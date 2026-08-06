/**
 * Private (unlisted) events.
 *
 * `visibility: "private"` is for a gathering the host wants to keep small: a
 * Prayer Team night that shouldn't go out to the whole community. It appears
 * in NO browse, search, or feed on group membership alone. You get in by
 * holding the link, or by being invited.
 *
 * The line these tests pin down: being a member of the hosting group is worth
 * nothing here. If group membership leaked a private event into someone's
 * list, the feature would be pointless.
 *
 * Note what private deliberately is NOT: sealed. Anyone the link reaches can
 * open and RSVP — distribution is the control, the same bargain as an unlisted
 * video. `canAccessMeeting` returning true for any authenticated caller is
 * therefore correct, not a gap: reaching it means you already hold the id.
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, afterEach } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { api } from "../_generated/api";
import { generateTokens } from "../lib/auth";
import type { Id } from "../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

vi.useFakeTimers();
afterEach(() => {
  vi.clearAllTimers();
});

let phoneSeq = 300;

interface Seed {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  hostId: Id<"users">;
  hostToken: string;
  invitedId: Id<"users">;
  invitedToken: string;
  /** In the hosting group, but not invited. Must see nothing. */
  groupOnlyId: Id<"users">;
  groupOnlyToken: string;
}

async function makeUser(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
  groupId: Id<"groups">,
  role: "leader" | "member",
  name: string
) {
  phoneSeq += 1;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      firstName: name,
      lastName: "Tester",
      phone: `+1555888${String(phoneSeq).padStart(4, "0")}`,
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("userCommunities", {
      userId: id,
      communityId,
      status: 1,
      roles: role === "leader" ? 3 : 1,
      createdAt: Date.now(),
    });
    await ctx.db.insert("groupMembers", {
      userId: id,
      groupId,
      role,
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
    return id;
  });
  const { accessToken } = await generateTokens(userId);
  return { userId, token: accessToken };
}

async function seed(t: ReturnType<typeof convexTest>): Promise<Seed> {
  const { communityId, groupTypeId } = await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Private Events Community",
      subdomain: "private-events",
      slug: "private-events",
      timezone: "America/New_York",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Groups",
      slug: "small-groups",
      isActive: true,
      displayOrder: 1,
      createdAt: Date.now(),
    });
    return { communityId, groupTypeId };
  });

  const groupId = await t.run(async (ctx) =>
    ctx.db.insert("groups", {
      name: "Host Group",
      communityId,
      groupTypeId,
      isPublic: true,
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  );

  const host = await makeUser(t, communityId, groupId, "leader", "Host");
  const invited = await makeUser(t, communityId, groupId, "member", "Invited");
  const groupOnly = await makeUser(t, communityId, groupId, "member", "GroupOnly");

  return {
    communityId,
    groupId,
    hostId: host.userId,
    hostToken: host.token,
    invitedId: invited.userId,
    invitedToken: invited.token,
    groupOnlyId: groupOnly.userId,
    groupOnlyToken: groupOnly.token,
  };
}

async function insertPrivateEvent(
  t: ReturnType<typeof convexTest>,
  data: Seed,
  opts: { shortId?: string } = {}
): Promise<Id<"meetings">> {
  return t.run(async (ctx) =>
    ctx.db.insert("meetings", {
      groupId: data.groupId,
      title: "Prayer Team Night",
      scheduledAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      meetingType: 1,
      status: "scheduled",
      visibility: "private",
      rsvpEnabled: true,
      rsvpOptions: [{ id: 1, label: "Going", enabled: true }],
      hostUserIds: [data.hostId],
      shortId: opts.shortId ?? "priv12345",
      createdById: data.hostId,
      createdAt: Date.now(),
    })
  );
}

async function invite(
  t: ReturnType<typeof convexTest>,
  data: Seed,
  meetingId: Id<"meetings">,
  recipientUserId: Id<"users">
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("eventInvites", {
      meetingId,
      groupId: data.groupId,
      communityId: data.communityId,
      sentById: data.hostId,
      recipientUserId,
      channels: ["push"],
      status: "sent",
      inviteRound: 1,
      lastSentAt: Date.now(),
      createdAt: Date.now(),
    });
  });
}

async function listedFor(
  t: ReturnType<typeof convexTest>,
  data: Seed,
  token: string
): Promise<string[]> {
  const result = await t.query(api.functions.meetings.index.communityEvents, {
    token,
    communityId: data.communityId,
  });
  return result.events.map((e: any) => e.id);
}

// ============================================================================

describe("private events stay out of listings", () => {
  test("a group member who wasn't invited does not see it", async () => {
    const t = convexTest(schema, modules);
    const data = await seed(t);
    const meetingId = await insertPrivateEvent(t, data);

    expect(await listedFor(t, data, data.groupOnlyToken)).not.toContain(
      meetingId
    );
  });

  test("an invited person sees it", async () => {
    const t = convexTest(schema, modules);
    const data = await seed(t);
    const meetingId = await insertPrivateEvent(t, data);
    await invite(t, data, meetingId, data.invitedId);

    expect(await listedFor(t, data, data.invitedToken)).toContain(meetingId);
  });

  test("the host sees their own private event", async () => {
    const t = convexTest(schema, modules);
    const data = await seed(t);
    const meetingId = await insertPrivateEvent(t, data);

    expect(await listedFor(t, data, data.hostToken)).toContain(meetingId);
  });

  test("a signed-out visitor sees nothing", async () => {
    const t = convexTest(schema, modules);
    const data = await seed(t);
    const meetingId = await insertPrivateEvent(t, data);

    const result = await t.query(api.functions.meetings.index.communityEvents, {
      communityId: data.communityId,
    });
    expect(result.events.map((e: any) => e.id)).not.toContain(meetingId);
  });

  test("a group event is still listed — the exclusion is specific to private", async () => {
    const t = convexTest(schema, modules);
    const data = await seed(t);
    const groupMeetingId = await t.run(async (ctx) =>
      ctx.db.insert("meetings", {
        groupId: data.groupId,
        title: "Regular Group Night",
        scheduledAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        meetingType: 1,
        status: "scheduled",
        visibility: "group",
        createdById: data.hostId,
        createdAt: Date.now(),
      })
    );

    expect(await listedFor(t, data, data.groupOnlyToken)).toContain(
      groupMeetingId
    );
  });
});

describe("private events are reachable by link", () => {
  test("anyone with the link can open it", async () => {
    const t = convexTest(schema, modules);
    const data = await seed(t);
    await insertPrivateEvent(t, data, { shortId: "linkme123" });

    const detail = await t.query(api.functions.meetings.index.getByShortId, {
      shortId: "linkme123",
      token: data.groupOnlyToken,
    });
    expect(detail).not.toBeNull();
    expect(detail?.hasAccess).toBe(true);
  });

  test("someone with the link can RSVP", async () => {
    const t = convexTest(schema, modules);
    const data = await seed(t);
    const meetingId = await insertPrivateEvent(t, data);

    await t.mutation(api.functions.meetingRsvps.submit, {
      token: data.groupOnlyToken,
      meetingId,
      optionId: 1,
    });

    const rsvps = await t.run((ctx) =>
      ctx.db
        .query("meetingRsvps")
        .filter((q) => q.eq(q.field("meetingId"), meetingId))
        .collect()
    );
    expect(rsvps).toHaveLength(1);
  });
});

describe("creating a private event", () => {
  test("persists the visibility", async () => {
    const t = convexTest(schema, modules);
    const data = await seed(t);

    const meetingId = await t.mutation(api.functions.meetings.index.create, {
      token: data.hostToken,
      groupId: data.groupId,
      scheduledAt: Date.now() + 7 * 86400000,
      title: "Prayer Team Night",
      meetingType: 1,
      visibility: "private",
    });

    const meeting = await t.run((ctx) =>
      ctx.db.get(meetingId as Id<"meetings">)
    );
    expect(meeting?.visibility).toBe("private");
    // No audience list to maintain — invites and the link carry it.
    expect(meeting?.shortId).toBeTruthy();
  });

  test("a created private event stays out of another member's list", async () => {
    const t = convexTest(schema, modules);
    const data = await seed(t);

    const meetingId = await t.mutation(api.functions.meetings.index.create, {
      token: data.hostToken,
      groupId: data.groupId,
      scheduledAt: Date.now() + 7 * 86400000,
      title: "Prayer Team Night",
      meetingType: 1,
      visibility: "private",
    });

    expect(await listedFor(t, data, data.groupOnlyToken)).not.toContain(
      meetingId
    );
  });
});
