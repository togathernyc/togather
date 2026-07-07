/**
 * Contributor Dev Dashboard tests (functions/devAssistant/contributions.ts,
 * ADR-029 Phase 1 + Phase 1.5).
 *
 * Covers the dashboard surface: submit -> platform-level DRAFT row + spec
 * dispatch, the spec-approval gate (auto-dispatch for low risk, explicit
 * startBuild otherwise), the spec-delivering callback (DRAFT -> IN_REVIEW),
 * shipped stamping, and unified contribution history (chat + dashboard).
 *
 * Phase 1.5 adds the conversation layer (devBugMessages): the report seeds the
 * thread, postMessage triggers spec-revision rounds, spec callbacks deliver
 * triage fields (aiTitle/area/scope/verifyOnStaging) + an assistant turn,
 * callback transitions log system turns, and the staging verification gate
 * (confirmStaging / reportStagingIssue).
 *
 * Auth is mocked (mirrors devAssistant-maintainers.test.ts): the token IS the
 * caller's user id, so each test "logs in" by passing a user id as the token.
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, afterEach } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

vi.useFakeTimers();

// Token == userId in these tests. requireAuth(User) resolves from the db.
vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    requireAuth: vi.fn(async (_ctx: unknown, token: string) => {
      if (!token) throw new Error("Not authenticated");
      return token;
    }),
    requireAuthUser: vi.fn(async (ctx: any, token: string) => {
      if (!token) throw new Error("Not authenticated");
      const user = await ctx.db.get(token);
      if (!user) throw new Error("User not found");
      return user;
    }),
  };
});

let activeHandle: ReturnType<typeof convexTest> | null = null;
afterEach(async () => {
  if (activeHandle) {
    await activeHandle.finishAllScheduledFunctions(vi.runAllTimers);
    activeHandle = null;
  }
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  delete process.env.CLAUDE_ROUTINES_TRIGGER_URL;
  delete process.env.CLAUDE_ROUTINES_TOKEN;
  delete process.env.CONVEX_SITE_URL;
  delete process.env.DEV_ASSISTANT_CALLBACK_SECRET;
});

async function seedUsers(t: ReturnType<typeof convexTest>): Promise<{
  maintainerId: Id<"users">;
  otherMaintainerId: Id<"users">;
  regularUserId: Id<"users">;
}> {
  const now = Date.now();
  return await t.run(async (ctx) => {
    const maintainerId = await ctx.db.insert("users", {
      firstName: "Connie",
      lastName: "Tributor",
      platformRoles: ["dev_maintainer"],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const otherMaintainerId = await ctx.db.insert("users", {
      firstName: "Marge",
      lastName: "Maintainer",
      isStaff: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const regularUserId = await ctx.db.insert("users", {
      firstName: "Randy",
      lastName: "Random",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return { maintainerId, otherMaintainerId, regularUserId };
  });
}

function stubRoutineEnv() {
  process.env.CLAUDE_ROUTINES_TRIGGER_URL =
    "https://api.anthropic.com/v1/claude_code/routines/trig_test/fire";
  process.env.CLAUDE_ROUTINES_TOKEN = "test-token";
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("submit", () => {
  test("creates a platform-level DRAFT row and dispatches the spec agent", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const fetchMock = stubRoutineEnv();

    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      {
        token: maintainerId,
        kind: "feature",
        title: "Add dark mode",
        body: "The app should support dark mode.",
      },
    );

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("DRAFT");
    expect(bug?.kind).toBe("feature");
    expect(bug?.source).toBe("dashboard");
    expect(bug?.originatorUserId).toBe(maintainerId);
    expect(bug?.communityId).toBeUndefined();
    expect(bug?.channelId).toBeUndefined();

    // The scheduled dispatchSpec fires the routine in spec mode and stamps a
    // routineRunId while the row stays DRAFT.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const brief = JSON.parse(JSON.parse(init.body as string).text);
    expect(brief).toMatchObject({
      mode: "spec",
      bugId: id,
      kind: "feature",
      title: "Add dark mode",
      callbackUrl: "https://example.convex.site/dev-assistant/callback",
    });

    const dispatched = await t.run(async (ctx) => ctx.db.get(id));
    expect(dispatched?.status).toBe("DRAFT");
    expect(dispatched?.routineRunId).toBeTruthy();
  });

  test("rejects non-maintainers", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { regularUserId } = await seedUsers(t);

    await expect(
      t.mutation(api.functions.devAssistant.contributions.submit, {
        token: regularUserId,
        kind: "bug",
        title: "Nope",
        body: "Not allowed",
      }),
    ).rejects.toThrow(/Not authorized/);
  });
});

/**
 * Submit a dashboard contribution and deliver the spec callback (optionally
 * with Phase 1.5 triage fields). Returns the devBugs id.
 */
async function submitAndDeliverSpec(
  t: ReturnType<typeof convexTest>,
  maintainerId: Id<"users">,
  riskLevel: "low" | "medium" | "high",
  triage?: {
    aiTitle?: string;
    area?: string;
    scope?: "buildable" | "split" | "design_needed";
    verifyOnStaging?: boolean;
  },
): Promise<Id<"devBugs">> {
  stubRoutineEnv();
  const id = await t.mutation(
    api.functions.devAssistant.contributions.submit,
    {
      token: maintainerId,
      kind: "bug",
      title: "Fix typo",
      body: "There is a typo on the profile screen.",
    },
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const bug = await t.run(async (ctx) => ctx.db.get(id));

  await t.action(
    internal.functions.devAssistant.actions.handleRoutineCallback,
    {
      bugId: id,
      routineRunId: bug!.routineRunId!,
      status: "IN_REVIEW",
      spec: "## Plan\nChange the string.",
      riskLevel,
      ...triage,
    },
  );
  return id;
}

describe("spec callback", () => {

  test("delivers spec + riskLevel and moves DRAFT -> IN_REVIEW", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);

    const id = await submitAndDeliverSpec(t, maintainerId, "medium");

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("IN_REVIEW");
    expect(bug?.spec).toBe("## Plan\nChange the string.");
    expect(bug?.riskLevel).toBe("medium");

    // The originator got a "spec ready" notification record (no push tokens in
    // tests, so the record is created as pending).
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const notifications = await t.run(async (ctx) =>
      ctx.db.query("notifications").collect(),
    );
    const specReady = notifications.filter(
      (n) =>
        n.userId === maintainerId &&
        n.notificationType === "dev_contribution_update",
    );
    expect(specReady).toHaveLength(1);
    expect(specReady[0]?.title).toMatch(/Spec ready/);
  });

  test("approveSpec on low risk auto-dispatches to READY_FOR_IMPL/IN_PROGRESS", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);

    const id = await submitAndDeliverSpec(t, maintainerId, "low");

    const result = await t.mutation(
      api.functions.devAssistant.contributions.approveSpec,
      { token: maintainerId, id },
    );
    expect(result.autoDispatched).toBe(true);

    const approved = await t.run(async (ctx) => ctx.db.get(id));
    expect(approved?.specApprovedAt).toBeTruthy();
    // READY_FOR_IMPL scheduled dispatchBug; after scheduled functions run the
    // bug is IN_PROGRESS (dispatched to the routine).
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const dispatched = await t.run(async (ctx) => ctx.db.get(id));
    expect(dispatched?.status).toBe("IN_PROGRESS");
  });

  test("approveSpec on high risk stays IN_REVIEW with specApprovedAt", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);

    const id = await submitAndDeliverSpec(t, maintainerId, "high");

    const result = await t.mutation(
      api.functions.devAssistant.contributions.approveSpec,
      { token: maintainerId, id },
    );
    expect(result.autoDispatched).toBe(false);

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("IN_REVIEW");
    expect(bug?.specApprovedAt).toBeTruthy();
  });

  test("startBuild requires an approved spec, then dispatches", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId, otherMaintainerId } = await seedUsers(t);

    const id = await submitAndDeliverSpec(t, maintainerId, "high");

    // Gate: no specApprovedAt yet.
    await expect(
      t.mutation(api.functions.devAssistant.contributions.startBuild, {
        token: otherMaintainerId,
        id,
      }),
    ).rejects.toThrow(/approved/);

    await t.mutation(api.functions.devAssistant.contributions.approveSpec, {
      token: maintainerId,
      id,
    });
    await t.mutation(api.functions.devAssistant.contributions.startBuild, {
      token: otherMaintainerId,
      id,
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("IN_PROGRESS");

    // startBuild by someone other than the originator pushes the originator.
    const notifications = await t.run(async (ctx) =>
      ctx.db.query("notifications").collect(),
    );
    const buildStarted = notifications.filter(
      (n) => n.userId === maintainerId && /Build started/.test(n.title),
    );
    expect(buildStarted).toHaveLength(1);
  });

  test("approveSpec rejects items without a spec", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    stubRoutineEnv();

    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      {
        token: maintainerId,
        kind: "bug",
        title: "T",
        body: "B",
      },
    );

    // Still DRAFT, no spec.
    await expect(
      t.mutation(api.functions.devAssistant.contributions.approveSpec, {
        token: maintainerId,
        id,
      }),
    ).rejects.toThrow(/in review/);
  });
});

describe("shipped", () => {
  test("MERGED callback stamps shippedAt and records a shipped notification", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const now = Date.now();

    // A dashboard item already at READY_TO_MERGE.
    const id = await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: maintainerId,
        status: "READY_TO_MERGE",
        kind: "bug",
        source: "dashboard",
        title: "Fix typo",
        body: "B",
        routineRunId: "run-ship",
        prUrl: "https://example.com/pr/1",
        createdAt: now,
        updatedAt: now,
      }),
    );

    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      { bugId: id, routineRunId: "run-ship", status: "MERGED" },
    );

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("MERGED");
    expect(bug?.shippedAt).toBeTruthy();

    const notifications = await t.run(async (ctx) =>
      ctx.db.query("notifications").collect(),
    );
    expect(
      notifications.some(
        (n) => n.userId === maintainerId && /shipped/i.test(n.title),
      ),
    ).toBe(true);
  });
});

describe("queries", () => {
  test("myContributions includes chat-originated items, newest first", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId, otherMaintainerId } = await seedUsers(t);
    const now = Date.now();

    // Chat-originated bug by the maintainer (has community/channel).
    const { communityId, channelId } = await t.run(async (ctx) => {
      const communityId = await ctx.db.insert("communities", {
        name: "Test Community",
        slug: "test-contributions",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      });
      const channelId = await ctx.db.insert("chatChannels", {
        communityId,
        channelType: "main",
        name: "general",
        createdById: maintainerId,
        createdAt: now,
        updatedAt: now,
        isArchived: false,
        memberCount: 1,
      });
      return { communityId, channelId };
    });
    const { bugId: chatBugId } = await t.mutation(
      internal.functions.devAssistant.bugs.createBug,
      {
        communityId,
        channelId,
        originatorUserId: maintainerId,
        title: "Chat bug",
        body: "From a thread",
      },
    );

    stubRoutineEnv();
    const dashboardId = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      { token: maintainerId, kind: "bug", title: "Dashboard bug", body: "B" },
    );
    // Someone else's item must not appear.
    const otherId = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      { token: otherMaintainerId, kind: "bug", title: "Other's bug", body: "B" },
    );

    const mine = await t.query(
      api.functions.devAssistant.contributions.myContributions,
      { token: maintainerId },
    );
    expect(mine.map((b) => b._id)).toEqual([dashboardId, chatBugId]);
    expect(mine.map((b) => b._id)).not.toContain(otherId);

    // listAll sees everything (any maintainer).
    const all = await t.query(
      api.functions.devAssistant.contributions.listAll,
      { token: otherMaintainerId },
    );
    expect(all.map((b) => b._id)).toEqual([otherId, dashboardId, chatBugId]);

    // getContribution: any maintainer may view any item.
    const viewed = await t.query(
      api.functions.devAssistant.contributions.getContribution,
      { token: otherMaintainerId, id: dashboardId },
    );
    expect(viewed?._id).toBe(dashboardId);
  });

  test("myContributions carries lastMessageBody/lastMessageAuthorType", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    stubRoutineEnv();

    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      {
        token: maintainerId,
        kind: "bug",
        title: "Fix typo",
        body: "There is a typo on the profile screen.",
      },
    );

    // Right after submit the latest turn is the report itself.
    let mine = await t.query(
      api.functions.devAssistant.contributions.myContributions,
      { token: maintainerId },
    );
    expect(mine[0]?._id).toBe(id);
    expect(mine[0]?.lastMessageBody).toBe(
      "There is a typo on the profile screen.",
    );
    expect(mine[0]?.lastMessageAuthorType).toBe("user");

    // After the spec callback, the assistant's spec is the latest turn.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.setSystemTime(Date.now() + 1000);
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: id,
        routineRunId: bug!.routineRunId!,
        status: "IN_REVIEW",
        spec: "## Plan\nChange the string.",
        riskLevel: "low",
      },
    );

    mine = await t.query(
      api.functions.devAssistant.contributions.myContributions,
      { token: maintainerId },
    );
    expect(mine[0]?.lastMessageBody).toBe("## Plan\nChange the string.");
    expect(mine[0]?.lastMessageAuthorType).toBe("assistant");
  });
});

describe("conversation thread (Phase 1.5)", () => {
  test("submit seeds the thread with the report as the first user message", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    stubRoutineEnv();

    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      {
        token: maintainerId,
        kind: "bug",
        title: "Fix typo",
        body: "There is a typo on the profile screen.",
      },
    );

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({
      bugId: id,
      authorType: "user",
      userId: maintainerId,
      body: "There is a typo on the profile screen.",
    });
  });

  test("spec callback stores triage fields and appends an assistant message", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);

    const id = await submitAndDeliverSpec(t, maintainerId, "low", {
      aiTitle: "Fix profile typo",
      area: "settings",
      scope: "buildable",
      verifyOnStaging: false,
    });

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("IN_REVIEW");
    expect(bug?.aiTitle).toBe("Fix profile typo");
    expect(bug?.area).toBe("settings");
    expect(bug?.scope).toBe("buildable");
    expect(bug?.verifyOnStaging).toBe(false);

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    // Report (user) then spec (assistant), oldest first.
    expect(thread.map((m) => m.authorType)).toEqual(["user", "assistant"]);
    expect(thread[1]?.body).toBe("## Plan\nChange the string.");
  });

  test("postMessage appends a user turn and fires a spec-revision dispatch while IN_REVIEW", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);

    const id = await submitAndDeliverSpec(t, maintainerId, "medium");
    const beforeBug = await t.run(async (ctx) => ctx.db.get(id));
    // Consume the submit-time dispatch + spec-callback side effects, then
    // re-stub fetch so the next call we see is the revision dispatch.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const fetchMock = stubRoutineEnv();
    vi.setSystemTime(Date.now() + 1000);

    const messageId = await t.mutation(
      api.functions.devAssistant.contributions.postMessage,
      { token: maintainerId, id, body: "Please also cover the settings tab." },
    );
    expect(messageId).toBeTruthy();

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const brief = JSON.parse(JSON.parse(init.body as string).text);
    expect(brief).toMatchObject({ mode: "spec", revision: true, bugId: id });
    expect(brief.instructions).toMatch(/REVISION ROUND/);
    // Full thread history rides along: report, spec, and the new reply.
    expect(
      brief.thread.map((m: { authorType: string }) => m.authorType),
    ).toEqual(["user", "assistant", "user"]);
    expect(brief.thread[2]?.body).toBe("Please also cover the settings tab.");
    expect(brief.thread[2]?.authorName).toBe("Connie Tributor");

    // Revision rounds stamp a FRESH routineRunId (stale callbacks orphaned).
    const afterBug = await t.run(async (ctx) => ctx.db.get(id));
    expect(afterBug?.routineRunId).toBeTruthy();
    expect(afterBug?.routineRunId).not.toBe(beforeBug?.routineRunId);
    expect(afterBug?.status).toBe("IN_REVIEW");
  });

  test("postMessage past the spec phase records the turn without dispatching", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const now = Date.now();

    const id = await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: maintainerId,
        status: "IN_PROGRESS",
        kind: "bug",
        source: "dashboard",
        title: "Fix typo",
        body: "B",
        routineRunId: "run-build",
        createdAt: now,
        updatedAt: now,
      }),
    );

    const fetchMock = stubRoutineEnv();
    await t.mutation(api.functions.devAssistant.contributions.postMessage, {
      token: maintainerId,
      id,
      body: "Any update?",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).not.toHaveBeenCalled();

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread).toHaveLength(1);
    expect(thread[0]?.body).toBe("Any update?");
  });

  test("approveSpec rejects non-buildable scopes", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId, otherMaintainerId } = await seedUsers(t);

    const splitId = await submitAndDeliverSpec(t, maintainerId, "low", {
      scope: "split",
    });
    await expect(
      t.mutation(api.functions.devAssistant.contributions.approveSpec, {
        token: maintainerId,
        id: splitId,
      }),
    ).rejects.toThrow(/too large/);

    const designId = await submitAndDeliverSpec(t, otherMaintainerId, "low", {
      scope: "design_needed",
    });
    await expect(
      t.mutation(api.functions.devAssistant.contributions.approveSpec, {
        token: otherMaintainerId,
        id: designId,
      }),
    ).rejects.toThrow(/design decisions/);

    const split = await t.run(async (ctx) => ctx.db.get(splitId));
    expect(split?.specApprovedAt).toBeUndefined();
    expect(split?.status).toBe("IN_REVIEW");
  });

  test("callback status transitions log system messages (once each)", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const now = Date.now();

    const id = await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: maintainerId,
        status: "IN_PROGRESS",
        kind: "bug",
        source: "dashboard",
        title: "Fix typo",
        body: "B",
        routineRunId: "run-transitions",
        createdAt: now,
        updatedAt: now,
      }),
    );

    for (const status of ["CODE_REVIEW", "READY_TO_MERGE", "MERGED"] as const) {
      vi.setSystemTime(Date.now() + 1000);
      await t.action(
        internal.functions.devAssistant.actions.handleRoutineCallback,
        { bugId: id, routineRunId: "run-transitions", status },
      );
    }
    // A re-delivered MERGED callback must not duplicate the system message.
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      { bugId: id, routineRunId: "run-transitions", status: "MERGED" },
    );

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread.every((m) => m.authorType === "system")).toBe(true);
    expect(thread.map((m) => m.body)).toEqual([
      "Pull request opened",
      "Ready to merge",
      "Shipped 🎉",
    ]);
  });

  test("CODE_REVIEW push says 'test on staging' when verifyOnStaging is set", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const now = Date.now();

    const id = await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: maintainerId,
        status: "IN_PROGRESS",
        kind: "bug",
        source: "dashboard",
        title: "Fix RSVP message",
        body: "B",
        routineRunId: "run-staging-push",
        verifyOnStaging: true,
        createdAt: now,
        updatedAt: now,
      }),
    );

    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: id,
        routineRunId: "run-staging-push",
        status: "CODE_REVIEW",
        prUrl: "https://example.com/pr/2",
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const notifications = await t.run(async (ctx) =>
      ctx.db.query("notifications").collect(),
    );
    const stagingPush = notifications.filter(
      (n) => n.userId === maintainerId && /staging/i.test(n.title),
    );
    expect(stagingPush).toHaveLength(1);
    expect(stagingPush[0]?.title).toBe("Ready to test on staging");
  });
});

describe("AI review cycle", () => {
  /** Seed a dashboard item somewhere in the build/review pipeline. */
  async function seedPipelineBug(
    t: ReturnType<typeof convexTest>,
    originatorId: Id<"users">,
    overrides: Partial<{
      status: "IN_PROGRESS" | "CODE_REVIEW" | "READY_TO_MERGE";
      prUrl: string;
      routineRunId: string;
      reviewVerdict: "approved" | "changes_requested";
      reviewSummary: string;
    }> = {},
  ): Promise<Id<"devBugs">> {
    const now = Date.now();
    return await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: originatorId,
        status: overrides.status ?? "IN_PROGRESS",
        kind: "bug",
        source: "dashboard",
        title: "Fix typo",
        aiTitle: "Fix profile typo",
        body: "B",
        spec: "## Plan\nChange the string.",
        riskLevel: "low",
        routineRunId: overrides.routineRunId ?? "run-impl",
        prUrl: overrides.prUrl,
        reviewVerdict: overrides.reviewVerdict,
        reviewSummary: overrides.reviewSummary,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  test("genuine CODE_REVIEW transition dispatches the review routine exactly once", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const id = await seedPipelineBug(t, maintainerId);
    const fetchMock = stubRoutineEnv();

    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: id,
        routineRunId: "run-impl",
        status: "CODE_REVIEW",
        prUrl: "https://example.com/pr/1",
      },
    );
    // Re-delivered before the scheduled dispatch runs: CODE_REVIEW ->
    // CODE_REVIEW is an idempotent re-apply, not a genuine transition, so it
    // must not schedule a second review dispatch.
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: id,
        routineRunId: "run-impl",
        status: "CODE_REVIEW",
        prUrl: "https://example.com/pr/1",
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const brief = JSON.parse(JSON.parse(init.body as string).text);
    expect(brief).toMatchObject({
      mode: "review",
      bugId: id,
      prUrl: "https://example.com/pr/1",
      title: "Fix typo",
      aiTitle: "Fix profile typo",
      spec: "## Plan\nChange the string.",
      riskLevel: "low",
      callbackUrl: "https://example.convex.site/dev-assistant/callback",
    });
    expect(brief.instructions).toMatch(/reviewVerdict/);
    expect(brief.instructions).toMatch(/subagents/);
    expect(brief.instructions).toMatch(/PR review comments/);

    // The review run owns callback correlation from here on: a fresh
    // routineRunId replaced the implementation run's.
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("CODE_REVIEW");
    expect(bug?.routineRunId).toBeTruthy();
    expect(bug?.routineRunId).not.toBe("run-impl");

    // A late replay from the superseded implementation run fails correlation
    // and is dropped entirely — no re-dispatch.
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      { bugId: id, routineRunId: "run-impl", status: "CODE_REVIEW" },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("CODE_REVIEW without a prUrl skips review dispatch with a breadcrumb", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const id = await seedPipelineBug(t, maintainerId);
    const fetchMock = stubRoutineEnv();

    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      { bugId: id, routineRunId: "run-impl", status: "CODE_REVIEW" },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).not.toHaveBeenCalled();
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("CODE_REVIEW");
    expect(bug?.lastError).toMatch(/no prUrl/);
    // No dispatch happened, so the implementation run id is untouched.
    expect(bug?.routineRunId).toBe("run-impl");
  });

  test("approved verdict stores fields, logs system messages, and promotes to READY_TO_MERGE", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const id = await seedPipelineBug(t, maintainerId, {
      status: "CODE_REVIEW",
      routineRunId: "run-review",
      prUrl: "https://example.com/pr/1",
    });

    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: id,
        routineRunId: "run-review",
        status: "CODE_REVIEW",
        reviewVerdict: "approved",
        reviewSummary: "All reviewers passed; tests cover the fix.",
      },
    );

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("READY_TO_MERGE");
    expect(bug?.reviewVerdict).toBe("approved");
    expect(bug?.reviewSummary).toBe(
      "All reviewers passed; tests cover the fix.",
    );

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread.map((m) => [m.authorType, m.body])).toEqual([
      ["system", "Code review passed ✓"],
      ["system", "Ready to merge"],
    ]);
  });

  test("changes_requested stores the verdict and keeps CODE_REVIEW", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const id = await seedPipelineBug(t, maintainerId, {
      status: "CODE_REVIEW",
      routineRunId: "run-review",
      prUrl: "https://example.com/pr/1",
    });

    const longSummary = "x".repeat(250);
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: id,
        routineRunId: "run-review",
        status: "CODE_REVIEW",
        reviewVerdict: "changes_requested",
        reviewSummary: longSummary,
      },
    );

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("CODE_REVIEW");
    expect(bug?.reviewVerdict).toBe("changes_requested");
    // The full summary is stored; only the thread quote is truncated.
    expect(bug?.reviewSummary).toBe(longSummary);

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread).toHaveLength(1);
    expect(thread[0]?.authorType).toBe("system");
    expect(thread[0]?.body).toBe(
      `Code review requested changes — ${"x".repeat(200)}…`,
    );

    // A re-delivered identical verdict callback must not repost the message.
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: id,
        routineRunId: "run-review",
        status: "CODE_REVIEW",
        reviewVerdict: "changes_requested",
        reviewSummary: longSummary,
      },
    );
    const replayThread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(replayThread).toHaveLength(1);
  });

  test("a later genuine CODE_REVIEW entry clears a stale verdict and re-dispatches review", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    // A previous review round left changes_requested behind; the pipeline is
    // back in IN_PROGRESS producing a new PR revision.
    const id = await seedPipelineBug(t, maintainerId, {
      status: "IN_PROGRESS",
      routineRunId: "run-impl-2",
      reviewVerdict: "changes_requested",
      reviewSummary: "Old round: fix the null check.",
    });
    const fetchMock = stubRoutineEnv();

    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: id,
        routineRunId: "run-impl-2",
        status: "CODE_REVIEW",
        prUrl: "https://example.com/pr/2",
      },
    );

    // The stale verdict is gone the moment CODE_REVIEW applies.
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("CODE_REVIEW");
    expect(bug?.reviewVerdict).toBeUndefined();
    expect(bug?.reviewSummary).toBeUndefined();

    // And a fresh review run was dispatched for the new revision.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const brief = JSON.parse(JSON.parse(init.body as string).text);
    expect(brief).toMatchObject({
      mode: "review",
      bugId: id,
      prUrl: "https://example.com/pr/2",
    });
  });

  test("invalid reviewVerdict is rejected with 400 at the http layer", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const id = await seedPipelineBug(t, maintainerId, {
      status: "CODE_REVIEW",
      routineRunId: "run-review",
      prUrl: "https://example.com/pr/1",
    });

    process.env.DEV_ASSISTANT_CALLBACK_SECRET = "test-callback-secret";
    const sign = async (body: string): Promise<string> => {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode("test-callback-secret"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
      return Array.from(new Uint8Array(bytes))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    };
    const post = async (payload: Record<string, unknown>): Promise<Response> => {
      const body = JSON.stringify(payload);
      return await t.fetch("/dev-assistant/callback", {
        method: "POST",
        body,
        headers: { "x-togather-signature": await sign(body) },
      });
    };

    const bad = await post({
      bugId: id,
      routineRunId: "run-review",
      status: "CODE_REVIEW",
      reviewVerdict: "maybe",
    });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toMatch(/Unsupported reviewVerdict/);

    const badSummary = await post({
      bugId: id,
      routineRunId: "run-review",
      status: "CODE_REVIEW",
      reviewVerdict: "approved",
      reviewSummary: 42,
    });
    expect(badSummary.status).toBe(400);

    // A valid verdict passes validation and is accepted end-to-end.
    const ok = await post({
      bugId: id,
      routineRunId: "run-review",
      status: "CODE_REVIEW",
      reviewVerdict: "approved",
      reviewSummary: "Ship it.",
    });
    expect(ok.status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("READY_TO_MERGE");
    expect(bug?.reviewVerdict).toBe("approved");
  });
});

describe("staging verification", () => {
  async function seedStagingBug(
    t: ReturnType<typeof convexTest>,
    originatorId: Id<"users">,
    overrides: Partial<{
      status: "DRAFT" | "IN_REVIEW" | "IN_PROGRESS" | "CODE_REVIEW" | "READY_TO_MERGE" | "MERGED";
      verifyOnStaging: boolean;
      stagingVerifiedAt: number;
    }> = {},
  ): Promise<Id<"devBugs">> {
    const now = Date.now();
    return await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: originatorId,
        status: overrides.status ?? "CODE_REVIEW",
        kind: "bug",
        source: "dashboard",
        title: "Fix RSVP message",
        body: "B",
        routineRunId: "run-staging",
        verifyOnStaging: overrides.verifyOnStaging ?? true,
        stagingVerifiedAt: overrides.stagingVerifiedAt,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  test("confirmStaging stamps stagingVerifiedAt, logs a system message, and pushes the originator", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId, otherMaintainerId } = await seedUsers(t);

    const id = await seedStagingBug(t, maintainerId);
    await t.mutation(api.functions.devAssistant.contributions.confirmStaging, {
      token: otherMaintainerId,
      id,
    });

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.stagingVerifiedAt).toBeTruthy();
    expect(bug?.status).toBe("CODE_REVIEW"); // status untouched

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({
      authorType: "system",
      body: "Marge Maintainer confirmed it works on staging",
    });

    // Confirmed by someone else -> the originator gets a push.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const notifications = await t.run(async (ctx) =>
      ctx.db.query("notifications").collect(),
    );
    expect(
      notifications.some(
        (n) => n.userId === maintainerId && /staging/i.test(n.title),
      ),
    ).toBe(true);
  });

  test("confirmStaging rejects outside its validity window", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);

    // Not flagged for staging verification.
    const noFlagId = await seedStagingBug(t, maintainerId, {
      verifyOnStaging: false,
    });
    await expect(
      t.mutation(api.functions.devAssistant.contributions.confirmStaging, {
        token: maintainerId,
        id: noFlagId,
      }),
    ).rejects.toThrow(/does not require/);

    // Already verified.
    const doneId = await seedStagingBug(t, maintainerId, {
      stagingVerifiedAt: Date.now(),
    });
    await expect(
      t.mutation(api.functions.devAssistant.contributions.confirmStaging, {
        token: maintainerId,
        id: doneId,
      }),
    ).rejects.toThrow(/already verified/);

    // PR not up yet.
    const earlyId = await seedStagingBug(t, maintainerId, {
      status: "IN_PROGRESS",
    });
    await expect(
      t.mutation(api.functions.devAssistant.contributions.confirmStaging, {
        token: maintainerId,
        id: earlyId,
      }),
    ).rejects.toThrow(/current status/);
  });

  test("reportStagingIssue logs the note plus a failure marker (no dispatch)", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);

    const id = await seedStagingBug(t, maintainerId, {
      status: "READY_TO_MERGE",
    });
    const fetchMock = stubRoutineEnv();

    await t.mutation(
      api.functions.devAssistant.contributions.reportStagingIssue,
      { token: maintainerId, id, note: "The RSVP toast still says Going." },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).not.toHaveBeenCalled();

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread.map((m) => [m.authorType, m.body])).toEqual([
      ["user", "The RSVP toast still says Going."],
      ["system", "Staging check failed — needs another look"],
    ]);

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.stagingVerifiedAt).toBeUndefined();
    expect(bug?.status).toBe("READY_TO_MERGE");
  });
});
