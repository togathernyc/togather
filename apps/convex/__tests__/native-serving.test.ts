/**
 * Combined (PCO + native) serving tests.
 *
 * The profile "Serving" system score (sys_service / pco_services_past_2mo) and
 * the serving-history card combine BOTH sources: the cached PCO
 * `pcoServingCounts` snapshot AND native rostering (`roleAssignments`). Native
 * counts/rows exclude PCO-imported plans (`eventPlans.pcoPlanId`) so a migrated
 * plan isn't double-counted.
 *
 * Run with: cd apps/convex && pnpm test __tests__/native-serving.test.ts
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import {
  countNativeServing,
  nativeServingHistory,
  mergeServingHistory,
} from "../lib/nativeServing";

const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// countNativeServing (community-scoped: distinct plans, window, declined,
// and cross-community exclusion)
// ============================================================================

describe("countNativeServing", () => {
  test("counts distinct in-window non-declined plans, scoped to the community", async () => {
    const t = convexTest(schema, modules);
    const nowTs = Date.now();

    const { communityId, assignments } = await t.run(async (ctx) => {
      const c1 = await seedCommunity(ctx, "Count C1");
      const c2 = await seedCommunity(ctx, "Count C2");
      const userId = await seedUser(ctx, "Nate");

      // Campus group + team + role per community to roster onto.
      const mkTeamRole = async (
        communityId: Id<"communities">,
        groupTypeId: Id<"groupTypes">,
      ) => {
        const groupId = await ctx.db.insert("groups", {
          communityId,
          groupTypeId,
          name: "Campus",
          isArchived: false,
          createdAt: nowTs,
          updatedAt: nowTs,
        });
        const teamId = await ctx.db.insert("teams", {
          groupId,
          communityId,
          name: "Worship",
          createdAt: nowTs,
          createdById: userId,
          updatedAt: nowTs,
        });
        const roleId = await ctx.db.insert("teamRoles", {
          teamId,
          communityId,
          name: "Drums",
          sortOrder: 0,
          createdAt: nowTs,
          createdById: userId,
        });
        return { groupId, teamId, roleId };
      };
      const a = await mkTeamRole(c1.communityId, c1.groupTypeId);
      const b = await mkTeamRole(c2.communityId, c2.groupTypeId);

      const addPlan = async (
        communityId: Id<"communities">,
        gtr: { groupId: Id<"groups">; teamId: Id<"teams">; roleId: Id<"teamRoles"> },
        title: string,
        eventDate: number,
        status = "confirmed",
        pcoPlanId?: string,
      ) => {
        const planId = await ctx.db.insert("eventPlans", {
          groupId: gtr.groupId,
          communityId,
          title,
          eventDate,
          times: [{ label: "9:00 AM", startsAt: eventDate }],
          status: "published",
          ...(pcoPlanId ? { pcoPlanId } : {}),
          createdAt: nowTs,
          createdById: userId,
          updatedAt: nowTs,
        });
        await ctx.db.insert("roleAssignments", {
          planId,
          teamId: gtr.teamId,
          roleId: gtr.roleId,
          userId,
          eventDate,
          status,
          assignedById: userId,
          assignedAt: nowTs,
        });
        return planId;
      };

      // Community 1: 3 distinct in-window plans (one with a duplicate slot),
      // 1 declined, 1 out-of-window → distinct in-window non-declined = 3.
      const p1 = await addPlan(c1.communityId, a, "P1", nowTs - 10 * DAY_MS);
      await ctx.db.insert("roleAssignments", {
        planId: p1,
        teamId: a.teamId,
        roleId: a.roleId,
        userId,
        eventDate: nowTs - 10 * DAY_MS,
        status: "unconfirmed",
        assignedById: userId,
        assignedAt: nowTs,
      });
      await addPlan(c1.communityId, a, "P2", nowTs - 20 * DAY_MS);
      await addPlan(c1.communityId, a, "P3", nowTs - 30 * DAY_MS);
      await addPlan(c1.communityId, a, "Declined", nowTs - 5 * DAY_MS, "declined");
      await addPlan(c1.communityId, a, "Old", nowTs - 90 * DAY_MS);
      // Future plan — rostered ahead but not yet served → must NOT count.
      await addPlan(c1.communityId, a, "Future", nowTs + 5 * DAY_MS);
      // PCO-imported plan (pcoPlanId set) — already in the PCO snapshot the
      // caller adds, so the native count must NOT include it.
      await addPlan(c1.communityId, a, "Imported", nowTs - 8 * DAY_MS, "confirmed", "pco-plan-123");
      // Community 2: an in-window plan that must NOT count toward community 1.
      await addPlan(c2.communityId, b, "OtherComm", nowTs - 3 * DAY_MS);

      const assignments = await ctx.db
        .query("roleAssignments")
        .withIndex("by_user_eventDate", (q: any) => q.eq("userId", userId))
        .order("desc")
        .take(200);
      return { communityId: c1.communityId, assignments };
    });

    const count = await t.run((ctx) =>
      countNativeServing(ctx, assignments, nowTs, communityId),
    );
    // 3 native-origin distinct plans in this community's window; duplicate
    // slot, declined, out-of-window, FUTURE, PCO-imported, and the other
    // community's plan are all excluded.
    expect(count).toBe(3);

    const zero = await t.run((ctx) =>
      countNativeServing(ctx, [], nowTs, communityId),
    );
    expect(zero).toBe(0);
  });
});

// ============================================================================
// Integration world builder
// ============================================================================

interface ServingWorld {
  communityId: Id<"communities">;
  announcementGroupId: Id<"groups">;
  groupMemberId: Id<"groupMembers">;
  userId: Id<"users">;
}

async function seedUser(ctx: any, first: string): Promise<Id<"users">> {
  const t = Date.now();
  return ctx.db.insert("users", {
    firstName: first,
    lastName: "Server",
    isActive: true,
    createdAt: t,
    updatedAt: t,
  });
}

async function seedCommunity(
  ctx: any,
  name: string,
): Promise<{
  communityId: Id<"communities">;
  groupTypeId: Id<"groupTypes">;
  announcementGroupId: Id<"groups">;
}> {
  const t = Date.now();
  const communityId = await ctx.db.insert("communities", {
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    isPublic: true,
  });
  const groupTypeId = await ctx.db.insert("groupTypes", {
    communityId,
    name: "Campus",
    slug: "campus",
    isActive: true,
    createdAt: t,
    displayOrder: 1,
  });
  const announcementGroupId = await ctx.db.insert("groups", {
    communityId,
    groupTypeId,
    name: "Announcements",
    isAnnouncementGroup: true,
    isArchived: false,
    createdAt: t,
    updatedAt: t,
  });
  return { communityId, groupTypeId, announcementGroupId };
}

async function joinAnnouncementGroup(
  ctx: any,
  announcementGroupId: Id<"groups">,
  userId: Id<"users">,
): Promise<Id<"groupMembers">> {
  return ctx.db.insert("groupMembers", {
    groupId: announcementGroupId,
    userId,
    role: "member",
    joinedAt: Date.now() - 90 * DAY_MS,
    notificationsEnabled: true,
  });
}

/** Insert a plan + one non-declined assignment for `userId` on it. */
async function seedPlanWithAssignment(
  ctx: any,
  args: {
    communityId: Id<"communities">;
    groupId: Id<"groups">;
    teamId: Id<"teams">;
    roleId: Id<"teamRoles">;
    userId: Id<"users">;
    title: string;
    eventDate: number;
    status?: string;
  },
): Promise<Id<"eventPlans">> {
  const t = Date.now();
  const planId = await ctx.db.insert("eventPlans", {
    groupId: args.groupId,
    communityId: args.communityId,
    title: args.title,
    eventDate: args.eventDate,
    times: [{ label: "9:00 AM", startsAt: args.eventDate }],
    status: "published",
    createdAt: t,
    createdById: args.userId,
    updatedAt: t,
  });
  await ctx.db.insert("roleAssignments", {
    planId,
    teamId: args.teamId,
    roleId: args.roleId,
    userId: args.userId,
    eventDate: args.eventDate,
    status: args.status ?? "confirmed",
    assignedById: args.userId,
    assignedAt: t,
  });
  return planId;
}

async function callScoreBatch(
  t: ReturnType<typeof convexTest>,
  world: ServingWorld,
) {
  const results = await t.query(
    internal.functions.communityScoreComputation.computeCommunityScoresBatch,
    {
      communityId: world.communityId,
      announcementGroupId: world.announcementGroupId,
      members: [
        {
          groupMemberId: world.groupMemberId,
          userId: world.userId,
          joinedAt: Date.now() - 90 * DAY_MS,
          firstName: "Test",
          lastName: "Server",
        },
      ],
    },
  );
  return results[0];
}

// ============================================================================
// (a) Native rostering present → serving = PCO count + native plans
// ============================================================================

describe("PCO + native combined", () => {
  test("serving score sums cached PCO count and distinct native plans", async () => {
    const t = convexTest(schema, modules);
    const nowTs = Date.now();

    const world = await t.run(async (ctx): Promise<ServingWorld> => {
      const { communityId, groupTypeId, announcementGroupId } =
        await seedCommunity(ctx, "Native Community");
      const userId = await seedUser(ctx, "Nate");
      const groupMemberId = await joinAnnouncementGroup(
        ctx,
        announcementGroupId,
        userId,
      );

      // A campus group + team + role to roster onto.
      const groupId = await ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name: "Campus",
        isArchived: false,
        createdAt: nowTs,
        updatedAt: nowTs,
      });
      const teamId = await ctx.db.insert("teams", {
        groupId,
        communityId,
        name: "Worship",
        createdAt: nowTs,
        createdById: userId,
        updatedAt: nowTs,
      });
      const roleId = await ctx.db.insert("teamRoles", {
        teamId,
        communityId,
        name: "Drums",
        sortOrder: 0,
        createdAt: nowTs,
        createdById: userId,
      });

      // 3 distinct plans in-window (one with a duplicate slot), 1 declined,
      // 1 outside the window → distinct in-window non-declined = 3.
      const p1 = await seedPlanWithAssignment(ctx, {
        communityId,
        groupId,
        teamId,
        roleId,
        userId,
        title: "Sunday AM",
        eventDate: nowTs - 10 * DAY_MS,
      });
      // Duplicate slot on the same plan p1 — must not double-count.
      await ctx.db.insert("roleAssignments", {
        planId: p1,
        teamId,
        roleId,
        userId,
        eventDate: nowTs - 10 * DAY_MS,
        status: "unconfirmed",
        assignedById: userId,
        assignedAt: nowTs,
      });
      await seedPlanWithAssignment(ctx, {
        communityId,
        groupId,
        teamId,
        roleId,
        userId,
        title: "Wednesday",
        eventDate: nowTs - 20 * DAY_MS,
      });
      await seedPlanWithAssignment(ctx, {
        communityId,
        groupId,
        teamId,
        roleId,
        userId,
        title: "Sunday PM",
        eventDate: nowTs - 30 * DAY_MS,
      });
      // Declined — excluded.
      await seedPlanWithAssignment(ctx, {
        communityId,
        groupId,
        teamId,
        roleId,
        userId,
        title: "Declined Day",
        eventDate: nowTs - 5 * DAY_MS,
        status: "declined",
      });
      // Outside the 60-day window — excluded from the count, still shown on
      // the (unbounded) history card.
      await seedPlanWithAssignment(ctx, {
        communityId,
        groupId,
        teamId,
        roleId,
        userId,
        title: "Old Day",
        eventDate: nowTs - 90 * DAY_MS,
      });
      // Future assignment (rostered ahead) — must NOT appear on the past-only
      // serving-history card.
      await seedPlanWithAssignment(ctx, {
        communityId,
        groupId,
        teamId,
        roleId,
        userId,
        title: "Future Day",
        eventDate: nowTs + 7 * DAY_MS,
      });

      // Cached PCO snapshot: 1 past service, plus one servingDetails row for a
      // PCO-only service the native side never sees.
      await ctx.db.patch(announcementGroupId, {
        pcoServingCounts: {
          updatedAt: nowTs,
          counts: [{ userId, count: 1 }],
          servingDetails: [
            {
              userId,
              date: new Date(nowTs - 40 * DAY_MS).toISOString().split("T")[0],
              serviceTypeName: "PCO Service",
              teamName: "PCO Team",
              position: "Usher",
            },
          ],
        },
      });

      return { communityId, announcementGroupId, groupMemberId, userId };
    });

    const scored = await callScoreBatch(t, world);
    // Combined = PCO count (1) + native distinct plans (3) = 4.
    expect(scored.rawValues.pco_services_past_2mo).toBe(4);
    // sys_service = min(100, 4 * 20) = 80.
    expect(scored.score1).toBe(80);

    // Serving-history card lists native rows, newest event first.
    const history = await t.run((ctx) =>
      nativeServingHistory(ctx, world.userId, world.communityId),
    );
    // 4 non-declined assignments across the window+old plan, but distinct
    // rows returned newest-first (one row per assignment).
    expect(history[0].serviceTypeName).toBe("Sunday AM");
    expect(history[0].teamName).toBe("Worship");
    expect(history[0].position).toBe("Drums");
    const titles = history.map((h) => h.serviceTypeName);
    expect(titles).toContain("Wednesday");
    expect(titles).toContain("Sunday PM");
    // Declined assignment never appears.
    expect(titles).not.toContain("Declined Day");
    // Future assignment never appears on the past-only serving-history card.
    expect(titles).not.toContain("Future Day");
  });
});

// ============================================================================
// (b) No native plans → serving = cached PCO count only
// ============================================================================

describe("PCO only (no native plans)", () => {
  test("serving score uses the cached PCO count when there is no native rostering", async () => {
    const t = convexTest(schema, modules);
    const nowTs = Date.now();

    const world = await t.run(async (ctx): Promise<ServingWorld> => {
      const { communityId, announcementGroupId } = await seedCommunity(
        ctx,
        "PCO Community",
      );
      const userId = await seedUser(ctx, "Paul");
      const groupMemberId = await joinAnnouncementGroup(
        ctx,
        announcementGroupId,
        userId,
      );

      // No eventPlans at all → native contributes 0. Cached PCO count = 4.
      await ctx.db.patch(announcementGroupId, {
        pcoServingCounts: {
          updatedAt: nowTs,
          counts: [{ userId, count: 4 }],
          servingDetails: [],
        },
      });

      return { communityId, announcementGroupId, groupMemberId, userId };
    });

    const scored = await callScoreBatch(t, world);
    // native (0) + PCO (4) = 4.
    expect(scored.rawValues.pco_services_past_2mo).toBe(4);
    // sys_service = min(100, 4 * 20) = 80.
    expect(scored.score1).toBe(80);
  });
});

// ============================================================================
// (c) mergeServingHistory — union of native + PCO rows, deduped, newest-first
// ============================================================================

describe("mergeServingHistory", () => {
  test("merges native + PCO rows newest-first and dedupes overlap", () => {
    const native = [
      { date: "2026-06-01", serviceTypeName: "Sunday", teamName: "Worship", position: "Drums" },
      { date: "2026-05-15", serviceTypeName: "Sunday", teamName: "Worship", position: "Drums" },
    ];
    const pco = [
      // Same service as the first native row → deduped.
      { date: "2026-06-01", serviceTypeName: "Sunday", teamName: "Worship", position: "Drums" },
      { date: "2026-06-10", serviceTypeName: "PCO Service", teamName: "Hospitality", position: "Usher" },
    ];
    const merged = mergeServingHistory(native, pco, 15);
    // Newest first: 06-10 (PCO), 06-01 (deduped), 05-15 (native).
    expect(merged.map((r) => r.date)).toEqual([
      "2026-06-10",
      "2026-06-01",
      "2026-05-15",
    ]);
    // The overlapping 06-01 row appears exactly once.
    expect(merged.filter((r) => r.date === "2026-06-01")).toHaveLength(1);
  });

  test("respects the cap", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-06-${String(i + 1).padStart(2, "0")}`,
      serviceTypeName: "S",
      teamName: "T",
      position: null,
    }));
    expect(mergeServingHistory(rows, [], 15)).toHaveLength(15);
  });
});
