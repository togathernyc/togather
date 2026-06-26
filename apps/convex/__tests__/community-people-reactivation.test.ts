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
});
