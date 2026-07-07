/**
 * Tests for the dev-assistant bug lifecycle DB ops (functions/devAssistant/bugs.ts).
 *
 * Covers the state machine guards, dispatch idempotency (markDispatched), and
 * callback idempotency/transition handling (applyCallback). The agent loop and
 * OpenAI calls are out of scope here — this exercises the pure DB transitions
 * the rest of the pipeline depends on, plus the required headers on the outbound
 * routine POST (the Claude Code fire endpoint rejects requests missing
 * anthropic-version).
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, afterEach } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

vi.useFakeTimers();

let activeHandle: ReturnType<typeof convexTest> | null = null;
afterEach(async () => {
  if (activeHandle) {
    await activeHandle.finishAllScheduledFunctions(vi.runAllTimers);
    activeHandle = null;
  }
  vi.clearAllTimers();
});

async function seedContext(t: ReturnType<typeof convexTest>): Promise<{
  communityId: Id<"communities">;
  channelId: Id<"chatChannels">;
  userId: Id<"users">;
}> {
  const now = Date.now();
  return await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "test-dev-assistant",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });
    const userId = await ctx.db.insert("users", {
      firstName: "Staffer",
      lastName: "McStaff",
      isStaff: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const channelId = await ctx.db.insert("chatChannels", {
      communityId,
      channelType: "main",
      name: "general",
      createdById: userId,
      createdAt: now,
      updatedAt: now,
      isArchived: false,
      memberCount: 1,
    });
    return { communityId, channelId, userId };
  });
}

describe("dev-assistant bug lifecycle", () => {
  test("createBug opens IN_REVIEW with a review link", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { communityId, channelId, userId } = await seedContext(t);

    const { bugId, reviewLink, reviewUrl } = await t.mutation(
      internal.functions.devAssistant.bugs.createBug,
      {
        communityId,
        channelId,
        originatorUserId: userId,
        title: "Fix the thing",
        body: "The thing is broken; make it not broken.",
      },
    );

    // In-app router path keeps the `(user)` route group for navigation.
    expect(reviewLink).toBe(`/(user)/admin/bugs/${bugId}`);
    // Chat-facing URL is absolute, on togather.nyc, and drops the route group.
    expect(reviewUrl).toBe(`https://togather.nyc/admin/bugs/${bugId}`);
    expect(reviewUrl).not.toContain("togather.com");
    expect(reviewUrl).not.toContain("(user)");
    const bug = await t.query(internal.functions.devAssistant.bugs.getBug, {
      bugId,
    });
    expect(bug?.status).toBe("IN_REVIEW");
    expect(bug?.reviewLink).toBe(reviewLink);
  });

  test("updateBug only edits while in review", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { communityId, channelId, userId } = await seedContext(t);

    const { bugId } = await t.mutation(
      internal.functions.devAssistant.bugs.createBug,
      { communityId, channelId, originatorUserId: userId, title: "T", body: "B" },
    );

    const ok = await t.mutation(internal.functions.devAssistant.bugs.updateBug, {
      bugId,
      body: "Revised brief",
    });
    expect(ok.ok).toBe(true);

    // Move past review (simulate dispatch).
    await t.mutation(internal.functions.devAssistant.bugs.setBugStatus, {
      bugId,
      status: "READY_FOR_IMPL",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(bugId, { status: "IN_PROGRESS" });
    });

    const blocked = await t.mutation(
      internal.functions.devAssistant.bugs.updateBug,
      { bugId, body: "too late" },
    );
    expect(blocked.ok).toBe(false);
  });

  test("setBugStatus rejects anything but READY_FOR_IMPL", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { communityId, channelId, userId } = await seedContext(t);
    const { bugId } = await t.mutation(
      internal.functions.devAssistant.bugs.createBug,
      { communityId, channelId, originatorUserId: userId, title: "T", body: "B" },
    );

    const res = await t.mutation(
      internal.functions.devAssistant.bugs.setBugStatus,
      { bugId, status: "MERGED" },
    );
    expect(res.ok).toBe(false);
  });

  test("markDispatched is idempotent (no double-run)", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { communityId, channelId, userId } = await seedContext(t);
    const { bugId } = await t.mutation(
      internal.functions.devAssistant.bugs.createBug,
      { communityId, channelId, originatorUserId: userId, title: "T", body: "B" },
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(bugId, { status: "READY_FOR_IMPL" });
    });

    const first = await t.mutation(
      internal.functions.devAssistant.bugs.markDispatched,
      { bugId, routineRunId: "run-123" },
    );
    expect(first.alreadyDispatched).toBe(false);

    const second = await t.mutation(
      internal.functions.devAssistant.bugs.markDispatched,
      { bugId, routineRunId: "run-456" },
    );
    expect(second.alreadyDispatched).toBe(true);

    const bug = await t.query(internal.functions.devAssistant.bugs.getBug, {
      bugId,
    });
    expect(bug?.status).toBe("IN_PROGRESS");
    expect(bug?.routineRunId).toBe("run-123");
  });

  test("applyCallback advances valid transitions and rejects illegal ones without persisting anything", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { communityId, channelId, userId } = await seedContext(t);
    const { bugId } = await t.mutation(
      internal.functions.devAssistant.bugs.createBug,
      { communityId, channelId, originatorUserId: userId, title: "T", body: "B" },
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(bugId, {
        status: "IN_PROGRESS",
        routineRunId: "run-789",
      });
    });

    // Illegal: IN_PROGRESS -> READY_TO_MERGE (skips CODE_REVIEW) is rejected,
    // and the rejected callback persists NOTHING else — the prUrl and spec it
    // carried must not land on the row.
    const illegal = await t.mutation(
      internal.functions.devAssistant.bugs.applyCallback,
      {
        bugId,
        status: "READY_TO_MERGE",
        prUrl: "https://example.com/pr/smuggled",
        spec: "## Smuggled",
      },
    );
    expect(illegal?.status).toBe("IN_PROGRESS");
    expect(illegal?.lastError).toContain("Ignored callback transition");
    expect(illegal?.prUrl).toBeUndefined();
    expect(illegal?.spec).toBeUndefined();

    // Valid: IN_PROGRESS -> CODE_REVIEW with a PR url (clears the lastError).
    const afterReview = await t.mutation(
      internal.functions.devAssistant.bugs.applyCallback,
      { bugId, status: "CODE_REVIEW", prUrl: "https://example.com/pr/1" },
    );
    expect(afterReview?.status).toBe("CODE_REVIEW");
    expect(afterReview?.prUrl).toBe("https://example.com/pr/1");
    expect(afterReview?.lastError).toBeUndefined();

    // Correlate by routineRunId.
    const byRun = await t.query(
      internal.functions.devAssistant.bugs.getBugByRoutineRunId,
      { routineRunId: "run-789" },
    );
    expect(byRun?._id).toBe(bugId);

    // MERGED is webhook/auto-merge-only: a routine-source callback may not
    // claim a merge, even where the transition map would allow it.
    const routineMerge = await t.mutation(
      internal.functions.devAssistant.bugs.applyCallback,
      { bugId, status: "MERGED" },
    );
    expect(routineMerge?.status).toBe("CODE_REVIEW");
    expect(routineMerge?.shippedAt).toBeUndefined();
    expect(routineMerge?.lastError).toContain("MERGED");

    // The GitHub webhook is ground truth for merges and applies it.
    const merged = await t.mutation(
      internal.functions.devAssistant.bugs.applyCallback,
      { bugId, status: "MERGED", source: "webhook" },
    );
    expect(merged?.status).toBe("MERGED");
    expect(merged?.shippedAt).toBeTruthy();
    expect(merged?.lastError).toBeUndefined();
  });

  test("webhook-source MERGED applies even from IN_PROGRESS (early GitHub merge)", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { communityId, channelId, userId } = await seedContext(t);
    const { bugId } = await t.mutation(
      internal.functions.devAssistant.bugs.createBug,
      { communityId, channelId, originatorUserId: userId, title: "T", body: "B" },
    );
    // The PR was merged on GitHub before the implementation callback landed —
    // without the webhook allowance the row would strand at IN_PROGRESS.
    await t.run(async (ctx) => {
      await ctx.db.patch(bugId, {
        status: "IN_PROGRESS",
        routineRunId: "run-early",
        activeRunMode: "implement",
      });
    });

    const merged = await t.mutation(
      internal.functions.devAssistant.bugs.applyCallback,
      { bugId, status: "MERGED", source: "webhook" },
    );
    expect(merged?.status).toBe("MERGED");
    expect(merged?.shippedAt).toBeTruthy();
  });

  test("mark*Dispatched stamp activeRunMode for their mode", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { communityId, channelId, userId } = await seedContext(t);

    // implement: markDispatched (READY_FOR_IMPL -> IN_PROGRESS).
    const { bugId } = await t.mutation(
      internal.functions.devAssistant.bugs.createBug,
      { communityId, channelId, originatorUserId: userId, title: "T", body: "B" },
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(bugId, { status: "READY_FOR_IMPL" });
    });
    await t.mutation(internal.functions.devAssistant.bugs.markDispatched, {
      bugId,
      routineRunId: "run-impl",
    });
    let bug = await t.query(internal.functions.devAssistant.bugs.getBug, {
      bugId,
    });
    expect(bug?.activeRunMode).toBe("implement");

    // review: markReviewDispatched (CODE_REVIEW only).
    await t.run(async (ctx) => {
      await ctx.db.patch(bugId, { status: "CODE_REVIEW" });
    });
    await t.mutation(
      internal.functions.devAssistant.bugs.markReviewDispatched,
      { bugId, routineRunId: "run-review" },
    );
    bug = await t.query(internal.functions.devAssistant.bugs.getBug, { bugId });
    expect(bug?.activeRunMode).toBe("review");
    expect(bug?.routineRunId).toBe("run-review");

    // fix: markFixDispatched (CODE_REVIEW only; also counts the round).
    await t.mutation(internal.functions.devAssistant.bugs.markFixDispatched, {
      bugId,
      routineRunId: "run-fix",
    });
    bug = await t.query(internal.functions.devAssistant.bugs.getBug, { bugId });
    expect(bug?.activeRunMode).toBe("fix");
    expect(bug?.fixRounds).toBe(1);

    // spec: markSpecDispatched (fresh DRAFT dashboard row).
    const now = Date.now();
    const specBugId = await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: userId,
        status: "DRAFT",
        kind: "bug",
        source: "dashboard",
        title: "T",
        body: "B",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await t.mutation(internal.functions.devAssistant.bugs.markSpecDispatched, {
      bugId: specBugId,
      routineRunId: "run-spec",
    });
    const specBug = await t.query(internal.functions.devAssistant.bugs.getBug, {
      bugId: specBugId,
    });
    expect(specBug?.activeRunMode).toBe("spec");
  });

  test("applyCallback ignores stale backward replays (monotonic lifecycle)", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { communityId, channelId, userId } = await seedContext(t);
    const { bugId } = await t.mutation(
      internal.functions.devAssistant.bugs.createBug,
      { communityId, channelId, originatorUserId: userId, title: "T", body: "B" },
    );
    // Bug has already advanced to READY_TO_MERGE.
    await t.run(async (ctx) => {
      await ctx.db.patch(bugId, {
        status: "READY_TO_MERGE",
        routineRunId: "run-stale",
        prUrl: "https://example.com/pr/9",
      });
    });

    // A reordered/retried older CODE_REVIEW callback must NOT move the bug
    // backward and clear the ready-to-merge state.
    const replay = await t.mutation(
      internal.functions.devAssistant.bugs.applyCallback,
      { bugId, status: "CODE_REVIEW" },
    );
    expect(replay?.status).toBe("READY_TO_MERGE");
    expect(replay?.lastError).toContain("Ignored callback transition");
  });
});

describe("dev-assistant routine dispatch", () => {
  const ROUTINE_ENV = {
    CLAUDE_ROUTINES_TRIGGER_URL:
      "https://api.anthropic.com/v1/claude_code/routines/trig_test/fire",
    CLAUDE_ROUTINES_TOKEN: "test-token",
    CONVEX_SITE_URL: "https://example.convex.site",
  } as const;

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of Object.keys(ROUTINE_ENV)) delete process.env[key];
  });

  test("dispatchBug posts the brief in `text` with the anthropic-version header", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { communityId, channelId, userId } = await seedContext(t);
    const { bugId } = await t.mutation(
      internal.functions.devAssistant.bugs.createBug,
      { communityId, channelId, originatorUserId: userId, title: "T", body: "B" },
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(bugId, { status: "READY_FOR_IMPL" });
    });

    Object.assign(process.env, ROUTINE_ENV);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.functions.devAssistant.actions.dispatchBug, {
      bugId,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({
      "anthropic-version": "2023-06-01",
    });

    // The fire endpoint reads the per-invocation payload from `text` and ignores
    // other top-level fields, so the brief must be JSON-stringified into `text`.
    const sentBody = JSON.parse(init.body as string);
    expect(Object.keys(sentBody)).toEqual(["text"]);
    const brief = JSON.parse(sentBody.text);
    expect(brief).toMatchObject({
      bugId,
      title: "T",
      body: "B",
      callbackUrl: `${ROUTINE_ENV.CONVEX_SITE_URL}/dev-assistant/callback`,
    });

    // The endpoint accepted it, so the bug stays in the dispatched lane.
    const bug = await t.query(internal.functions.devAssistant.bugs.getBug, {
      bugId,
    });
    expect(bug?.status).toBe("IN_PROGRESS");
  });
});
