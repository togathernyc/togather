/**
 * Tests for rotation.ts
 *
 * Unit tests for Planning Center Services auto channel rotation logic.
 * Tests the functions that manage channel membership based on service schedules,
 * including member addition, expiration, and synchronization.
 */

import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { mockTimestamp } from "./fixtures";

describe("PCO Services Rotation", () => {
  let t: ReturnType<typeof convexTest>;
  let communityId: Id<"communities">;
  let groupId: Id<"groups">;
  let channelId: Id<"chatChannels">;
  let configId: Id<"autoChannelConfigs">;
  let userId: Id<"users">;
  let createdById: Id<"users">;

  beforeEach(async () => {
    t = convexTest(schema, modules);

    // Setup: Create community, channel, config, and test user
    ({ communityId, groupId, channelId, configId, userId, createdById } = await t.run(
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
          name: "Sunday Service",
          description: "Sunday service coordination",
          channelType: "pco_services",
          memberCount: 0,
          isArchived: false,
          createdById,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });

        const configId = await ctx.db.insert("autoChannelConfigs", {
          communityId,
          channelId,
          integrationType: "pco_services",
          config: {
            serviceTypeId: "service-type-123",
            serviceTypeName: "Sunday Service",
            syncScope: "all_teams",
            addMembersDaysBefore: 5,
            removeMembersDaysAfter: 1,
          },
          isActive: true,
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

        return { communityId, groupId, channelId, configId, userId, createdById };
      }
    ));
  });

  describe("getActiveAutoChannelConfigs query", () => {
    it("returns all active PCO Services configs", async () => {
      // Create another active config with proper groupId
      const newGroupId = await t.run(async (ctx) => {
        return await ctx.db.insert("groups", {
          communityId,
          groupTypeId: await ctx.db
            .query("groupTypes")
            .withIndex("by_community", (q) => q.eq("communityId", communityId))
            .first()
            .then((gt) => gt?._id!),
          name: "Another Test Group",
          isArchived: false,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      await t.run(async (ctx) => {
        const channelId2 = await ctx.db.insert("chatChannels", {
          groupId: newGroupId,
          name: "Wednesday Service",
          channelType: "pco_services",
          memberCount: 0,
          isArchived: false,
          createdById,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });

        await ctx.db.insert("autoChannelConfigs", {
          communityId,
          channelId: channelId2,
          integrationType: "pco_services",
          config: {
            serviceTypeId: "service-type-456",
            serviceTypeName: "Wednesday Service",
            syncScope: "all_teams",
            addMembersDaysBefore: 3,
            removeMembersDaysAfter: 1,
          },
          isActive: true,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      const configs = await t.query(
        internal.functions.pcoServices.rotation.getActiveAutoChannelConfigs,
        {}
      );

      expect(configs.length).toBeGreaterThanOrEqual(2);
      expect(configs.every((c) => c.isActive)).toBe(true);
      expect(configs.every((c) => c.integrationType === "pco_services")).toBe(true);
    });

    it("excludes inactive configs", async () => {
      await t.run(async (ctx) => {
        await ctx.db.patch(configId, {
          isActive: false,
        });
      });

      const configs = await t.query(
        internal.functions.pcoServices.rotation.getActiveAutoChannelConfigs,
        {}
      );

      const foundConfig = configs.find((c) => c._id === configId);
      expect(foundConfig).toBeUndefined();
    });

    it("excludes non-PCO Services configs", async () => {
      const newGroupId = await t.run(async (ctx) => {
        return await ctx.db.insert("groups", {
          communityId,
          groupTypeId: await ctx.db
            .query("groupTypes")
            .withIndex("by_community", (q) => q.eq("communityId", communityId))
            .first()
            .then((gt) => gt?._id!),
          name: "Elvanto Group",
          isArchived: false,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      await t.run(async (ctx) => {
        const channelId2 = await ctx.db.insert("chatChannels", {
          groupId: newGroupId,
          name: "Elvanto Service",
          channelType: "custom",
          memberCount: 0,
          isArchived: false,
          createdById,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });

        await ctx.db.insert("autoChannelConfigs", {
          communityId,
          channelId: channelId2,
          integrationType: "elvanto",
          config: {
            addMembersDaysBefore: 3,
            removeMembersDaysAfter: 1,
          },
          isActive: true,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      const configs = await t.query(
        internal.functions.pcoServices.rotation.getActiveAutoChannelConfigs,
        {}
      );

      expect(configs.every((c) => c.integrationType === "pco_services")).toBe(true);
    });
  });

  describe("getAutoChannelConfig query", () => {
    it("returns config for specified channel", async () => {
      const config = await t.query(
        internal.functions.pcoServices.rotation.getAutoChannelConfig,
        { channelId }
      );

      expect(config).not.toBeNull();
      expect(config?._id).toBe(configId);
      expect(config?.channelId).toBe(channelId);
    });

    it("returns null for channel with no config", async () => {
      const channelWithoutConfig = await t.run(async (ctx) => {
        return await ctx.db.insert("chatChannels", {
          groupId,
          name: "No Config Channel",
          channelType: "custom",
          memberCount: 0,
          isArchived: false,
          createdById,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      const config = await t.query(
        internal.functions.pcoServices.rotation.getAutoChannelConfig,
        { channelId: channelWithoutConfig }
      );

      expect(config).toBeNull();
    });
  });

  describe("getAutoChannelConfigById query", () => {
    it("returns config by ID", async () => {
      const config = await t.query(
        internal.functions.pcoServices.rotation.getAutoChannelConfigById,
        { configId }
      );

      expect(config).not.toBeNull();
      expect(config?._id).toBe(configId);
      expect(config?.integrationType).toBe("pco_services");
    });

    it("returns null for non-existent config", async () => {
      // Create a config to get a valid ID format, then try to fetch a different one
      const tempChannelId = await t.run(async (ctx) => {
        const gId = await ctx.db
          .query("groups")
          .withIndex("by_community", (q) => q.eq("communityId", communityId))
          .first()
          .then((g) => g?._id!);

        return await ctx.db.insert("chatChannels", {
          groupId: gId,
          name: "Temp",
          channelType: "custom",
          memberCount: 0,
          isArchived: false,
          createdById,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      const tempConfigId = await t.run(async (ctx) => {
        return await ctx.db.insert("autoChannelConfigs", {
          communityId,
          channelId: tempChannelId,
          integrationType: "pco_services",
          config: {
            serviceTypeId: "temp",
            syncScope: "all_teams",
            addMembersDaysBefore: 1,
            removeMembersDaysAfter: 1,
          },
          isActive: true,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      // Delete it so we can query for a non-existent config
      await t.run(async (ctx) => {
        await ctx.db.delete(tempConfigId);
      });

      // Now try to fetch the deleted config
      const config = await t.query(
        internal.functions.pcoServices.rotation.getAutoChannelConfigById,
        { configId: tempConfigId }
      );

      expect(config).toBeNull();
    });
  });

  describe("addChannelMember mutation", () => {
    it("adds a new member to the channel", async () => {
      const now = mockTimestamp();
      const scheduledRemovalAt = now + 7 * 24 * 60 * 60 * 1000;

      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-123",
          scheduledRemovalAt,
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

      expect(member).not.toBeNull();
      expect(member?.role).toBe("member");
      expect(member?.syncSource).toBe("pco_services");
      expect(member?.syncEventId).toBe("plan-123");
      expect(member?.scheduledRemovalAt).toBe(scheduledRemovalAt);
    });

    it("rejects adding user who is not a group member", async () => {
      // Create a user who is NOT a member of the group
      const nonGroupUser = await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
          firstName: "NonGroup",
          lastName: "User",
          isActive: true,
          roles: 1,
        });
      });

      const result = await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId: nonGroupUser,
          syncEventId: "plan-123",
          scheduledRemovalAt: mockTimestamp(7),
        }
      );

      expect(result.success).toBe(false);
      expect(result.reason).toBe("not_in_group");

      // Verify user was NOT added to the channel
      const member = await t.run(async (ctx) => {
        return await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", nonGroupUser)
          )
          .unique();
      });
      expect(member).toBeNull();
    });

    it("updates existing member with new sync info", async () => {
      const now = mockTimestamp();
      const firstRemovalAt = now + 3 * 24 * 60 * 60 * 1000;
      const secondRemovalAt = now + 7 * 24 * 60 * 60 * 1000;

      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-123",
          scheduledRemovalAt: firstRemovalAt,
        }
      );

      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-124",
          scheduledRemovalAt: secondRemovalAt,
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

      expect(member?.scheduledRemovalAt).toBe(secondRemovalAt);
      expect(member?.syncEventId).toBe("plan-124");
    });

    it("uses maximum scheduled removal time when member added multiple times", async () => {
      const now = mockTimestamp();
      const time1 = now + 3 * 24 * 60 * 60 * 1000;
      const time2 = now + 7 * 24 * 60 * 60 * 1000;

      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-124",
          scheduledRemovalAt: time2,
        }
      );

      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-123",
          scheduledRemovalAt: time1,
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

      expect(member?.scheduledRemovalAt).toBe(time2);
    });

    it("increments channel memberCount when adding new member", async () => {
      const initialCount = await t.run(async (ctx) => {
        const channel = await ctx.db.get(channelId);
        return channel?.memberCount || 0;
      });

      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-123",
          scheduledRemovalAt: mockTimestamp(7),
        }
      );

      const updatedCount = await t.run(async (ctx) => {
        const channel = await ctx.db.get(channelId);
        return channel?.memberCount || 0;
      });

      expect(updatedCount).toBe(initialCount + 1);
    });
  });

  describe("removeExpiredMembers mutation", () => {
    it("removes members whose scheduled removal time has passed", async () => {
      const pastTime = mockTimestamp(-1);

      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-123",
          scheduledRemovalAt: pastTime,
        }
      );

      const result = await t.mutation(
        internal.functions.pcoServices.rotation.removeExpiredMembers,
        { channelId }
      );

      expect(result.removedCount).toBe(1);

      const member = await t.run(async (ctx) => {
        return await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId)
          )
          .unique();
      });

      // Verify soft delete: member still exists but has leftAt set
      expect(member).not.toBeNull();
      expect(member?.leftAt).toBeDefined();
      expect(member?.scheduledRemovalAt).toBeUndefined();
    });

    it("keeps members whose scheduled removal time hasn't passed yet", async () => {
      const futureTime = mockTimestamp(1);

      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-123",
          scheduledRemovalAt: futureTime,
        }
      );

      const result = await t.mutation(
        internal.functions.pcoServices.rotation.removeExpiredMembers,
        { channelId }
      );

      expect(result.removedCount).toBe(0);

      const member = await t.run(async (ctx) => {
        return await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId)
          )
          .unique();
      });

      expect(member).not.toBeNull();
    });

    it("only removes PCO-synced members", async () => {
      const pastTime = mockTimestamp(-1);

      await t.run(async (ctx) => {
        await ctx.db.insert("chatChannelMembers", {
          channelId,
          userId,
          role: "member",
          joinedAt: mockTimestamp(),
          isMuted: false,
          scheduledRemovalAt: pastTime,
        });
      });

      const result = await t.mutation(
        internal.functions.pcoServices.rotation.removeExpiredMembers,
        { channelId }
      );

      expect(result.removedCount).toBe(0);

      const member = await t.run(async (ctx) => {
        return await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId)
          )
          .unique();
      });

      expect(member).not.toBeNull();
    });

    it("removes multiple expired members at once", async () => {
      const pastTime = mockTimestamp(-1);

      const userIds = await t.run(async (ctx) => {
        const ids: Id<"users">[] = [];
        for (let i = 0; i < 3; i++) {
          const id = await ctx.db.insert("users", {
            firstName: `User${i}`,
            lastName: "Test",
            isActive: true,
            roles: 1,
          });
          // Add user to the group (required for channel membership)
          await ctx.db.insert("groupMembers", {
            groupId,
            userId: id,
            role: "member",
            joinedAt: Date.now(),
            notificationsEnabled: true,
          });
          ids.push(id);
        }
        return ids;
      });

      for (const uid of userIds) {
        await t.mutation(
          internal.functions.pcoServices.rotation.addChannelMember,
          {
            channelId,
            userId: uid,
            syncEventId: "plan-123",
            scheduledRemovalAt: pastTime,
          }
        );
      }

      const result = await t.mutation(
        internal.functions.pcoServices.rotation.removeExpiredMembers,
        { channelId }
      );

      expect(result.removedCount).toBe(3);
    });

    it("decrements channel memberCount when removing members", async () => {
      const pastTime = mockTimestamp(-1);

      const user2Id = await t.run(async (ctx) => {
        const id = await ctx.db.insert("users", {
          firstName: "User2",
          lastName: "Test",
          isActive: true,
          roles: 1,
        });
        // Add user to the group (required for channel membership)
        await ctx.db.insert("groupMembers", {
          groupId,
          userId: id,
          role: "member",
          joinedAt: Date.now(),
          notificationsEnabled: true,
        });
        return id;
      });

      for (const uid of [userId, user2Id]) {
        await t.mutation(
          internal.functions.pcoServices.rotation.addChannelMember,
          {
            channelId,
            userId: uid,
            syncEventId: "plan-123",
            scheduledRemovalAt: pastTime,
          }
        );
      }

      const countBefore = await t.run(async (ctx) => {
        const channel = await ctx.db.get(channelId);
        return channel?.memberCount || 0;
      });

      await t.mutation(
        internal.functions.pcoServices.rotation.removeExpiredMembers,
        { channelId }
      );

      const countAfter = await t.run(async (ctx) => {
        const channel = await ctx.db.get(channelId);
        return channel?.memberCount || 0;
      });

      expect(countAfter).toBe(countBefore - 2);
    });

    it("doesn't go below zero memberCount", async () => {
      const pastTime = mockTimestamp(-1);

      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-123",
          scheduledRemovalAt: pastTime,
        }
      );

      await t.run(async (ctx) => {
        await ctx.db.patch(channelId, {
          memberCount: 0,
        });
      });

      const result = await t.mutation(
        internal.functions.pcoServices.rotation.removeExpiredMembers,
        { channelId }
      );

      expect(result.removedCount).toBe(1);

      const countAfter = await t.run(async (ctx) => {
        const channel = await ctx.db.get(channelId);
        return channel?.memberCount || 0;
      });

      expect(countAfter).toBe(0);
    });
  });

  describe("removeStalePcoSyncedMembers mutation", () => {
    it("removes PCO-synced members not in the expected user set when their plan is being synced", async () => {
      const futureTime = mockTimestamp(1);

      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-123",
          scheduledRemovalAt: futureTime,
        }
      );

      const result = await t.mutation(
        internal.functions.pcoServices.rotation.removeStalePcoSyncedMembers,
        { channelId, expectedUserIds: [], syncedPlanIds: ["plan-123"] }
      );

      expect(result.removedCount).toBe(1);

      const member = await t.run(async (ctx) => {
        return await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId)
          )
          .unique();
      });

      expect(member?.leftAt).toBeDefined();
      expect(member?.scheduledRemovalAt).toBeUndefined();
    });

    it("keeps PCO-synced members who are in the expected user set", async () => {
      const futureTime = mockTimestamp(1);

      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-123",
          scheduledRemovalAt: futureTime,
        }
      );

      const result = await t.mutation(
        internal.functions.pcoServices.rotation.removeStalePcoSyncedMembers,
        { channelId, expectedUserIds: [userId], syncedPlanIds: ["plan-123"] }
      );

      expect(result.removedCount).toBe(0);

      const member = await t.run(async (ctx) => {
        return await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId)
          )
          .unique();
      });

      expect(member?.leftAt).toBeUndefined();
    });

    it("does not remove manually added members without syncSource", async () => {
      await t.run(async (ctx) => {
        await ctx.db.insert("chatChannelMembers", {
          channelId,
          userId,
          role: "member",
          joinedAt: mockTimestamp(),
          isMuted: false,
        });
      });

      const result = await t.mutation(
        internal.functions.pcoServices.rotation.removeStalePcoSyncedMembers,
        { channelId, expectedUserIds: [], syncedPlanIds: ["plan-123"] }
      );

      expect(result.removedCount).toBe(0);

      const member = await t.run(async (ctx) => {
        return await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId)
          )
          .unique();
      });

      expect(member?.leftAt).toBeUndefined();
    });

    it("does not remove members from a previous plan that is not being synced", async () => {
      const futureTime = mockTimestamp(1);

      // Add a member for plan-old (simulating someone added for last week's service)
      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-old",
          scheduledRemovalAt: futureTime, // Still has time before removal
        }
      );

      // Sync only includes plan-new (this week's service), not plan-old
      const result = await t.mutation(
        internal.functions.pcoServices.rotation.removeStalePcoSyncedMembers,
        { channelId, expectedUserIds: [], syncedPlanIds: ["plan-new"] }
      );

      // Should NOT remove the member because they were added for plan-old
      // which is not being synced - they should remain until scheduledRemovalAt
      expect(result.removedCount).toBe(0);

      const member = await t.run(async (ctx) => {
        return await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId)
          )
          .unique();
      });

      expect(member?.leftAt).toBeUndefined();
      expect(member?.scheduledRemovalAt).toBe(futureTime);
    });
  });

  describe("updateSyncStatus mutation", () => {
    it("updates sync status and timestamp", async () => {
      const beforeTime = Date.now();

      await t.mutation(
        internal.functions.pcoServices.rotation.updateSyncStatus,
        {
          configId,
          status: "success",
        }
      );

      const afterTime = Date.now();

      const config = await t.run(async (ctx) => {
        return await ctx.db.get(configId);
      });

      expect(config?.lastSyncStatus).toBe("success");
      expect(config?.lastSyncAt).toBeGreaterThanOrEqual(beforeTime);
      expect(config?.lastSyncAt).toBeLessThanOrEqual(afterTime);
    });

    it("records error message on sync failure", async () => {
      const errorMsg = "Test error: invalid config";

      await t.mutation(
        internal.functions.pcoServices.rotation.updateSyncStatus,
        {
          configId,
          status: "error",
          error: errorMsg,
        }
      );

      const config = await t.run(async (ctx) => {
        return await ctx.db.get(configId);
      });

      expect(config?.lastSyncStatus).toBe("error");
      expect(config?.lastSyncError).toBe(errorMsg);
    });

    it("records current event info when available", async () => {
      const planDate = mockTimestamp(3);

      await t.mutation(
        internal.functions.pcoServices.rotation.updateSyncStatus,
        {
          configId,
          status: "success",
          currentEventId: "plan-123",
          currentEventDate: planDate,
        }
      );

      const config = await t.run(async (ctx) => {
        return await ctx.db.get(configId);
      });

      expect(config?.currentEventId).toBe("plan-123");
      expect(config?.currentEventDate).toBe(planDate);
    });

    it("updates updatedAt timestamp", async () => {
      const beforeTime = Date.now();

      await t.mutation(
        internal.functions.pcoServices.rotation.updateSyncStatus,
        {
          configId,
          status: "success",
        }
      );

      const afterTime = Date.now();

      const config = await t.run(async (ctx) => {
        return await ctx.db.get(configId);
      });

      expect(config?.updatedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(config?.updatedAt).toBeLessThanOrEqual(afterTime);
    });
  });

  describe("syncAutoChannel action", () => {
    it("skips sync when config is not found", async () => {
      // Create then delete a config to get a valid ID that doesn't exist
      const tempChannelId = await t.run(async (ctx) => {
        const gId = await ctx.db
          .query("groups")
          .withIndex("by_community", (q) => q.eq("communityId", communityId))
          .first()
          .then((g) => g?._id!);

        return await ctx.db.insert("chatChannels", {
          groupId: gId,
          name: "Temp",
          channelType: "custom",
          memberCount: 0,
          isArchived: false,
          createdById,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      const tempConfigId = await t.run(async (ctx) => {
        return await ctx.db.insert("autoChannelConfigs", {
          communityId,
          channelId: tempChannelId,
          integrationType: "pco_services",
          config: {
            serviceTypeId: "temp",
            syncScope: "all_teams",
            addMembersDaysBefore: 1,
            removeMembersDaysAfter: 1,
          },
          isActive: true,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      await t.run(async (ctx) => {
        await ctx.db.delete(tempConfigId);
      });

      const result = await t.action(
        internal.functions.pcoServices.rotation.syncAutoChannel,
        {
          configId: tempConfigId,
        }
      );

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("not found");
    });

    it("skips sync when config is inactive", async () => {
      await t.run(async (ctx) => {
        await ctx.db.patch(configId, {
          isActive: false,
        });
      });

      const result = await t.action(
        internal.functions.pcoServices.rotation.syncAutoChannel,
        { configId }
      );

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("inactive");
    });

    it("skips sync when not a PCO Services config", async () => {
      const newGroupId = await t.run(async (ctx) => {
        return await ctx.db.insert("groups", {
          communityId,
          groupTypeId: await ctx.db
            .query("groupTypes")
            .withIndex("by_community", (q) => q.eq("communityId", communityId))
            .first()
            .then((gt) => gt?._id!),
          name: "Other Group",
          isArchived: false,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      const otherConfigId = await t.run(async (ctx) => {
        const chId = await ctx.db.insert("chatChannels", {
          groupId: newGroupId,
          name: "Other Channel",
          channelType: "custom",
          memberCount: 0,
          isArchived: false,
          createdById,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });

        return await ctx.db.insert("autoChannelConfigs", {
          communityId,
          channelId: chId,
          integrationType: "elvanto",
          config: {
            addMembersDaysBefore: 3,
            removeMembersDaysAfter: 1,
          },
          isActive: true,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      const result = await t.action(
        internal.functions.pcoServices.rotation.syncAutoChannel,
        { configId: otherConfigId }
      );

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("Not a PCO Services");
    });

    it("skips sync when no service type configured", async () => {
      const newGroupId = await t.run(async (ctx) => {
        return await ctx.db.insert("groups", {
          communityId,
          groupTypeId: await ctx.db
            .query("groupTypes")
            .withIndex("by_community", (q) => q.eq("communityId", communityId))
            .first()
            .then((gt) => gt?._id!),
          name: "No Service Group",
          isArchived: false,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });
      });

      const noServiceConfigId = await t.run(async (ctx) => {
        const chId = await ctx.db.insert("chatChannels", {
          groupId: newGroupId,
          name: "No Service Channel",
          channelType: "pco_services",
          memberCount: 0,
          isArchived: false,
          createdById,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });

        return await ctx.db.insert("autoChannelConfigs", {
          communityId,
          channelId: chId,
          integrationType: "pco_services",
          config: {
            syncScope: "all_teams",
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
        { configId: noServiceConfigId }
      );

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("service type");
    });
  });

  describe("processAllAutoChannels action", () => {
    it("processes all active PCO Services configs", async () => {
      const result = await t.action(
        internal.functions.pcoServices.rotation.processAllAutoChannels,
        {}
      );

      expect(result).toHaveProperty("processed");
      expect(result).toHaveProperty("results");
      expect(Array.isArray(result.results)).toBe(true);
    });
  });

  describe("removeNonMatchingMembers mutation", () => {
    it("removes PCO-synced members whose team no longer matches the filter", async () => {
      // Setup: Add a member with STAFF team metadata
      const futureTime = mockTimestamp(7); // Far in the future - not expired

      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-123",
          scheduledRemovalAt: futureTime,
          syncMetadata: {
            serviceTypeName: "MANHATTAN",
            teamName: "STAFF",
            position: "Production Director",
            serviceDate: futureTime,
            serviceName: "Sunday Service",
          },
        }
      );

      // Verify member was added
      const memberBefore = await t.run(async (ctx) => {
        return await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId)
          )
          .filter((q) => q.eq(q.field("leftAt"), undefined))
          .unique();
      });
      expect(memberBefore).not.toBeNull();
      expect(memberBefore?.syncMetadata?.teamName).toBe("STAFF");

      // Update the config to only include WORSHIP team (simulating filter change)
      await t.run(async (ctx) => {
        await ctx.db.patch(configId, {
          config: {
            serviceTypeId: "service-type-123",
            serviceTypeName: "Sunday Service",
            syncScope: "specific_teams",
            teamIds: ["team-worship"],
            teamNames: ["WORSHIP"],
            addMembersDaysBefore: 5,
            removeMembersDaysAfter: 1,
          },
        });
      });

      // Call removeNonMatchingMembers to clean up members who don't match new filters
      const result = await t.mutation(
        internal.functions.pcoServices.rotation.removeNonMatchingMembers,
        { channelId, configId }
      );

      expect(result.removedCount).toBe(1);

      // Verify member was removed (soft delete - leftAt set)
      const memberAfter = await t.run(async (ctx) => {
        return await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId)
          )
          .unique();
      });

      expect(memberAfter).not.toBeNull();
      expect(memberAfter?.leftAt).toBeDefined();
    });

    it("keeps PCO-synced members whose team matches the filter", async () => {
      const futureTime = mockTimestamp(7);

      // Add a member with WORSHIP team metadata (matches filter)
      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-123",
          scheduledRemovalAt: futureTime,
          syncMetadata: {
            serviceTypeName: "MANHATTAN",
            teamName: "WORSHIP",
            position: "Worship Leader",
            serviceDate: futureTime,
            serviceName: "Sunday Service",
          },
        }
      );

      // Config already filters for WORSHIP team
      await t.run(async (ctx) => {
        await ctx.db.patch(configId, {
          config: {
            serviceTypeId: "service-type-123",
            serviceTypeName: "Sunday Service",
            syncScope: "specific_teams",
            teamIds: ["team-worship"],
            teamNames: ["WORSHIP"],
            addMembersDaysBefore: 5,
            removeMembersDaysAfter: 1,
          },
        });
      });

      // Call removeNonMatchingMembers
      const result = await t.mutation(
        internal.functions.pcoServices.rotation.removeNonMatchingMembers,
        { channelId, configId }
      );

      expect(result.removedCount).toBe(0);

      // Verify member is still active
      const memberAfter = await t.run(async (ctx) => {
        return await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId)
          )
          .filter((q) => q.eq(q.field("leftAt"), undefined))
          .unique();
      });

      expect(memberAfter).not.toBeNull();
    });

    it("only removes PCO-synced members, not manually added members", async () => {
      const futureTime = mockTimestamp(7);

      // Add a manually-added member (no syncSource)
      await t.run(async (ctx) => {
        await ctx.db.insert("chatChannelMembers", {
          channelId,
          userId,
          role: "member",
          joinedAt: mockTimestamp(),
          isMuted: false,
          // No syncSource - manually added
        });
      });

      // Config filters for WORSHIP team
      await t.run(async (ctx) => {
        await ctx.db.patch(configId, {
          config: {
            serviceTypeId: "service-type-123",
            serviceTypeName: "Sunday Service",
            syncScope: "specific_teams",
            teamIds: ["team-worship"],
            teamNames: ["WORSHIP"],
            addMembersDaysBefore: 5,
            removeMembersDaysAfter: 1,
          },
        });
      });

      // Call removeNonMatchingMembers
      const result = await t.mutation(
        internal.functions.pcoServices.rotation.removeNonMatchingMembers,
        { channelId, configId }
      );

      // Should not remove manually added member
      expect(result.removedCount).toBe(0);

      // Verify member is still active
      const memberAfter = await t.run(async (ctx) => {
        return await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId)
          )
          .filter((q) => q.eq(q.field("leftAt"), undefined))
          .unique();
      });

      expect(memberAfter).not.toBeNull();
    });

    it("removes members when position filter no longer matches", async () => {
      const futureTime = mockTimestamp(7);

      // Add a member with "Production Director" position
      await t.mutation(
        internal.functions.pcoServices.rotation.addChannelMember,
        {
          channelId,
          userId,
          syncEventId: "plan-123",
          scheduledRemovalAt: futureTime,
          syncMetadata: {
            serviceTypeName: "MANHATTAN",
            teamName: "WORSHIP",
            position: "Production Director", // Doesn't match filter
            serviceDate: futureTime,
            serviceName: "Sunday Service",
          },
        }
      );

      // Config filters for specific positions
      await t.run(async (ctx) => {
        await ctx.db.patch(configId, {
          config: {
            serviceTypeId: "service-type-123",
            serviceTypeName: "Sunday Service",
            syncScope: "specific_teams",
            teamIds: ["team-worship"],
            teamNames: ["WORSHIP"],
            filters: {
              positions: ["Worship Leader", "Keys", "Drums"], // Production Director not included
            },
            addMembersDaysBefore: 5,
            removeMembersDaysAfter: 1,
          },
        });
      });

      // Call removeNonMatchingMembers
      const result = await t.mutation(
        internal.functions.pcoServices.rotation.removeNonMatchingMembers,
        { channelId, configId }
      );

      expect(result.removedCount).toBe(1);

      // Verify member was removed
      const memberAfter = await t.run(async (ctx) => {
        return await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId)
          )
          .unique();
      });

      expect(memberAfter?.leftAt).toBeDefined();
    });
  });
});
