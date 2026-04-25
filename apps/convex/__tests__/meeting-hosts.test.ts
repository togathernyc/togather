/**
 * Host-decoupling tests.
 *
 * Covers the behaviors introduced when `meeting.hostUserIds` was decoupled
 * from `meeting.createdById`:
 *   - getHostUserIds / isMeetingHost helpers (no creator fallback)
 *   - canEditMeeting authorizes hosts + leaders + admins, not the creator
 *   - Event chat seating seeds hosts (or group leaders when delegated)
 *   - reconcileEventChannelAdmins updates seating when hosts change
 *   - RSVP notifications go to hosts when set, leaders when delegated
 *   - create/update validate hosts are active group members
 *
 * Run with: cd apps/convex && pnpm test __tests__/meeting-hosts.test.ts
 */

import { vi, expect, test, describe, beforeEach, afterEach } from "vitest";

vi.mock("jose", () => ({
  jwtVerify: vi.fn(async (token: string) => {
    const match = token.match(/^test-token-(.+)$/);
    if (!match) throw new Error("Invalid token");
    return { payload: { userId: match[1], type: "access" } };
  }),
  SignJWT: vi.fn(() => ({
    setProtectedHeader: vi.fn().mockReturnThis(),
    setIssuedAt: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    sign: vi.fn().mockResolvedValue("mock-signed-token"),
  })),
  decodeJwt: vi.fn((token: string) => {
    const match = token.match(/^test-token-(.+)$/);
    if (!match) return null;
    return { userId: match[1], type: "access" };
  }),
}));

import { convexTest } from "convex-test";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { modules } from "../test.setup";
import { api, internal } from "../_generated/api";
import {
  getHostUserIds,
  isMeetingHost,
} from "../lib/meetingPermissions";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// Fixtures
// ============================================================================

interface Fixture {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  leaderId: Id<"users">;
  otherLeaderId: Id<"users">;
  memberId: Id<"users">;
  outsiderId: Id<"users">;
  adminId: Id<"users">;
  leaderToken: string;
  memberToken: string;
  outsiderToken: string;
  adminToken: string;
}

async function seed(t: ReturnType<typeof convexTest>): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const ts = Date.now();

    const communityId = await ctx.db.insert("communities", {
      name: "Hosts Community",
      slug: "hosts",
      isPublic: true,
      createdAt: ts,
      updatedAt: ts,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "General",
      slug: "general",
      isActive: true,
      displayOrder: 0,
      createdAt: ts,
    });

    const groupId = await ctx.db.insert("groups", {
      communityId,
      name: "Test Group",
      groupTypeId,
      isArchived: false,
      createdAt: ts,
      updatedAt: ts,
    });

    const mk = async (firstName: string, phone: string) =>
      ctx.db.insert("users", {
        firstName,
        lastName: "T",
        phone,
        createdAt: ts,
        updatedAt: ts,
      });

    const leaderId = await mk("Leader", "+15552220001");
    const otherLeaderId = await mk("OtherLeader", "+15552220002");
    const memberId = await mk("Member", "+15552220003");
    const outsiderId = await mk("Outsider", "+15552220004");
    const adminId = await mk("Admin", "+15552220005");

    // Community memberships. `roles: 3` flips the admin bit on userCommunities
    // (consistent with seed usage in other tests for `isCommunityAdmin`).
    const inCommunity = async (uid: Id<"users">, roles = 1) => {
      await ctx.db.insert("userCommunities", {
        userId: uid,
        communityId,
        roles,
        status: 1,
        createdAt: ts,
        updatedAt: ts,
      });
    };
    await inCommunity(leaderId);
    await inCommunity(otherLeaderId);
    await inCommunity(memberId);
    await inCommunity(adminId, 3);
    // outsider intentionally not in community

    // Group memberships
    const inGroup = async (uid: Id<"users">, role: string) => {
      await ctx.db.insert("groupMembers", {
        groupId,
        userId: uid,
        role,
        joinedAt: ts,
        notificationsEnabled: true,
      });
    };
    await inGroup(leaderId, "leader");
    await inGroup(otherLeaderId, "leader");
    await inGroup(memberId, "member");

    // Seed push tokens for every seeded user. The notify action short-circuits
    // before writing `notifications` rows when no device tokens exist, so
    // asserting recipient routing by reading `notifications` requires this.
    // `environment: "staging"` matches `getCurrentEnvironment()` when
    // APP_ENV is unset (the default in tests).
    for (const uid of [leaderId, otherLeaderId, memberId, adminId]) {
      await ctx.db.insert("pushTokens", {
        userId: uid,
        token: `expo-${uid}`,
        platform: "ios",
        environment: "staging",
        isActive: true,
        createdAt: ts,
        updatedAt: ts,
        lastUsedAt: ts,
      });
    }

    return {
      communityId,
      groupId,
      leaderId,
      otherLeaderId,
      memberId,
      outsiderId,
      adminId,
      leaderToken: `test-token-${leaderId}`,
      memberToken: `test-token-${memberId}`,
      outsiderToken: `test-token-${outsiderId}`,
      adminToken: `test-token-${adminId}`,
    };
  });
}

const FUTURE = () => Date.now() + 7 * 86_400_000;

async function insertMeeting(
  t: ReturnType<typeof convexTest>,
  args: {
    groupId: Id<"groups">;
    communityId: Id<"communities">;
    createdById: Id<"users">;
    hostUserIds?: Id<"users">[];
    shortId?: string;
  },
): Promise<Id<"meetings">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("meetings", {
      groupId: args.groupId,
      communityId: args.communityId,
      createdById: args.createdById,
      hostUserIds: args.hostUserIds,
      scheduledAt: FUTURE(),
      status: "scheduled",
      meetingType: 1,
      createdAt: Date.now(),
      rsvpEnabled: true,
      rsvpOptions: [
        { id: 1, label: "Going", enabled: true },
        { id: 2, label: "Not Going", enabled: true },
      ],
      shortId: args.shortId ?? `hosts-${Math.random().toString(36).slice(2, 8)}`,
    }),
  );
}

// ============================================================================
// Helpers: getHostUserIds / isMeetingHost
// ============================================================================

describe("getHostUserIds / isMeetingHost", () => {
  test("returns hostUserIds when set", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const meetingId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.memberId,
      hostUserIds: [s.memberId],
    });

    await t.run(async (ctx) => {
      const meeting = await ctx.db.get(meetingId);
      expect(getHostUserIds(meeting!)).toEqual([s.memberId]);
      expect(isMeetingHost(meeting!, s.memberId)).toBe(true);
      expect(isMeetingHost(meeting!, s.leaderId)).toBe(false);
    });
  });

  test("returns [] when hostUserIds is undefined (no creator fallback)", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const meetingId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.memberId,
      // hostUserIds intentionally omitted → undefined
    });

    await t.run(async (ctx) => {
      const meeting = await ctx.db.get(meetingId);
      expect(getHostUserIds(meeting!)).toEqual([]);
      // Creator is not a fallback host under the new model.
      expect(isMeetingHost(meeting!, s.memberId)).toBe(false);
    });
  });

  test("returns [] when hostUserIds is an empty array (delegated)", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const meetingId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.memberId,
      hostUserIds: [],
    });

    await t.run(async (ctx) => {
      const meeting = await ctx.db.get(meetingId);
      expect(getHostUserIds(meeting!)).toEqual([]);
      expect(isMeetingHost(meeting!, s.memberId)).toBe(false);
    });
  });
});

// ============================================================================
// canEditMeeting — via the update mutation, which wraps it
// ============================================================================

describe("canEditMeeting (via update mutation)", () => {
  test("a listed host can edit", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const meetingId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.memberId,
      hostUserIds: [s.memberId],
    });

    await t.mutation(api.functions.meetings.index.update, {
      token: s.memberToken,
      meetingId,
      title: "host-edit",
    });
  });

  test("the creator cannot edit when they're not a host", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const meetingId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.memberId,
      hostUserIds: [s.leaderId], // someone else is host
    });

    await expect(
      t.mutation(api.functions.meetings.index.update, {
        token: s.memberToken,
        meetingId,
        title: "nope",
      }),
    ).rejects.toThrow(/permission/i);
  });

  test("a group leader can always edit, even with hosts set", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const meetingId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.memberId,
      hostUserIds: [s.memberId],
    });

    // leaderId is a group leader but not a host → still allowed
    await t.mutation(api.functions.meetings.index.update, {
      token: s.leaderToken,
      meetingId,
      title: "leader-edit",
    });
  });

  test("a group leader can edit a delegated meeting", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const meetingId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.memberId,
      hostUserIds: [],
    });

    await t.mutation(api.functions.meetings.index.update, {
      token: s.leaderToken,
      meetingId,
      title: "delegated-leader-edit",
    });
  });

  test("a community admin can edit even without host or leader role", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const meetingId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.memberId,
      hostUserIds: [s.memberId],
    });

    await t.mutation(api.functions.meetings.index.update, {
      token: s.adminToken,
      meetingId,
      title: "admin-edit",
    });
  });

  test("all_in_series scope cascades host changes to siblings", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const seriesId = await t.run(async (ctx) =>
      ctx.db.insert("eventSeries", {
        groupId: s.groupId,
        createdById: s.leaderId,
        name: "Weekly",
        status: "active",
        createdAt: Date.now(),
      }),
    );

    const anchorId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.leaderId,
      hostUserIds: [s.leaderId],
      shortId: "series-anchor",
    });
    const siblingId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.leaderId,
      hostUserIds: [s.leaderId],
      shortId: "series-sibling",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(anchorId, { seriesId });
      await ctx.db.patch(siblingId, { seriesId });
    });

    // Transfer hosts to a different user via the all_in_series scope.
    await t.mutation(api.functions.meetings.index.update, {
      token: s.leaderToken,
      meetingId: anchorId,
      hostUserIds: [s.memberId],
      scope: "all_in_series",
    });

    await t.run(async (ctx) => {
      const anchor = await ctx.db.get(anchorId);
      const sibling = await ctx.db.get(siblingId);
      expect(anchor?.hostUserIds).toEqual([s.memberId]);
      // Without the cascade fix the sibling would still hold [s.leaderId].
      expect(sibling?.hostUserIds).toEqual([s.memberId]);
    });
  });

  test("all_in_series reconciles siblings that diverged even when the anchor didn't change", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const seriesId = await t.run(async (ctx) =>
      ctx.db.insert("eventSeries", {
        groupId: s.groupId,
        createdById: s.leaderId,
        name: "Weekly",
        status: "active",
        createdAt: Date.now(),
      }),
    );

    // Anchor already has [memberId] as host — this matches the payload we
    // send below so the anchor's own hostsChanged reads false. A prior
    // per-meeting edit diverged the sibling to [otherLeaderId]. Without
    // per-sibling change detection, reconciliation would be skipped and
    // the sibling's chat admins would stay stale.
    const anchorId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.leaderId,
      hostUserIds: [s.memberId],
      shortId: "series-anchor-2",
    });
    const siblingId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.leaderId,
      hostUserIds: [s.otherLeaderId],
      shortId: "series-sibling-2",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(anchorId, { seriesId });
      await ctx.db.patch(siblingId, { seriesId });
    });

    // Materialize the sibling's chat channel so we can verify admin
    // seating actually changes after reconcile. Without this step the
    // test would assert only the host-id patch — the reconcile call is
    // the thing that was being skipped pre-fix, so we have to observe
    // its effect on chatChannelMembers, not just on the meeting doc.
    const siblingChannelId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: siblingId },
    );

    // Pre-condition: sibling chat is seated with [otherLeaderId] as admin.
    const preAdmins = await t.run(async (ctx) =>
      ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", siblingChannelId))
        .collect(),
    );
    expect(preAdmins.map((m) => String(m.userId))).toEqual([String(s.otherLeaderId)]);

    // Send `hostUserIds: [memberId]` for the whole series. Anchor is
    // unchanged; sibling should still get patched AND reconciled.
    await t.mutation(api.functions.meetings.index.update, {
      token: s.leaderToken,
      meetingId: anchorId,
      hostUserIds: [s.memberId],
      scope: "all_in_series",
    });
    // Drain the reconcileEventChannelAdmins runAfter(0) — that scheduled
    // mutation is exactly what the round-3 fix re-enables for diverged
    // siblings, and is what this test is meant to prove.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.run(async (ctx) => {
      const sibling = await ctx.db.get(siblingId);
      expect(sibling?.hostUserIds).toEqual([s.memberId]);

      const postRows = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", siblingChannelId))
        .collect();
      const admins = postRows
        .filter((m) => m.role === "admin")
        .map((m) => String(m.userId));
      // Pre-fix: admins still [otherLeaderId] because reconcile was
      // skipped. Post-fix: admins should be [memberId].
      expect(admins).toEqual([String(s.memberId)]);
      // The departing host had no RSVP, so they're fully removed.
      expect(postRows.map((m) => String(m.userId))).not.toContain(
        String(s.otherLeaderId),
      );
    });
  });
});

// ============================================================================
// Event chat seating — delegated-mode (no hosts) seats leaders
// ============================================================================

describe("event chat seating", () => {
  test("delegated meeting seats all active group leaders as admin", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const meetingId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.memberId,
      hostUserIds: [], // delegated → leaders own it
      shortId: "delegated-chat",
    });

    const channelId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId },
    );

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
    );

    const seatedIds = rows.map((r) => String(r.userId)).sort();
    expect(seatedIds).toEqual([String(s.leaderId), String(s.otherLeaderId)].sort());
    for (const row of rows) {
      expect(row.role).toBe("admin");
    }
  });

  test("explicit-host meeting seats only hosts as admin, not leaders", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const meetingId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.memberId,
      hostUserIds: [s.memberId],
      shortId: "host-chat",
    });

    const channelId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId },
    );

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
    );
    expect(rows.map((r) => String(r.userId))).toEqual([String(s.memberId)]);
  });

  test("reconcileEventChannelAdmins adds new hosts and removes old ones", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const meetingId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.memberId,
      hostUserIds: [s.memberId],
      shortId: "reconcile",
    });

    // Materialize the channel with the original host seated.
    const channelId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId },
    );

    // Transfer hosting: remove memberId, add leaderId.
    await t.run(async (ctx) => {
      await ctx.db.patch(meetingId, { hostUserIds: [s.leaderId] });
    });
    await t.mutation(
      (internal as any).functions.messaging.eventChat.reconcileEventChannelAdmins,
      { meetingId },
    );

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
    );
    const admins = rows.filter((r) => r.role === "admin").map((r) => String(r.userId));
    expect(admins).toEqual([String(s.leaderId)]);
    // The departing host has no RSVP, so they're fully removed rather than demoted.
    expect(rows.map((r) => String(r.userId))).not.toContain(String(s.memberId));
  });

  test("reconcile demotes a departing host to member when they have an active RSVP", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const meetingId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.memberId,
      hostUserIds: [s.memberId],
      shortId: "demote",
    });

    const channelId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId },
    );

    // Give the original host a valid RSVP so they're still a participant.
    await t.run(async (ctx) =>
      ctx.db.insert("meetingRsvps", {
        meetingId,
        userId: s.memberId,
        rsvpOptionId: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    await t.run(async (ctx) => {
      await ctx.db.patch(meetingId, { hostUserIds: [s.leaderId] });
    });
    await t.mutation(
      (internal as any).functions.messaging.eventChat.reconcileEventChannelAdmins,
      { meetingId },
    );

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
    );
    const prior = rows.find((r) => String(r.userId) === String(s.memberId));
    expect(prior).toBeDefined();
    expect(prior?.role).toBe("member");
  });
});

// ============================================================================
// create / update validation
// ============================================================================

describe("create / update validation", () => {
  test("create rejects a host who isn't a group member", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      t.mutation(api.functions.meetings.index.create, {
        token: s.leaderToken,
        groupId: s.groupId,
        scheduledAt: FUTURE(),
        meetingType: 1,
        locationMode: "tbd",
        hostUserIds: [s.outsiderId],
      }),
    ).rejects.toThrow(/active members/i);
  });

  test("create defaults hostUserIds to [creator] when omitted", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const meetingId = await t.mutation(api.functions.meetings.index.create, {
      token: s.memberToken,
      groupId: s.groupId,
      scheduledAt: FUTURE(),
      meetingType: 1,
      locationMode: "tbd",
    });

    await t.run(async (ctx) => {
      const meeting = await ctx.db.get(meetingId);
      expect(meeting?.hostUserIds).toEqual([s.memberId]);
    });
  });

  test("create deduplicates repeated hosts", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const meetingId = await t.mutation(api.functions.meetings.index.create, {
      token: s.leaderToken,
      groupId: s.groupId,
      scheduledAt: FUTURE(),
      meetingType: 1,
      locationMode: "tbd",
      hostUserIds: [s.memberId, s.memberId, s.leaderId],
    });

    await t.run(async (ctx) => {
      const meeting = await ctx.db.get(meetingId);
      expect(meeting?.hostUserIds).toEqual([s.memberId, s.leaderId]);
    });
  });

  test("update allows delegating back to leaders with empty array", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const meetingId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.memberId,
      hostUserIds: [s.memberId],
    });

    await t.mutation(api.functions.meetings.index.update, {
      token: s.memberToken,
      meetingId,
      hostUserIds: [],
    });

    await t.run(async (ctx) => {
      const meeting = await ctx.db.get(meetingId);
      expect(meeting?.hostUserIds).toEqual([]);
    });
  });
});

// ============================================================================
// RSVP notification recipients (asserted via the internal action's return)
// ============================================================================

describe("RSVP notification recipients", () => {
  test("with hosts set, only the host receives the notification record", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const meetingId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.memberId,
      hostUserIds: [s.memberId],
      shortId: "notif-hosted",
    });

    // Submit an RSVP from a different user so the RSVPer themselves isn't
    // the host (otherwise the "exclude the actor" rule zeroes recipients).
    await t.mutation(
      // @ts-expect-error — token-based test auth
      "functions/meetingRsvps:submit" as any,
      {
        token: s.leaderToken,
        meetingId,
        optionId: 1,
      },
    );

    // Wait for the scheduled notify action to flush, then read the per-user
    // notification rows. Only the host should have received one; the
    // (non-host) leaders should not.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const notified = await t.run(async (ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", s.memberId))
        .collect(),
    );
    expect(notified.length).toBeGreaterThanOrEqual(1);

    const leaderNotified = await t.run(async (ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", s.otherLeaderId))
        .collect(),
    );
    // otherLeaderId isn't a host and hosts are set → no notification.
    expect(leaderNotified).toEqual([]);
  });

  test("with hosts empty (delegated), group leaders are notified", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const meetingId = await insertMeeting(t, {
      groupId: s.groupId,
      communityId: s.communityId,
      createdById: s.memberId,
      hostUserIds: [],
      shortId: "notif-delegated",
    });

    // Member RSVPs → hosts empty → leaders are the recipients.
    await t.mutation(
      // @ts-expect-error — token-based test auth
      "functions/meetingRsvps:submit" as any,
      {
        token: s.memberToken,
        meetingId,
        optionId: 1,
      },
    );

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const leaderNotified = await t.run(async (ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", s.leaderId))
        .collect(),
    );
    expect(leaderNotified.length).toBeGreaterThanOrEqual(1);
  });
});
