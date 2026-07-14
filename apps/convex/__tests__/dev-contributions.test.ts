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
  delete process.env.CLAUDE_ROUTINES_TRIGGER_URL_IMPL;
  delete process.env.CLAUDE_ROUTINES_TOKEN_IMPL;
  delete process.env.CONVEX_SITE_URL;
  delete process.env.DEV_ASSISTANT_CALLBACK_SECRET;
  delete process.env.GH_MIRROR_TOKEN;
  delete process.env.GITHUB_MIRROR_TOKEN;
  delete process.env.GH_WEBHOOK_SECRET;
  delete process.env.AUTO_MERGE_ENABLED;
  delete process.env.AUTO_MERGE_METHOD;
  delete process.env.R2_PUBLIC_URL;
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
    expect(dispatched?.activeRunMode).toBe("spec");
  });

  test("seeds the repro into the opening thread turn", async () => {
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
        repro: "Open Settings > Profile and look at the header.",
      },
    );

    // The repro is only stored on the row, so it must ride the first thread
    // message to be visible in the conversation UI.
    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread).toHaveLength(1);
    expect(thread[0]?.body).toBe(
      "There is a typo on the profile screen.\n\n" +
        "How to see it: Open Settings > Profile and look at the header.",
    );
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
    expect(dispatched?.activeRunMode).toBe("implement");
  });

  test("build dispatch resolves r2: report screenshots to fetchable URLs", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    process.env.R2_PUBLIC_URL = "https://media.example.com";

    // Submit carrying a stored r2: report screenshot, then deliver a low-risk
    // spec so approval auto-dispatches the build.
    stubRoutineEnv();
    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      {
        token: maintainerId,
        kind: "bug",
        title: "Fix typo",
        body: "There is a typo on the profile screen.",
        screenshotUrls: ["r2:report/a.png"],
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
        riskLevel: "low",
      },
    );

    // Consume the spec-callback side effects, then re-stub fetch so the only
    // call we inspect is the build (implement) dispatch.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const fetchMock = stubRoutineEnv();
    vi.setSystemTime(Date.now() + 1000);

    await t.mutation(api.functions.devAssistant.contributions.approveSpec, {
      token: maintainerId,
      id,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const brief = JSON.parse(JSON.parse(init.body as string).text);
    // The (vision-capable) routine can't fetch raw r2: paths — the report shots
    // must arrive resolved to public https URLs (regression: the build path
    // used to send bug.screenshotUrls unresolved).
    expect(brief.screenshotUrls).toEqual([
      "https://media.example.com/report/a.png",
    ]);
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
  test("MERGED is webhook-only: a routine callback is rejected, the webhook source ships it", async () => {
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

    // A routine run claiming the merge itself is rejected — GitHub is ground
    // truth for merges and only the webhook/auto-merge sources may apply it.
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      { bugId: id, routineRunId: "run-ship", status: "MERGED" },
    );
    let bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("READY_TO_MERGE");
    expect(bug?.shippedAt).toBeUndefined();
    expect(bug?.lastError).toMatch(/MERGED/);
    // No premature shipped push either.
    let notifications = await t.run(async (ctx) =>
      ctx.db.query("notifications").collect(),
    );
    expect(notifications).toHaveLength(0);

    // The webhook source (GitHub reported the merge) stamps shippedAt and
    // starts deploy observation (stagingDeploy pending) — but a merge only
    // *triggers* the staging deploy, so NO "live on staging" push fires yet.
    // That push waits for the workflow_run webhook (see deploy-observation
    // tests).
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      { bugId: id, routineRunId: "run-ship", status: "MERGED", source: "webhook" },
    );

    bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("MERGED");
    expect(bug?.shippedAt).toBeTruthy();
    expect(bug?.stagingDeploy?.state).toBe("pending");

    // No staging push at merge time — the deploy isn't live yet.
    notifications = await t.run(async (ctx) =>
      ctx.db.query("notifications").collect(),
    );
    expect(
      notifications.some(
        (n) => n.userId === maintainerId && /staging/i.test(n.title),
      ),
    ).toBe(false);
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
    // The plan itself is NOT posted into the thread (it lives behind "The
    // plan" card) — the latest turn is the plan-ready pointer.
    expect(mine[0]?.lastMessageBody).toBe(
      'The plan is ready — read it under "The plan" below',
    );
    expect(mine[0]?.lastMessageAuthorType).toBe("system");
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

  test("spec callback stores triage fields and logs a plan-ready pointer", async () => {
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
    // Report (user) then the plan-ready pointer (system), oldest first — the
    // spec text itself stays on the row and renders behind "The plan" card.
    expect(thread.map((m) => m.authorType)).toEqual(["user", "system"]);
    expect(thread[1]?.body).toBe(
      'The plan is ready — read it under "The plan" below',
    );
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
    // Full thread history rides along: report, the plan-ready pointer, and
    // the new reply (the spec text itself travels in the payload's `spec`).
    expect(
      brief.thread.map((m: { authorType: string }) => m.authorType),
    ).toEqual(["user", "system", "user"]);
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

    for (const status of ["CODE_REVIEW", "READY_TO_MERGE"] as const) {
      vi.setSystemTime(Date.now() + 1000);
      await t.action(
        internal.functions.devAssistant.actions.handleRoutineCallback,
        { bugId: id, routineRunId: "run-transitions", status },
      );
    }
    // MERGED arrives from the GitHub webhook source (routine callbacks may
    // not claim merges).
    vi.setSystemTime(Date.now() + 1000);
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: id,
        routineRunId: "run-transitions",
        status: "MERGED",
        source: "webhook",
      },
    );
    // A re-delivered MERGED webhook must not duplicate the system message.
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: id,
        routineRunId: "run-transitions",
        status: "MERGED",
        source: "webhook",
      },
    );

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread.every((m) => m.authorType === "system")).toBe(true);
    expect(thread.map((m) => m.body)).toEqual([
      "Pull request opened",
      "Ready to merge",
      "Merged — deploying to staging…",
    ]);
  });

  test("the 'test on staging' push waits for the staging deploy to go live, not the merge", async () => {
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

    // CODE_REVIEW: the PR is still open, nothing is on staging — the push is
    // the generic "in code review" note, NOT the staging ask.
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

    let notifications = await t.run(async (ctx) =>
      ctx.db.query("notifications").collect(),
    );
    expect(
      notifications.filter((n) => /staging/i.test(n.title)),
    ).toHaveLength(0);
    expect(
      notifications.some((n) => n.title === "Your contribution is in code review"),
    ).toBe(true);

    // MERGED only *triggers* the staging deploy — still NO staging push, and
    // stagingDeploy is pending (correlated by the merge commit SHA).
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: id,
        routineRunId: "run-staging-push",
        status: "READY_TO_MERGE",
      },
    );
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: id,
        routineRunId: "run-staging-push",
        status: "MERGED",
        source: "webhook",
        mergeCommitSha: "sha-staging-push",
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    notifications = await t.run(async (ctx) =>
      ctx.db.query("notifications").collect(),
    );
    expect(
      notifications.filter(
        (n) => n.userId === maintainerId && /staging/i.test(n.title),
      ),
    ).toHaveLength(0);
    expect(
      (await t.run(async (ctx) => ctx.db.get(id)))?.stagingDeploy?.state,
    ).toBe("pending");

    // The staging deploy workflow finishing (workflow_run success) is the
    // honest moment: the change is up, so NOW the "try it on staging" push
    // fires.
    await t.mutation(internal.functions.devAssistant.bugs.handleWorkflowRunEvent, {
      action: "completed",
      name: "Deploy Convex",
      conclusion: "success",
      headSha: "sha-staging-push",
      headBranch: "main",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    notifications = await t.run(async (ctx) =>
      ctx.db.query("notifications").collect(),
    );
    const stagingPush = notifications.filter(
      (n) => n.userId === maintainerId && /staging/i.test(n.title),
    );
    expect(stagingPush).toHaveLength(1);
    expect(stagingPush[0]?.title).toBe("Ready to test on staging");
    expect(
      (await t.run(async (ctx) => ctx.db.get(id)))?.stagingDeploy?.state,
    ).toBe("live");
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
    // routineRunId replaced the implementation run's, and the run mode is
    // stamped so applyCallback holds its callback to the review policy.
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("CODE_REVIEW");
    expect(bug?.routineRunId).toBeTruthy();
    expect(bug?.routineRunId).not.toBe("run-impl");
    expect(bug?.activeRunMode).toBe("review");

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
      stagingDeploy: {
        state: "pending" | "live" | "failed";
        updatedAt: number;
      };
    }> = {},
  ): Promise<Id<"devBugs">> {
    const now = Date.now();
    return await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: originatorId,
        // Staging is checked after merge (ADR-029) — the window is MERGED.
        status: overrides.status ?? "MERGED",
        kind: "bug",
        source: "dashboard",
        title: "Fix RSVP message",
        body: "B",
        routineRunId: "run-staging",
        verifyOnStaging: overrides.verifyOnStaging ?? true,
        stagingVerifiedAt: overrides.stagingVerifiedAt,
        // Omitted → legacy-undefined, treated as live (backward-compat).
        stagingDeploy: overrides.stagingDeploy,
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
    expect(bug?.status).toBe("MERGED"); // status untouched — already merged

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({
      authorType: "system",
      body: "Marge Maintainer confirmed it works on staging — ready for a maintainer to deploy to production",
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

    // Not merged yet — the PR is still open in code review, so nothing is on
    // staging to check. The window only opens at MERGED (ADR-029).
    const earlyId = await seedStagingBug(t, maintainerId, {
      status: "CODE_REVIEW",
    });
    await expect(
      t.mutation(api.functions.devAssistant.contributions.confirmStaging, {
        token: maintainerId,
        id: earlyId,
      }),
    ).rejects.toThrow(/current status/);

    // Reviewed and approved but still not merged — also rejected.
    const preMergeId = await seedStagingBug(t, maintainerId, {
      status: "READY_TO_MERGE",
    });
    await expect(
      t.mutation(api.functions.devAssistant.contributions.confirmStaging, {
        token: maintainerId,
        id: preMergeId,
      }),
    ).rejects.toThrow(/current status/);
  });

  test("confirmStaging is gated server-side on the staging deploy actually being live", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);

    // Merged, but the staging deploy is still running — the UI hides the card,
    // but a stale/hand-rolled client must be rejected server-side too.
    const pendingId = await seedStagingBug(t, maintainerId, {
      stagingDeploy: { state: "pending", updatedAt: Date.now() },
    });
    await expect(
      t.mutation(api.functions.devAssistant.contributions.confirmStaging, {
        token: maintainerId,
        id: pendingId,
      }),
    ).rejects.toThrow(/still running/);

    // Deploy failed — there's nothing on staging to confirm.
    const failedId = await seedStagingBug(t, maintainerId, {
      stagingDeploy: { state: "failed", updatedAt: Date.now() },
    });
    await expect(
      t.mutation(api.functions.devAssistant.contributions.confirmStaging, {
        token: maintainerId,
        id: failedId,
      }),
    ).rejects.toThrow(/staging deploy failed/i);

    // Live → allowed.
    const liveId = await seedStagingBug(t, maintainerId, {
      stagingDeploy: { state: "live", updatedAt: Date.now() },
    });
    await t.mutation(api.functions.devAssistant.contributions.confirmStaging, {
      token: maintainerId,
      id: liveId,
    });
    expect(
      (await t.run(async (ctx) => ctx.db.get(liveId)))?.stagingVerifiedAt,
    ).toBeTruthy();

    // Legacy row (no stagingDeploy) → treated as live, still confirmable.
    const legacyId = await seedStagingBug(t, maintainerId);
    await t.mutation(api.functions.devAssistant.contributions.confirmStaging, {
      token: maintainerId,
      id: legacyId,
    });
    expect(
      (await t.run(async (ctx) => ctx.db.get(legacyId)))?.stagingVerifiedAt,
    ).toBeTruthy();
  });

  test("reportStagingIssue sends the item back through the pipeline (staging-redo dispatch)", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);

    const id = await seedStagingBug(t, maintainerId, {
      status: "MERGED",
    });
    // Seed the merged round's leftovers so the reset is observable.
    await t.run(async (ctx) =>
      ctx.db.patch(id, {
        prUrl: "https://github.com/togathernyc/togather/pull/41",
        reviewVerdict: "approved" as const,
        reviewSummary: "LGTM",
        fixRounds: 2,
        activeRunMode: "review" as const,
      }),
    );
    const fetchMock = stubRoutineEnv();

    await t.mutation(
      api.functions.devAssistant.contributions.reportStagingIssue,
      { token: maintainerId, id, note: "The RSVP toast still says Going." },
    );

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread.map((m) => [m.authorType, m.body])).toEqual([
      ["user", "The RSVP toast still says Going."],
      ["system", "Staging check failed — sending it back to the AI to fix"],
    ]);

    // The previous round's pipeline state is reset and the item re-enters the
    // build pipeline (MERGED -> READY_FOR_IMPL -> IN_PROGRESS via dispatch).
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("IN_PROGRESS");
    expect(bug?.stagingVerifiedAt).toBeUndefined();
    expect(bug?.verifyOnStaging).toBe(true); // re-merge reopens the window
    expect(bug?.prUrl).toBeUndefined();
    expect(bug?.reviewVerdict).toBeUndefined();
    expect(bug?.reviewSummary).toBeUndefined();
    expect(bug?.fixRounds).toBe(0);
    expect(bug?.redoRounds).toBe(1); // persisted — dispatch infers redo from it
    expect(bug?.activeRunMode).toBe("implement");
    // Fresh routineRunId — stale callbacks from the merged round are orphaned.
    expect(bug?.routineRunId).toBeTruthy();
    expect(bug?.routineRunId).not.toBe("run-staging");

    // A redo-mode implement dispatch fired, carrying the conversation and the
    // "open a NEW PR" instructions.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const brief = JSON.parse(JSON.parse(init.body as string).text);
    expect(brief).toMatchObject({ bugId: id, redo: true });
    expect(brief.instructions).toMatch(/REDO ROUND/);
    expect(brief.instructions).toMatch(/NEW\s+pull request/);
    expect(
      brief.thread.map((m: { authorType: string }) => m.authorType),
    ).toEqual(["user", "system"]);
    expect(brief.thread[0]?.body).toBe("The RSVP toast still says Going.");
  });

  test("a retried redo dispatch keeps the redo context (inferred from redoRounds)", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { otherMaintainerId, maintainerId } = await seedUsers(t);

    const id = await seedStagingBug(t, maintainerId, { status: "MERGED" });
    // No routine env: the redo dispatch fails before markDispatched, leaving
    // the row in READY_FOR_IMPL with lastError — the retry window.
    await t.mutation(
      api.functions.devAssistant.contributions.reportStagingIssue,
      { token: maintainerId, id, note: "Still broken on staging." },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    let bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("READY_FOR_IMPL");
    expect(bug?.lastError).toBeTruthy();

    // Superuser retries once the env is back — the redo context must survive
    // because it's inferred from the persisted redoRounds, not a dispatch arg.
    const fetchMock = stubRoutineEnv();
    await t.mutation(api.functions.devAssistant.bugs.retryDispatch, {
      token: otherMaintainerId,
      bugId: id,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const brief = JSON.parse(JSON.parse(init.body as string).text);
    expect(brief).toMatchObject({ bugId: id, redo: true });
    expect(brief.instructions).toMatch(/REDO ROUND/);
    expect(brief.thread[0]?.body).toBe("Still broken on staging.");

    bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("IN_PROGRESS");
  });

  test("redo dispatch carries pictures attached to thread replies", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);

    const id = await seedStagingBug(t, maintainerId, { status: "MERGED" });
    // Contributor screenshots the broken staging behavior in a reply…
    await t.run(async (ctx) => {
      await ctx.db.insert("devBugMessages", {
        bugId: id,
        authorType: "user",
        userId: maintainerId,
        body: "See the screenshot",
        imageUrls: ["r2:devassistant/staging-broken.png"],
        createdAt: Date.now(),
      });
    });
    process.env.R2_PUBLIC_URL = "https://media.example.com";
    const fetchMock = stubRoutineEnv();

    // …then reports the staging issue.
    await t.mutation(
      api.functions.devAssistant.contributions.reportStagingIssue,
      { token: maintainerId, id, note: "see the screenshot above" },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const brief = JSON.parse(JSON.parse(init.body as string).text);
    expect(brief.redo).toBe(true);
    expect(brief.screenshotUrls).toEqual([
      "https://media.example.com/devassistant/staging-broken.png",
    ]);
    delete process.env.R2_PUBLIC_URL;
  });

  test("a stale merged-PR webhook for a previous round cannot kill the redo", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);

    // Redo in flight: shipped once (round 1 merged), building again, no new
    // PR yet.
    const now = Date.now();
    const id = await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: maintainerId,
        status: "IN_PROGRESS",
        kind: "bug",
        source: "dashboard",
        title: "Fix RSVP message",
        body: "B",
        routineRunId: "run-redo",
        activeRunMode: "implement" as const,
        verifyOnStaging: true,
        redoRounds: 1,
        shippedAt: now - 1000,
        createdAt: now,
        updatedAt: now,
      }),
    );

    // GitHub redelivers round 1's closed(merged) event — same branch name.
    await t.mutation(internal.functions.devAssistant.bugs.handleGithubPrClosed, {
      branchRef: `claude/devbug-${id}`,
      prUrl: "https://github.com/togathernyc/togather/pull/41",
      merged: true,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The redo round survives untouched.
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("IN_PROGRESS");

    // Once the redo's own PR is stored, only ITS url may apply a merge.
    await t.run(async (ctx) =>
      ctx.db.patch(id, {
        status: "CODE_REVIEW" as const,
        prUrl: "https://github.com/togathernyc/togather/pull/52",
      }),
    );
    await t.mutation(internal.functions.devAssistant.bugs.handleGithubPrClosed, {
      branchRef: `claude/devbug-${id}`,
      prUrl: "https://github.com/togathernyc/togather/pull/41", // round 1
      merged: true,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run(async (ctx) => ctx.db.get(id)))?.status).toBe(
      "CODE_REVIEW",
    );

    // The current round's PR still merges normally.
    await t.mutation(internal.functions.devAssistant.bugs.handleGithubPrClosed, {
      branchRef: `claude/devbug-${id}`,
      prUrl: "https://github.com/togathernyc/togather/pull/52",
      merged: true,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run(async (ctx) => ctx.db.get(id)))?.status).toBe("MERGED");
  });
});

describe("in-app merge (mergeNow)", () => {
  async function seedReadyToMerge(
    t: ReturnType<typeof convexTest>,
    originatorId: Id<"users">,
    overrides: Partial<{
      status: "CODE_REVIEW" | "READY_TO_MERGE" | "MERGED";
      reviewVerdict: "approved" | "changes_requested";
      prUrl: string | undefined;
    }> = {},
  ): Promise<Id<"devBugs">> {
    const now = Date.now();
    return await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: originatorId,
        status: overrides.status ?? "READY_TO_MERGE",
        kind: "bug",
        source: "dashboard",
        title: "Fix RSVP message",
        body: "B",
        routineRunId: "run-merge",
        reviewVerdict:
          "reviewVerdict" in overrides ? overrides.reviewVerdict : "approved",
        prUrl:
          "prUrl" in overrides
            ? overrides.prUrl
            : "https://github.com/togathernyc/togather/pull/77",
        verifyOnStaging: true,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  test("merges the PR via GitHub and lands MERGED through the trusted source", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const id = await seedReadyToMerge(t, maintainerId);

    process.env.GH_MIRROR_TOKEN = "gh-token";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await t.mutation(api.functions.devAssistant.contributions.mergeNow, {
      token: maintainerId,
      id,
    });

    // Server-side in-flight latch: stamped immediately so the merge card
    // hides for every viewer and a concurrent second tap is rejected.
    expect(
      (await t.run(async (ctx) => ctx.db.get(id)))?.mergeRequestedAt,
    ).toBeTruthy();
    await expect(
      t.mutation(api.functions.devAssistant.contributions.mergeNow, {
        token: maintainerId,
        id,
      }),
    ).rejects.toThrow(/already in flight/);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The GitHub merge endpoint was hit with the squash default.
    const mergeCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/pulls/77/merge"),
    );
    expect(mergeCall).toBeTruthy();
    expect(JSON.parse((mergeCall![1] as RequestInit).body as string)).toEqual({
      merge_method: "squash",
    });

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("MERGED");
    expect(bug?.shippedAt).toBeTruthy();

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread.map((m) => m.body)).toEqual([
      "Connie Tributor asked to merge this from the app — merging…",
      "Merged — deploying to staging…",
    ]);
  });

  test("a failed GitHub merge posts the reason instead of advancing", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const id = await seedReadyToMerge(t, maintainerId);

    process.env.GH_MIRROR_TOKEN = "gh-token";
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Base branch was modified" }), {
          status: 409,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await t.mutation(api.functions.devAssistant.contributions.mergeNow, {
      token: maintainerId,
      id,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("READY_TO_MERGE");
    // Failure clears the in-flight latch so the merge card returns and the
    // "try again" in the message is actually possible.
    expect(bug?.mergeRequestedAt).toBeUndefined();

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread[thread.length - 1]?.body).toMatch(
      /Merge failed: GitHub merge returned 409 \(Base branch was modified\)/,
    );
  });

  test("losing the race to auto-merge is a success, not a spurious failure", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const id = await seedReadyToMerge(t, maintainerId);

    process.env.GH_MIRROR_TOKEN = "gh-token";
    // The merge PUT 405s (someone else merged first), but the follow-up PR
    // GET reports merged: true.
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith("/merge")) {
        return new Response(
          JSON.stringify({ message: "Pull Request is not mergeable" }),
          { status: 405 },
        );
      }
      return new Response(JSON.stringify({ merged: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await t.mutation(api.functions.devAssistant.contributions.mergeNow, {
      token: maintainerId,
      id,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("MERGED");

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    // No "Merge failed" line — the change merged, whoever's PUT landed.
    expect(thread.some((m) => /Merge failed/.test(m.body))).toBe(false);
  });

  test("rejects when the item is not ready (status, verdict, or missing PR)", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId, regularUserId } = await seedUsers(t);

    const notReady = await seedReadyToMerge(t, maintainerId, {
      status: "CODE_REVIEW",
    });
    await expect(
      t.mutation(api.functions.devAssistant.contributions.mergeNow, {
        token: maintainerId,
        id: notReady,
      }),
    ).rejects.toThrow(/isn't ready to merge/);

    const notApproved = await seedReadyToMerge(t, maintainerId, {
      reviewVerdict: "changes_requested",
    });
    await expect(
      t.mutation(api.functions.devAssistant.contributions.mergeNow, {
        token: maintainerId,
        id: notApproved,
      }),
    ).rejects.toThrow(/hasn't approved/);

    const noPr = await seedReadyToMerge(t, maintainerId, { prUrl: undefined });
    await expect(
      t.mutation(api.functions.devAssistant.contributions.mergeNow, {
        token: maintainerId,
        id: noPr,
      }),
    ).rejects.toThrow(/no pull request/);

    // Non-contributors can't reach the surface at all.
    const ready = await seedReadyToMerge(t, maintainerId);
    await expect(
      t.mutation(api.functions.devAssistant.contributions.mergeNow, {
        token: regularUserId,
        id: ready,
      }),
    ).rejects.toThrow(/Not authorized/);
  });
});

describe("in-app production promote (silent OTA)", () => {
  async function seedMergedBug(
    t: ReturnType<typeof convexTest>,
    originatorId: Id<"users">,
    overrides: Partial<{
      verifyOnStaging: boolean;
      stagingVerifiedAt: number;
      productionRequestedAt: number;
      stagingDeploy: {
        state: "pending" | "live" | "failed";
        updatedAt: number;
      };
    }> = {},
  ): Promise<Id<"devBugs">> {
    const now = Date.now();
    return await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: originatorId,
        status: "MERGED",
        kind: "bug",
        source: "dashboard",
        title: "Fix RSVP message",
        body: "B",
        verifyOnStaging: overrides.verifyOnStaging ?? true,
        stagingVerifiedAt:
          "stagingVerifiedAt" in overrides ? overrides.stagingVerifiedAt : now,
        productionRequestedAt: overrides.productionRequestedAt,
        // Omitted → legacy-undefined, treated as live (backward-compat).
        stagingDeploy: overrides.stagingDeploy,
        shippedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  test("triggers the production workflow with silent update_mode and logs it", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const id = await seedMergedBug(t, maintainerId);

    process.env.GH_MIRROR_TOKEN = "gh-token";
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await t.mutation(
      api.functions.devAssistant.contributions.promoteToProduction,
      { token: maintainerId, id },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const dispatchCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("deploy-to-production.yml/dispatches"),
    );
    expect(dispatchCall).toBeTruthy();
    expect(
      JSON.parse((dispatchCall![1] as RequestInit).body as string),
    ).toEqual({
      ref: "main",
      inputs: { confirm: "deploy", update_mode: "silent" },
    });

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.productionRequestedAt).toBeTruthy();
    // A successful dispatch starts production deploy observation.
    expect(bug?.productionDeploy?.state).toBe("pending");

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread.map((m) => m.body)).toEqual([
      "Connie Tributor triggered the production deploy (silent update)",
      "Deploying to production…",
    ]);
  });

  test("a failed workflow dispatch clears productionRequestedAt so the button returns", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const id = await seedMergedBug(t, maintainerId);

    process.env.GH_MIRROR_TOKEN = "gh-token";
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Resource not accessible" }), {
          status: 403,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await t.mutation(
      api.functions.devAssistant.contributions.promoteToProduction,
      { token: maintainerId, id },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.productionRequestedAt).toBeUndefined();

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread[thread.length - 1]?.body).toMatch(
      /Production deploy couldn't start: GitHub workflow dispatch returned 403 \(Resource not accessible\) — needs a maintainer/,
    );
  });

  test("gates: unmerged, staging-unverified, and double triggers are rejected", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);

    // Staging flagged but not verified.
    const unverified = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("devBugs", {
        originatorUserId: maintainerId,
        status: "MERGED",
        kind: "bug",
        source: "dashboard",
        title: "T",
        body: "B",
        verifyOnStaging: true,
        createdAt: now,
        updatedAt: now,
      });
    });
    await expect(
      t.mutation(
        api.functions.devAssistant.contributions.promoteToProduction,
        { token: maintainerId, id: unverified },
      ),
    ).rejects.toThrow(/works on staging/);

    // Not merged yet.
    const open = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("devBugs", {
        originatorUserId: maintainerId,
        status: "READY_TO_MERGE",
        kind: "bug",
        source: "dashboard",
        title: "T",
        body: "B",
        createdAt: now,
        updatedAt: now,
      });
    });
    await expect(
      t.mutation(
        api.functions.devAssistant.contributions.promoteToProduction,
        { token: maintainerId, id: open },
      ),
    ).rejects.toThrow(/Only merged changes/);

    // Already triggered (within the cooldown).
    const done = await seedMergedBug(t, maintainerId, {
      productionRequestedAt: Date.now(),
    });
    await expect(
      t.mutation(
        api.functions.devAssistant.contributions.promoteToProduction,
        { token: maintainerId, id: done },
      ),
    ).rejects.toThrow(/already triggered/);

    // Legacy row: verifyOnStaging UNSET (predates the feature) — must not
    // grow a production trigger retroactively.
    const legacy = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("devBugs", {
        originatorUserId: maintainerId,
        status: "MERGED",
        kind: "bug",
        source: "dashboard",
        title: "T",
        body: "B",
        shippedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    });
    await expect(
      t.mutation(
        api.functions.devAssistant.contributions.promoteToProduction,
        { token: maintainerId, id: legacy },
      ),
    ).rejects.toThrow(/works on staging/);

    // Non-interactive items skip the staging gate entirely.
    const copyOnly = await seedMergedBug(t, maintainerId, {
      verifyOnStaging: false,
      stagingVerifiedAt: undefined,
    });
    process.env.GH_MIRROR_TOKEN = "gh-token";
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await t.mutation(
      api.functions.devAssistant.contributions.promoteToProduction,
      { token: maintainerId, id: copyOnly },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      (await t.run(async (ctx) => ctx.db.get(copyOnly)))
        ?.productionRequestedAt,
    ).toBeTruthy();
  });

  test("the trigger latch is a cooldown: a stale request can be re-triggered", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);

    // Triggered 16 minutes ago — the workflow run may have failed on GitHub
    // with no callback to clear the latch; past the cooldown the maintainer
    // may re-trigger from the app.
    const id = await seedMergedBug(t, maintainerId, {
      productionRequestedAt: Date.now() - 16 * 60 * 1000,
    });
    process.env.GH_MIRROR_TOKEN = "gh-token";
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await t.mutation(
      api.functions.devAssistant.contributions.promoteToProduction,
      { token: maintainerId, id },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("promoteToProduction is gated server-side on the staging deploy being live", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    process.env.GH_MIRROR_TOKEN = "gh-token";
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    // Non-interactive item (skips the sign-off gate) but its staging deploy is
    // still running — must NOT be shippable to production.
    const pending = await seedMergedBug(t, maintainerId, {
      verifyOnStaging: false,
      stagingVerifiedAt: undefined,
      stagingDeploy: { state: "pending", updatedAt: Date.now() },
    });
    await expect(
      t.mutation(api.functions.devAssistant.contributions.promoteToProduction, {
        token: maintainerId,
        id: pending,
      }),
    ).rejects.toThrow(/still running/);

    // Staging deploy failed — nothing is up, so production is blocked.
    const failed = await seedMergedBug(t, maintainerId, {
      verifyOnStaging: false,
      stagingVerifiedAt: undefined,
      stagingDeploy: { state: "failed", updatedAt: Date.now() },
    });
    await expect(
      t.mutation(api.functions.devAssistant.contributions.promoteToProduction, {
        token: maintainerId,
        id: failed,
      }),
    ).rejects.toThrow(/staging deploy failed/i);

    // Nothing was dispatched to GitHub for the blocked promotions.
    expect(fetchMock).not.toHaveBeenCalled();

    // Live staging deploy → the promotion goes through.
    const live = await seedMergedBug(t, maintainerId, {
      verifyOnStaging: false,
      stagingVerifiedAt: undefined,
      stagingDeploy: { state: "live", updatedAt: Date.now() },
    });
    await t.mutation(
      api.functions.devAssistant.contributions.promoteToProduction,
      { token: maintainerId, id: live },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      (await t.run(async (ctx) => ctx.db.get(live)))?.productionDeploy?.state,
    ).toBe("pending");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("githubUsername (ADR-029 Phase 2)", () => {
  test("set + get roundtrip, trimming and stripping a leading @", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);

    await t.mutation(
      api.functions.devAssistant.contributions.setGithubUsername,
      { token: maintainerId, username: "octocat" },
    );
    expect(
      await t.query(
        api.functions.devAssistant.contributions.getGithubUsername,
        { token: maintainerId },
      ),
    ).toBe("octocat");

    await t.mutation(
      api.functions.devAssistant.contributions.setGithubUsername,
      { token: maintainerId, username: "  @octo-cat  " },
    );
    expect(
      await t.query(
        api.functions.devAssistant.contributions.getGithubUsername,
        { token: maintainerId },
      ),
    ).toBe("octo-cat");
  });

  test("rejects usernames that break GitHub's rules", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);

    const invalid = [
      "octo_cat", // underscore
      "-leading",
      "trailing-",
      "double--hyphen",
      "a".repeat(40), // 39 max
      "octo cat", // space inside
    ];
    for (const username of invalid) {
      await expect(
        t.mutation(api.functions.devAssistant.contributions.setGithubUsername, {
          token: maintainerId,
          username,
        }),
      ).rejects.toThrow(/Invalid GitHub username/);
    }

    // Exactly 39 chars is fine.
    await t.mutation(
      api.functions.devAssistant.contributions.setGithubUsername,
      { token: maintainerId, username: "a".repeat(39) },
    );
    const user = await t.run(async (ctx) => ctx.db.get(maintainerId));
    expect(user?.githubUsername).toBe("a".repeat(39));
  });

  test("empty string clears the field", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);

    await t.mutation(
      api.functions.devAssistant.contributions.setGithubUsername,
      { token: maintainerId, username: "octocat" },
    );
    await t.mutation(
      api.functions.devAssistant.contributions.setGithubUsername,
      { token: maintainerId, username: "" },
    );
    expect(
      await t.query(
        api.functions.devAssistant.contributions.getGithubUsername,
        { token: maintainerId },
      ),
    ).toBeNull();
    const user = await t.run(async (ctx) => ctx.db.get(maintainerId));
    expect(user?.githubUsername).toBeUndefined();
  });

  test("gated by requireContributor", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { regularUserId } = await seedUsers(t);

    await expect(
      t.query(api.functions.devAssistant.contributions.getGithubUsername, {
        token: regularUserId,
      }),
    ).rejects.toThrow(/Not authorized/);
    await expect(
      t.mutation(api.functions.devAssistant.contributions.setGithubUsername, {
        token: regularUserId,
        username: "octocat",
      }),
    ).rejects.toThrow(/Not authorized/);
  });
});

describe("GitHub issue mirroring + dispatch payload (ADR-029 Phase 2)", () => {
  /** Seed a spec-approved dashboard item ready for implementation dispatch. */
  async function seedReadyBug(
    t: ReturnType<typeof convexTest>,
    originatorId: Id<"users">,
    overrides: Partial<{
      githubIssueNumber: number;
      githubIssueUrl: string;
    }> = {},
  ): Promise<Id<"devBugs">> {
    const now = Date.now();
    return await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: originatorId,
        status: "READY_FOR_IMPL",
        kind: "bug",
        source: "dashboard",
        title: "Fix typo",
        aiTitle: "Fix profile typo",
        body: "There is a typo on the profile screen.",
        spec: "## Plan\nChange the string.",
        riskLevel: "low",
        specApprovedAt: now,
        githubIssueNumber: overrides.githubIssueNumber,
        githubIssueUrl: overrides.githubIssueUrl,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  /** Routine env + a fetch mock that also answers the GitHub issues POST. */
  function stubRoutineAndGithub(issueResponse: Response) {
    process.env.CLAUDE_ROUTINES_TRIGGER_URL =
      "https://api.anthropic.com/v1/claude_code/routines/trig_test/fire";
    process.env.CLAUDE_ROUTINES_TOKEN = "test-token";
    process.env.CONVEX_SITE_URL = "https://example.convex.site";
    const fetchMock = vi.fn(async (...fetchArgs: unknown[]) => {
      if (String(fetchArgs[0]).startsWith("https://api.github.com/")) {
        return issueResponse.clone();
      }
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  /** The routine brief parsed back out of a captured fire-endpoint call. */
  function parseBrief(call: unknown[]): Record<string, unknown> {
    const init = call[1] as RequestInit;
    return JSON.parse(JSON.parse(init.body as string).text);
  }

  test("without GH_MIRROR_TOKEN mirroring is skipped; payload still carries spec + attribution", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    await t.mutation(
      api.functions.devAssistant.contributions.setGithubUsername,
      { token: maintainerId, username: "connie-codes" },
    );
    const id = await seedReadyBug(t, maintainerId);
    const fetchMock = stubRoutineEnv();

    await t.action(internal.functions.devAssistant.actions.dispatchBug, {
      bugId: id,
    });

    // Only the routine POST — no GitHub call, no issue fields stored.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain(
      "api.github.com",
    );
    const brief = parseBrief(fetchMock.mock.calls[0] as unknown[]);
    expect(brief).toMatchObject({
      bugId: id,
      spec: "## Plan\nChange the string.",
      riskLevel: "low",
      originatorName: "Connie Tributor",
      originatorGithubUsername: "connie-codes",
    });
    expect(brief.githubIssueNumber).toBeUndefined();

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("IN_PROGRESS");
    expect(bug?.githubIssueNumber).toBeUndefined();
    expect(bug?.lastError).toBeUndefined();
  });

  test("with GH_MIRROR_TOKEN the issue is created first and its number rides the payload", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    await t.mutation(
      api.functions.devAssistant.contributions.setGithubUsername,
      { token: maintainerId, username: "connie-codes" },
    );
    const id = await seedReadyBug(t, maintainerId);
    process.env.GH_MIRROR_TOKEN = "gh-test-pat";
    const fetchMock = stubRoutineAndGithub(
      new Response(
        JSON.stringify({
          number: 123,
          html_url: "https://github.com/togathernyc/togather/issues/123",
        }),
        { status: 201 },
      ),
    );

    await t.action(internal.functions.devAssistant.actions.dispatchBug, {
      bugId: id,
    });

    // Issue POST first, routine POST second.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/togathernyc/togather/issues",
    );
    const issueInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(issueInit.headers).toMatchObject({
      Authorization: "Bearer gh-test-pat",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    const issueBody = JSON.parse(issueInit.body as string);
    // aiTitle wins over title; body is the spec + dashboard footer.
    expect(issueBody.title).toBe("Fix profile typo");
    expect(issueBody.body).toContain("## Plan\nChange the string.");
    expect(issueBody.body).toMatch(/Togather dev dashboard/);

    const brief = parseBrief(fetchMock.mock.calls[1] as unknown[]);
    expect(brief).toMatchObject({
      bugId: id,
      spec: "## Plan\nChange the string.",
      riskLevel: "low",
      githubIssueNumber: 123,
      originatorName: "Connie Tributor",
      originatorGithubUsername: "connie-codes",
    });

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("IN_PROGRESS");
    expect(bug?.githubIssueNumber).toBe(123);
    expect(bug?.githubIssueUrl).toBe(
      "https://github.com/togathernyc/togather/issues/123",
    );
  });

  test("a bug that already has an issue is not re-mirrored", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const id = await seedReadyBug(t, maintainerId, {
      githubIssueNumber: 55,
      githubIssueUrl: "https://github.com/togathernyc/togather/issues/55",
    });
    process.env.GH_MIRROR_TOKEN = "gh-test-pat";
    const fetchMock = stubRoutineAndGithub(
      new Response(JSON.stringify({ number: 999 }), { status: 201 }),
    );

    await t.action(internal.functions.devAssistant.actions.dispatchBug, {
      bugId: id,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1); // routine only
    const brief = parseBrief(fetchMock.mock.calls[0] as unknown[]);
    expect(brief.githubIssueNumber).toBe(55);
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.githubIssueNumber).toBe(55);
  });

  test("issue creation failure is non-fatal: breadcrumb recorded, dispatch continues", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const id = await seedReadyBug(t, maintainerId);
    process.env.GH_MIRROR_TOKEN = "gh-test-pat";
    const fetchMock = stubRoutineAndGithub(
      new Response("boom", { status: 500 }),
    );

    await t.action(internal.functions.devAssistant.actions.dispatchBug, {
      bugId: id,
    });

    // GitHub call failed, but the routine POST still went out.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const brief = parseBrief(fetchMock.mock.calls[1] as unknown[]);
    expect(brief.githubIssueNumber).toBeUndefined();

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("IN_PROGRESS");
    expect(bug?.githubIssueNumber).toBeUndefined();
    expect(bug?.lastError).toMatch(/GitHub issue mirroring failed/);
  });

  test("legacy GITHUB_MIRROR_TOKEN still enables mirroring (fallback)", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const id = await seedReadyBug(t, maintainerId);
    process.env.GITHUB_MIRROR_TOKEN = "gh-legacy-pat";
    const fetchMock = stubRoutineAndGithub(
      new Response(JSON.stringify({ number: 7 }), { status: 201 }),
    );

    await t.action(internal.functions.devAssistant.actions.dispatchBug, {
      bugId: id,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const issueInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(issueInit.headers).toMatchObject({
      Authorization: "Bearer gh-legacy-pat",
    });
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.githubIssueNumber).toBe(7);
  });
});

describe("POST /github/webhook (ADR-029 Phase 2)", () => {
  const WEBHOOK_SECRET = "gh-webhook-secret";

  /** GitHub-style signature: sha256=<hex HMAC of the raw body>. */
  async function signGithub(body: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const hex = Array.from(new Uint8Array(bytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `sha256=${hex}`;
  }

  async function postWebhook(
    t: ReturnType<typeof convexTest>,
    payload: Record<string, unknown>,
    event = "pull_request",
  ): Promise<Response> {
    const body = JSON.stringify(payload);
    return await t.fetch("/github/webhook", {
      method: "POST",
      body,
      headers: {
        "x-hub-signature-256": await signGithub(body),
        "x-github-event": event,
      },
    });
  }

  function mergedPrPayload(
    branchRef: string,
    merged: boolean,
    htmlUrl = "https://github.com/togathernyc/togather/pull/42",
  ): Record<string, unknown> {
    return {
      action: "closed",
      pull_request: {
        merged,
        html_url: htmlUrl,
        head: { ref: branchRef },
      },
    };
  }

  async function seedPrBug(
    t: ReturnType<typeof convexTest>,
    originatorId: Id<"users">,
    status: "IN_PROGRESS" | "CODE_REVIEW" | "READY_TO_MERGE" = "READY_TO_MERGE",
  ): Promise<Id<"devBugs">> {
    const now = Date.now();
    return await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: originatorId,
        status,
        kind: "bug",
        source: "dashboard",
        title: "Fix typo",
        body: "B",
        routineRunId: "run-gh",
        prUrl: "https://github.com/togathernyc/togather/pull/42",
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  test("503 when GH_WEBHOOK_SECRET is unset; 401 on missing or bad signature", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;

    // Secret not configured -> 503 (never a signature bypass).
    let res = await t.fetch("/github/webhook", {
      method: "POST",
      body: "{}",
      headers: { "x-hub-signature-256": "sha256=deadbeef" },
    });
    expect(res.status).toBe(503);

    process.env.GH_WEBHOOK_SECRET = WEBHOOK_SECRET;

    // Missing header -> 401.
    res = await t.fetch("/github/webhook", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);

    // Wrong signature -> 401.
    res = await t.fetch("/github/webhook", {
      method: "POST",
      body: "{}",
      headers: { "x-hub-signature-256": `sha256=${"0".repeat(64)}` },
    });
    expect(res.status).toBe(401);

    // Signature computed with the right secret over a DIFFERENT body -> 401.
    res = await t.fetch("/github/webhook", {
      method: "POST",
      body: '{"tampered":true}',
      headers: { "x-hub-signature-256": await signGithub("{}") },
    });
    expect(res.status).toBe(401);
  });

  test("falls back to DEV_ASSISTANT_CALLBACK_SECRET when GH_WEBHOOK_SECRET is unset", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    process.env.DEV_ASSISTANT_CALLBACK_SECRET = WEBHOOK_SECRET;

    // No GH_WEBHOOK_SECRET: not a 503 — the shared secret verifies.
    const ping = await postWebhook(t, { zen: "One secret, two doors." }, "ping");
    expect(ping.status).toBe(200);
    expect(await ping.text()).toBe("ignored");

    // An explicit GH_WEBHOOK_SECRET wins over the fallback.
    process.env.GH_WEBHOOK_SECRET = "a-different-secret";
    const res = await t.fetch("/github/webhook", {
      method: "POST",
      body: "{}",
      headers: {
        "x-hub-signature-256": await signGithub("{}"),
        "x-github-event": "ping",
      },
    });
    expect(res.status).toBe(401);
  });

  test("non-pull_request events and non-closed actions are acked and ignored", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    process.env.GH_WEBHOOK_SECRET = WEBHOOK_SECRET;

    const ping = await postWebhook(t, { zen: "Design for failure." }, "ping");
    expect(ping.status).toBe(200);
    expect(await ping.text()).toBe("ignored");

    const opened = await postWebhook(t, {
      action: "opened",
      pull_request: { merged: false, head: { ref: "claude/devbug-x" } },
    });
    expect(opened.status).toBe(200);
    expect(await opened.text()).toBe("ignored");
  });

  test("merged PR -> MERGED + shippedAt via branch-name correlation; replay is idempotent", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    process.env.GH_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const id = await seedPrBug(t, maintainerId, "READY_TO_MERGE");

    const res = await postWebhook(
      t,
      mergedPrPayload(`claude/devbug-${id}`, true),
    );
    expect(res.status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("MERGED");
    expect(bug?.shippedAt).toBeTruthy();

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread.map((m) => [m.authorType, m.body])).toEqual([
      ["system", "Merged — deploying to staging…"],
    ]);

    // A merge only *triggers* the staging deploy: stagingDeploy is pending and
    // NO staging push fires yet (the "try it" ask waits for the workflow_run).
    expect(bug?.stagingDeploy?.state).toBe("pending");
    const stagingPushes = async () =>
      (await t.run(async (ctx) => ctx.db.query("notifications").collect()))
        .filter((n) => n.userId === maintainerId && /staging/i.test(n.title));
    expect(await stagingPushes()).toHaveLength(0);

    // Replayed delivery: no double system message, still no push.
    const replay = await postWebhook(
      t,
      mergedPrPayload(`claude/devbug-${id}`, true),
    );
    expect(replay.status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const replayedThread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(replayedThread).toHaveLength(1);
    expect(await stagingPushes()).toHaveLength(0);
  });

  test("merge done on GitHub while still in CODE_REVIEW correlates via prUrl fallback", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    process.env.GH_WEBHOOK_SECRET = WEBHOOK_SECRET;
    // Branch doesn't follow the claude/devbug-<id> convention; correlation
    // falls back to matching html_url against the stored prUrl.
    const id = await seedPrBug(t, maintainerId, "CODE_REVIEW");

    const res = await postWebhook(t, mergedPrPayload("fix/manual-branch", true));
    expect(res.status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("MERGED");
    expect(bug?.shippedAt).toBeTruthy();
  });

  test("early GitHub merge while still IN_PROGRESS applies MERGED (no stranding)", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    process.env.GH_WEBHOOK_SECRET = WEBHOOK_SECRET;
    // The implementation callback never landed: the row is still IN_PROGRESS
    // when a maintainer merges the PR directly on GitHub.
    const id = await seedPrBug(t, maintainerId, "IN_PROGRESS");

    const res = await postWebhook(
      t,
      mergedPrPayload(`claude/devbug-${id}`, true),
    );
    expect(res.status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("MERGED");
    expect(bug?.shippedAt).toBeTruthy();

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread.map((m) => [m.authorType, m.body])).toEqual([
      ["system", "Merged — deploying to staging…"],
    ]);
  });

  test("unmerged close posts a maintainer-look message and leaves status unchanged", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    process.env.GH_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const id = await seedPrBug(t, maintainerId, "CODE_REVIEW");

    const res = await postWebhook(
      t,
      mergedPrPayload(`claude/devbug-${id}`, false),
    );
    expect(res.status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("CODE_REVIEW");
    expect(bug?.shippedAt).toBeUndefined();

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread.map((m) => [m.authorType, m.body])).toEqual([
      [
        "system",
        "Pull request closed without merging — needs a maintainer look",
      ],
    ]);

    // Redelivered close doesn't stack duplicate messages.
    await postWebhook(t, mergedPrPayload(`claude/devbug-${id}`, false));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const replayedThread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(replayedThread).toHaveLength(1);
  });

  test("uncorrelated PR-closed events are dropped without side effects", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    process.env.GH_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const id = await seedPrBug(t, maintainerId, "READY_TO_MERGE");

    // Neither the branch nor the html_url matches anything we track.
    const res = await postWebhook(
      t,
      mergedPrPayload(
        "claude/devbug-notarealid",
        true,
        "https://github.com/togathernyc/togather/pull/9999",
      ),
    );
    expect(res.status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("READY_TO_MERGE");
    const messages = await t.run(async (ctx) =>
      ctx.db.query("devBugMessages").collect(),
    );
    expect(messages).toHaveLength(0);
  });

  // ---- workflow_run: staging/production deploy observation ----

  function workflowRunPayload(
    name: string,
    action: string,
    conclusion: string | null,
    headSha: string,
    headBranch = "main",
    runStartedAt?: string,
  ): Record<string, unknown> {
    return {
      action,
      workflow_run: {
        name,
        status: action === "completed" ? "completed" : "in_progress",
        conclusion,
        head_sha: headSha,
        head_branch: headBranch,
        ...(runStartedAt ? { run_started_at: runStartedAt } : {}),
      },
    };
  }

  async function seedDeployingBug(
    t: ReturnType<typeof convexTest>,
    originatorId: Id<"users">,
    sha: string,
    overrides: {
      verifyOnStaging?: boolean;
      workflows?: { name: string; conclusion?: string }[];
    } = {},
  ): Promise<Id<"devBugs">> {
    const now = Date.now();
    return await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: originatorId,
        status: "MERGED",
        kind: "bug",
        source: "dashboard",
        title: "Fix typo",
        body: "B",
        verifyOnStaging: overrides.verifyOnStaging,
        mergeCommitSha: sha,
        shippedAt: now,
        stagingDeploy: {
          state: "pending",
          workflows: overrides.workflows ?? [],
          updatedAt: now,
        },
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  async function stagingPushCount(
    t: ReturnType<typeof convexTest>,
    userId: Id<"users">,
  ): Promise<number> {
    const notifications = await t.run(async (ctx) =>
      ctx.db.query("notifications").collect(),
    );
    return notifications.filter(
      (n) => n.userId === userId && /staging/i.test(n.title),
    ).length;
  }

  test("a successful staging workflow_run flips the deploy live and fires the try-it push", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    process.env.GH_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const id = await seedDeployingBug(t, maintainerId, "sha-live", {
      verifyOnStaging: true,
    });

    // requested → tracked, still pending, no push.
    let res = await postWebhook(
      t,
      workflowRunPayload("Deploy Convex", "requested", null, "sha-live"),
      "workflow_run",
    );
    expect(res.status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      (await t.run(async (ctx) => ctx.db.get(id)))?.stagingDeploy?.state,
    ).toBe("pending");
    expect(await stagingPushCount(t, maintainerId)).toBe(0);

    // completed success → the only tracked workflow succeeded, so live.
    res = await postWebhook(
      t,
      workflowRunPayload("Deploy Convex", "completed", "success", "sha-live"),
      "workflow_run",
    );
    expect(res.status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.stagingDeploy?.state).toBe("live");

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread.map((m) => m.body)).toContain(
      "Live on staging — ready to try it",
    );
    expect(await stagingPushCount(t, maintainerId)).toBe(1);
  });

  test("staging deploy stays pending until EVERY triggered workflow succeeds", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    process.env.GH_WEBHOOK_SECRET = WEBHOOK_SECRET;
    // Both Convex and mobile were triggered (both paths changed).
    const id = await seedDeployingBug(t, maintainerId, "sha-both", {
      verifyOnStaging: true,
      workflows: [
        { name: "Deploy Convex" },
        { name: "Deploy Mobile Update" },
      ],
    });

    // First workflow succeeds — the other is still running, so NOT live.
    await postWebhook(
      t,
      workflowRunPayload("Deploy Convex", "completed", "success", "sha-both"),
      "workflow_run",
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      (await t.run(async (ctx) => ctx.db.get(id)))?.stagingDeploy?.state,
    ).toBe("pending");
    expect(await stagingPushCount(t, maintainerId)).toBe(0);

    // Second workflow succeeds — now all tracked workflows are green → live.
    await postWebhook(
      t,
      workflowRunPayload(
        "Deploy Mobile Update",
        "completed",
        "success",
        "sha-both",
      ),
      "workflow_run",
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      (await t.run(async (ctx) => ctx.db.get(id)))?.stagingDeploy?.state,
    ).toBe("live");
    expect(await stagingPushCount(t, maintainerId)).toBe(1);
  });

  test("a failed staging workflow flips to failed with a contact-the-lead-maintainer line and no push", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    process.env.GH_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const id = await seedDeployingBug(t, maintainerId, "sha-fail", {
      verifyOnStaging: true,
      workflows: [
        { name: "Deploy Convex" },
        { name: "Deploy Mobile Update" },
      ],
    });

    // Even though the OTHER workflow hasn't reported, one failure fails the
    // whole deploy immediately.
    await postWebhook(
      t,
      workflowRunPayload("Deploy Convex", "completed", "failure", "sha-fail"),
      "workflow_run",
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.stagingDeploy?.state).toBe("failed");
    expect(bug?.stagingDeploy?.failedWorkflow).toBe("Deploy Convex");

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread.map((m) => m.body)).toContain(
      "Staging deploy failed (Deploy Convex) — contact the lead maintainer.",
    );
    // Never invite the contributor to test something that isn't up.
    expect(await stagingPushCount(t, maintainerId)).toBe(0);
  });

  test("staging workflow_run for an unrelated SHA / non-main branch / already-settled deploy is a no-op", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    process.env.GH_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const id = await seedDeployingBug(t, maintainerId, "sha-real", {
      verifyOnStaging: true,
    });

    // Different SHA — correlates to nothing.
    await postWebhook(
      t,
      workflowRunPayload("Deploy Convex", "completed", "success", "sha-other"),
      "workflow_run",
    );
    // Right SHA but a feature branch, not main.
    await postWebhook(
      t,
      workflowRunPayload(
        "Deploy Convex",
        "completed",
        "success",
        "sha-real",
        "feature/x",
      ),
      "workflow_run",
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      (await t.run(async (ctx) => ctx.db.get(id)))?.stagingDeploy?.state,
    ).toBe("pending");
    expect(await stagingPushCount(t, maintainerId)).toBe(0);
  });

  test("a production workflow_run moves every pending-prod bug (success → live, failure → failed)", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    process.env.GH_WEBHOOK_SECRET = WEBHOOK_SECRET;

    const now = Date.now();
    const seedProd = async (): Promise<Id<"devBugs">> =>
      await t.run(async (ctx) =>
        ctx.db.insert("devBugs", {
          originatorUserId: maintainerId,
          status: "MERGED",
          kind: "bug",
          source: "dashboard",
          title: "Fix typo",
          body: "B",
          shippedAt: now,
          stagingVerifiedAt: now,
          productionDeploy: { state: "pending", updatedAt: now },
          createdAt: now,
          updatedAt: now,
        }),
      );

    // Success path.
    const liveId = await seedProd();
    await postWebhook(
      t,
      // Prod runs deploy everything on main — the SHA/branch are irrelevant to
      // correlation (global-by-state).
      workflowRunPayload("Deploy to Production", "completed", "success", "any"),
      "workflow_run",
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const live = await t.run(async (ctx) => ctx.db.get(liveId));
    expect(live?.productionDeploy?.state).toBe("live");
    const liveThread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id: liveId },
    );
    expect(liveThread.map((m) => m.body)).toContain("Live in production 🎉");

    // Failure path — a fresh pending-prod bug.
    const failId = await seedProd();
    await postWebhook(
      t,
      workflowRunPayload("Deploy to Production", "completed", "failure", "any"),
      "workflow_run",
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const failed = await t.run(async (ctx) => ctx.db.get(failId));
    expect(failed?.productionDeploy?.state).toBe("failed");
    const failThread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id: failId },
    );
    expect(failThread.map((m) => m.body)).toContain(
      "Production deploy failed — contact the lead maintainer.",
    );
    // The already-live bug from the success path isn't touched by the failure.
    expect(
      (await t.run(async (ctx) => ctx.db.get(liveId)))?.productionDeploy?.state,
    ).toBe("live");
  });

  test("a production run only settles bugs requested before it started (A/B race)", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    process.env.GH_WEBHOOK_SECRET = WEBHOOK_SECRET;

    const now = Date.now();
    const runStarted = now; // item A's run begins here.
    const seedProdAt = async (requestedAt: number): Promise<Id<"devBugs">> =>
      await t.run(async (ctx) =>
        ctx.db.insert("devBugs", {
          originatorUserId: maintainerId,
          status: "MERGED",
          kind: "bug",
          source: "dashboard",
          title: "Fix typo",
          body: "B",
          shippedAt: now,
          stagingVerifiedAt: now,
          productionDeploy: { state: "pending", requestedAt, updatedAt: requestedAt },
          createdAt: now,
          updatedAt: now,
        }),
      );

    // A requested before the run started; B requested a minute AFTER it started
    // (a second promotion while A's deploy was still in flight).
    const aId = await seedProdAt(runStarted - 60_000);
    const bId = await seedProdAt(runStarted + 60_000);

    // A's run completes — it covers A but NOT B.
    await postWebhook(
      t,
      workflowRunPayload(
        "Deploy to Production",
        "completed",
        "success",
        "any",
        "main",
        new Date(runStarted).toISOString(),
      ),
      "workflow_run",
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(
      (await t.run(async (ctx) => ctx.db.get(aId)))?.productionDeploy?.state,
    ).toBe("live");
    // B was requested after A's run began — it must still be pending, waiting
    // for its OWN run.
    expect(
      (await t.run(async (ctx) => ctx.db.get(bId)))?.productionDeploy?.state,
    ).toBe("pending");
  });

  test("the webhook accepts and schedules a workflow_run event (endpoint wiring)", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    process.env.GH_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const id = await seedDeployingBug(t, maintainerId, "sha-wire");

    const res = await postWebhook(
      t,
      workflowRunPayload("Deploy Convex", "completed", "success", "sha-wire"),
      "workflow_run",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("received");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // Non-interactive item: goes live, honest "live on staging" note.
    expect(
      (await t.run(async (ctx) => ctx.db.get(id)))?.stagingDeploy?.state,
    ).toBe("live");
  });
});

describe("review fix loop (ADR-029 Phase 3)", () => {
  /** Seed a bug sitting in CODE_REVIEW with an open PR. */
  async function seedCodeReviewBug(
    t: ReturnType<typeof convexTest>,
    originatorId: Id<"users">,
    overrides: Partial<{
      routineRunId: string;
      activeRunMode: "spec" | "implement" | "review" | "fix";
      reviewVerdict: "approved" | "changes_requested";
      reviewSummary: string;
      fixRounds: number;
    }> = {},
  ): Promise<Id<"devBugs">> {
    const now = Date.now();
    return await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: originatorId,
        status: "CODE_REVIEW",
        kind: "bug",
        source: "dashboard",
        title: "Fix typo",
        body: "B",
        spec: "## Plan\nChange the string.",
        riskLevel: "low",
        routineRunId: overrides.routineRunId ?? "run-review",
        activeRunMode: overrides.activeRunMode,
        prUrl: "https://github.com/togathernyc/togather/pull/42",
        reviewVerdict: overrides.reviewVerdict,
        reviewSummary: overrides.reviewSummary,
        fixRounds: overrides.fixRounds,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  test("changes_requested dispatches a fix run via the implement trigger and counts the round", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const id = await seedCodeReviewBug(t, maintainerId);
    const fetchMock = stubRoutineEnv();
    // Fix runs need push access, so they must fire through the implement
    // Routine's trigger — give it a distinct URL to prove that.
    process.env.CLAUDE_ROUTINES_TRIGGER_URL_IMPL =
      "https://api.anthropic.com/v1/claude_code/routines/trig_impl/fire";
    process.env.CLAUDE_ROUTINES_TOKEN_IMPL = "impl-token";

    const verdictCallback = {
      bugId: id,
      routineRunId: "run-review",
      status: "CODE_REVIEW" as const,
      reviewVerdict: "changes_requested" as const,
      reviewSummary: "Fix the null check.",
    };
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      verdictCallback,
    );
    // Re-delivered verdict before the scheduled fix dispatch runs: the stored
    // verdict is unchanged, so it must not schedule a second fix run.
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      verdictCallback,
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("trig_impl");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const brief = JSON.parse(JSON.parse(init.body as string).text);
    expect(brief).toMatchObject({
      mode: "fix",
      bugId: id,
      prUrl: "https://github.com/togathernyc/togather/pull/42",
      spec: "## Plan\nChange the string.",
      riskLevel: "low",
      reviewSummary: "Fix the null check.",
      callbackUrl: "https://example.convex.site/dev-assistant/callback",
    });
    expect(brief.instructions).toMatch(/review comments/);
    expect(brief.instructions).toMatch(/SAME branch/);
    expect(brief.instructions).toMatch(/Never merge/);

    // The fix run owns callback correlation (fresh routineRunId, stamped
    // mode) and the round was counted.
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("CODE_REVIEW");
    expect(bug?.fixRounds).toBe(1);
    expect(bug?.routineRunId).toBeTruthy();
    expect(bug?.routineRunId).not.toBe("run-review");
    expect(bug?.activeRunMode).toBe("fix");

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread.map((m) => [m.authorType, m.body])).toEqual([
      ["system", "Code review requested changes — Fix the null check."],
      ["system", "AI is addressing the review feedback (round 1 of 3)"],
    ]);
  });

  test("the 3-round cap escalates to a human instead of dispatching", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const id = await seedCodeReviewBug(t, maintainerId, { fixRounds: 3 });
    const fetchMock = stubRoutineEnv();

    const verdictCallback = {
      bugId: id,
      routineRunId: "run-review",
      status: "CODE_REVIEW" as const,
      reviewVerdict: "changes_requested" as const,
      reviewSummary: "Still broken.",
    };
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      verdictCallback,
    );
    // Replay: unchanged verdict must not repost the escalation or re-push.
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      verdictCallback,
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // No fix dispatch went out.
    expect(fetchMock).not.toHaveBeenCalled();
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.fixRounds).toBe(3);
    expect(bug?.routineRunId).toBe("run-review");

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread.map((m) => m.body)).toEqual([
      "Code review requested changes — Still broken.",
      "Code review still failing after 3 fix rounds — needs a human",
    ]);

    // The originator was notified (record created; no push tokens in tests).
    const notifications = await t.run(async (ctx) =>
      ctx.db.query("notifications").collect(),
    );
    const escalations = notifications.filter(
      (n) => n.userId === maintainerId && /needs a human/i.test(n.title),
    );
    expect(escalations).toHaveLength(1);
  });

  test("a fix run's CODE_REVIEW callback clears the verdict and re-dispatches review exactly once", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    // The fix run (run-fix-1) is in flight; the changes_requested verdict from
    // the previous review round is still pending on the row.
    const id = await seedCodeReviewBug(t, maintainerId, {
      routineRunId: "run-fix-1",
      activeRunMode: "fix",
      reviewVerdict: "changes_requested",
      reviewSummary: "Round 1 findings.",
      fixRounds: 1,
    });
    const fetchMock = stubRoutineEnv();

    const fixDoneCallback = {
      bugId: id,
      routineRunId: "run-fix-1",
      status: "CODE_REVIEW" as const,
    };
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      fixDoneCallback,
    );
    // Same-run duplicate delivery: the verdict is already cleared, so review
    // must not double-dispatch.
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      fixDoneCallback,
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const brief = JSON.parse(JSON.parse(init.body as string).text);
    expect(brief).toMatchObject({
      mode: "review",
      bugId: id,
      prUrl: "https://github.com/togathernyc/togather/pull/42",
    });

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("CODE_REVIEW");
    expect(bug?.reviewVerdict).toBeUndefined();
    expect(bug?.reviewSummary).toBeUndefined();
    // The fresh review round owns correlation now.
    expect(bug?.routineRunId).toBeTruthy();
    expect(bug?.routineRunId).not.toBe("run-fix-1");
    expect(bug?.activeRunMode).toBe("review");

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread.map((m) => [m.authorType, m.body])).toEqual([
      ["system", "Fixes pushed — running code review again"],
    ]);
  });

  test("a fix run's echoed review verdict is IGNORED — no fix re-dispatch, review still re-dispatched", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const id = await seedCodeReviewBug(t, maintainerId, {
      routineRunId: "run-fix-echo",
      activeRunMode: "fix",
      reviewVerdict: "changes_requested",
      reviewSummary: "Round 1 findings.",
      fixRounds: 1,
    });
    const fetchMock = stubRoutineEnv();

    // The fix run quotes the verdict it just addressed in its callback. It
    // has no review authority: the echo must not be stored (it would look
    // like a fresh verdict and dispatch ANOTHER fix run) — the callback still
    // counts as "fixes pushed" and re-dispatches review.
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: id,
        routineRunId: "run-fix-echo",
        status: "CODE_REVIEW",
        reviewVerdict: "changes_requested",
        reviewSummary: "Echoed: fix the null check.",
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Exactly one dispatch, and it's the review round — no fix run.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const brief = JSON.parse(JSON.parse(init.body as string).text);
    expect(brief).toMatchObject({ mode: "review", bugId: id });

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("CODE_REVIEW");
    expect(bug?.reviewVerdict).toBeUndefined();
    expect(bug?.reviewSummary).toBeUndefined();
    expect(bug?.fixRounds).toBe(1); // no extra round counted

    // Only the "fixes pushed" line — the echoed verdict posted no
    // "Code review requested changes" message.
    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread.map((m) => m.body)).toEqual([
      "Fixes pushed — running code review again",
    ]);
  });

  test("a legacy fix run (no stamped mode) still completes via payload-shape inference", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    // Row dispatched before activeRunMode stamping existed: no mode, pending
    // verdict — the old "CODE_REVIEW callback carrying no verdict" inference
    // must keep working across the deploy.
    const id = await seedCodeReviewBug(t, maintainerId, {
      routineRunId: "run-fix-legacy",
      reviewVerdict: "changes_requested",
      reviewSummary: "Round 1 findings.",
      fixRounds: 1,
    });
    const fetchMock = stubRoutineEnv();

    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      { bugId: id, routineRunId: "run-fix-legacy", status: "CODE_REVIEW" },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const brief = JSON.parse(JSON.parse(init.body as string).text);
    expect(brief).toMatchObject({ mode: "review", bugId: id });

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.reviewVerdict).toBeUndefined();
  });
});

describe("policy auto-merge (ADR-029 Phase 3)", () => {
  const PR_URL = "https://github.com/togathernyc/togather/pull/77";
  const MERGE_URL =
    "https://api.github.com/repos/togathernyc/togather/pulls/77/merge";

  /** Seed a bug at the merge gate (defaults pass every policy check). */
  async function seedMergeBug(
    t: ReturnType<typeof convexTest>,
    originatorId: Id<"users">,
    overrides: Partial<{
      status: "CODE_REVIEW" | "READY_TO_MERGE" | "MERGED";
      riskLevel: "low" | "medium" | "high";
      reviewVerdict: "approved" | "changes_requested";
      verifyOnStaging: boolean;
      stagingVerifiedAt: number;
      noPrUrl: boolean;
    }> = {},
  ): Promise<Id<"devBugs">> {
    const now = Date.now();
    return await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: originatorId,
        status: overrides.status ?? "READY_TO_MERGE",
        kind: "bug",
        source: "dashboard",
        title: "Fix typo",
        body: "B",
        spec: "## Plan\nChange the string.",
        riskLevel: overrides.riskLevel ?? "low",
        // "reviewVerdict: undefined" passed explicitly means "no verdict yet".
        reviewVerdict:
          "reviewVerdict" in overrides ? overrides.reviewVerdict : "approved",
        verifyOnStaging: overrides.verifyOnStaging,
        stagingVerifiedAt: overrides.stagingVerifiedAt,
        routineRunId: "run-merge",
        prUrl: overrides.noPrUrl ? undefined : PR_URL,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  /** Stub fetch with one response factory per expected call (last repeats). */
  function stubMergeFetch(...responses: Array<() => Response>) {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      const make = responses[Math.min(call, responses.length - 1)]!;
      call += 1;
      return make();
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function enableAutoMerge() {
    process.env.AUTO_MERGE_ENABLED = "true";
    process.env.GH_MIRROR_TOKEN = "gh-merge-pat";
  }

  async function threadBodies(
    t: ReturnType<typeof convexTest>,
    token: Id<"users">,
    id: Id<"devBugs">,
  ): Promise<string[]> {
    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token, id },
    );
    return thread.map((m) => m.body);
  }

  test("AUTO_MERGE_ENABLED anything but \"true\" is a silent no-op", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const id = await seedMergeBug(t, maintainerId);
    process.env.GH_MIRROR_TOKEN = "gh-merge-pat";
    const fetchMock = stubMergeFetch(() => new Response(null, { status: 200 }));

    // Unset entirely, then an explicit non-"true" value.
    await t.action(internal.functions.devAssistant.actions.attemptAutoMerge, {
      bugId: id,
    });
    process.env.AUTO_MERGE_ENABLED = "false";
    await t.action(internal.functions.devAssistant.actions.attemptAutoMerge, {
      bugId: id,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await threadBodies(t, maintainerId, id)).toEqual([]);
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("READY_TO_MERGE");
  });

  test("every unmet policy gate blocks the merge silently", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    enableAutoMerge();
    const fetchMock = stubMergeFetch(() => new Response(null, { status: 200 }));

    const gateFailures = [
      { status: "CODE_REVIEW" as const },
      { riskLevel: "medium" as const },
      { reviewVerdict: "changes_requested" as const },
      { noPrUrl: true },
    ];
    for (const overrides of gateFailures) {
      const id = await seedMergeBug(t, maintainerId, overrides);
      await t.action(
        internal.functions.devAssistant.actions.attemptAutoMerge,
        { bugId: id },
      );
      expect(await threadBodies(t, maintainerId, id)).toEqual([]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a raised per-originator cap lets a higher-risk item auto-merge", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    enableAutoMerge();
    // This originator is trusted up to high risk.
    await t.run(async (ctx) =>
      ctx.db.patch(maintainerId, { autoMergeMaxSeverity: "high" }),
    );
    const id = await seedMergeBug(t, maintainerId, { riskLevel: "high" });
    const fetchMock = stubMergeFetch(
      () => new Response(JSON.stringify({ merged: true }), { status: 200 }),
    );

    await t.action(internal.functions.devAssistant.actions.attemptAutoMerge, {
      bugId: id,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("MERGED");
  });

  test("a 'none' cap blocks auto-merge even for a low-risk item", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    enableAutoMerge();
    await t.run(async (ctx) =>
      ctx.db.patch(maintainerId, { autoMergeMaxSeverity: "none" }),
    );
    const id = await seedMergeBug(t, maintainerId, { riskLevel: "low" });
    const fetchMock = stubMergeFetch(() => new Response(null, { status: 200 }));

    await t.action(internal.functions.devAssistant.actions.attemptAutoMerge, {
      bugId: id,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("READY_TO_MERGE");
  });

  test("all gates passing merges via squash and applies MERGED directly", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    enableAutoMerge();
    const id = await seedMergeBug(t, maintainerId);
    const fetchMock = stubMergeFetch(
      () => new Response(JSON.stringify({ merged: true }), { status: 200 }),
    );

    await t.action(internal.functions.devAssistant.actions.attemptAutoMerge, {
      bugId: id,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(MERGE_URL);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer gh-merge-pat",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      merge_method: "squash",
    });

    expect(await threadBodies(t, maintainerId, id)).toEqual([
      "Auto-merged ✓ — all gates passed (low risk, review approved)",
      "Merged — deploying to staging…",
    ]);
    // GitHub confirmed the merge, so the action applies MERGED itself via
    // the trusted "automerge" source — the row must not strand at
    // READY_TO_MERGE waiting on webhook delivery.
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("MERGED");
    expect(bug?.shippedAt).toBeTruthy();

    // A later webhook delivery for the same merge stays a no-op: no duplicate
    // system message, status untouched.
    await t.mutation(internal.functions.devAssistant.bugs.handleGithubPrClosed, {
      branchRef: `claude/devbug-${id}`,
      prUrl: PR_URL,
      merged: true,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await threadBodies(t, maintainerId, id)).toEqual([
      "Auto-merged ✓ — all gates passed (low risk, review approved)",
      "Merged — deploying to staging…",
    ]);
  });

  test("an interactive item auto-merges without staging verification (staging is not a merge gate)", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    enableAutoMerge();
    // Interactive (verifyOnStaging) but never verified on staging — nothing
    // reaches staging until the merge, so this must NOT block the merge
    // (ADR-029). The staging try-it happens post-merge and gates production.
    const id = await seedMergeBug(t, maintainerId, { verifyOnStaging: true });
    const fetchMock = stubMergeFetch(() => new Response(null, { status: 200 }));

    await t.action(internal.functions.devAssistant.actions.attemptAutoMerge, {
      bugId: id,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await threadBodies(t, maintainerId, id)).toEqual([
      "Auto-merged ✓ — all gates passed (low risk, review approved)",
      "Merged — deploying to staging…",
    ]);
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("MERGED");
    expect(bug?.stagingVerifiedAt).toBeUndefined();
  });

  test("a 405 method-not-allowed retries once with plain merge", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    enableAutoMerge();
    const id = await seedMergeBug(t, maintainerId);
    const fetchMock = stubMergeFetch(
      () =>
        new Response(JSON.stringify({ message: "Merge method not allowed" }), {
          status: 405,
        }),
      () => new Response(JSON.stringify({ merged: true }), { status: 200 }),
    );

    await t.action(internal.functions.devAssistant.actions.attemptAutoMerge, {
      bugId: id,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const second = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(first.body as string)).toEqual({
      merge_method: "squash",
    });
    expect(JSON.parse(second.body as string)).toEqual({
      merge_method: "merge",
    });
    expect(await threadBodies(t, maintainerId, id)).toEqual([
      "Auto-merged ✓ — all gates passed (low risk, review approved)",
      "Merged — deploying to staging…",
    ]);
  });

  test("merge failure posts a blocked line for a maintainer, no retry loop", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    enableAutoMerge();
    const id = await seedMergeBug(t, maintainerId);
    const fetchMock = stubMergeFetch(
      () =>
        new Response(
          JSON.stringify({ message: "Pull Request is not mergeable" }),
          { status: 409 },
        ),
    );

    await t.action(internal.functions.devAssistant.actions.attemptAutoMerge, {
      bugId: id,
    });

    // Two calls, no retry loop: the merge PUT, then the merged-state GET that
    // rules out a lost race before reporting a failure. No further merges.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).not.toMatch(/\/merge$/);
    expect(await threadBodies(t, maintainerId, id)).toEqual([
      "Auto-merge blocked: GitHub merge returned 409 (Pull Request is not mergeable) — needs a maintainer",
    ]);
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("READY_TO_MERGE");
  });

  test("GH_MIRROR_TOKEN wins over the legacy GITHUB_MIRROR_TOKEN", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    process.env.AUTO_MERGE_ENABLED = "true";
    process.env.GH_MIRROR_TOKEN = "gh-new-pat";
    process.env.GITHUB_MIRROR_TOKEN = "gh-legacy-pat";
    const id = await seedMergeBug(t, maintainerId);
    const fetchMock = stubMergeFetch(() => new Response(null, { status: 200 }));

    await t.action(internal.functions.devAssistant.actions.attemptAutoMerge, {
      bugId: id,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({
      Authorization: "Bearer gh-new-pat",
    });
  });

  test("an approved verdict promoting to READY_TO_MERGE triggers the merge attempt", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    enableAutoMerge();
    // Review round in flight: CODE_REVIEW, correlated to run-review.
    const id = await seedMergeBug(t, maintainerId, {
      status: "CODE_REVIEW",
      reviewVerdict: undefined,
    });
    const fetchMock = stubMergeFetch(() => new Response(null, { status: 200 }));

    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: id,
        routineRunId: "run-merge",
        status: "CODE_REVIEW",
        reviewVerdict: "approved",
        reviewSummary: "Ship it.",
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const mergeCalls = fetchMock.mock.calls.filter(
      (c) => String(c[0]) === MERGE_URL,
    );
    expect(mergeCalls).toHaveLength(1);
    expect(await threadBodies(t, maintainerId, id)).toEqual([
      "Code review passed ✓",
      "Ready to merge",
      "Auto-merged ✓ — all gates passed (low risk, review approved)",
      "Merged — deploying to staging…",
    ]);
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("MERGED");
  });

  test("confirmStaging does NOT trigger a merge — the change is already merged", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    enableAutoMerge();
    // Staging is checked post-merge now, so the item is already MERGED when the
    // contributor signs off — there is nothing left to merge.
    const id = await seedMergeBug(t, maintainerId, {
      status: "MERGED",
      verifyOnStaging: true,
    });
    const fetchMock = stubMergeFetch(() => new Response(null, { status: 200 }));

    await t.mutation(api.functions.devAssistant.contributions.confirmStaging, {
      token: maintainerId,
      id,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).not.toHaveBeenCalled();
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("MERGED");
    expect(bug?.stagingVerifiedAt).toBeTruthy();
  });
});

describe("run-mode callback policy", () => {
  test("a spec revision clears the stale approval, logs it, and pushes the originator", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);

    // High risk so approval does NOT auto-dispatch — the item stays IN_REVIEW
    // with a signed-off spec, the exact window a revision can invalidate.
    const id = await submitAndDeliverSpec(t, maintainerId, "high");
    await t.mutation(api.functions.devAssistant.contributions.approveSpec, {
      token: maintainerId,
      id,
    });
    expect(
      (await t.run(async (ctx) => ctx.db.get(id)))?.specApprovedAt,
    ).toBeTruthy();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    stubRoutineEnv();
    vi.setSystemTime(Date.now() + 1000);

    // Contributor replies -> spec-revision round with a fresh routineRunId.
    await t.mutation(api.functions.devAssistant.contributions.postMessage, {
      token: maintainerId,
      id,
      body: "Actually, also fix the settings tab.",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const revised = await t.run(async (ctx) => ctx.db.get(id));

    // The revision delivers a CHANGED spec with no status change.
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: id,
        routineRunId: revised!.routineRunId!,
        status: "IN_REVIEW",
        spec: "## Plan v2\nChange the string on both tabs.",
        riskLevel: "high",
      },
    );

    // The old sign-off no longer covers the plan on the row.
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.spec).toBe("## Plan v2\nChange the string on both tabs.");
    expect(bug?.specApprovedAt).toBeUndefined();
    expect(bug?.status).toBe("IN_REVIEW");

    // Thread: the revision lands as ONE re-approval pointer (the plan text
    // itself is not reposted — it renders behind "The plan" card).
    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread.slice(-2).map((m) => [m.authorType, m.body])).toEqual([
      ["user", "Actually, also fix the settings tab."],
      ["system", "Plan updated — it needs your approval again"],
    ]);

    // The originator was pushed about the revision (status didn't change, so
    // the plain status push can't have fired) — exactly once.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const notifications = await t.run(async (ctx) =>
      ctx.db.query("notifications").collect(),
    );
    const revisionPushes = notifications.filter(
      (n) => n.userId === maintainerId && n.title === "Updated plan ready",
    );
    expect(revisionPushes).toHaveLength(1);
  });

  test("startBuild rejects non-buildable scopes (same gate as approveSpec)", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const now = Date.now();

    // An approved item that a later spec revision re-triaged out of
    // "buildable" — approveSpec's gate alone can't catch this.
    const seed = async (scope: "split" | "design_needed") =>
      await t.run(async (ctx) =>
        ctx.db.insert("devBugs", {
          originatorUserId: maintainerId,
          status: "IN_REVIEW",
          kind: "feature",
          source: "dashboard",
          title: "Build video chat",
          body: "B",
          spec: "## Too big",
          riskLevel: "high",
          specApprovedAt: now,
          scope,
          createdAt: now,
          updatedAt: now,
        }),
      );

    const splitId = await seed("split");
    await expect(
      t.mutation(api.functions.devAssistant.contributions.startBuild, {
        token: maintainerId,
        id: splitId,
      }),
    ).rejects.toThrow(/too large/);

    const designId = await seed("design_needed");
    await expect(
      t.mutation(api.functions.devAssistant.contributions.startBuild, {
        token: maintainerId,
        id: designId,
      }),
    ).rejects.toThrow(/design decisions/);

    const split = await t.run(async (ctx) => ctx.db.get(splitId));
    expect(split?.status).toBe("IN_REVIEW");
  });

  test("out-of-policy statuses for the stamped mode persist nothing", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const now = Date.now();

    // A spec run may only deliver IN_REVIEW: a CODE_REVIEW callback (with a
    // smuggled prUrl) is rejected wholesale.
    const specBugId = await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: maintainerId,
        status: "DRAFT",
        kind: "bug",
        source: "dashboard",
        title: "Fix typo",
        body: "B",
        routineRunId: "run-spec-rogue",
        activeRunMode: "spec",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: specBugId,
        routineRunId: "run-spec-rogue",
        status: "CODE_REVIEW",
        prUrl: "https://example.com/pr/rogue",
        spec: "## Smuggled plan",
      },
    );
    let bug = await t.run(async (ctx) => ctx.db.get(specBugId));
    expect(bug?.status).toBe("DRAFT");
    expect(bug?.prUrl).toBeUndefined();
    expect(bug?.spec).toBeUndefined();
    expect(bug?.lastError).toMatch(/spec run may not deliver status/);
    // And a spec run may not carry a review verdict either.
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: specBugId,
        routineRunId: "run-spec-rogue",
        status: "IN_REVIEW",
        spec: "## Plan",
        reviewVerdict: "approved",
      },
    );
    bug = await t.run(async (ctx) => ctx.db.get(specBugId));
    expect(bug?.status).toBe("DRAFT");
    expect(bug?.spec).toBeUndefined();
    expect(bug?.reviewVerdict).toBeUndefined();
    expect(bug?.lastError).toMatch(/review verdict/);
    // No thread side effects from rejected callbacks.
    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id: specBugId },
    );
    expect(thread).toHaveLength(0);

    // An implement run may not promote to READY_TO_MERGE — the review
    // pipeline owns that promotion now.
    const implBugId = await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: maintainerId,
        status: "CODE_REVIEW",
        kind: "bug",
        source: "dashboard",
        title: "Fix typo",
        body: "B",
        routineRunId: "run-impl-eager",
        activeRunMode: "implement",
        prUrl: "https://example.com/pr/1",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: implBugId,
        routineRunId: "run-impl-eager",
        status: "READY_TO_MERGE",
      },
    );
    const implBug = await t.run(async (ctx) => ctx.db.get(implBugId));
    expect(implBug?.status).toBe("CODE_REVIEW");
    expect(implBug?.lastError).toMatch(/review pipeline owns that promotion/);
  });

  test("rejectBug clears run correlation so in-flight callbacks fall on the floor", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId, otherMaintainerId } = await seedUsers(t);
    const now = Date.now();

    const id = await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: maintainerId,
        status: "IN_PROGRESS",
        kind: "bug",
        source: "dashboard",
        title: "Fix typo",
        body: "B",
        routineRunId: "run-doomed",
        activeRunMode: "implement",
        createdAt: now,
        updatedAt: now,
      }),
    );

    // otherMaintainerId is staff, so it passes rejectBug's superuser gate.
    await t.mutation(api.functions.devAssistant.bugs.rejectBug, {
      token: otherMaintainerId,
      bugId: id,
    });

    let bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("REJECTED");
    expect(bug?.routineRunId).toBeUndefined();
    expect(bug?.activeRunMode).toBeUndefined();

    // The in-flight run's callback no longer correlates: dropped entirely,
    // not even a lastError breadcrumb on the terminal row.
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: id,
        routineRunId: "run-doomed",
        status: "CODE_REVIEW",
        prUrl: "https://example.com/pr/zombie",
      },
    );
    bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("REJECTED");
    expect(bug?.prUrl).toBeUndefined();
    expect(bug?.lastError).toBeUndefined();
  });
});

/**
 * Chat-first filing, pictures, and split slices (ADR-029 follow-up).
 *
 * - submit derives a title from the message when none is given
 * - pictures ride the report/reply as message imageUrls and reach the spec
 *   agent as resolved public URLs
 * - the spec routine's `splitSlices` persist and clear with the scope
 */
describe("chat-first filing, pictures, and split slices", () => {
  test("submit derives a title from the message when none is given", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    stubRoutineEnv();

    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      {
        token: maintainerId,
        kind: "bug",
        body: "The events tab crashes when I tap a photo.",
      },
    );

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    // No title field → first line of the message becomes the placeholder.
    expect(bug?.title).toBe("The events tab crashes when I tap a photo.");
    // The message still seeds the opening thread turn verbatim.
    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread[0]?.body).toBe("The events tab crashes when I tap a photo.");
  });

  test("submit clips a long derived title with an ellipsis", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    stubRoutineEnv();

    const longBody =
      "This is a really long description that goes well past the eighty " +
      "character placeholder title limit so it should be clipped.";
    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      { token: maintainerId, kind: "feature", body: longBody },
    );

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.title.length).toBeLessThanOrEqual(80);
    expect(bug?.title.endsWith("…")).toBe(true);
    // The full message is preserved on the row/thread, only the title clips.
    expect(bug?.body).toBe(longBody);
  });

  test("submit rejects a message with neither text nor a screenshot", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    stubRoutineEnv();

    await expect(
      t.mutation(api.functions.devAssistant.contributions.submit, {
        token: maintainerId,
        kind: "bug",
        body: "   ",
      }),
    ).rejects.toThrow(/description or a screenshot/i);
  });

  test("submit accepts a screenshot-only report with a fallback title", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    stubRoutineEnv();
    process.env.R2_PUBLIC_URL = "https://cdn.example.com";

    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      {
        token: maintainerId,
        kind: "bug",
        body: "",
        screenshotUrls: ["r2:chat/only.jpg"],
      },
    );

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.title).toBe("Bug report");
    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread[0]?.body).toBe("");
    expect(thread[0]?.imageUrls).toEqual(["https://cdn.example.com/chat/only.jpg"]);

    delete process.env.R2_PUBLIC_URL;
  });

  test("attached pictures ride the opening turn and reach the spec agent as public URLs", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const fetchMock = stubRoutineEnv();
    process.env.R2_PUBLIC_URL = "https://cdn.example.com";

    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      {
        token: maintainerId,
        kind: "bug",
        body: "See the glitch in these shots.",
        screenshotUrls: ["r2:chat/a.jpg", "r2:chat/b.jpg"],
      },
    );

    // Stored on the row (durable R2 paths) and on the opening message.
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.screenshotUrls).toEqual(["r2:chat/a.jpg", "r2:chat/b.jpg"]);

    // getThread resolves them to fetchable public URLs for the app.
    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread[0]?.imageUrls).toEqual([
      "https://cdn.example.com/chat/a.jpg",
      "https://cdn.example.com/chat/b.jpg",
    ]);

    // The dispatched spec brief carries resolved (not r2:) URLs for vision.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const brief = JSON.parse(JSON.parse(init.body as string).text);
    expect(brief.screenshotUrls).toEqual([
      "https://cdn.example.com/chat/a.jpg",
      "https://cdn.example.com/chat/b.jpg",
    ]);

    delete process.env.R2_PUBLIC_URL;
  });

  test("postMessage accepts a picture-only reply and rejects an empty one", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    stubRoutineEnv();
    process.env.R2_PUBLIC_URL = "https://cdn.example.com";

    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      { token: maintainerId, kind: "bug", body: "Something's off." },
    );

    // A picture with no words is valid.
    await t.mutation(api.functions.devAssistant.contributions.postMessage, {
      token: maintainerId,
      id,
      body: "",
      imageUrls: ["r2:chat/c.jpg"],
    });
    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    const last = thread[thread.length - 1];
    expect(last?.body).toBe("");
    expect(last?.imageUrls).toEqual(["https://cdn.example.com/chat/c.jpg"]);

    // Neither text nor pictures is rejected.
    await expect(
      t.mutation(api.functions.devAssistant.contributions.postMessage, {
        token: maintainerId,
        id,
        body: "   ",
      }),
    ).rejects.toThrow(/Message body is required/);

    delete process.env.R2_PUBLIC_URL;
  });

  test("spec callback persists splitSlices for a split item and clears them on re-triage", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    stubRoutineEnv();

    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      { token: maintainerId, kind: "feature", body: "Rebuild the whole thing." },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const slices = [
      { title: "In progress tab", prompt: "Build the in-progress tab only." },
      { title: "Chat-first filing", prompt: "Reshape the submit form to a chat." },
    ];
    await t.mutation(internal.functions.devAssistant.bugs.applyCallback, {
      bugId: id,
      status: "IN_REVIEW",
      spec: "## Too big\nSplit it up.",
      scope: "split",
      splitSlices: slices,
    });

    let bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.scope).toBe("split");
    expect(bug?.splitSlices).toEqual(slices);

    // A revision that re-triages to a single buildable item clears the slices.
    await t.mutation(internal.functions.devAssistant.bugs.applyCallback, {
      bugId: id,
      status: "IN_REVIEW",
      spec: "## Actually small\nJust one screen.",
      scope: "buildable",
    });
    bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.scope).toBe("buildable");
    expect(bug?.splitSlices).toBeUndefined();
  });

  test("the http callback validates splitSlices and accepts a well-formed array", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const now = Date.now();
    const id = await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: maintainerId,
        status: "DRAFT",
        kind: "feature",
        source: "dashboard",
        title: "Big ask",
        body: "B",
        routineRunId: "run-spec",
        activeRunMode: "spec",
        createdAt: now,
        updatedAt: now,
      }),
    );

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

    // Malformed slice entries are rejected before scheduling.
    const bad = await post({
      bugId: id,
      routineRunId: "run-spec",
      status: "IN_REVIEW",
      scope: "split",
      splitSlices: [{ title: "Missing prompt" }],
    });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toMatch(/Invalid splitSlices/);

    // A well-formed array passes and persists end-to-end.
    const ok = await post({
      bugId: id,
      routineRunId: "run-spec",
      status: "IN_REVIEW",
      spec: "## Split\nDo it in pieces.",
      scope: "split",
      splitSlices: [{ title: "Slice one", prompt: "Build slice one only." }],
    });
    expect(ok.status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.scope).toBe("split");
    expect(bug?.splitSlices).toEqual([
      { title: "Slice one", prompt: "Build slice one only." },
    ]);
  });
});

/**
 * Review-cycle hardening (ADR-029 Phase 1.7): tests added after code review —
 * the r2:-only image guard, title-truncation boundary, getThread passthrough
 * for already-public URLs, revision-round image aggregation, and splitSlices
 * clearing on a design_needed re-triage.
 */
describe("review-cycle hardening", () => {
  test("submit and postMessage reject non-r2 image URLs", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    stubRoutineEnv();

    // submit rejects an external URL masquerading as an attachment.
    await expect(
      t.mutation(api.functions.devAssistant.contributions.submit, {
        token: maintainerId,
        kind: "bug",
        body: "look",
        screenshotUrls: ["https://evil.example/beacon.png"],
      }),
    ).rejects.toThrow(/uploaded images/i);

    // A valid item, then postMessage rejects the same.
    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      { token: maintainerId, kind: "bug", body: "ok" },
    );
    await expect(
      t.mutation(api.functions.devAssistant.contributions.postMessage, {
        token: maintainerId,
        id,
        body: "here",
        imageUrls: ["http://169.254.169.254/latest/meta-data/"],
      }),
    ).rejects.toThrow(/uploaded images/i);
  });

  test("deriveTitle keeps 80 chars but clips at 81", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    stubRoutineEnv();

    const exactly80 = "a".repeat(80);
    const id80 = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      { token: maintainerId, kind: "bug", body: exactly80 },
    );
    const bug80 = await t.run(async (ctx) => ctx.db.get(id80));
    expect(bug80?.title).toBe(exactly80); // no ellipsis at the boundary

    const over81 = "b".repeat(81);
    const id81 = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      { token: maintainerId, kind: "bug", body: over81 },
    );
    const bug81 = await t.run(async (ctx) => ctx.db.get(id81));
    expect(bug81?.title.length).toBe(80);
    expect(bug81?.title.endsWith("…")).toBe(true);
  });

  test("getThread passes already-public (http) image URLs through unchanged", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    process.env.R2_PUBLIC_URL = "https://cdn.example.com";

    // Simulate a chat-originated message whose imageUrls are already public
    // (inserted directly, bypassing the dashboard r2:-only guard).
    const now = Date.now();
    const id = await t.run(async (ctx) => {
      const bugId = await ctx.db.insert("devBugs", {
        originatorUserId: maintainerId,
        status: "IN_REVIEW",
        kind: "bug",
        source: "chat",
        title: "From chat",
        body: "B",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("devBugMessages", {
        bugId,
        authorType: "user",
        userId: maintainerId,
        body: "see this",
        imageUrls: ["https://already.public/shot.png"],
        createdAt: now,
      });
      return bugId;
    });

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread[0]?.imageUrls).toEqual(["https://already.public/shot.png"]);

    delete process.env.R2_PUBLIC_URL;
  });

  test("a revision round folds a reply's picture into the spec brief", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const fetchMock = stubRoutineEnv();
    process.env.R2_PUBLIC_URL = "https://cdn.example.com";

    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      { token: maintainerId, kind: "bug", body: "Initial report, no picture." },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Move to IN_REVIEW so the reply drives a revision round.
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: id,
        routineRunId: bug!.routineRunId!,
        status: "IN_REVIEW",
        spec: "## Plan",
        riskLevel: "low",
      },
    );

    // Reply with a screenshot → schedules a revision dispatch.
    await t.mutation(api.functions.devAssistant.contributions.postMessage, {
      token: maintainerId,
      id,
      body: "Here's what I mean:",
      imageUrls: ["r2:chat/reply.jpg"],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The most recent dispatch is the revision; its brief carries the resolved
    // reply image.
    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const brief = JSON.parse(JSON.parse(lastCall[1].body).text);
    expect(brief.revision).toBe(true);
    expect(brief.screenshotUrls).toContain("https://cdn.example.com/chat/reply.jpg");

    delete process.env.R2_PUBLIC_URL;
  });

  test("re-triage from split to design_needed clears stale splitSlices", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    stubRoutineEnv();

    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      { token: maintainerId, kind: "feature", body: "Huge ask." },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.mutation(internal.functions.devAssistant.bugs.applyCallback, {
      bugId: id,
      status: "IN_REVIEW",
      spec: "## Split",
      scope: "split",
      splitSlices: [{ title: "One", prompt: "Build one." }],
    });
    let bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.splitSlices).toHaveLength(1);

    // Revision decides it actually needs design work; no slices delivered.
    await t.mutation(internal.functions.devAssistant.bugs.applyCallback, {
      bugId: id,
      status: "IN_REVIEW",
      spec: "## Needs design",
      scope: "design_needed",
    });
    bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.scope).toBe("design_needed");
    expect(bug?.splitSlices).toBeUndefined();
  });

  test("a split revision that omits slices keeps the last-known ones", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    stubRoutineEnv();

    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      { token: maintainerId, kind: "feature", body: "Huge ask." },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const slices = [{ title: "One", prompt: "Build one." }];
    await t.mutation(internal.functions.devAssistant.bugs.applyCallback, {
      bugId: id,
      status: "IN_REVIEW",
      spec: "## Split",
      scope: "split",
      splitSlices: slices,
    });
    // A revision that stays "split" but omits splitSlices keeps them.
    await t.mutation(internal.functions.devAssistant.bugs.applyCallback, {
      bugId: id,
      status: "IN_REVIEW",
      spec: "## Still split",
      scope: "split",
    });
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.splitSlices).toEqual(slices);
  });
});

/**
 * Archive / unarchive (ADR-029): a contributor sets a conversation aside
 * (abandoned or not doable) and can restore it. Orthogonal to the pipeline
 * status; originator-only (plus staff/superuser).
 */
describe("archive / unarchive", () => {
  test("archive stamps archivedAt + a system turn, and is idempotent", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    stubRoutineEnv();

    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      { token: maintainerId, kind: "bug", body: "Abandon me." },
    );

    await t.mutation(api.functions.devAssistant.contributions.archive, {
      token: maintainerId,
      id,
    });
    let bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.archivedAt).toBeTruthy();
    const firstStamp = bug!.archivedAt;

    // Re-archiving is a no-op: keeps the first stamp, no duplicate system turn.
    await t.mutation(api.functions.devAssistant.contributions.archive, {
      token: maintainerId,
      id,
    });
    bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.archivedAt).toBe(firstStamp);

    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    const archiveMsgs = thread.filter((m) => m.body.includes("archived"));
    expect(archiveMsgs).toHaveLength(1);
  });

  test("unarchive clears archivedAt and restores the conversation", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    stubRoutineEnv();

    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      { token: maintainerId, kind: "bug", body: "Set aside then bring back." },
    );
    await t.mutation(api.functions.devAssistant.contributions.archive, {
      token: maintainerId,
      id,
    });
    await t.mutation(api.functions.devAssistant.contributions.unarchive, {
      token: maintainerId,
      id,
    });
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.archivedAt).toBeUndefined();
  });

  test("only the originator (or staff) can archive; other maintainers cannot", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId, otherMaintainerId } = await seedUsers(t);
    stubRoutineEnv();

    // A second non-staff maintainer who is NOT the originator.
    const now = Date.now();
    const strangerId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        firstName: "Stan",
        lastName: "Stranger",
        platformRoles: ["dev_maintainer"],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }),
    );

    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      { token: maintainerId, kind: "bug", body: "Mine to archive." },
    );

    // A non-owner, non-staff maintainer is refused.
    await expect(
      t.mutation(api.functions.devAssistant.contributions.archive, {
        token: strangerId,
        id,
      }),
    ).rejects.toThrow(/Only the person who started this/);

    // A staff maintainer (otherMaintainerId isStaff) may archive to tidy up.
    await t.mutation(api.functions.devAssistant.contributions.archive, {
      token: otherMaintainerId,
      id,
    });
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.archivedAt).toBeTruthy();
  });
});

/**
 * Archive pauses the pipeline (ADR-029, post-review): an archived item can't
 * be approved/built and doesn't consume the AI, but system callbacks still
 * land (archivedAt is orthogonal to status). Also covers the review's flagged
 * auth/superuser gaps.
 */
describe("archive pauses the pipeline", () => {
  test("approveSpec and startBuild are refused while archived", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);

    const id = await submitAndDeliverSpec(t, maintainerId, "medium");
    await t.mutation(api.functions.devAssistant.contributions.archive, {
      token: maintainerId,
      id,
    });

    await expect(
      t.mutation(api.functions.devAssistant.contributions.approveSpec, {
        token: maintainerId,
        id,
      }),
    ).rejects.toThrow(/Restore this conversation/);
    await expect(
      t.mutation(api.functions.devAssistant.contributions.startBuild, {
        token: maintainerId,
        id,
      }),
    ).rejects.toThrow(/Restore this conversation/);
  });

  test("replying to an archived item records the note but doesn't re-fire the AI", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    const fetchMock = stubRoutineEnv();

    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      { token: maintainerId, kind: "bug", body: "Abandon this." },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const dispatchesBefore = fetchMock.mock.calls.length; // initial spec dispatch

    await t.mutation(api.functions.devAssistant.contributions.archive, {
      token: maintainerId,
      id,
    });
    await t.mutation(api.functions.devAssistant.contributions.postMessage, {
      token: maintainerId,
      id,
      body: "Just a closing note.",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // No new dispatch fired for the archived reply.
    expect(fetchMock.mock.calls.length).toBe(dispatchesBefore);
    // ...but the note is in the thread.
    const thread = await t.query(
      api.functions.devAssistant.contributions.getThread,
      { token: maintainerId, id },
    );
    expect(thread.some((m) => m.body === "Just a closing note.")).toBe(true);
  });

  test("a routine callback still advances an archived in-flight item", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    stubRoutineEnv();

    const now = Date.now();
    const id = await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: maintainerId,
        status: "IN_PROGRESS",
        kind: "bug",
        source: "dashboard",
        title: "Mid-build then archived",
        body: "B",
        spec: "## Plan",
        riskLevel: "low",
        routineRunId: "run-live",
        activeRunMode: "implement",
        archivedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    );

    await t.action(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: id,
        routineRunId: "run-live",
        status: "CODE_REVIEW",
        prUrl: "https://example.com/pr/42",
      },
    );

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("CODE_REVIEW"); // status advanced
    expect(bug?.archivedAt).toBe(now); // still archived
  });

  test("unarchive is originator/staff-only, and a superuser may archive", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    stubRoutineEnv();

    const now = Date.now();
    const strangerId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        firstName: "Stan",
        lastName: "Stranger",
        platformRoles: ["dev_maintainer"],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const superId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        firstName: "Sue",
        lastName: "Super",
        platformRoles: ["dev_maintainer"],
        isSuperuser: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }),
    );

    const id = await t.mutation(
      api.functions.devAssistant.contributions.submit,
      { token: maintainerId, kind: "bug", body: "Owned item." },
    );

    // A superuser can archive someone else's item.
    await t.mutation(api.functions.devAssistant.contributions.archive, {
      token: superId,
      id,
    });
    expect((await t.run((ctx) => ctx.db.get(id)))?.archivedAt).toBeTruthy();

    // A non-owner, non-staff maintainer cannot unarchive it.
    await expect(
      t.mutation(api.functions.devAssistant.contributions.unarchive, {
        token: strangerId,
        id,
      }),
    ).rejects.toThrow(/Only the person who started this/);

    // The originator can.
    await t.mutation(api.functions.devAssistant.contributions.unarchive, {
      token: maintainerId,
      id,
    });
    expect((await t.run((ctx) => ctx.db.get(id)))?.archivedAt).toBeUndefined();
  });
});

describe("reconcileMergedPrs (manual-merge backstop)", () => {
  const PR_URL = "https://github.com/togathernyc/togather/pull/77";
  const PR_GET_URL =
    "https://api.github.com/repos/togathernyc/togather/pulls/77";

  async function seedOpenPrBug(
    t: ReturnType<typeof convexTest>,
    originatorId: Id<"users">,
    status: "CODE_REVIEW" | "READY_TO_MERGE",
  ): Promise<Id<"devBugs">> {
    const now = Date.now();
    return await t.run(async (ctx) =>
      ctx.db.insert("devBugs", {
        originatorUserId: originatorId,
        status,
        kind: "bug",
        source: "dashboard",
        title: "Fix typo",
        body: "B",
        riskLevel: "medium",
        reviewVerdict: status === "READY_TO_MERGE" ? "approved" : undefined,
        routineRunId: "run-merge",
        prUrl: PR_URL,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  test("flips an open-PR bug to MERGED when GitHub reports it merged", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    process.env.GH_MIRROR_TOKEN = "gh-merge-pat";
    const id = await seedOpenPrBug(t, maintainerId, "READY_TO_MERGE");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ merged: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await t.action(
      internal.functions.devAssistant.actions.reconcileMergedPrs,
      {},
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Polled the PR's GitHub endpoint, then applied the merge.
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(PR_GET_URL);
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("MERGED");
  });

  test("leaves the bug untouched when the PR isn't merged yet", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    process.env.GH_MIRROR_TOKEN = "gh-merge-pat";
    const id = await seedOpenPrBug(t, maintainerId, "CODE_REVIEW");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ merged: false }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await t.action(
      internal.functions.devAssistant.actions.reconcileMergedPrs,
      {},
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("CODE_REVIEW");
  });

  test("no-ops when the GitHub integration is unconfigured", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { maintainerId } = await seedUsers(t);
    // GH_MIRROR_TOKEN intentionally unset.
    const id = await seedOpenPrBug(t, maintainerId, "READY_TO_MERGE");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ merged: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await t.action(
      internal.functions.devAssistant.actions.reconcileMergedPrs,
      {},
    );

    expect(fetchMock).not.toHaveBeenCalled();
    const bug = await t.run(async (ctx) => ctx.db.get(id));
    expect(bug?.status).toBe("READY_TO_MERGE");
  });
});
