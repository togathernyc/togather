/**
 * Smoke test for Convex test infrastructure
 *
 * Verifies that convex-test and Vitest are working correctly with our schema.
 * Tests basic database operations (insert, get, query) to ensure the test
 * infrastructure is properly configured.
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";

// ============================================================================
// Role Constants (used in test data)
// ============================================================================

const ROLES = {
  MEMBER: 1,
  LEADER: 2,
  ADMIN: 3,
  PRIMARY_ADMIN: 4,
} as const;

const GROUP_ROLES = {
  member: "member",
  leader: "leader",
  admin: "admin",
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a timestamp for testing (Unix milliseconds)
 */
function mockTimestamp(offsetDays: number = 0): number {
  return Date.now() + offsetDays * 24 * 60 * 60 * 1000;
}

// ============================================================================
// SMOKE TESTS
// ============================================================================

describe("Convex Test Infrastructure", () => {
  describe("Basic Database Operations", () => {
    test("should insert and retrieve a user document", async () => {
      const t = convexTest(schema, modules);

      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
          firstName: "Test",
          lastName: "User",
          email: "test@example.com",
          phone: "+12025550123",
          phoneVerified: true,
          isActive: true,
          roles: ROLES.MEMBER,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      expect(userId).toBeDefined();

      // Verify we can retrieve the document
      const user = await t.run(async (ctx) => {
        return await ctx.db.get(userId);
      });

      expect(user).not.toBeNull();
      expect(user?.firstName).toBe("Test");
      expect(user?.lastName).toBe("User");
      expect(user?.email).toBe("test@example.com");
    });

    test("should insert and retrieve a community document", async () => {
      const t = convexTest(schema, modules);

      const communityId = await t.run(async (ctx) => {
        return await ctx.db.insert("communities", {
          name: "Test Community",
          slug: "test-community",
          subdomain: "test",
          timezone: "America/New_York",
          isPublic: true,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      expect(communityId).toBeDefined();

      const community = await t.run(async (ctx) => {
        return await ctx.db.get(communityId);
      });

      expect(community).not.toBeNull();
      expect(community?.name).toBe("Test Community");
      expect(community?.isPublic).toBe(true);
    });

    test("should support document patching", async () => {
      const t = convexTest(schema, modules);

      // Insert a user
      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
          firstName: "Original",
          lastName: "Name",
          isActive: true,
        });
      });

      // Patch the document
      await t.run(async (ctx) => {
        await ctx.db.patch(userId, {
          firstName: "Updated",
          lastName: "User",
        });
      });

      // Verify the patch was applied
      const user = await t.run(async (ctx) => {
        return await ctx.db.get(userId);
      });

      expect(user?.firstName).toBe("Updated");
      expect(user?.lastName).toBe("User");
      expect(user?.isActive).toBe(true); // Original field preserved
    });

    test("should support document deletion", async () => {
      const t = convexTest(schema, modules);

      // Insert a user
      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
          firstName: "ToDelete",
          lastName: "User",
        });
      });

      // Verify it exists
      const beforeDelete = await t.run(async (ctx) => {
        return await ctx.db.get(userId);
      });
      expect(beforeDelete).not.toBeNull();

      // Delete the document
      await t.run(async (ctx) => {
        await ctx.db.delete(userId);
      });

      // Verify it's gone
      const afterDelete = await t.run(async (ctx) => {
        return await ctx.db.get(userId);
      });
      expect(afterDelete).toBeNull();
    });
  });

  describe("Query Operations", () => {
    test("should query documents by index", async () => {
      const t = convexTest(schema, modules);

      // Insert a community and multiple users
      const communityId = await t.run(async (ctx) => {
        return await ctx.db.insert("communities", {
          name: "Query Test Community",
          slug: "query-test",
          isPublic: true,
        });
      });

      await t.run(async (ctx) => {
        // Insert two user-community memberships
        await ctx.db.insert("userCommunities", {
          userId: await ctx.db.insert("users", {
            firstName: "User",
            lastName: "One",
          }),
          communityId,
          roles: ROLES.MEMBER,
          status: 1,
          createdAt: mockTimestamp(),
        });

        await ctx.db.insert("userCommunities", {
          userId: await ctx.db.insert("users", {
            firstName: "User",
            lastName: "Two",
          }),
          communityId,
          roles: ROLES.ADMIN,
          status: 1,
          createdAt: mockTimestamp(),
        });
      });

      // Query memberships by community
      const memberships = await t.run(async (ctx) => {
        return await ctx.db
          .query("userCommunities")
          .withIndex("by_community", (q) => q.eq("communityId", communityId))
          .collect();
      });

      expect(memberships).toHaveLength(2);
    });

    test("should support .first() query method", async () => {
      const t = convexTest(schema, modules);

      // Insert a user with specific email
      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          firstName: "Unique",
          lastName: "User",
          email: "unique@test.com",
        });
      });

      // Query for that user
      const user = await t.run(async (ctx) => {
        return await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", "unique@test.com"))
          .first();
      });

      expect(user).not.toBeNull();
      expect(user?.firstName).toBe("Unique");
    });

    test("should return null for non-existent query results", async () => {
      const t = convexTest(schema, modules);

      const user = await t.run(async (ctx) => {
        return await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", "nonexistent@test.com"))
          .first();
      });

      expect(user).toBeNull();
    });
  });

  describe("Related Documents", () => {
    test("should create groups with proper relationships", async () => {
      const t = convexTest(schema, modules);

      // Create community, group type, and group
      const { communityId, groupTypeId, groupId } = await t.run(async (ctx) => {
        const communityId = await ctx.db.insert("communities", {
          name: "Group Test Community",
          slug: "group-test",
          isPublic: true,
        });

        const groupTypeId = await ctx.db.insert("groupTypes", {
          communityId,
          name: "Small Group",
          slug: "small-group",
          isActive: true,
          createdAt: mockTimestamp(),
          displayOrder: 1,
        });

        const groupId = await ctx.db.insert("groups", {
          communityId,
          groupTypeId,
          name: "Test Small Group",
          description: "A test group",
          isArchived: false,
          isPublic: true,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });

        return { communityId, groupTypeId, groupId };
      });

      // Verify relationships
      const group = await t.run(async (ctx) => {
        return await ctx.db.get(groupId);
      });

      expect(group).not.toBeNull();
      expect(group?.communityId).toBe(communityId);
      expect(group?.groupTypeId).toBe(groupTypeId);
      expect(group?.name).toBe("Test Small Group");
    });

    test("should create group memberships correctly", async () => {
      const t = convexTest(schema, modules);

      // Create the full hierarchy
      const { groupId, userId, membershipId } = await t.run(async (ctx) => {
        const communityId = await ctx.db.insert("communities", {
          name: "Membership Test",
          slug: "membership-test",
        });

        const groupTypeId = await ctx.db.insert("groupTypes", {
          communityId,
          name: "Test Type",
          slug: "test-type",
          isActive: true,
          createdAt: mockTimestamp(),
          displayOrder: 1,
        });

        const groupId = await ctx.db.insert("groups", {
          communityId,
          groupTypeId,
          name: "Test Group",
          isArchived: false,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });

        const userId = await ctx.db.insert("users", {
          firstName: "Group",
          lastName: "Member",
        });

        const membershipId = await ctx.db.insert("groupMembers", {
          groupId,
          userId,
          role: GROUP_ROLES.member,
          joinedAt: mockTimestamp(),
          notificationsEnabled: true,
        });

        return { groupId, userId, membershipId };
      });

      // Query membership by group and user
      const membership = await t.run(async (ctx) => {
        return await ctx.db
          .query("groupMembers")
          .withIndex("by_group_user", (q) =>
            q.eq("groupId", groupId).eq("userId", userId)
          )
          .first();
      });

      expect(membership).not.toBeNull();
      expect(membership?._id).toBe(membershipId);
      expect(membership?.role).toBe(GROUP_ROLES.member);
    });
  });

  describe("Role Constants", () => {
    test("should have correct role values", () => {
      expect(ROLES.MEMBER).toBe(1);
      expect(ROLES.LEADER).toBe(2);
      expect(ROLES.ADMIN).toBe(3);
      expect(ROLES.PRIMARY_ADMIN).toBe(4);
    });

    test("should have correct group role strings", () => {
      expect(GROUP_ROLES.member).toBe("member");
      expect(GROUP_ROLES.leader).toBe("leader");
      expect(GROUP_ROLES.admin).toBe("admin");
    });
  });

  describe("Timestamp Helpers", () => {
    test("should create timestamps close to now by default", () => {
      const timestamp = mockTimestamp();
      const now = Date.now();
      // Should be within 1 second
      expect(Math.abs(timestamp - now)).toBeLessThan(1000);
    });

    test("should offset timestamps by days", () => {
      const pastTimestamp = mockTimestamp(-7); // 7 days ago
      const now = Date.now();
      const expectedOffset = 7 * 24 * 60 * 60 * 1000;
      expect(Math.abs(now - pastTimestamp - expectedOffset)).toBeLessThan(1000);
    });
  });
});

describe("Schema Validation", () => {
  test("should enforce required fields on groups", async () => {
    const t = convexTest(schema, modules);

    // Create prerequisites
    const { communityId, groupTypeId } = await t.run(async (ctx) => {
      const communityId = await ctx.db.insert("communities", {
        name: "Validation Test",
      });
      const groupTypeId = await ctx.db.insert("groupTypes", {
        communityId,
        name: "Test",
        slug: "test",
        isActive: true,
        createdAt: mockTimestamp(),
        displayOrder: 1,
      });
      return { communityId, groupTypeId };
    });

    // Should succeed with all required fields
    const groupId = await t.run(async (ctx) => {
      return await ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name: "Valid Group",
        isArchived: false,
        createdAt: mockTimestamp(),
        updatedAt: mockTimestamp(),
      });
    });

    expect(groupId).toBeDefined();
  });

  test("should enforce required fields on meetings", async () => {
    const t = convexTest(schema, modules);

    // Create prerequisites
    const groupId = await t.run(async (ctx) => {
      const communityId = await ctx.db.insert("communities", {
        name: "Meeting Test",
      });
      const groupTypeId = await ctx.db.insert("groupTypes", {
        communityId,
        name: "Test",
        slug: "test",
        isActive: true,
        createdAt: mockTimestamp(),
        displayOrder: 1,
      });
      return await ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name: "Meeting Group",
        isArchived: false,
        createdAt: mockTimestamp(),
        updatedAt: mockTimestamp(),
      });
    });

    // Should succeed with required fields
    const meetingId = await t.run(async (ctx) => {
      return await ctx.db.insert("meetings", {
        groupId,
        scheduledAt: mockTimestamp(7), // 7 days in future
        status: "scheduled",
        meetingType: 1, // In-Person
        createdAt: mockTimestamp(),
      });
    });

    expect(meetingId).toBeDefined();

    // Verify the meeting
    const meeting = await t.run(async (ctx) => {
      return await ctx.db.get(meetingId);
    });

    expect(meeting?.status).toBe("scheduled");
    expect(meeting?.meetingType).toBe(1);
  });
});
