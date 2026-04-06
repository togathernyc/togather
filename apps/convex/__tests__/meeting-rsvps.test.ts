/**
 * Meeting RSVP Tests
 *
 * Tests for submit, remove, myRsvp, list, getCounts, and myRsvpEvents queries/mutations.
 */

import { convexTest } from "convex-test";
import { vi, expect, test, describe, afterEach } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { api } from "../_generated/api";
import { generateTokens } from "../lib/auth";
import type { Id } from "../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// Use fake timers so scheduled functions (RSVP notification actions) can be
// drained without actually calling internal queries/actions.
vi.useFakeTimers();

// Clean up after each test to prevent unhandled errors from scheduled functions
afterEach(() => {
  vi.clearAllTimers();
});

// ============================================================================
// Test Helpers
// ============================================================================

const DEFAULT_RSVP_OPTIONS = [
  { id: 1, label: "Going", enabled: true },
  { id: 2, label: "Maybe", enabled: true },
  { id: 3, label: "Not Going", enabled: true },
];

/**
 * Drain scheduled functions so convex-test global state is clean.
 */
async function drainScheduledFunctions(t: ReturnType<typeof convexTest>) {
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } catch {
    // Expected - notification actions may fail in test environment
  }
}

async function seedCommunityWithGroup(t: ReturnType<typeof convexTest>) {
  const communityId = await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: "Test Community",
      subdomain: "test",
      slug: "test",
      timezone: "America/New_York",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const groupTypeId = await t.run(async (ctx) => {
    return await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      displayOrder: 0,
      createdAt: Date.now(),
    });
  });

  const groupId = await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Test Group",
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  return { communityId, groupId, groupTypeId };
}

async function createUser(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
  groupId: Id<"groups">,
  phone = "+15555550001"
) {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Test",
      lastName: "User",
      phone,
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("userCommunities", {
      userId,
      communityId,
      roles: 1,
      status: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      userId,
      groupId,
      role: "member",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  });

  const { accessToken } = await generateTokens(userId);
  return { userId, accessToken };
}

async function createMeeting(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
  overrides: Partial<{
    title: string;
    scheduledAt: number;
    status: string;
    rsvpEnabled: boolean;
    rsvpOptions: typeof DEFAULT_RSVP_OPTIONS;
    visibility: string;
    communityId: Id<"communities">;
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("meetings", {
      groupId,
      title: overrides.title ?? "Test Meeting",
      scheduledAt: overrides.scheduledAt ?? Date.now() + 86400000,
      status: overrides.status ?? "scheduled",
      meetingType: 1,
      rsvpEnabled: overrides.rsvpEnabled ?? true,
      rsvpOptions: overrides.rsvpOptions ?? DEFAULT_RSVP_OPTIONS,
      visibility: overrides.visibility ?? "group",
      createdAt: Date.now(),
      ...(overrides.communityId ? { communityId: overrides.communityId } : {}),
    });
  });
}

// ============================================================================
// Submit RSVP Tests
// ============================================================================

describe("meetingRsvps.submit", () => {
  test("creates a new RSVP", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUser(t, communityId, groupId);
    const meetingId = await createMeeting(t, groupId);

    const result = await t.mutation(api.functions.meetingRsvps.submit, {
      token: accessToken,
      meetingId,
      optionId: 1,
    });
    await drainScheduledFunctions(t);

    expect(result.success).toBe(true);
    expect(result.optionId).toBe(1);
  });

  test("updates existing RSVP when user changes response", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUser(t, communityId, groupId);
    const meetingId = await createMeeting(t, groupId);

    await t.mutation(api.functions.meetingRsvps.submit, {
      token: accessToken,
      meetingId,
      optionId: 1,
    });
    await drainScheduledFunctions(t);

    const result = await t.mutation(api.functions.meetingRsvps.submit, {
      token: accessToken,
      meetingId,
      optionId: 2,
    });

    expect(result.success).toBe(true);
    expect(result.optionId).toBe(2);
  });

  test("rejects RSVP when disabled on meeting", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUser(t, communityId, groupId);
    const meetingId = await createMeeting(t, groupId, { rsvpEnabled: false });

    await expect(
      t.mutation(api.functions.meetingRsvps.submit, {
        token: accessToken,
        meetingId,
        optionId: 1,
      })
    ).rejects.toThrow("RSVP is not enabled for this event");
  });

  test("rejects RSVP for cancelled meeting", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUser(t, communityId, groupId);
    const meetingId = await createMeeting(t, groupId, { status: "cancelled" });

    await expect(
      t.mutation(api.functions.meetingRsvps.submit, {
        token: accessToken,
        meetingId,
        optionId: 1,
      })
    ).rejects.toThrow("Cannot RSVP to cancelled event");
  });

  test("rejects RSVP for past meeting", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUser(t, communityId, groupId);
    const meetingId = await createMeeting(t, groupId, {
      scheduledAt: Date.now() - 86400000,
    });

    await expect(
      t.mutation(api.functions.meetingRsvps.submit, {
        token: accessToken,
        meetingId,
        optionId: 1,
      })
    ).rejects.toThrow("Cannot RSVP to past event");
  });

  test("rejects RSVP with invalid option ID", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUser(t, communityId, groupId);
    const meetingId = await createMeeting(t, groupId);

    await expect(
      t.mutation(api.functions.meetingRsvps.submit, {
        token: accessToken,
        meetingId,
        optionId: 999,
      })
    ).rejects.toThrow("Invalid RSVP option");
  });

  test("rejects RSVP with disabled option", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUser(t, communityId, groupId);
    const meetingId = await createMeeting(t, groupId, {
      rsvpOptions: [
        { id: 1, label: "Going", enabled: false },
        { id: 2, label: "Maybe", enabled: true },
      ],
    });

    await expect(
      t.mutation(api.functions.meetingRsvps.submit, {
        token: accessToken,
        meetingId,
        optionId: 1,
      })
    ).rejects.toThrow("RSVP option is disabled");
  });

  test("rejects RSVP from non-group-member for group-only event", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);

    // Create user WITHOUT group membership
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Outsider",
        lastName: "User",
        phone: "+15555550099",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        roles: 1,
        status: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const { accessToken } = await generateTokens(userId);

    const meetingId = await createMeeting(t, groupId, { visibility: "group" });

    await expect(
      t.mutation(api.functions.meetingRsvps.submit, {
        token: accessToken,
        meetingId,
        optionId: 1,
      })
    ).rejects.toThrow("You must be a group member to RSVP");
  });

  test("allows community member to RSVP to community-visibility event", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);

    // Create user with community membership but NOT group membership
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Community",
        lastName: "Member",
        phone: "+15555550088",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        roles: 1,
        status: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const { accessToken } = await generateTokens(userId);

    const meetingId = await createMeeting(t, groupId, { visibility: "community" });

    const result = await t.mutation(api.functions.meetingRsvps.submit, {
      token: accessToken,
      meetingId,
      optionId: 1,
    });
    await drainScheduledFunctions(t);

    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Remove RSVP Tests
// ============================================================================

describe("meetingRsvps.remove", () => {
  test("removes existing RSVP", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUser(t, communityId, groupId);
    const meetingId = await createMeeting(t, groupId);

    await t.mutation(api.functions.meetingRsvps.submit, {
      token: accessToken,
      meetingId,
      optionId: 1,
    });
    await drainScheduledFunctions(t);

    const result = await t.mutation(api.functions.meetingRsvps.remove, {
      token: accessToken,
      meetingId,
    });

    expect(result.success).toBe(true);

    // Verify RSVP is gone
    const myRsvp = await t.query(api.functions.meetingRsvps.myRsvp, {
      token: accessToken,
      meetingId,
    });
    expect(myRsvp.optionId).toBeNull();
  });

  test("succeeds even when no RSVP exists", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUser(t, communityId, groupId);
    const meetingId = await createMeeting(t, groupId);

    const result = await t.mutation(api.functions.meetingRsvps.remove, {
      token: accessToken,
      meetingId,
    });

    expect(result.success).toBe(true);
  });
});

// ============================================================================
// myRsvp Query Tests
// ============================================================================

describe("meetingRsvps.myRsvp", () => {
  test("returns optionId for user with RSVP", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUser(t, communityId, groupId);
    const meetingId = await createMeeting(t, groupId);

    await t.mutation(api.functions.meetingRsvps.submit, {
      token: accessToken,
      meetingId,
      optionId: 2,
    });
    await drainScheduledFunctions(t);

    const result = await t.query(api.functions.meetingRsvps.myRsvp, {
      token: accessToken,
      meetingId,
    });

    expect(result.optionId).toBe(2);
  });

  test("returns null optionId for unauthenticated user", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityWithGroup(t);
    const meetingId = await createMeeting(t, groupId);

    const result = await t.query(api.functions.meetingRsvps.myRsvp, {
      meetingId,
    });

    expect(result.optionId).toBeNull();
  });
});

// ============================================================================
// getCounts Query Tests
// ============================================================================

describe("meetingRsvps.getCounts", () => {
  test("returns counts grouped by option", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken: token1 } = await createUser(t, communityId, groupId, "+15555550001");
    const { accessToken: token2 } = await createUser(t, communityId, groupId, "+15555550002");
    const { accessToken: token3 } = await createUser(t, communityId, groupId, "+15555550003");
    const meetingId = await createMeeting(t, groupId);

    // Two "Going", one "Maybe"
    await t.mutation(api.functions.meetingRsvps.submit, { token: token1, meetingId, optionId: 1 });
    await t.mutation(api.functions.meetingRsvps.submit, { token: token2, meetingId, optionId: 1 });
    await t.mutation(api.functions.meetingRsvps.submit, { token: token3, meetingId, optionId: 2 });
    await drainScheduledFunctions(t);

    const result = await t.query(api.functions.meetingRsvps.getCounts, { meetingId });

    expect(result.total).toBe(3);
    expect(result.byOption[1]).toBe(2); // Going
    expect(result.byOption[2]).toBe(1); // Maybe
    expect(result.byOption[3]).toBe(0); // Not Going
  });

  test("returns zero counts for meeting with no RSVPs", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityWithGroup(t);
    const meetingId = await createMeeting(t, groupId);

    const result = await t.query(api.functions.meetingRsvps.getCounts, { meetingId });

    expect(result.total).toBe(0);
  });
});

// ============================================================================
// list Query Tests
// ============================================================================

describe("meetingRsvps.list", () => {
  test("returns limitedAccess response for unauthenticated user", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUser(t, communityId, groupId);
    const meetingId = await createMeeting(t, groupId);

    await t.mutation(api.functions.meetingRsvps.submit, {
      token: accessToken,
      meetingId,
      optionId: 1,
    });
    await drainScheduledFunctions(t);

    const result = await t.query(api.functions.meetingRsvps.list, { meetingId });

    expect(result.limitedAccess).toBe(true);
    expect(result.total).toBe(1);
  });

  test("returns full response for user who has RSVPed", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken } = await createUser(t, communityId, groupId);
    const meetingId = await createMeeting(t, groupId);

    await t.mutation(api.functions.meetingRsvps.submit, {
      token: accessToken,
      meetingId,
      optionId: 1,
    });
    await drainScheduledFunctions(t);

    const result = await t.query(api.functions.meetingRsvps.list, {
      token: accessToken,
      meetingId,
    });

    expect(result.limitedAccess).toBeUndefined();
    expect(result.total).toBe(1);
    expect(result.rsvps[0].count).toBe(1);
    expect(result.rsvps[0].users).toHaveLength(1);
  });

  test("returns limitedAccess for authenticated user who has NOT RSVPed", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedCommunityWithGroup(t);
    const { accessToken: rsvpToken } = await createUser(t, communityId, groupId, "+15555550001");
    const { accessToken: viewerToken } = await createUser(t, communityId, groupId, "+15555550002");
    const meetingId = await createMeeting(t, groupId);

    await t.mutation(api.functions.meetingRsvps.submit, {
      token: rsvpToken,
      meetingId,
      optionId: 1,
    });
    await drainScheduledFunctions(t);

    const result = await t.query(api.functions.meetingRsvps.list, {
      token: viewerToken,
      meetingId,
    });

    expect(result.limitedAccess).toBe(true);
  });
});

