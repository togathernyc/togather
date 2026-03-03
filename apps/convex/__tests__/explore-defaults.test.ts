/**
 * Explore Page Admin Defaults Tests
 *
 * Tests for admin-configurable default filters on the explore page:
 * - getExploreDefaults query: returns configured defaults for any authenticated user
 * - updateCommunitySettings mutation: persists explore default settings
 *
 * The explore defaults feature allows admins to pre-configure which group types
 * and meeting types are shown by default on the explore page.
 *
 * Run with: cd apps/convex && pnpm test __tests__/explore-defaults.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

// Set up JWT secret for testing - must be at least 32 characters
process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// ============================================================================
// Role Constants
// ============================================================================

const COMMUNITY_ROLES = {
  MEMBER: 1,
  MODERATOR: 2,
  ADMIN: 3,
  PRIMARY_ADMIN: 4,
} as const;

// ============================================================================
// Test Setup Helper
// ============================================================================

interface TestSetup {
  adminId: Id<"users">;
  memberId: Id<"users">;
  communityId: Id<"communities">;
  groupType1Id: Id<"groupTypes">;
  groupType2Id: Id<"groupTypes">;
  groupType3Id: Id<"groupTypes">;
  adminToken: string;
  memberToken: string;
}

/**
 * Seeds the database with a community, users, and group types for testing
 * explore defaults functionality.
 */
async function seedTestData(t: ReturnType<typeof convexTest>): Promise<TestSetup> {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();

    // Create admin user
    const adminId = await ctx.db.insert("users", {
      firstName: "Admin",
      lastName: "User",
      email: "admin@test.com",
      phone: "+12025551001",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Create regular member user
    const memberId = await ctx.db.insert("users", {
      firstName: "Member",
      lastName: "User",
      email: "member@test.com",
      phone: "+12025551002",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Create community
    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "test-community",
      isPublic: true,
      timezone: "America/New_York",
      createdAt: now,
      updatedAt: now,
    });

    // Create group types
    const groupType1Id = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: now,
      displayOrder: 1,
    });

    const groupType2Id = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Bible Study",
      slug: "bible-study",
      isActive: true,
      createdAt: now,
      displayOrder: 2,
    });

    const groupType3Id = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Service Team",
      slug: "service-team",
      isActive: true,
      createdAt: now,
      displayOrder: 3,
    });

    // Create community memberships
    await ctx.db.insert("userCommunities", {
      userId: adminId,
      communityId,
      roles: COMMUNITY_ROLES.ADMIN,
      status: 1,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("userCommunities", {
      userId: memberId,
      communityId,
      roles: COMMUNITY_ROLES.MEMBER,
      status: 1,
      createdAt: now,
      updatedAt: now,
    });

    return {
      adminId,
      memberId,
      communityId,
      groupType1Id,
      groupType2Id,
      groupType3Id,
    };
  });

  // Generate JWT tokens for each user
  const [adminTokens, memberTokens] = await Promise.all([
    generateTokens(ids.adminId),
    generateTokens(ids.memberId),
  ]);

  return {
    ...ids,
    adminToken: adminTokens.accessToken,
    memberToken: memberTokens.accessToken,
  };
}

// ============================================================================
// getExploreDefaults QUERY TESTS
// ============================================================================

describe("getExploreDefaults query", () => {
  test("returns empty defaults when no explore settings are configured", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const defaults = await t.query(api.functions.admin.settings.getExploreDefaults, {
      token: setup.memberToken,
      communityId: setup.communityId,
    });

    expect(defaults).toEqual({
      groupTypes: [],
      meetingType: null,
    });
  });

  test("returns configured group types array when set", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Set explore defaults directly in the database
    await t.run(async (ctx) => {
      await ctx.db.patch(setup.communityId, {
        exploreDefaultGroupTypes: [setup.groupType1Id, setup.groupType2Id],
      });
    });

    const defaults = await t.query(api.functions.admin.settings.getExploreDefaults, {
      token: setup.memberToken,
      communityId: setup.communityId,
    });

    expect(defaults.groupTypes).toEqual([setup.groupType1Id, setup.groupType2Id]);
    expect(defaults.meetingType).toBeNull();
  });

  test("returns configured meeting type when set", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Set meeting type to In-Person (2)
    await t.run(async (ctx) => {
      await ctx.db.patch(setup.communityId, {
        exploreDefaultMeetingType: 2,
      });
    });

    const defaults = await t.query(api.functions.admin.settings.getExploreDefaults, {
      token: setup.memberToken,
      communityId: setup.communityId,
    });

    expect(defaults.groupTypes).toEqual([]);
    expect(defaults.meetingType).toBe(2);
  });

  test("returns both group types and meeting type when both are set", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Set both defaults
    await t.run(async (ctx) => {
      await ctx.db.patch(setup.communityId, {
        exploreDefaultGroupTypes: [setup.groupType1Id],
        exploreDefaultMeetingType: 1, // Online
      });
    });

    const defaults = await t.query(api.functions.admin.settings.getExploreDefaults, {
      token: setup.memberToken,
      communityId: setup.communityId,
    });

    expect(defaults.groupTypes).toEqual([setup.groupType1Id]);
    expect(defaults.meetingType).toBe(1);
  });

  test("requires authentication - rejects invalid token", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    await expect(
      t.query(api.functions.admin.settings.getExploreDefaults, {
        token: "invalid-token-that-is-not-a-jwt",
        communityId: setup.communityId,
      })
    ).rejects.toThrow();
  });

  test("throws when community does not exist", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Create a fake community ID by inserting and deleting
    const fakeCommunityId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("communities", { name: "temp" });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      t.query(api.functions.admin.settings.getExploreDefaults, {
        token: setup.memberToken,
        communityId: fakeCommunityId,
      })
    ).rejects.toThrow("Community not found");
  });

  test("admin can also read explore defaults", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Set defaults
    await t.run(async (ctx) => {
      await ctx.db.patch(setup.communityId, {
        exploreDefaultGroupTypes: [setup.groupType3Id],
        exploreDefaultMeetingType: 2,
      });
    });

    const defaults = await t.query(api.functions.admin.settings.getExploreDefaults, {
      token: setup.adminToken,
      communityId: setup.communityId,
    });

    expect(defaults.groupTypes).toEqual([setup.groupType3Id]);
    expect(defaults.meetingType).toBe(2);
  });
});

// ============================================================================
// updateCommunitySettings MUTATION TESTS (explore fields)
// ============================================================================

describe("updateCommunitySettings mutation - explore defaults", () => {
  test("can set exploreDefaultGroupTypes to an array of groupType IDs", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const result = await t.mutation(api.functions.admin.settings.updateCommunitySettings, {
      token: setup.adminToken,
      communityId: setup.communityId,
      exploreDefaultGroupTypes: [setup.groupType1Id, setup.groupType2Id],
    });

    expect(result).toBeDefined();
    expect(result?.exploreDefaultGroupTypes).toEqual([setup.groupType1Id, setup.groupType2Id]);
  });

  test("can set exploreDefaultMeetingType to Online (1)", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const result = await t.mutation(api.functions.admin.settings.updateCommunitySettings, {
      token: setup.adminToken,
      communityId: setup.communityId,
      exploreDefaultMeetingType: 1,
    });

    expect(result).toBeDefined();
    expect(result?.exploreDefaultMeetingType).toBe(1);
  });

  test("can set exploreDefaultMeetingType to In-Person (2)", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const result = await t.mutation(api.functions.admin.settings.updateCommunitySettings, {
      token: setup.adminToken,
      communityId: setup.communityId,
      exploreDefaultMeetingType: 2,
    });

    expect(result).toBeDefined();
    expect(result?.exploreDefaultMeetingType).toBe(2);
  });

  test("can clear explore defaults by setting empty array", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // First set some defaults
    await t.mutation(api.functions.admin.settings.updateCommunitySettings, {
      token: setup.adminToken,
      communityId: setup.communityId,
      exploreDefaultGroupTypes: [setup.groupType1Id],
      exploreDefaultMeetingType: 2,
    });

    // Clear group types by setting empty array
    const result = await t.mutation(api.functions.admin.settings.updateCommunitySettings, {
      token: setup.adminToken,
      communityId: setup.communityId,
      exploreDefaultGroupTypes: [],
    });

    expect(result).toBeDefined();
    expect(result?.exploreDefaultGroupTypes).toEqual([]);
    // Meeting type should still be set since we didn't update it
    expect(result?.exploreDefaultMeetingType).toBe(2);
  });

  test("values persist and are readable via getCommunitySettings", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Set explore defaults via mutation
    await t.mutation(api.functions.admin.settings.updateCommunitySettings, {
      token: setup.adminToken,
      communityId: setup.communityId,
      exploreDefaultGroupTypes: [setup.groupType1Id, setup.groupType3Id],
      exploreDefaultMeetingType: 1,
    });

    // Read back via getCommunitySettings (admin-only query)
    const settings = await t.query(api.functions.admin.settings.getCommunitySettings, {
      token: setup.adminToken,
      communityId: setup.communityId,
    });

    expect(settings.exploreDefaultGroupTypes).toEqual([setup.groupType1Id, setup.groupType3Id]);
    expect(settings.exploreDefaultMeetingType).toBe(1);
  });

  test("values persist and are readable via getExploreDefaults (member view)", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Admin sets explore defaults
    await t.mutation(api.functions.admin.settings.updateCommunitySettings, {
      token: setup.adminToken,
      communityId: setup.communityId,
      exploreDefaultGroupTypes: [setup.groupType2Id],
      exploreDefaultMeetingType: 2,
    });

    // Member reads explore defaults
    const defaults = await t.query(api.functions.admin.settings.getExploreDefaults, {
      token: setup.memberToken,
      communityId: setup.communityId,
    });

    expect(defaults.groupTypes).toEqual([setup.groupType2Id]);
    expect(defaults.meetingType).toBe(2);
  });

  test("non-admin cannot update community settings", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    await expect(
      t.mutation(api.functions.admin.settings.updateCommunitySettings, {
        token: setup.memberToken,
        communityId: setup.communityId,
        exploreDefaultGroupTypes: [setup.groupType1Id],
      })
    ).rejects.toThrow();
  });

  test("setting explore defaults does not affect other community fields", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Set a non-explore field first
    await t.mutation(api.functions.admin.settings.updateCommunitySettings, {
      token: setup.adminToken,
      communityId: setup.communityId,
      primaryColor: "#FF0000",
    });

    // Now set explore defaults
    await t.mutation(api.functions.admin.settings.updateCommunitySettings, {
      token: setup.adminToken,
      communityId: setup.communityId,
      exploreDefaultGroupTypes: [setup.groupType1Id],
    });

    // Verify both fields are preserved
    const settings = await t.query(api.functions.admin.settings.getCommunitySettings, {
      token: setup.adminToken,
      communityId: setup.communityId,
    });

    expect(settings.primaryColor).toBe("#FF0000");
    expect(settings.exploreDefaultGroupTypes).toEqual([setup.groupType1Id]);
  });

  test("can set all three group types as defaults", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const result = await t.mutation(api.functions.admin.settings.updateCommunitySettings, {
      token: setup.adminToken,
      communityId: setup.communityId,
      exploreDefaultGroupTypes: [setup.groupType1Id, setup.groupType2Id, setup.groupType3Id],
    });

    expect(result?.exploreDefaultGroupTypes).toHaveLength(3);
    expect(result?.exploreDefaultGroupTypes).toContain(setup.groupType1Id);
    expect(result?.exploreDefaultGroupTypes).toContain(setup.groupType2Id);
    expect(result?.exploreDefaultGroupTypes).toContain(setup.groupType3Id);
  });
});

// ============================================================================
// getCommunitySettings QUERY TESTS (explore fields in admin view)
// ============================================================================

describe("getCommunitySettings query - explore fields", () => {
  test("includes exploreDefaultGroupTypes in response when set", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Set the field so it appears in the response
    await t.run(async (ctx) => {
      await ctx.db.patch(setup.communityId, {
        exploreDefaultGroupTypes: [setup.groupType1Id],
      });
    });

    const settings = await t.query(api.functions.admin.settings.getCommunitySettings, {
      token: setup.adminToken,
      communityId: setup.communityId,
    });

    expect(settings.exploreDefaultGroupTypes).toEqual([setup.groupType1Id]);
  });

  test("includes exploreDefaultMeetingType in response when set", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Set the field so it appears in the response
    await t.run(async (ctx) => {
      await ctx.db.patch(setup.communityId, {
        exploreDefaultMeetingType: 2,
      });
    });

    const settings = await t.query(api.functions.admin.settings.getCommunitySettings, {
      token: setup.adminToken,
      communityId: setup.communityId,
    });

    expect(settings.exploreDefaultMeetingType).toBe(2);
  });

  test("explore fields are undefined when not set on community", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const settings = await t.query(api.functions.admin.settings.getCommunitySettings, {
      token: setup.adminToken,
      communityId: setup.communityId,
    });

    // Optional fields: groupTypes is undefined when not set, meetingType returns null (0 and undefined both map to null)
    expect(settings.exploreDefaultGroupTypes).toBeUndefined();
    expect(settings.exploreDefaultMeetingType).toBeNull();
  });

  test("non-admin cannot read community settings", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    await expect(
      t.query(api.functions.admin.settings.getCommunitySettings, {
        token: setup.memberToken,
        communityId: setup.communityId,
      })
    ).rejects.toThrow();
  });
});
