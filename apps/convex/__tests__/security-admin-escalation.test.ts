/**
 * Security Tests: Admin Role Escalation Prevention
 *
 * These tests verify that the security checks in communities.updateMemberRole
 * properly prevent unauthorized role escalation.
 *
 * SECURITY CHECKS TESTED:
 * 1. Regular ADMIN cannot promote to PRIMARY_ADMIN
 * 2. Regular ADMIN cannot demote PRIMARY_ADMIN
 * 3. Self-promotion to PRIMARY_ADMIN is blocked
 * 4. Role hierarchy is properly enforced
 * 5. Only PRIMARY_ADMIN can modify admin-level roles
 *
 * Run with: cd convex && pnpm test __tests__/security-admin-escalation.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, beforeEach } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";

// ============================================================================
// Role Constants
// ============================================================================

const COMMUNITY_ROLES = {
  MEMBER: 1,
  LEADER: 2,
  ADMIN: 3,
  PRIMARY_ADMIN: 4,
} as const;

// ============================================================================
// Test Setup
// ============================================================================

// Configure JWT secret for tests
beforeEach(() => {
  process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters-long-for-security";
});

// ============================================================================
// SECURITY VULNERABILITY TESTS - PRIMARY ADMIN PROMOTION BYPASS
// ============================================================================

describe("SECURITY: Admin Role Escalation Prevention in communities.updateMemberRole", () => {
  describe("Security Check 1: Regular ADMIN cannot promote to PRIMARY_ADMIN", () => {
    /**
     * SECURITY CHECK:
     * Only PRIMARY_ADMIN (role 4) should be able to promote users to PRIMARY_ADMIN.
     * Regular ADMIN (role 3) should be blocked.
     */
    test("regular ADMIN cannot promote user to PRIMARY_ADMIN", async () => {
      const t = convexTest(schema, modules);

      // Setup test data
      const setup = await t.run(async (ctx) => {
        const communityId = await ctx.db.insert("communities", {
          name: "Test Community",
          slug: "test-community",
          isPublic: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const adminUserId = await ctx.db.insert("users", {
          firstName: "Admin",
          lastName: "User",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const memberUserId = await ctx.db.insert("users", {
          firstName: "Member",
          lastName: "User",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Admin user with role 3
        await ctx.db.insert("userCommunities", {
          userId: adminUserId,
          communityId,
          roles: COMMUNITY_ROLES.ADMIN,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Target member with role 1
        await ctx.db.insert("userCommunities", {
          userId: memberUserId,
          communityId,
          roles: COMMUNITY_ROLES.MEMBER,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        return { communityId, adminUserId, memberUserId };
      });

      // Generate a real token for the admin user
      const { accessToken } = await generateTokens(setup.adminUserId);

      // Attempt to promote member to PRIMARY_ADMIN as a regular ADMIN
      // This should fail with a security error
      await expect(
        t.mutation(api.functions.communities.updateMemberRole, {
          token: accessToken,
          communityId: setup.communityId,
          targetUserId: setup.memberUserId,
          roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
        })
      ).rejects.toThrow("Only primary admin can promote to primary admin");
    });
  });

  describe("Security Check 2: Regular ADMIN cannot demote PRIMARY_ADMIN", () => {
    /**
     * SECURITY CHECK:
     * PRIMARY_ADMIN role cannot be modified through updateMemberRole.
     * The proper way to change PRIMARY_ADMIN is through a dedicated transfer mechanism.
     */
    test("regular ADMIN cannot demote PRIMARY_ADMIN", async () => {
      const t = convexTest(schema, modules);

      const setup = await t.run(async (ctx) => {
        const communityId = await ctx.db.insert("communities", {
          name: "Test Community",
          slug: "test-community",
          isPublic: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const primaryAdminId = await ctx.db.insert("users", {
          firstName: "Primary",
          lastName: "Admin",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const adminUserId = await ctx.db.insert("users", {
          firstName: "Admin",
          lastName: "User",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Primary Admin with role 4
        await ctx.db.insert("userCommunities", {
          userId: primaryAdminId,
          communityId,
          roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Regular Admin with role 3
        await ctx.db.insert("userCommunities", {
          userId: adminUserId,
          communityId,
          roles: COMMUNITY_ROLES.ADMIN,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        return { communityId, primaryAdminId, adminUserId };
      });

      // Generate a token for the regular admin
      const { accessToken } = await generateTokens(setup.adminUserId);

      // Attempt to demote PRIMARY_ADMIN as a regular ADMIN
      // This should fail because PRIMARY_ADMIN cannot be modified
      await expect(
        t.mutation(api.functions.communities.updateMemberRole, {
          token: accessToken,
          communityId: setup.communityId,
          targetUserId: setup.primaryAdminId,
          roles: COMMUNITY_ROLES.ADMIN,
        })
      ).rejects.toThrow("Cannot modify Primary Admin role");
    });
  });

  describe("Security Check 3: Self-promotion to PRIMARY_ADMIN is blocked", () => {
    /**
     * SECURITY CHECK:
     * No user should be able to promote themselves to PRIMARY_ADMIN,
     * even if they are already an ADMIN.
     */
    test("ADMIN cannot promote themselves to PRIMARY_ADMIN", async () => {
      const t = convexTest(schema, modules);

      const setup = await t.run(async (ctx) => {
        const communityId = await ctx.db.insert("communities", {
          name: "Test Community",
          slug: "test-community",
          isPublic: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const adminUserId = await ctx.db.insert("users", {
          firstName: "Admin",
          lastName: "User",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Admin user with role 3
        await ctx.db.insert("userCommunities", {
          userId: adminUserId,
          communityId,
          roles: COMMUNITY_ROLES.ADMIN,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        return { communityId, adminUserId };
      });

      // Generate a token for the admin
      const { accessToken } = await generateTokens(setup.adminUserId);

      // Attempt self-promotion to PRIMARY_ADMIN
      // This should fail with a security error
      await expect(
        t.mutation(api.functions.communities.updateMemberRole, {
          token: accessToken,
          communityId: setup.communityId,
          targetUserId: setup.adminUserId,
          roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
        })
      ).rejects.toThrow("Cannot promote yourself to primary admin");
    });
  });
});

// ============================================================================
// ROLE HIERARCHY TESTS
// ============================================================================

describe("SECURITY: Role Hierarchy Enforcement", () => {
  describe("Role hierarchy: Lower roles cannot promote to higher roles", () => {
    /**
     * SECURITY CHECK:
     * Users with role < ADMIN_ROLE_THRESHOLD (3) cannot update roles at all.
     */
    test("LEADER (role 2) cannot promote anyone to ADMIN (role 3)", async () => {
      const t = convexTest(schema, modules);

      const setup = await t.run(async (ctx) => {
        const communityId = await ctx.db.insert("communities", {
          name: "Test Community",
          slug: "test-community",
          isPublic: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const leaderUserId = await ctx.db.insert("users", {
          firstName: "Leader",
          lastName: "User",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const memberUserId = await ctx.db.insert("users", {
          firstName: "Member",
          lastName: "User",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Leader with role 2
        await ctx.db.insert("userCommunities", {
          userId: leaderUserId,
          communityId,
          roles: COMMUNITY_ROLES.LEADER,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Member with role 1
        await ctx.db.insert("userCommunities", {
          userId: memberUserId,
          communityId,
          roles: COMMUNITY_ROLES.MEMBER,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        return { communityId, leaderUserId, memberUserId };
      });

      // Generate a token for the leader
      const { accessToken } = await generateTokens(setup.leaderUserId);

      // LEADER tries to promote member to ADMIN - should fail
      await expect(
        t.mutation(api.functions.communities.updateMemberRole, {
          token: accessToken,
          communityId: setup.communityId,
          targetUserId: setup.memberUserId,
          roles: COMMUNITY_ROLES.ADMIN,
        })
      ).rejects.toThrow("Community admin role required");
    });

    /**
     * SECURITY CHECK:
     * Regular ADMIN (role 3) cannot promote to ADMIN-level roles.
     * Only PRIMARY_ADMIN can modify admin-level roles.
     */
    test("ADMIN (role 3) cannot promote to ADMIN without PRIMARY_ADMIN privileges", async () => {
      const t = convexTest(schema, modules);

      const setup = await t.run(async (ctx) => {
        const communityId = await ctx.db.insert("communities", {
          name: "Test Community",
          slug: "test-community",
          isPublic: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const adminUserId = await ctx.db.insert("users", {
          firstName: "Admin",
          lastName: "User",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const memberUserId = await ctx.db.insert("users", {
          firstName: "Member",
          lastName: "User",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Admin with role 3
        await ctx.db.insert("userCommunities", {
          userId: adminUserId,
          communityId,
          roles: COMMUNITY_ROLES.ADMIN,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Member with role 1
        await ctx.db.insert("userCommunities", {
          userId: memberUserId,
          communityId,
          roles: COMMUNITY_ROLES.MEMBER,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        return { communityId, adminUserId, memberUserId };
      });

      // Generate a token for the admin
      const { accessToken } = await generateTokens(setup.adminUserId);

      // ADMIN tries to promote member to ADMIN - should fail (only PRIMARY_ADMIN can do this)
      await expect(
        t.mutation(api.functions.communities.updateMemberRole, {
          token: accessToken,
          communityId: setup.communityId,
          targetUserId: setup.memberUserId,
          roles: COMMUNITY_ROLES.ADMIN,
        })
      ).rejects.toThrow("Only primary admin can promote or demote admin-level roles");
    });
  });

  describe("PRIMARY_ADMIN authority tests", () => {
    /**
     * POSITIVE TEST:
     * PRIMARY_ADMIN should be able to promote users to PRIMARY_ADMIN.
     */
    test("PRIMARY_ADMIN can promote member to PRIMARY_ADMIN", async () => {
      const t = convexTest(schema, modules);

      const setup = await t.run(async (ctx) => {
        const communityId = await ctx.db.insert("communities", {
          name: "Test Community",
          slug: "test-community",
          isPublic: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const primaryAdminId = await ctx.db.insert("users", {
          firstName: "Primary",
          lastName: "Admin",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const memberUserId = await ctx.db.insert("users", {
          firstName: "Member",
          lastName: "User",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Primary Admin with role 4
        await ctx.db.insert("userCommunities", {
          userId: primaryAdminId,
          communityId,
          roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Member with role 1
        await ctx.db.insert("userCommunities", {
          userId: memberUserId,
          communityId,
          roles: COMMUNITY_ROLES.MEMBER,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        return { communityId, primaryAdminId, memberUserId };
      });

      // Generate a token for the primary admin
      const { accessToken } = await generateTokens(setup.primaryAdminId);

      // PRIMARY_ADMIN promotes member to PRIMARY_ADMIN - should succeed
      const result = await t.mutation(api.functions.communities.updateMemberRole, {
        token: accessToken,
        communityId: setup.communityId,
        targetUserId: setup.memberUserId,
        roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
      });

      expect(result).toBe(true);

      // Verify the role was updated
      await t.run(async (ctx) => {
        const membership = await ctx.db
          .query("userCommunities")
          .withIndex("by_user_community", (q) =>
            q.eq("userId", setup.memberUserId).eq("communityId", setup.communityId)
          )
          .first();

        expect(membership).not.toBeNull();
        expect(membership!.roles).toBe(COMMUNITY_ROLES.PRIMARY_ADMIN);
      });
    });

    /**
     * POSITIVE TEST:
     * PRIMARY_ADMIN should be able to promote members to ADMIN.
     */
    test("PRIMARY_ADMIN can promote member to ADMIN", async () => {
      const t = convexTest(schema, modules);

      const setup = await t.run(async (ctx) => {
        const communityId = await ctx.db.insert("communities", {
          name: "Test Community",
          slug: "test-community",
          isPublic: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const primaryAdminId = await ctx.db.insert("users", {
          firstName: "Primary",
          lastName: "Admin",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const memberUserId = await ctx.db.insert("users", {
          firstName: "Member",
          lastName: "User",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Primary Admin with role 4
        await ctx.db.insert("userCommunities", {
          userId: primaryAdminId,
          communityId,
          roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Member with role 1
        await ctx.db.insert("userCommunities", {
          userId: memberUserId,
          communityId,
          roles: COMMUNITY_ROLES.MEMBER,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        return { communityId, primaryAdminId, memberUserId };
      });

      // Generate a token for the primary admin
      const { accessToken } = await generateTokens(setup.primaryAdminId);

      // PRIMARY_ADMIN promotes member to ADMIN - should succeed
      const result = await t.mutation(api.functions.communities.updateMemberRole, {
        token: accessToken,
        communityId: setup.communityId,
        targetUserId: setup.memberUserId,
        roles: COMMUNITY_ROLES.ADMIN,
      });

      expect(result).toBe(true);

      // Verify the role was updated
      await t.run(async (ctx) => {
        const membership = await ctx.db
          .query("userCommunities")
          .withIndex("by_user_community", (q) =>
            q.eq("userId", setup.memberUserId).eq("communityId", setup.communityId)
          )
          .first();

        expect(membership).not.toBeNull();
        expect(membership!.roles).toBe(COMMUNITY_ROLES.ADMIN);
      });
    });
  });
});

// ============================================================================
// ATTACK SCENARIO TESTS
// ============================================================================

describe("SECURITY: Attack Scenario Prevention", () => {
  describe("Attack Prevention: Admin Takeover", () => {
    /**
     * ATTACK SCENARIO:
     * 1. Attacker becomes ADMIN through normal means (or is a rogue admin)
     * 2. Attacker tries to promote themselves to PRIMARY_ADMIN
     * 3. If successful, attacker would demote the legitimate PRIMARY_ADMIN
     *
     * This test verifies step 2 is blocked.
     */
    test("rogue admin cannot take over community by self-promotion", async () => {
      const t = convexTest(schema, modules);

      const setup = await t.run(async (ctx) => {
        const communityId = await ctx.db.insert("communities", {
          name: "Test Community",
          slug: "test-community",
          isPublic: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const rogueAdminId = await ctx.db.insert("users", {
          firstName: "Rogue",
          lastName: "Admin",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Rogue Admin with role 3
        await ctx.db.insert("userCommunities", {
          userId: rogueAdminId,
          communityId,
          roles: COMMUNITY_ROLES.ADMIN,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        return { communityId, rogueAdminId };
      });

      // Generate a token for the rogue admin
      const { accessToken } = await generateTokens(setup.rogueAdminId);

      // Rogue admin tries to promote themselves - should be blocked
      await expect(
        t.mutation(api.functions.communities.updateMemberRole, {
          token: accessToken,
          communityId: setup.communityId,
          targetUserId: setup.rogueAdminId,
          roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
        })
      ).rejects.toThrow("Cannot promote yourself to primary admin");
    });
  });

  describe("Attack Prevention: Privilege Escalation Chain", () => {
    /**
     * ATTACK SCENARIO:
     * ADMIN A promotes ADMIN B (or any user) to PRIMARY_ADMIN,
     * creating an unauthorized PRIMARY_ADMIN.
     *
     * This test verifies this escalation is blocked.
     */
    test("ADMIN cannot create unauthorized PRIMARY_ADMIN", async () => {
      const t = convexTest(schema, modules);

      const setup = await t.run(async (ctx) => {
        const communityId = await ctx.db.insert("communities", {
          name: "Test Community",
          slug: "test-community",
          isPublic: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const adminUserId = await ctx.db.insert("users", {
          firstName: "Admin",
          lastName: "User",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const otherAdminId = await ctx.db.insert("users", {
          firstName: "Other",
          lastName: "Admin",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Admin with role 3
        await ctx.db.insert("userCommunities", {
          userId: adminUserId,
          communityId,
          roles: COMMUNITY_ROLES.ADMIN,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Another Admin with role 3
        await ctx.db.insert("userCommunities", {
          userId: otherAdminId,
          communityId,
          roles: COMMUNITY_ROLES.ADMIN,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        return { communityId, adminUserId, otherAdminId };
      });

      // Generate a token for the first admin
      const { accessToken } = await generateTokens(setup.adminUserId);

      // ADMIN tries to promote another ADMIN to PRIMARY_ADMIN - should fail
      await expect(
        t.mutation(api.functions.communities.updateMemberRole, {
          token: accessToken,
          communityId: setup.communityId,
          targetUserId: setup.otherAdminId,
          roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
        })
      ).rejects.toThrow("Only primary admin can promote to primary admin");
    });
  });

  describe("Comparison: admin.ts parity", () => {
    /**
     * DOCUMENTATION TEST:
     * Verifies that communities.ts has the same PRIMARY_ADMIN protection as admin.ts.
     *
     * admin.ts properly checks:
     * - if (currentRole === COMMUNITY_ROLES.PRIMARY_ADMIN) throw "Cannot modify Primary Admin role"
     * - requirePrimaryAdmin() for admin-level changes
     *
     * communities.ts should have equivalent protection.
     */
    test("communities.ts has same PRIMARY_ADMIN protection as admin.ts", async () => {
      const t = convexTest(schema, modules);

      const setup = await t.run(async (ctx) => {
        const communityId = await ctx.db.insert("communities", {
          name: "Test Community",
          slug: "test-community",
          isPublic: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const primaryAdminId = await ctx.db.insert("users", {
          firstName: "Primary",
          lastName: "Admin",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const adminUserId = await ctx.db.insert("users", {
          firstName: "Admin",
          lastName: "User",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Primary Admin with role 4
        await ctx.db.insert("userCommunities", {
          userId: primaryAdminId,
          communityId,
          roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Admin with role 3
        await ctx.db.insert("userCommunities", {
          userId: adminUserId,
          communityId,
          roles: COMMUNITY_ROLES.ADMIN,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        return { communityId, primaryAdminId, adminUserId };
      });

      // Generate a token for the regular admin
      const { accessToken } = await generateTokens(setup.adminUserId);

      // ADMIN tries to demote PRIMARY_ADMIN - should fail with proper error message
      await expect(
        t.mutation(api.functions.communities.updateMemberRole, {
          token: accessToken,
          communityId: setup.communityId,
          targetUserId: setup.primaryAdminId,
          roles: COMMUNITY_ROLES.ADMIN,
        })
      ).rejects.toThrow("Cannot modify Primary Admin role");
    });

    test("communities.ts requires PRIMARY_ADMIN for admin-level promotions", async () => {
      const t = convexTest(schema, modules);

      const setup = await t.run(async (ctx) => {
        const communityId = await ctx.db.insert("communities", {
          name: "Test Community",
          slug: "test-community",
          isPublic: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const adminUserId = await ctx.db.insert("users", {
          firstName: "Admin",
          lastName: "User",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const memberUserId = await ctx.db.insert("users", {
          firstName: "Member",
          lastName: "User",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Admin with role 3
        await ctx.db.insert("userCommunities", {
          userId: adminUserId,
          communityId,
          roles: COMMUNITY_ROLES.ADMIN,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Member with role 1
        await ctx.db.insert("userCommunities", {
          userId: memberUserId,
          communityId,
          roles: COMMUNITY_ROLES.MEMBER,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        return { communityId, adminUserId, memberUserId };
      });

      // Generate a token for the admin
      const { accessToken } = await generateTokens(setup.adminUserId);

      // ADMIN tries to promote member to PRIMARY_ADMIN - should require PRIMARY_ADMIN caller
      await expect(
        t.mutation(api.functions.communities.updateMemberRole, {
          token: accessToken,
          communityId: setup.communityId,
          targetUserId: setup.memberUserId,
          roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
        })
      ).rejects.toThrow("Only primary admin can promote to primary admin");
    });
  });
});
