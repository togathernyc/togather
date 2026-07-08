/**
 * Native-first serving tests.
 *
 * The profile "Serving" system score (sys_service / pco_services_past_2mo) and
 * the serving-history card are native-first: when a community uses native
 * rostering (has ≥1 eventPlans row) serving comes from `roleAssignments`; when
 * it has no native rostering it falls back to cached PCO `pcoServingCounts`.
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
  communityUsesNativeRostering,
  nativeServingHistory,
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
      ) => {
        const planId = await ctx.db.insert("eventPlans", {
          groupId: gtr.groupId,
          communityId,
          title,
          eventDate,
          times: [{ label: "9:00 AM", startsAt: eventDate }],
          status: "published",
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
    // 3 distinct plans in this community's window; duplicate slot, declined,
    // out-of-window, FUTURE, and the other community's plan are all excluded.
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
// (a) Native rostering present → serving from roleAssignments
// ============================================================================

describe("native rostering present", () => {
  test("serving score uses distinct native plans, ignoring stale PCO counts", async () => {
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

      // Stale PCO cache that would (wrongly) win if we weren't native-first.
      await ctx.db.patch(announcementGroupId, {
        pcoServingCounts: {
          updatedAt: nowTs,
          counts: [{ userId, count: 99 }],
          servingDetails: [],
        },
      });

      return { communityId, announcementGroupId, groupMemberId, userId };
    });

    const scored = await callScoreBatch(t, world);
    // Native count = 3 distinct plans (PCO's 99 is ignored).
    expect(scored.rawValues.pco_services_past_2mo).toBe(3);
    // sys_service = min(100, 3 * 20) = 60.
    expect(scored.score1).toBe(60);

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

    const usesNative = await t.run((ctx) =>
      communityUsesNativeRostering(ctx, world.communityId),
    );
    expect(usesNative).toBe(true);
  });
});

// ============================================================================
// (b) No native rostering → fall back to PCO pcoServingCounts
// ============================================================================

describe("no native rostering", () => {
  test("serving score falls back to cached PCO counts", async () => {
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

      // No eventPlans at all → PCO fallback. Cached count = 4.
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
    expect(scored.rawValues.pco_services_past_2mo).toBe(4);
    // sys_service = min(100, 4 * 20) = 80.
    expect(scored.score1).toBe(80);

    const usesNative = await t.run((ctx) =>
      communityUsesNativeRostering(ctx, world.communityId),
    );
    expect(usesNative).toBe(false);
  });
});
