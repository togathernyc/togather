/**
 * Member-Created Events Tests (ADR-022 PR 2)
 *
 * Covers the permission loosening on meetings.create/update/cancel, the
 * 1-future-event cap on non-leaders, locationMode validation, the
 * meetingReports round-trip, and the leave-community ownership transfer.
 */

import { convexTest } from "convex-test";
import { expect, test, describe, afterEach } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { api } from "../_generated/api";
import { generateTokens } from "../lib/auth";
import type { Id } from "../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// convex-test leaves its global TransactionManager busy when a mutation
// rejects (a handler throw during a `rejects.toThrow` assertion), which
// surfaces the next `convexTest()` call as "test began while previous
// transaction was still open" — intermittently locally, consistently in CI.
// Yielding to the microtask + timer queues between tests lets the harness
// unwind before the next test starts.
afterEach(async () => {
  await new Promise((resolve) => setImmediate(resolve));
});

interface Seed {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  leaderId: Id<"users">;
  memberId: Id<"users">;
  otherMemberId: Id<"users">;
  outsiderId: Id<"users">;
  adminId: Id<"users">;
  leaderToken: string;
  memberToken: string;
  otherMemberToken: string;
  outsiderToken: string;
  adminToken: string;
}

async function seed(t: ReturnType<typeof convexTest>): Promise<Seed> {
  const communityId = await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: "Test",
      subdomain: "test",
      slug: "test",
      timezone: "America/New_York",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const groupTypeId = await t.run(async (ctx) =>
    ctx.db.insert("groupTypes", {
      communityId,
      name: "Groups",
      slug: "groups",
      isActive: true,
      displayOrder: 1,
      createdAt: Date.now(),
    })
  );

  const groupId = await t.run(async (ctx) =>
    ctx.db.insert("groups", {
      name: "Group",
      communityId,
      groupTypeId,
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  );

  const makeUser = async (first: string, phone: string) =>
    t.run(async (ctx) =>
      ctx.db.insert("users", {
        firstName: first,
        lastName: "T",
        phone,
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );

  const leaderId = await makeUser("Leader", "+15555550001");
  const memberId = await makeUser("Member", "+15555550002");
  const otherMemberId = await makeUser("Other", "+15555550003");
  const outsiderId = await makeUser("Outsider", "+15555550004");
  const adminId = await makeUser("Admin", "+15555550099");

  // group memberships
  await t.run(async (ctx) => {
    for (const [userId, role] of [
      [leaderId, "leader"],
      [memberId, "member"],
      [otherMemberId, "member"],
    ] as const) {
      await ctx.db.insert("groupMembers", {
        userId,
        groupId,
        role,
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    }
  });

  // community memberships (status=1 means active)
  await t.run(async (ctx) => {
    for (const userId of [leaderId, memberId, otherMemberId, outsiderId]) {
      await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        roles: 1,
        status: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    await ctx.db.insert("userCommunities", {
      userId: adminId,
      communityId,
      roles: 4, // PRIMARY_ADMIN
      status: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const [leaderTokens, memberTokens, otherTokens, outsiderTokens, adminTokens] =
    await Promise.all([
      generateTokens(leaderId),
      generateTokens(memberId),
      generateTokens(otherMemberId),
      generateTokens(outsiderId),
      generateTokens(adminId),
    ]);

  return {
    communityId,
    groupId,
    leaderId,
    memberId,
    otherMemberId,
    outsiderId,
    adminId,
    leaderToken: leaderTokens.accessToken,
    memberToken: memberTokens.accessToken,
    otherMemberToken: otherTokens.accessToken,
    outsiderToken: outsiderTokens.accessToken,
    adminToken: adminTokens.accessToken,
  };
}

const FUTURE = () => Date.now() + 24 * 60 * 60 * 1000;

// ============================================================================
// Create permission + cap
// ============================================================================

describe("meetings.create — member flow", () => {
  test("active member can create an event", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const meetingId = await t.mutation(api.functions.meetings.index.create, {
      token: s.memberToken,
      groupId: s.groupId,
      scheduledAt: FUTURE(),
      meetingType: 1,
      locationMode: "address",
      locationOverride: "123 Main St, Dallas, TX 75201",
    });

    expect(meetingId).toBeDefined();
  });

  test("non-member is rejected", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      t.mutation(api.functions.meetings.index.create, {
        token: s.outsiderToken,
        groupId: s.groupId,
        scheduledAt: FUTURE(),
        meetingType: 1,
        locationMode: "tbd",
      })
    ).rejects.toThrow();
  });

  test("non-leader cannot attach seriesId", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const seriesId = await t.run(async (ctx) =>
      ctx.db.insert("eventSeries", {
        groupId: s.groupId,
        createdById: s.leaderId,
        name: "Weekly",
        status: "active",
        createdAt: Date.now(),
      })
    );

    await expect(
      t.mutation(api.functions.meetings.index.create, {
        token: s.memberToken,
        groupId: s.groupId,
        scheduledAt: FUTURE(),
        meetingType: 1,
        locationMode: "tbd",
        seriesId,
      })
    ).rejects.toThrow(/series/i);
  });

  test("second future event from same non-leader is capped", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await t.mutation(api.functions.meetings.index.create, {
      token: s.memberToken,
      groupId: s.groupId,
      scheduledAt: FUTURE(),
      meetingType: 1,
      locationMode: "tbd",
    });

    await expect(
      t.mutation(api.functions.meetings.index.create, {
        token: s.memberToken,
        groupId: s.groupId,
        scheduledAt: FUTURE() + 1000,
        meetingType: 1,
        locationMode: "tbd",
      })
    ).rejects.toThrow(/upcoming event/i);
  });

  // NOTE on concurrency: Convex mutations are serialized per-document at the
  // platform level, so the "second mutation reads the first's inserted row"
  // semantic is what the sequential cap test above exercises. We intentionally
  // don't run two `Promise.all` mutations against convex-test here because the
  // in-process test harness leaves dangling global transaction state when one
  // of the parallel handlers throws, poisoning subsequent tests with
  // "test began while previous transaction was still open". The cap
  // guarantee comes from the runtime invariant, not from a racy test.

  test("non-leader can file event for someone else without hitting cap", async () => {
    // Cap counts events the user is *hosting* (in hostUserIds), not events
    // they merely created. A member who already hosts one future event can
    // still file a separate event for someone else as long as they don't
    // include themselves in the new event's hostUserIds.
    const t = convexTest(schema, modules);
    const s = await seed(t);

    // Member hosts their own future event (default hostUserIds = [creator]).
    await t.mutation(api.functions.meetings.index.create, {
      token: s.memberToken,
      groupId: s.groupId,
      scheduledAt: FUTURE(),
      meetingType: 1,
      locationMode: "tbd",
    });

    // Member files a second event with someone else as host — should succeed.
    await t.mutation(api.functions.meetings.index.create, {
      token: s.memberToken,
      groupId: s.groupId,
      scheduledAt: FUTURE() + 1000,
      meetingType: 1,
      locationMode: "tbd",
      hostUserIds: [s.otherMemberId],
    });
  });

  test("non-leader is capped when adding self as co-host on second event", async () => {
    // The cap counts hostUserIds — if the new event includes the creator as
    // a host alongside someone else, it still counts.
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await t.mutation(api.functions.meetings.index.create, {
      token: s.memberToken,
      groupId: s.groupId,
      scheduledAt: FUTURE(),
      meetingType: 1,
      locationMode: "tbd",
    });

    await expect(
      t.mutation(api.functions.meetings.index.create, {
        token: s.memberToken,
        groupId: s.groupId,
        scheduledAt: FUTURE() + 1000,
        meetingType: 1,
        locationMode: "tbd",
        hostUserIds: [s.memberId, s.otherMemberId],
      })
    ).rejects.toThrow(/upcoming event/i);
  });

  test("leaders are unthrottled by the cap", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    // Two back-to-back creations by the leader should both succeed.
    await t.mutation(api.functions.meetings.index.create, {
      token: s.leaderToken,
      groupId: s.groupId,
      scheduledAt: FUTURE(),
      meetingType: 1,
      locationMode: "tbd",
    });
    await t.mutation(api.functions.meetings.index.create, {
      token: s.leaderToken,
      groupId: s.groupId,
      scheduledAt: FUTURE() + 1000,
      meetingType: 1,
      locationMode: "tbd",
    });
  });
});

// ============================================================================
// CWE children + cover inheritance
// ============================================================================

describe("meetings — CWE children + cover", () => {
  test("CWE child inherits parent coverImage on getByShortId when its own is empty", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const groupTypeId = await t.run(async (ctx) =>
      ctx.db.insert("groupTypes", {
        communityId: s.communityId,
        name: "Dinner Parties",
        slug: "dinner-parties",
        isActive: true,
        displayOrder: 1,
        createdAt: Date.now(),
      })
    );
    const cweId = await t.run(async (ctx) =>
      ctx.db.insert("communityWideEvents", {
        communityId: s.communityId,
        groupTypeId,
        title: "Dinner Party",
        scheduledAt: FUTURE(),
        status: "scheduled",
        meetingType: 1,
        createdById: s.adminId,
        createdAt: Date.now(),
        coverImage: "https://images.togather.nyc/parent-cover.png",
      })
    );
    await t.run(async (ctx) =>
      ctx.db.insert("meetings", {
        groupId: s.groupId,
        createdById: s.adminId,
        scheduledAt: FUTURE(),
        status: "scheduled",
        meetingType: 1,
        communityId: s.communityId,
        communityWideEventId: cweId,
        createdAt: Date.now(),
        shortId: "cweshort1",
        // No coverImage — should inherit parent's.
      })
    );

    const result = await t.query(api.functions.meetings.index.getByShortId, {
      shortId: "cweshort1",
      token: s.adminToken,
    });
    expect(result?.coverImage).toContain("parent-cover.png");
  });

  test("update on a CWE child with empty location succeeds — location is inherited", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    // Build a community-wide parent + a child meeting linked to it.
    const groupTypeId = await t.run(async (ctx) =>
      ctx.db.insert("groupTypes", {
        communityId: s.communityId,
        name: "Dinner Parties",
        slug: "dinner-parties",
        isActive: true,
        displayOrder: 1,
        createdAt: Date.now(),
      })
    );
    const cweId = await t.run(async (ctx) =>
      ctx.db.insert("communityWideEvents", {
        communityId: s.communityId,
        groupTypeId,
        title: "Dinner Party",
        scheduledAt: FUTURE(),
        status: "scheduled",
        meetingType: 1,
        createdById: s.adminId,
        createdAt: Date.now(),
      })
    );
    const meetingId = await t.run(async (ctx) =>
      ctx.db.insert("meetings", {
        groupId: s.groupId,
        createdById: s.adminId,
        scheduledAt: FUTURE(),
        status: "scheduled",
        meetingType: 1,
        communityId: s.communityId,
        communityWideEventId: cweId,
        createdAt: Date.now(),
        // No locationOverride — CWE children inherit from their group.
      })
    );

    // The CreateEventScreen always sends `locationMode: "address"` + empty
    // `locationOverride` when the form hasn't explicitly chosen online/tbd.
    // Backend no longer enforces location invariants, so this just saves.
    await t.mutation(api.functions.meetings.index.update, {
      token: s.adminToken,
      meetingId,
      title: "Updated title",
      locationMode: "address",
      // No locationOverride provided.
    });

    const after = await t.run(async (ctx) => ctx.db.get(meetingId));
    expect(after?.title).toBe("Updated title");
  });

  test("CWE update writes coverImage to parent only, leaving leader overrides intact", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const groupTypeId = await t.run(async (ctx) =>
      ctx.db.insert("groupTypes", {
        communityId: s.communityId,
        name: "Dinner Parties",
        slug: "dinner-parties",
        isActive: true,
        displayOrder: 1,
        createdAt: Date.now(),
      })
    );
    const cweId = await t.run(async (ctx) =>
      ctx.db.insert("communityWideEvents", {
        communityId: s.communityId,
        groupTypeId,
        title: "Dinner Party",
        scheduledAt: FUTURE(),
        status: "scheduled",
        meetingType: 1,
        createdById: s.adminId,
        createdAt: Date.now(),
        coverImage: "https://images.togather.nyc/old-cover.png",
      })
    );
    // Inherited child: no cover of its own, relies on parent fallback at read time.
    const inheritedChildId = await t.run(async (ctx) =>
      ctx.db.insert("meetings", {
        groupId: s.groupId,
        createdById: s.adminId,
        scheduledAt: FUTURE(),
        status: "scheduled",
        meetingType: 1,
        communityId: s.communityId,
        communityWideEventId: cweId,
        createdAt: Date.now(),
        shortId: "cweshort2",
        isOverridden: false,
      })
    );
    // Leader-overridden child: has its own cover that must not be touched by
    // admin CWE edits.
    const overriddenChildId = await t.run(async (ctx) =>
      ctx.db.insert("meetings", {
        groupId: s.groupId,
        createdById: s.adminId,
        scheduledAt: FUTURE(),
        status: "scheduled",
        meetingType: 1,
        communityId: s.communityId,
        communityWideEventId: cweId,
        createdAt: Date.now(),
        shortId: "cweshort3",
        coverImage: "https://images.togather.nyc/leader-override.png",
        isOverridden: true,
      })
    );

    await t.mutation(api.functions.communityWideEvents.update, {
      token: s.adminToken,
      communityWideEventId: cweId,
      coverImage: "https://images.togather.nyc/new-cover.png",
    });

    const parent = await t.run(async (ctx) => ctx.db.get(cweId));
    const inherited = await t.run(async (ctx) => ctx.db.get(inheritedChildId));
    const overridden = await t.run(async (ctx) => ctx.db.get(overriddenChildId));
    expect(parent?.coverImage).toContain("new-cover.png");
    // Parent-only: inherited child's cover stays empty; read path will fall
    // back to the new parent cover.
    expect(inherited?.coverImage).toBeUndefined();
    // Leader-set override is untouched.
    expect(overridden?.coverImage).toContain("leader-override.png");
  });

  test("createCommunityWideEvent does not stamp coverImage on children", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const groupTypeId = await t.run(async (ctx) =>
      ctx.db.insert("groupTypes", {
        communityId: s.communityId,
        name: "Dinner Parties",
        slug: "dinner-parties",
        isActive: true,
        displayOrder: 1,
        createdAt: Date.now(),
      })
    );
    // Attach the existing seed group to this group type so the CWE find a
    // child to create against.
    await t.run(async (ctx) => ctx.db.patch(s.groupId, { groupTypeId }));

    const result = await t.mutation(
      api.functions.meetings.communityEvents.createCommunityWideEvent,
      {
        token: s.adminToken,
        communityId: s.communityId,
        groupTypeId,
        title: "Dinner",
        scheduledAt: FUTURE(),
        meetingType: 1,
        coverImage: "https://images.togather.nyc/shared.png",
      }
    );

    const parent = await t.run(async (ctx) =>
      ctx.db.get(result.communityWideEventId as Id<"communityWideEvents">)
    );
    const children = await t.run(async (ctx) =>
      ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", result.communityWideEventId as Id<"communityWideEvents">)
        )
        .collect()
    );
    expect(parent?.coverImage).toContain("shared.png");
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(child.coverImage).toBeUndefined();
    }

    // List/search queries used to read `meeting.coverImage` directly. Now
    // that children don't store a cover, those surfaces have to resolve
    // the parent fallback or the artwork disappears from the Events tab,
    // My RSVPs, and search.
    const communityEventsResult = await t.query(
      api.functions.meetings.index.communityEvents,
      { token: s.adminToken, communityId: s.communityId }
    );
    const cweInList = communityEventsResult.events.find(
      (e: any) => e.communityWideEventId === result.communityWideEventId
    );
    expect(cweInList?.coverImage).toContain("shared.png");
  });

  test("coverImage: \"\" clears the cover (both meetings.update and communityWideEvents.update)", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    // Standalone meeting — leader clears their own cover.
    const meetingId = await t.mutation(api.functions.meetings.index.create, {
      token: s.memberToken,
      groupId: s.groupId,
      scheduledAt: FUTURE(),
      meetingType: 1,
      locationMode: "address",
      locationOverride: "123 Main St, Dallas, TX 75201",
      coverImage: "https://images.togather.nyc/original.png",
    });
    const beforeClear = await t.run(async (ctx) => ctx.db.get(meetingId));
    expect(beforeClear?.coverImage).toContain("original.png");

    await t.mutation(api.functions.meetings.index.update, {
      token: s.memberToken,
      meetingId,
      coverImage: "",
    });
    const afterClear = await t.run(async (ctx) => ctx.db.get(meetingId));
    // "" is translated to undefined in the patch so the field is fully
    // unset — read paths see no cover without having to special-case "".
    expect(afterClear?.coverImage).toBeUndefined();

    // CWE parent — admin clears the shared cover.
    const groupTypeId = await t.run(async (ctx) =>
      ctx.db.insert("groupTypes", {
        communityId: s.communityId,
        name: "Dinner Parties 2",
        slug: "dinner-parties-2",
        isActive: true,
        displayOrder: 1,
        createdAt: Date.now(),
      })
    );
    const cweId = await t.run(async (ctx) =>
      ctx.db.insert("communityWideEvents", {
        communityId: s.communityId,
        groupTypeId,
        title: "Dinner Party",
        scheduledAt: FUTURE(),
        status: "scheduled",
        meetingType: 1,
        createdById: s.adminId,
        createdAt: Date.now(),
        coverImage: "https://images.togather.nyc/shared.png",
      })
    );
    await t.mutation(api.functions.communityWideEvents.update, {
      token: s.adminToken,
      communityWideEventId: cweId,
      coverImage: "",
    });
    const parent = await t.run(async (ctx) => ctx.db.get(cweId));
    expect(parent?.coverImage).toBeUndefined();
  });

  test("tbd accepts empty location + link", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const id = await t.mutation(api.functions.meetings.index.create, {
      token: s.memberToken,
      groupId: s.groupId,
      scheduledAt: FUTURE(),
      meetingType: 1,
      locationMode: "tbd",
    });
    expect(id).toBeDefined();
  });

  test("getByShortId surfaces the host list; legacy rows with no hosts show none", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    // Member-led: the create mutation defaults hostUserIds to [creator], so
    // the share page attributes the event to the filer.
    const memberMeetingId = await t.mutation(api.functions.meetings.index.create, {
      token: s.memberToken,
      groupId: s.groupId,
      scheduledAt: FUTURE(),
      meetingType: 1,
      locationMode: "tbd",
    });
    const memberShortId = await t.run(
      async (ctx) => (await ctx.db.get(memberMeetingId))?.shortId
    );
    const memberResult = await t.query(api.functions.meetings.index.getByShortId, {
      shortId: memberShortId!,
      token: s.memberToken,
    });
    expect(memberResult?.hosts).toHaveLength(1);
    expect(memberResult?.hosts?.[0]?.id).toBe(s.memberId);

    // Leader-led: same default — leader filed the event, so they're the host.
    const leaderMeetingId = await t.mutation(api.functions.meetings.index.create, {
      token: s.leaderToken,
      groupId: s.groupId,
      scheduledAt: FUTURE() + 1000,
      meetingType: 1,
      locationMode: "tbd",
    });
    const leaderShortId = await t.run(
      async (ctx) => (await ctx.db.get(leaderMeetingId))?.shortId
    );
    const leaderResult = await t.query(api.functions.meetings.index.getByShortId, {
      shortId: leaderShortId!,
      token: s.leaderToken,
    });
    expect(leaderResult?.hosts).toHaveLength(1);
    expect(leaderResult?.hosts?.[0]?.id).toBe(s.leaderId);

    // Legacy / delegated: meeting written without hostUserIds — `hosts` is
    // empty so the client falls back to group attribution. Creator is NOT
    // a fallback anymore.
    await t.run(async (ctx) =>
      ctx.db.insert("meetings", {
        groupId: s.groupId,
        createdById: s.adminId,
        scheduledAt: FUTURE() + 2000,
        status: "scheduled",
        meetingType: 1,
        communityId: s.communityId,
        createdAt: Date.now(),
        shortId: "legacyhostcheck",
      })
    );
    const legacyResult = await t.query(api.functions.meetings.index.getByShortId, {
      shortId: "legacyhostcheck",
      token: s.adminToken,
    });
    expect(legacyResult?.hosts).toEqual([]);
  });
});

// ============================================================================
// Update / cancel permissions
// ============================================================================

describe("meetings.update/cancel — perms", () => {
  test("creator can update their own event; another member cannot", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const meetingId = await t.mutation(api.functions.meetings.index.create, {
      token: s.memberToken,
      groupId: s.groupId,
      scheduledAt: FUTURE(),
      meetingType: 1,
      locationMode: "tbd",
    });

    await t.mutation(api.functions.meetings.index.update, {
      token: s.memberToken,
      meetingId,
      title: "updated by creator",
    });

    await expect(
      t.mutation(api.functions.meetings.index.update, {
        token: s.otherMemberToken,
        meetingId,
        title: "unauthorised",
      })
    ).rejects.toThrow(/permission/i);
  });

  test("creator cannot cascade series-wide update to siblings they don't lead", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const seriesId = await t.run(async (ctx) =>
      ctx.db.insert("eventSeries", {
        groupId: s.groupId,
        createdById: s.leaderId,
        name: "Weekly",
        status: "active",
        createdAt: Date.now(),
      })
    );

    const meetingId = await t.run(async (ctx) =>
      ctx.db.insert("meetings", {
        groupId: s.groupId,
        createdById: s.memberId,
        hostUserIds: [s.memberId],
        scheduledAt: FUTURE(),
        status: "scheduled",
        meetingType: 1,
        communityId: s.communityId,
        seriesId,
        createdAt: Date.now(),
      })
    );

    // Single-meeting edit by host: allowed.
    await t.mutation(api.functions.meetings.index.update, {
      token: s.memberToken,
      meetingId,
      title: "local-only edit",
    });

    // Series-wide edit by host: blocked — they aren't a leader.
    await expect(
      t.mutation(api.functions.meetings.index.update, {
        token: s.memberToken,
        meetingId,
        title: "series-wide hijack",
        scope: "all_in_series",
      })
    ).rejects.toThrow(/series/i);
  });

  test("leader can apply series-wide cancel; bare host cannot", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const seriesId = await t.run(async (ctx) =>
      ctx.db.insert("eventSeries", {
        groupId: s.groupId,
        createdById: s.leaderId,
        name: "Weekly",
        status: "active",
        createdAt: Date.now(),
      })
    );

    const meetingId = await t.run(async (ctx) =>
      ctx.db.insert("meetings", {
        groupId: s.groupId,
        createdById: s.memberId,
        hostUserIds: [s.memberId],
        scheduledAt: FUTURE(),
        status: "scheduled",
        meetingType: 1,
        communityId: s.communityId,
        seriesId,
        createdAt: Date.now(),
      })
    );

    await expect(
      t.mutation(api.functions.meetings.index.cancel, {
        token: s.memberToken,
        meetingId,
        scope: "all_in_series",
      })
    ).rejects.toThrow(/series/i);

    // Leader can.
    await t.mutation(api.functions.meetings.index.cancel, {
      token: s.leaderToken,
      meetingId,
      scope: "all_in_series",
    });
  });

  test("group leader and community admin can both cancel a member's event", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const meetingId1 = await t.mutation(api.functions.meetings.index.create, {
      token: s.memberToken,
      groupId: s.groupId,
      scheduledAt: FUTURE(),
      meetingType: 1,
      locationMode: "tbd",
    });
    await t.mutation(api.functions.meetings.index.cancel, {
      token: s.leaderToken,
      meetingId: meetingId1,
    });

    // Re-enable the cap by leaving no live upcoming for member — cancelled
    // doesn't count. Then create another and let admin cancel it.
    const meetingId2 = await t.mutation(api.functions.meetings.index.create, {
      token: s.memberToken,
      groupId: s.groupId,
      scheduledAt: FUTURE() + 1000,
      meetingType: 1,
      locationMode: "tbd",
    });
    await t.mutation(api.functions.meetings.index.cancel, {
      token: s.adminToken,
      meetingId: meetingId2,
    });
  });
});

// ============================================================================
// Reports round-trip
// ============================================================================

describe("meetingReports", () => {
  test("createReport → leader listReportsForGroup → resolveReport", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const meetingId = await t.mutation(api.functions.meetings.index.create, {
      token: s.memberToken,
      groupId: s.groupId,
      scheduledAt: FUTURE(),
      meetingType: 1,
      locationMode: "tbd",
    });

    const reportId = await t.mutation(
      api.functions.meetings.reports.createReport,
      {
        token: s.otherMemberToken,
        meetingId,
        reason: "spam",
        details: "looks dodgy",
      }
    );
    expect(reportId).toBeDefined();

    const list = await t.query(
      api.functions.meetings.reports.listReportsForGroup,
      { token: s.leaderToken, groupId: s.groupId }
    );
    expect(list.length).toBe(1);
    expect(list[0].reason).toBe("spam");

    await t.mutation(api.functions.meetings.reports.resolveReport, {
      token: s.leaderToken,
      reportId,
      action: "dismissed",
    });

    const after = await t.run(async (ctx) => ctx.db.get(reportId));
    expect(after?.status).toBe("dismissed");
    expect(after?.reviewedById).toBe(s.leaderId);
  });

  test("re-reporting a dismissed event reopens it as pending", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const meetingId = await t.mutation(api.functions.meetings.index.create, {
      token: s.memberToken,
      groupId: s.groupId,
      scheduledAt: FUTURE(),
      meetingType: 1,
      locationMode: "tbd",
    });

    const reportId = await t.mutation(
      api.functions.meetings.reports.createReport,
      { token: s.otherMemberToken, meetingId, reason: "spam" }
    );

    await t.mutation(api.functions.meetings.reports.resolveReport, {
      token: s.leaderToken,
      reportId,
      action: "dismissed",
    });

    // Same reporter files a new report with a different reason.
    const reReportId = await t.mutation(
      api.functions.meetings.reports.createReport,
      {
        token: s.otherMemberToken,
        meetingId,
        reason: "inappropriate",
        details: "still bad",
      }
    );
    expect(reReportId).toBe(reportId); // upsert, same row

    const after = await t.run(async (ctx) => ctx.db.get(reportId));
    expect(after?.status).toBe("pending");
    expect(after?.reviewedById).toBeUndefined();
    expect(after?.reviewedAt).toBeUndefined();

    // The leader's pending queue sees it again.
    const list = await t.query(
      api.functions.meetings.reports.listReportsForGroup,
      { token: s.leaderToken, groupId: s.groupId }
    );
    expect(list.length).toBe(1);
    expect(list[0]._id).toBe(reportId);
  });

  test("host cannot report their own event", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    // `create` defaults hostUserIds to [creator], so the filer is seated
    // as host and therefore can't self-report.
    const meetingId = await t.mutation(api.functions.meetings.index.create, {
      token: s.memberToken,
      groupId: s.groupId,
      scheduledAt: FUTURE(),
      meetingType: 1,
      locationMode: "tbd",
    });

    await expect(
      t.mutation(api.functions.meetings.reports.createReport, {
        token: s.memberToken, // the host
        meetingId,
        reason: "spam",
      })
    ).rejects.toThrow(/you host or filed/i);
  });

  test("filer cannot report a delegated event they filed (hostUserIds empty)", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    // Insert directly so hostUserIds stays empty (delegated/legacy state).
    // `createdById === memberId` should still block self-reporting even
    // though the meeting has no explicit hosts.
    const meetingId = await t.run(async (ctx) =>
      ctx.db.insert("meetings", {
        groupId: s.groupId,
        createdById: s.memberId,
        hostUserIds: [],
        scheduledAt: FUTURE(),
        status: "scheduled",
        meetingType: 1,
        communityId: s.communityId,
        createdAt: Date.now(),
        shortId: "delegatedreport",
      })
    );

    await expect(
      t.mutation(api.functions.meetings.reports.createReport, {
        token: s.memberToken,
        meetingId,
        reason: "spam",
      })
    ).rejects.toThrow(/you host or filed/i);
  });

  test("rejects invalid reason", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const meetingId = await t.mutation(api.functions.meetings.index.create, {
      token: s.memberToken,
      groupId: s.groupId,
      scheduledAt: FUTURE(),
      meetingType: 1,
      locationMode: "tbd",
    });

    await expect(
      t.mutation(api.functions.meetings.reports.createReport, {
        token: s.otherMemberToken,
        meetingId,
        reason: "not-a-valid-reason",
      })
    ).rejects.toThrow(/reason/i);
  });
});

// ============================================================================
// Leave-community ownership transfer
// ============================================================================

describe("leave community — future-meeting ownership", () => {
  test("creator leaving community transfers future meetings to primary admin", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const meetingId = await t.mutation(api.functions.meetings.index.create, {
      token: s.memberToken,
      groupId: s.groupId,
      scheduledAt: FUTURE(),
      meetingType: 1,
      locationMode: "tbd",
    });

    await t.mutation(api.functions.communities.leave, {
      token: s.memberToken,
      communityId: s.communityId,
    });

    const after = await t.run(async (ctx) => ctx.db.get(meetingId));
    expect(after?.createdById).toBe(s.adminId); // primary admin
  });
});
