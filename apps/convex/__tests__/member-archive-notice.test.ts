/**
 * Pre-Archive Check-In Notice Tests
 *
 * Members are auto-archived after 60 days of inactivity. These tests cover the
 * "week before" check-in nudge sent to a member's leaders and assignees:
 *   1. The pure window/spell decision (shouldSendPreArchiveNotice)
 *   2. Candidate detection from announcement-group communityPeople rows
 *   3. Recipient resolution (assignees + group leaders, excluding the
 *      announcement group and the person themselves)
 *   4. Marking the notice as sent across the person's rows
 *
 * Run with: cd apps/convex && pnpm test __tests__/member-archive-notice.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import {
  shouldSendPreArchiveNotice,
  PRE_ARCHIVE_NOTICE_LEAD_MS,
} from "../functions/memberArchiveNotice";
import { INACTIVITY_THRESHOLD_MS } from "../functions/communityScoreComputation";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

// Integration queries compute activity age against the runtime clock (now()),
// so seeded activity timestamps must be anchored to real time, not NOW.
const REAL_NOW = Date.now();

// Activity age (ms) -> a lastActivityTs that old.
const ageMs = (ms: number) => NOW - ms;

// ============================================================================
// Pure decision logic
// ============================================================================

describe("shouldSendPreArchiveNotice", () => {
  test("fires inside the lead window before auto-archive", () => {
    expect(
      shouldSendPreArchiveNotice({
        nowTs: NOW,
        isActive: true,
        lastActivityTs: ageMs(55 * DAY_MS),
      }),
    ).toBe(true);
  });

  test("does not fire while still active recently (before the window)", () => {
    expect(
      shouldSendPreArchiveNotice({
        nowTs: NOW,
        isActive: true,
        lastActivityTs: ageMs(40 * DAY_MS),
      }),
    ).toBe(false);
  });

  test("window opens exactly one week before the archive cutoff", () => {
    const justInside = INACTIVITY_THRESHOLD_MS - PRE_ARCHIVE_NOTICE_LEAD_MS + DAY_MS;
    const justOutside = INACTIVITY_THRESHOLD_MS - PRE_ARCHIVE_NOTICE_LEAD_MS - DAY_MS;
    expect(
      shouldSendPreArchiveNotice({
        nowTs: NOW,
        isActive: true,
        lastActivityTs: ageMs(justInside),
      }),
    ).toBe(true);
    expect(
      shouldSendPreArchiveNotice({
        nowTs: NOW,
        isActive: true,
        lastActivityTs: ageMs(justOutside),
      }),
    ).toBe(false);
  });

  test("does not fire once the person is already past the archive cutoff", () => {
    expect(
      shouldSendPreArchiveNotice({
        nowTs: NOW,
        isActive: true,
        lastActivityTs: ageMs(INACTIVITY_THRESHOLD_MS + DAY_MS),
      }),
    ).toBe(false);
  });

  test("does not fire for an already-archived person", () => {
    expect(
      shouldSendPreArchiveNotice({
        nowTs: NOW,
        isActive: false,
        lastActivityTs: ageMs(55 * DAY_MS),
      }),
    ).toBe(false);
  });

  test("falls back to addedAt when there is no recorded activity", () => {
    expect(
      shouldSendPreArchiveNotice({
        nowTs: NOW,
        isActive: true,
        lastActivityTs: undefined,
        addedAt: ageMs(55 * DAY_MS),
      }),
    ).toBe(true);
  });

  test("returns false when there is no activity signal at all", () => {
    expect(
      shouldSendPreArchiveNotice({ nowTs: NOW, isActive: true }),
    ).toBe(false);
  });

  test("stays quiet once notified for the current inactivity spell", () => {
    const lastActivityTs = ageMs(55 * DAY_MS);
    expect(
      shouldSendPreArchiveNotice({
        nowTs: NOW,
        isActive: true,
        lastActivityTs,
        // Notified a day ago, after the last activity -> same spell.
        noticeSentAt: ageMs(DAY_MS),
      }),
    ).toBe(false);
  });

  test("re-notifies after the person engages again and goes quiet", () => {
    // Notice went out during a previous spell; then the person engaged (newer
    // activity), and has now gone quiet again into the window.
    expect(
      shouldSendPreArchiveNotice({
        nowTs: NOW,
        isActive: true,
        lastActivityTs: ageMs(54 * DAY_MS),
        noticeSentAt: ageMs(120 * DAY_MS), // older than the latest activity
      }),
    ).toBe(true);
  });
});

// ============================================================================
// Integration: candidate detection, recipients, marking
// ============================================================================

async function seedCommunity(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      subdomain: "test",
      slug: "test",
      timezone: "America/New_York",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Dinner Party",
      slug: "dinner-party",
      isActive: true,
      createdAt: NOW,
      displayOrder: 0,
    });
    const announcementGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Announcements",
      isArchived: false,
      isAnnouncementGroup: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const dinnerGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Tuesday Dinner",
      isArchived: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    return { communityId, groupTypeId, announcementGroupId, dinnerGroupId };
  });
}

async function insertUser(
  t: ReturnType<typeof convexTest>,
  firstName: string,
): Promise<Id<"users">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", { firstName, createdAt: NOW }),
  );
}

async function addMember(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
  userId: Id<"users">,
  role: "leader" | "member",
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      groupId,
      userId,
      role,
      joinedAt: NOW,
      notificationsEnabled: true,
    });
  });
}

describe("pre-archive candidate detection", () => {
  test("flags an inactive-but-not-archived announcement-group member", async () => {
    const t = convexTest(schema, modules);
    const { communityId, announcementGroupId } = await seedCommunity(t);
    const memberId = await insertUser(t, "Stale");
    const activeId = await insertUser(t, "Active");

    await t.run(async (ctx) => {
      // 55 days idle, still active, never notified -> candidate.
      await ctx.db.insert("communityPeople", {
        communityId,
        groupId: announcementGroupId,
        userId: memberId,
        firstName: "Stale",
        lastName: "Member",
        isActive: true,
        lastActiveAt: REAL_NOW - 55 * DAY_MS,
        createdAt: NOW,
        updatedAt: NOW,
      });
      // Active 5 days ago -> not a candidate.
      await ctx.db.insert("communityPeople", {
        communityId,
        groupId: announcementGroupId,
        userId: activeId,
        firstName: "Active",
        isActive: true,
        lastActiveAt: REAL_NOW - 5 * DAY_MS,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });

    const page = await t.query(
      internal.functions.memberArchiveNotice.getPreArchiveCandidatesPage,
      { announcementGroupId, limit: 100 },
    );

    expect(page.candidates).toHaveLength(1);
    expect(page.candidates[0].userId).toBe(memberId);
  });
});

describe("pre-archive recipient resolution", () => {
  test("includes assignees and group leaders, excluding self and announcement group", async () => {
    const t = convexTest(schema, modules);
    const { announcementGroupId, dinnerGroupId } = await seedCommunity(t);

    const memberId = await insertUser(t, "Stale");
    const dinnerLeaderId = await insertUser(t, "DinnerLeader");
    const assigneeId = await insertUser(t, "Assignee");
    const announcementLeaderId = await insertUser(t, "AdminLeader");

    // The member is in both the announcement group and the dinner group.
    await addMember(t, announcementGroupId, memberId, "member");
    await addMember(t, dinnerGroupId, memberId, "member");
    // A dinner-group leader should be notified.
    await addMember(t, dinnerGroupId, dinnerLeaderId, "leader");
    // An announcement-group "leader" (community admin) should NOT be notified.
    await addMember(t, announcementGroupId, announcementLeaderId, "leader");

    const recipients = await t.query(
      internal.functions.memberArchiveNotice.getPreArchiveRecipients,
      { userId: memberId, assigneeIds: [assigneeId] },
    );

    expect(recipients).toContain(dinnerLeaderId);
    expect(recipients).toContain(assigneeId);
    expect(recipients).not.toContain(announcementLeaderId);
    expect(recipients).not.toContain(memberId);
    expect(recipients).toHaveLength(2);
  });
});

describe("marking the notice as sent", () => {
  test("stamps preArchiveNoticeSentAt on every row for the person", async () => {
    const t = convexTest(schema, modules);
    const { communityId, announcementGroupId, dinnerGroupId } =
      await seedCommunity(t);
    const memberId = await insertUser(t, "Stale");

    await t.run(async (ctx) => {
      for (const groupId of [announcementGroupId, dinnerGroupId]) {
        await ctx.db.insert("communityPeople", {
          communityId,
          groupId,
          userId: memberId,
          isActive: true,
          // Stale enough to be a candidate, so the mark is what suppresses it.
          lastActiveAt: REAL_NOW - 55 * DAY_MS,
          createdAt: NOW,
          updatedAt: NOW,
        });
      }
    });

    await t.mutation(
      internal.functions.memberArchiveNotice.markPreArchiveNoticeSent,
      { communityId, userId: memberId, sentAt: REAL_NOW },
    );

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("communityPeople")
        .withIndex("by_community_user", (q) =>
          q.eq("communityId", communityId).eq("userId", memberId),
        )
        .collect(),
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.preArchiveNoticeSentAt === REAL_NOW)).toBe(true);

    // Re-checking the candidate detection should now skip this person.
    const page = await t.query(
      internal.functions.memberArchiveNotice.getPreArchiveCandidatesPage,
      { announcementGroupId, limit: 100 },
    );
    expect(page.candidates).toHaveLength(0);
  });
});
