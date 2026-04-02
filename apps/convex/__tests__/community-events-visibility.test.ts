/**
 * Community Events Visibility Tests
 *
 * These tests verify that the communityEvents query properly filters events
 * based on visibility settings:
 * 1. Public events - visible to all users (including unauthenticated)
 * 2. Community events - visible only to community members
 * 3. Group events - visible only to group members
 *
 * Run with: cd apps/convex && pnpm test __tests__/community-events-visibility.test.ts
 */

import { vi, expect, test, describe, beforeEach, afterEach } from "vitest";

// Mock the jose library to bypass JWT verification in tests
vi.mock("jose", () => ({
  jwtVerify: vi.fn(async (token: string) => {
    const match = token.match(/^test-token-(.+)$/);
    if (!match) {
      throw new Error("Invalid token");
    }
    return {
      payload: {
        userId: match[1],
        type: "access",
      },
    };
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
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { modules } from "../test.setup";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// Test Setup Helper
// ============================================================================

interface TestSetup {
  communityId: Id<"communities">;
  otherCommunityId: Id<"communities">;
  groupTypeId: Id<"groupTypes">;
  groupId: Id<"groups">;
  communityMemberId: Id<"users">;
  groupMemberId: Id<"users">;
  nonMemberId: Id<"users">;
  publicMeetingId: Id<"meetings">;
  communityMeetingId: Id<"meetings">;
  groupMeetingId: Id<"meetings">;
  communityMemberToken: string;
  groupMemberToken: string;
  nonMemberToken: string;
}

async function setupTestData(t: ReturnType<typeof convexTest>): Promise<TestSetup> {
  return await t.run(async (ctx) => {
    const timestamp = Date.now();
    const futureTime = timestamp + 86400000; // Tomorrow

    // Create main community
    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "test-community",
      isPublic: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Create another community (for testing cross-community access)
    const otherCommunityId = await ctx.db.insert("communities", {
      name: "Other Community",
      slug: "other-community",
      isPublic: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Create group type
    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: timestamp,
      displayOrder: 1,
    });

    // Create users:
    // 1. Community member (not in any group)
    // 2. Group member (also a community member)
    // 3. Non-member (not in community at all)

    const communityMemberId = await ctx.db.insert("users", {
      firstName: "Community",
      lastName: "Member",
      email: "community@test.com",
      phone: "+12025551001",
      phoneVerified: true,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const groupMemberId = await ctx.db.insert("users", {
      firstName: "Group",
      lastName: "Member",
      email: "group@test.com",
      phone: "+12025551002",
      phoneVerified: true,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const nonMemberId = await ctx.db.insert("users", {
      firstName: "Non",
      lastName: "Member",
      email: "nonmember@test.com",
      phone: "+12025551003",
      phoneVerified: true,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Create a group
    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Test Group",
      description: "A test group",
      isArchived: false,
      isPublic: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Add community membership for communityMember
    await ctx.db.insert("userCommunities", {
      userId: communityMemberId,
      communityId,
      roles: 1, // Regular member
      status: 1, // Active
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Add community membership for groupMember
    await ctx.db.insert("userCommunities", {
      userId: groupMemberId,
      communityId,
      roles: 1, // Regular member
      status: 1, // Active
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Add group membership for groupMember
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: groupMemberId,
      role: "member",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    // Create meetings with different visibility levels
    const publicMeetingId = await ctx.db.insert("meetings", {
      groupId,
      title: "Public Event",
      scheduledAt: futureTime,
      meetingType: 1,
      status: "scheduled",
      visibility: "public",
      createdById: groupMemberId,
      createdAt: timestamp,
    });

    const communityMeetingId = await ctx.db.insert("meetings", {
      groupId,
      title: "Community Event",
      scheduledAt: futureTime + 1000, // Slightly later
      meetingType: 1,
      status: "scheduled",
      visibility: "community",
      createdById: groupMemberId,
      createdAt: timestamp,
    });

    const groupMeetingId = await ctx.db.insert("meetings", {
      groupId,
      title: "Group Event",
      scheduledAt: futureTime + 2000, // Slightly later
      meetingType: 1,
      status: "scheduled",
      visibility: "group",
      createdById: groupMemberId,
      createdAt: timestamp,
    });

    return {
      communityId,
      otherCommunityId,
      groupTypeId,
      groupId,
      communityMemberId,
      groupMemberId,
      nonMemberId,
      publicMeetingId,
      communityMeetingId,
      groupMeetingId,
      communityMemberToken: `test-token-${communityMemberId}`,
      groupMemberToken: `test-token-${groupMemberId}`,
      nonMemberToken: `test-token-${nonMemberId}`,
    };
  });
}

// ============================================================================
// Public Event Visibility Tests
// ============================================================================

describe("Public events visibility", () => {
  test("Public events are visible to unauthenticated users", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.meetings.index.communityEvents, {
      communityId: setup.communityId,
      includePast: true,
    });

    const publicEvent = result.events.find((e) => e.id === setup.publicMeetingId);
    expect(publicEvent).toBeDefined();
    expect(publicEvent?.title).toBe("Public Event");
  });

  test("Public events are visible to non-community members", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.meetings.index.communityEvents, {
      token: setup.nonMemberToken,
      communityId: setup.communityId,
      includePast: true,
    });

    const publicEvent = result.events.find((e) => e.id === setup.publicMeetingId);
    expect(publicEvent).toBeDefined();
    expect(publicEvent?.title).toBe("Public Event");
  });

  test("Public events are visible to community members", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.meetings.index.communityEvents, {
      token: setup.communityMemberToken,
      communityId: setup.communityId,
      includePast: true,
    });

    const publicEvent = result.events.find((e) => e.id === setup.publicMeetingId);
    expect(publicEvent).toBeDefined();
    expect(publicEvent?.title).toBe("Public Event");
  });
});

// ============================================================================
// Community Event Visibility Tests
// ============================================================================

describe("Community events visibility", () => {
  test("Community events are NOT visible to unauthenticated users", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.meetings.index.communityEvents, {
      communityId: setup.communityId,
      includePast: true,
    });

    const communityEvent = result.events.find((e) => e.id === setup.communityMeetingId);
    expect(communityEvent).toBeUndefined();
  });

  test("Community events are NOT visible to non-community members", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.meetings.index.communityEvents, {
      token: setup.nonMemberToken,
      communityId: setup.communityId,
      includePast: true,
    });

    const communityEvent = result.events.find((e) => e.id === setup.communityMeetingId);
    expect(communityEvent).toBeUndefined();
  });

  test("Community events ARE visible to community members", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.meetings.index.communityEvents, {
      token: setup.communityMemberToken,
      communityId: setup.communityId,
      includePast: true,
    });

    const communityEvent = result.events.find((e) => e.id === setup.communityMeetingId);
    expect(communityEvent).toBeDefined();
    expect(communityEvent?.title).toBe("Community Event");
  });

  test("Community events ARE visible to group members (who are also community members)", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.meetings.index.communityEvents, {
      token: setup.groupMemberToken,
      communityId: setup.communityId,
      includePast: true,
    });

    const communityEvent = result.events.find((e) => e.id === setup.communityMeetingId);
    expect(communityEvent).toBeDefined();
    expect(communityEvent?.title).toBe("Community Event");
  });
});

// ============================================================================
// Group Event Visibility Tests
// ============================================================================

describe("Group events visibility", () => {
  test("Group events are NOT visible to unauthenticated users", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.meetings.index.communityEvents, {
      communityId: setup.communityId,
      includePast: true,
    });

    const groupEvent = result.events.find((e) => e.id === setup.groupMeetingId);
    expect(groupEvent).toBeUndefined();
  });

  test("Group events are NOT visible to non-community members", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.meetings.index.communityEvents, {
      token: setup.nonMemberToken,
      communityId: setup.communityId,
      includePast: true,
    });

    const groupEvent = result.events.find((e) => e.id === setup.groupMeetingId);
    expect(groupEvent).toBeUndefined();
  });

  test("Group events are NOT visible to community members who are not in the group", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.meetings.index.communityEvents, {
      token: setup.communityMemberToken,
      communityId: setup.communityId,
      includePast: true,
    });

    const groupEvent = result.events.find((e) => e.id === setup.groupMeetingId);
    expect(groupEvent).toBeUndefined();
  });

  test("Group events ARE visible to group members", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.meetings.index.communityEvents, {
      token: setup.groupMemberToken,
      communityId: setup.communityId,
      includePast: true,
    });

    const groupEvent = result.events.find((e) => e.id === setup.groupMeetingId);
    expect(groupEvent).toBeDefined();
    expect(groupEvent?.title).toBe("Group Event");
  });
});

// ============================================================================
// Filtering by Hosting Group Tests
// ============================================================================

describe("Events filtered by hosting group", () => {
  test("Filtering by group shows events from that group with correct visibility", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Group member filtering by their group should see all events they have access to
    const result = await t.query(api.functions.meetings.index.communityEvents, {
      token: setup.groupMemberToken,
      communityId: setup.communityId,
      hostingGroupIds: [setup.groupId],
      includePast: true,
    });

    // Should see all 3 events (public, community, group)
    expect(result.events).toHaveLength(3);
    const titles = result.events.map((e) => e.title);
    expect(titles).toContain("Public Event");
    expect(titles).toContain("Community Event");
    expect(titles).toContain("Group Event");
  });

  test("Community member filtering by group only sees public and community events", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Community member (not in group) filtering by group should only see public + community events
    const result = await t.query(api.functions.meetings.index.communityEvents, {
      token: setup.communityMemberToken,
      communityId: setup.communityId,
      hostingGroupIds: [setup.groupId],
      includePast: true,
    });

    // Should see only 2 events (public, community) - NOT group event
    expect(result.events).toHaveLength(2);
    const titles = result.events.map((e) => e.title);
    expect(titles).toContain("Public Event");
    expect(titles).toContain("Community Event");
    expect(titles).not.toContain("Group Event");
  });

  test("Non-member filtering by group only sees public events", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Non-member filtering by group should only see public events
    const result = await t.query(api.functions.meetings.index.communityEvents, {
      token: setup.nonMemberToken,
      communityId: setup.communityId,
      hostingGroupIds: [setup.groupId],
      includePast: true,
    });

    // Should see only 1 event (public)
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("Public Event");
  });
});

// ============================================================================
// Summary of Expected Behavior
// ============================================================================

describe("Visibility Summary", () => {
  test("documents expected visibility behavior", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Unauthenticated user
    const unauthResult = await t.query(api.functions.meetings.index.communityEvents, {
      communityId: setup.communityId,
      includePast: true,
    });

    // Non-member
    const nonMemberResult = await t.query(api.functions.meetings.index.communityEvents, {
      token: setup.nonMemberToken,
      communityId: setup.communityId,
      includePast: true,
    });

    // Community member (not in group)
    const communityMemberResult = await t.query(api.functions.meetings.index.communityEvents, {
      token: setup.communityMemberToken,
      communityId: setup.communityId,
      includePast: true,
    });

    // Group member
    const groupMemberResult = await t.query(api.functions.meetings.index.communityEvents, {
      token: setup.groupMemberToken,
      communityId: setup.communityId,
      includePast: true,
    });

    // Expected visibility matrix:
    // | User Type         | Public | Community | Group |
    // |-------------------|--------|-----------|-------|
    // | Unauthenticated   | YES    | NO        | NO    |
    // | Non-member        | YES    | NO        | NO    |
    // | Community member  | YES    | YES       | NO    |
    // | Group member      | YES    | YES       | YES   |

    expect(unauthResult.events.length).toBe(1); // Only public
    expect(nonMemberResult.events.length).toBe(1); // Only public
    expect(communityMemberResult.events.length).toBe(2); // Public + Community
    expect(groupMemberResult.events.length).toBe(3); // Public + Community + Group
  });
});
