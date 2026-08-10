/**
 * upsertFromSubmission reactivation gating.
 *
 * upsertFromSubmission is scheduled from two kinds of callers:
 *   - the public landing-page form submission (reactivate: true), and
 *   - generic denormalization paths like CSV import / quick-add (no flag).
 *
 * Only the genuine submission may resurrect an archived person; a routine
 * import must never clear a member's archive. These tests pin that boundary.
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { modules } from "../test.setup";

async function seedArchivedPerson(t: ReturnType<typeof convexTest>) {
  const now = Date.now();
  const archivedAt = now - 5 * 24 * 60 * 60 * 1000; // archived 5 days ago

  return await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Reactivation Community",
      slug: "reactivation-community",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Announcements",
      slug: "announcements",
      isActive: true,
      createdAt: now,
      displayOrder: 0,
    });

    const announcementGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Announcements",
      isAnnouncementGroup: true,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });

    const userId = await ctx.db.insert("users", {
      firstName: "Archie",
      lastName: "Ved",
      email: "archie@test.com",
      phone: "+15555554001",
      createdAt: now,
      updatedAt: now,
    });

    const groupMemberId = await ctx.db.insert("groupMembers", {
      groupId: announcementGroupId,
      userId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    });

    // Canonical score doc read by upsertFromSubmission.
    await ctx.db.insert("memberFollowupScores", {
      groupId: announcementGroupId,
      groupMemberId,
      userId,
      firstName: "Archie",
      lastName: "Ved",
      score1: 0,
      score2: 0,
      alerts: [],
      isSnoozed: false,
      attendanceScore: 0,
      connectionScore: 0,
      followupScore: 0,
      missedMeetings: 0,
      consecutiveMissed: 0,
      scoreIds: [],
      updatedAt: now,
      addedAt: now,
    });

    // The person is currently archived.
    const communityPeopleId = await ctx.db.insert("communityPeople", {
      communityId,
      groupId: announcementGroupId,
      userId,
      firstName: "Archie",
      lastName: "Ved",
      isActive: false,
      archivedAt,
      createdAt: now,
      updatedAt: now,
    });

    return { communityId, userId, communityPeopleId, archivedAt };
  });
}

describe("upsertFromSubmission reactivation gating", () => {
  test("a generic upsert (no reactivate flag) leaves an archived person archived", async () => {
    const t = convexTest(schema, modules);
    const { communityId, userId, communityPeopleId, archivedAt } =
      await seedArchivedPerson(t);

    await t.mutation(internal.functions.communityPeople.upsertFromSubmission, {
      communityId,
      userId,
    });

    const row = await t.run((ctx) => ctx.db.get(communityPeopleId));
    expect(row?.isActive).toBe(false);
    expect(row?.archivedAt).toBe(archivedAt);
    expect(row?.reactivatedAt).toBeUndefined();
  });

  test("a real submission (reactivate: true) reactivates an archived person", async () => {
    const t = convexTest(schema, modules);
    const { communityId, userId, communityPeopleId } =
      await seedArchivedPerson(t);

    await t.mutation(internal.functions.communityPeople.upsertFromSubmission, {
      communityId,
      userId,
      reactivate: true,
    });

    const row = await t.run((ctx) => ctx.db.get(communityPeopleId));
    expect(row?.isActive).toBe(true);
    expect(row?.archivedAt).toBeUndefined();
    expect(typeof row?.reactivatedAt).toBe("number");
  });

  test("a generic upsert inherits the archive state when creating a new per-group row", async () => {
    const t = convexTest(schema, modules);
    const { communityId, userId } = await seedArchivedPerson(t);

    // The archived person joins a second group that has no communityPeople row.
    await t.run(async (ctx) => {
      const group = await ctx.db
        .query("groups")
        .withIndex("by_community", (q: any) => q.eq("communityId", communityId))
        .filter((q: any) => q.eq(q.field("isAnnouncementGroup"), true))
        .first();
      const secondGroupId = await ctx.db.insert("groups", {
        communityId,
        groupTypeId: group!.groupTypeId,
        name: "Dinner Party",
        isAnnouncementGroup: false,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        groupId: secondGroupId,
        userId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    // Generic upsert (no reactivate) — must not resurrect the person anywhere.
    await t.mutation(internal.functions.communityPeople.upsertFromSubmission, {
      communityId,
      userId,
    });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("communityPeople")
        .withIndex("by_community_user", (q: any) =>
          q.eq("communityId", communityId).eq("userId", userId),
        )
        .collect(),
    );
    // A new row was created for the second group, and it inherited the archive.
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.isActive === false)).toBe(true);
  });

  test("a generic upsert archives an active placeholder row (quick-add path)", async () => {
    const t = convexTest(schema, modules);
    const { communityId, userId } = await seedArchivedPerson(t);

    // Quick-add creates a minimal, active communityPeople row synchronously
    // before scheduling the generic upsert.
    const placeholderId = await t.run(async (ctx) => {
      const announcement = await ctx.db
        .query("groups")
        .withIndex("by_community", (q: any) => q.eq("communityId", communityId))
        .filter((q: any) => q.eq(q.field("isAnnouncementGroup"), true))
        .first();
      const secondGroupId = await ctx.db.insert("groups", {
        communityId,
        groupTypeId: announcement!.groupTypeId,
        name: "Dinner Party",
        isAnnouncementGroup: false,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        groupId: secondGroupId,
        userId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      // Active placeholder (no isActive set → defaults active).
      return await ctx.db.insert("communityPeople", {
        communityId,
        groupId: secondGroupId,
        userId,
        firstName: "Archie",
        lastName: "Ved",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.functions.communityPeople.upsertFromSubmission, {
      communityId,
      userId,
    });

    const placeholder = await t.run((ctx) => ctx.db.get(placeholderId));
    expect(placeholder?.isActive).toBe(false);
    expect(typeof placeholder?.archivedAt).toBe("number");
  });

  test("a stale archived row for a left group does not re-archive active rows", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    const ids = await t.run(async (ctx) => {
      const communityId = await ctx.db.insert("communities", {
        name: "Stale Left Group Community",
        slug: "stale-left-group",
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      });
      const groupTypeId = await ctx.db.insert("groupTypes", {
        communityId,
        name: "Announcements",
        slug: "announcements",
        isActive: true,
        createdAt: now,
        displayOrder: 0,
      });
      const announcementGroupId = await ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name: "Announcements",
        isAnnouncementGroup: true,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      });
      const userId = await ctx.db.insert("users", {
        firstName: "Rae",
        lastName: "Joyne",
        email: "rae@test.com",
        phone: "+15555554002",
        createdAt: now,
        updatedAt: now,
      });
      const groupMemberId = await ctx.db.insert("groupMembers", {
        groupId: announcementGroupId,
        userId,
        role: "member",
        joinedAt: now,
        notificationsEnabled: true,
      });
      await ctx.db.insert("memberFollowupScores", {
        groupId: announcementGroupId,
        groupMemberId,
        userId,
        firstName: "Rae",
        lastName: "Joyne",
        score1: 0,
        score2: 0,
        alerts: [],
        isSnoozed: false,
        attendanceScore: 0,
        connectionScore: 0,
        followupScore: 0,
        missedMeetings: 0,
        consecutiveMissed: 0,
        scoreIds: [],
        updatedAt: now,
        addedAt: now,
      });
      // Current announcement row is ACTIVE (e.g. just reactivated).
      const activeRowId = await ctx.db.insert("communityPeople", {
        communityId,
        groupId: announcementGroupId,
        userId,
        firstName: "Rae",
        lastName: "Joyne",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      // A group the user has LEFT, with a leftover archived row.
      const leftGroupId = await ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name: "Old Group",
        isAnnouncementGroup: false,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("groupMembers", {
        groupId: leftGroupId,
        userId,
        role: "member",
        joinedAt: now - 1000,
        leftAt: now - 500,
        notificationsEnabled: true,
      });
      await ctx.db.insert("communityPeople", {
        communityId,
        groupId: leftGroupId,
        userId,
        firstName: "Rae",
        lastName: "Joyne",
        isActive: false,
        archivedAt: now - 400,
        createdAt: now,
        updatedAt: now,
      });

      return { communityId, userId, activeRowId };
    });

    await t.mutation(internal.functions.communityPeople.upsertFromSubmission, {
      communityId: ids.communityId,
      userId: ids.userId,
    });

    // The current active row must stay active — the stale left-group archive
    // is not authoritative.
    const activeRow = await t.run((ctx) => ctx.db.get(ids.activeRowId));
    expect(activeRow?.isActive).toBe(true);
  });
});
