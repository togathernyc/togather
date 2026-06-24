/**
 * Tests for the dev-assistant bug lifecycle DB ops (functions/devAssistant/bugs.ts).
 *
 * Covers the state machine guards, dispatch idempotency (markDispatched), and
 * callback idempotency/transition handling (applyCallback). The agent loop,
 * OpenAI calls, and outbound routine POST are out of scope here — this exercises
 * the pure DB transitions the rest of the pipeline depends on.
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

    const { bugId, reviewLink } = await t.mutation(
      internal.functions.devAssistant.bugs.createBug,
      {
        communityId,
        channelId,
        originatorUserId: userId,
        title: "Fix the thing",
        body: "The thing is broken; make it not broken.",
      },
    );

    expect(reviewLink).toBe(`/(user)/admin/bugs/${bugId}`);
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

  test("applyCallback advances valid transitions and ignores illegal ones", async () => {
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

    // Valid: IN_PROGRESS -> CODE_REVIEW with a PR url.
    const afterReview = await t.mutation(
      internal.functions.devAssistant.bugs.applyCallback,
      { bugId, status: "CODE_REVIEW", prUrl: "https://example.com/pr/1" },
    );
    expect(afterReview?.status).toBe("CODE_REVIEW");
    expect(afterReview?.prUrl).toBe("https://example.com/pr/1");

    // Illegal: CODE_REVIEW -> MERGED (skips READY_TO_MERGE) is ignored.
    const illegal = await t.mutation(
      internal.functions.devAssistant.bugs.applyCallback,
      { bugId, status: "MERGED" },
    );
    expect(illegal?.status).toBe("CODE_REVIEW");
    expect(illegal?.lastError).toContain("Ignored callback transition");

    // Correlate by routineRunId.
    const byRun = await t.query(
      internal.functions.devAssistant.bugs.getBugByRoutineRunId,
      { routineRunId: "run-789" },
    );
    expect(byRun?._id).toBe(bugId);
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
