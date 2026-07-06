/**
 * Contributor Dev Dashboard tests (functions/devAssistant/contributions.ts,
 * ADR-029 Phase 1).
 *
 * Covers the dashboard surface: submit -> platform-level DRAFT row + spec
 * dispatch, the spec-approval gate (auto-dispatch for low risk, explicit
 * startBuild otherwise), the spec-delivering callback (DRAFT -> IN_REVIEW),
 * shipped stamping, and unified contribution history (chat + dashboard).
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

describe("spec callback", () => {
  async function submitAndDeliverSpec(
    t: ReturnType<typeof convexTest>,
    maintainerId: Id<"users">,
    riskLevel: "low" | "medium" | "high",
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
      },
    );
    return id;
  }

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
});
