/**
 * Tests for filter-based PCO Services rotation
 *
 * Tests the syncAutoChannel action with the new filter-based config structure.
 * These tests focus on the filter application logic rather than the full
 * sync flow (which is tested in rotation.test.ts).
 */

import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { mockTimestamp } from "./fixtures";

// We'll test the helper functions and the filter application logic
// The actual syncAutoChannel requires mocking the PCO API, so we test
// the helper functions directly and test the sync flow indirectly

describe("Filter-based PCO Services Rotation", () => {
  let t: ReturnType<typeof convexTest>;
  let communityId: Id<"communities">;
  let groupId: Id<"groups">;
  let channelId: Id<"chatChannels">;
  let userId: Id<"users">;
  let createdById: Id<"users">;

  beforeEach(async () => {
    t = convexTest(schema, modules);

    // Setup: Create community, channel, and test user
    ({ communityId, groupId, channelId, userId, createdById } = await t.run(
      async (ctx) => {
        const communityId = await ctx.db.insert("communities", {
          name: "Test Community",
          slug: "test",
          isPublic: true,
        });

        const createdById = await ctx.db.insert("users", {
          firstName: "Test",
          lastName: "Creator",
          email: "creator@example.com",
          isActive: true,
          roles: 1,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });

        const groupTypeId = await ctx.db.insert("groupTypes", {
          communityId,
          name: "Default Group Type",
          slug: "default",
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

        const channelId = await ctx.db.insert("chatChannels", {
          groupId,
          name: "Multi-Service Channel",
          description: "Tests filter-based sync",
          channelType: "pco_services",
          memberCount: 0,
          isArchived: false,
          createdById,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });

        const userId = await ctx.db.insert("users", {
          firstName: "Test",
          lastName: "User",
          email: "test@example.com",
          phone: "2025550123",
          isActive: true,
          roles: 1,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });

        // Add user to the group (required for channel membership)
        await ctx.db.insert("groupMembers", {
          groupId,
          userId,
          role: "member",
          joinedAt: mockTimestamp(),
          notificationsEnabled: true,
        });

        return { communityId, groupId, channelId, userId, createdById };
      }
    ));
  });

  describe("Filter-based config structure", () => {
    it("accepts config with filters instead of syncScope", async () => {
      const configId = await t.run(async (ctx) => {
        return await ctx.db.insert("autoChannelConfigs", {
          communityId,
          channelId,
          integrationType: "pco_services",
          config: {
            filters: {
              serviceTypeIds: ["st-1", "st-2"],
              teamIds: ["team-1"],
              positions: ["Director"],
              statuses: ["C"],
            },
            addMembersDaysBefore: 5,
            removeMembersDaysAfter: 1,
          },
          isActive: true,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      const config = await t.query(
        internal.functions.pcoServices.rotation.getAutoChannelConfigById,
        { configId }
      );

      expect(config).not.toBeNull();
      expect(config?.config.filters).toBeDefined();
      expect(config?.config.filters?.serviceTypeIds).toEqual(["st-1", "st-2"]);
      expect(config?.config.filters?.teamIds).toEqual(["team-1"]);
      expect(config?.config.filters?.positions).toEqual(["Director"]);
      expect(config?.config.filters?.statuses).toEqual(["C"]);
    });

    it("accepts config with serviceTypeNames instead of IDs", async () => {
      const configId = await t.run(async (ctx) => {
        return await ctx.db.insert("autoChannelConfigs", {
          communityId,
          channelId,
          integrationType: "pco_services",
          config: {
            filters: {
              serviceTypeNames: ["Sunday Service", "Wednesday Service"],
              teamNames: ["Worship Band", "Production"],
            },
            addMembersDaysBefore: 5,
            removeMembersDaysAfter: 1,
          },
          isActive: true,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      const config = await t.query(
        internal.functions.pcoServices.rotation.getAutoChannelConfigById,
        { configId }
      );

      expect(config?.config.filters?.serviceTypeNames).toEqual([
        "Sunday Service",
        "Wednesday Service",
      ]);
      expect(config?.config.filters?.teamNames).toEqual([
        "Worship Band",
        "Production",
      ]);
    });

    it("handles empty filters object (sync all)", async () => {
      const configId = await t.run(async (ctx) => {
        return await ctx.db.insert("autoChannelConfigs", {
          communityId,
          channelId,
          integrationType: "pco_services",
          config: {
            filters: {},
            addMembersDaysBefore: 5,
            removeMembersDaysAfter: 1,
          },
          isActive: true,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      const config = await t.query(
        internal.functions.pcoServices.rotation.getAutoChannelConfigById,
        { configId }
      );

      expect(config?.config.filters).toEqual({});
    });
  });

  describe("multi-service-type config", () => {
    it("stores multiple service type IDs in filters", async () => {
      const configId = await t.run(async (ctx) => {
        return await ctx.db.insert("autoChannelConfigs", {
          communityId,
          channelId,
          integrationType: "pco_services",
          config: {
            filters: {
              serviceTypeIds: ["st-1", "st-2"],
              serviceTypeNames: ["Sunday Service", "Wednesday Service"],
            },
            addMembersDaysBefore: 5,
            removeMembersDaysAfter: 1,
          },
          isActive: true,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      const config = await t.query(
        internal.functions.pcoServices.rotation.getAutoChannelConfigById,
        { configId }
      );

      expect(config?.config.filters?.serviceTypeIds).toHaveLength(2);
      expect(config?.config.filters?.serviceTypeIds?.[0]).toBe("st-1");
      expect(config?.config.filters?.serviceTypeIds?.[1]).toBe("st-2");
      expect(config?.config.filters?.serviceTypeNames).toHaveLength(2);
    });
  });

  describe("syncAutoChannel with filter-based config", () => {
    it("skips sync when no service types in filters", async () => {
      const configId = await t.run(async (ctx) => {
        return await ctx.db.insert("autoChannelConfigs", {
          communityId,
          channelId,
          integrationType: "pco_services",
          config: {
            filters: {
              // No serviceTypeIds or serviceTypeNames
              teamIds: ["team-1"],
            },
            addMembersDaysBefore: 5,
            removeMembersDaysAfter: 1,
          },
          isActive: true,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      const result = await t.action(
        internal.functions.pcoServices.rotation.syncAutoChannel,
        { configId }
      );

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("service type");
    });

    it("handles config without filters (uses serviceTypeId for backwards compat check)", async () => {
      const configId = await t.run(async (ctx) => {
        return await ctx.db.insert("autoChannelConfigs", {
          communityId,
          channelId,
          integrationType: "pco_services",
          config: {
            // No filters - should check for serviceTypeId
            addMembersDaysBefore: 5,
            removeMembersDaysAfter: 1,
          },
          isActive: true,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      const result = await t.action(
        internal.functions.pcoServices.rotation.syncAutoChannel,
        { configId }
      );

      // Should skip because no service type is configured
      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("service type");
    });
  });

  describe("Member deduplication across services", () => {
    it("uses latest scheduledRemovalAt when member appears in multiple services", async () => {
      // This test validates the deduplication logic at the database level
      // When the same person is added twice, the later removal date should be kept

      const now = mockTimestamp();
      const firstRemovalAt = now + 3 * 24 * 60 * 60 * 1000;
      const secondRemovalAt = now + 7 * 24 * 60 * 60 * 1000;

      // Add user first time with earlier removal date
      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-1", // From service type 1
          scheduledRemovalAt: firstRemovalAt,
          syncMetadata: {
            teamName: "Band",
            position: "Drums",
            serviceDate: now + 3 * 24 * 60 * 60 * 1000,
            serviceName: "Sunday Service",
          },
        }
      );

      // Add user second time with later removal date (from different service)
      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-2", // From service type 2
          scheduledRemovalAt: secondRemovalAt,
          syncMetadata: {
            teamName: "Vocals",
            position: "Lead",
            serviceDate: now + 7 * 24 * 60 * 60 * 1000,
            serviceName: "Wednesday Service",
          },
        }
      );

      // Verify the member has the later removal date
      const member = await t.run(async (ctx) => {
        return await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId)
          )
          .unique();
      });

      expect(member?.scheduledRemovalAt).toBe(secondRemovalAt);
    });

    it("keeps later removal date even if added in reverse order", async () => {
      const now = mockTimestamp();
      const laterRemovalAt = now + 10 * 24 * 60 * 60 * 1000;
      const earlierRemovalAt = now + 3 * 24 * 60 * 60 * 1000;

      // Add with later date first
      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-later",
          scheduledRemovalAt: laterRemovalAt,
        }
      );

      // Add with earlier date second - should NOT override the later date
      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-earlier",
          scheduledRemovalAt: earlierRemovalAt,
        }
      );

      const member = await t.run(async (ctx) => {
        return await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId)
          )
          .unique();
      });

      // Should keep the later date
      expect(member?.scheduledRemovalAt).toBe(laterRemovalAt);
    });
  });
});
