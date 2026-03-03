/**
 * Tests for matching.ts
 *
 * Unit tests for Planning Center Services person matching and linking logic.
 * Tests the functions that match PCO people to Together users by phone or email,
 * and manage the linking in userCommunities.externalIds.
 */

import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import {
  findTogetherUserByContact,
  findUserByPcoPersonId,
} from "../../functions/pcoServices/matching";
import {
  createMockCommunity,
  createMockUser,
  createMockUserCommunity,
  mockTimestamp,
} from "./fixtures";

describe("PCO Services Matching", () => {
  let t: ReturnType<typeof convexTest>;
  let communityId: Id<"communities">;
  let user1Id: Id<"users">;
  let user2Id: Id<"users">;
  let uc1Id: Id<"userCommunities">;
  let uc2Id: Id<"userCommunities">;

  beforeEach(async () => {
    t = convexTest(schema, modules);

    // Setup: Create community and users
    ({ communityId, user1Id, user2Id, uc1Id, uc2Id } = await t.run(
      async (ctx) => {
        const communityId = await ctx.db.insert("communities", {
          name: "Test Community",
          slug: "test",
          isPublic: true,
        });

        const user1Id = await ctx.db.insert("users", {
          firstName: "John",
          lastName: "Doe",
          email: "john.doe@example.com",
          phone: "2025550123",
          phoneVerified: true,
          isActive: true,
          roles: 1,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });

        const user2Id = await ctx.db.insert("users", {
          firstName: "Jane",
          lastName: "Smith",
          email: "jane.smith@example.com",
          phone: "2025550124",
          phoneVerified: true,
          isActive: true,
          roles: 1,
          createdAt: mockTimestamp(),
          updatedAt: mockTimestamp(),
        });

        const uc1Id = await ctx.db.insert("userCommunities", {
          userId: user1Id,
          communityId,
          roles: 1,
          status: 1,
          createdAt: mockTimestamp(),
        });

        const uc2Id = await ctx.db.insert("userCommunities", {
          userId: user2Id,
          communityId,
          roles: 1,
          status: 1,
          createdAt: mockTimestamp(),
        });

        return { communityId, user1Id, user2Id, uc1Id, uc2Id };
      }
    ));
  });

  describe("findTogetherUserByContact", () => {
    it("finds user by exact phone match", async () => {
      const result = await t.run(async (ctx) => {
        return await findTogetherUserByContact(
          ctx,
          communityId,
          "2025550123", // John's phone
          null
        );
      });

      expect(result).toBe(user1Id);
    });

    it("finds user by phone with different formatting", async () => {
      const result = await t.run(async (ctx) => {
        return await findTogetherUserByContact(
          ctx,
          communityId,
          "(202) 555-0123", // Same as John's but formatted
          null
        );
      });

      expect(result).toBe(user1Id);
    });

    it("finds user by email match", async () => {
      const result = await t.run(async (ctx) => {
        return await findTogetherUserByContact(
          ctx,
          communityId,
          null,
          "john.doe@example.com"
        );
      });

      expect(result).toBe(user1Id);
    });

    it("finds user by email with case-insensitive match", async () => {
      const result = await t.run(async (ctx) => {
        return await findTogetherUserByContact(
          ctx,
          communityId,
          null,
          "JOHN.DOE@EXAMPLE.COM"
        );
      });

      expect(result).toBe(user1Id);
    });

    it("prefers phone match when both phone and email provided", async () => {
      // Provide John's phone but Jane's email - should return John
      const result = await t.run(async (ctx) => {
        return await findTogetherUserByContact(
          ctx,
          communityId,
          "2025550123", // John's phone
          "jane.smith@example.com" // Jane's email
        );
      });

      expect(result).toBe(user1Id);
    });

    it("returns null when no contact info provided", async () => {
      const result = await t.run(async (ctx) => {
        return await findTogetherUserByContact(ctx, communityId, null, null);
      });

      expect(result).toBeNull();
    });

    it("returns null when contact info doesn't match any user", async () => {
      const result = await t.run(async (ctx) => {
        return await findTogetherUserByContact(
          ctx,
          communityId,
          "9999999999",
          "nobody@example.com"
        );
      });

      expect(result).toBeNull();
    });

    it("returns null for phone match in different community", async () => {
      // Create another community
      const otherCommunityId = await t.run(async (ctx) => {
        return await ctx.db.insert("communities", {
          name: "Other Community",
          slug: "other",
          isPublic: true,
        });
      });

      const result = await t.run(async (ctx) => {
        return await findTogetherUserByContact(
          ctx,
          otherCommunityId,
          "2025550123",
          null
        );
      });

      expect(result).toBeNull();
    });

    it("handles users with no phone", async () => {
      // Create user without phone
      const userNoPhone = await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
          firstName: "NoPhone",
          lastName: "User",
          email: "nophone@example.com",
          isActive: true,
          roles: 1,
        });
      });

      await t.run(async (ctx) => {
        await ctx.db.insert("userCommunities", {
          userId: userNoPhone,
          communityId,
          roles: 1,
          status: 1,
          createdAt: mockTimestamp(),
        });
      });

      // Should still find by email
      const result = await t.run(async (ctx) => {
        return await findTogetherUserByContact(
          ctx,
          communityId,
          null,
          "nophone@example.com"
        );
      });

      expect(result).toBe(userNoPhone);
    });

    it("handles users with no email", async () => {
      // Create user without email
      const userNoEmail = await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
          firstName: "NoEmail",
          lastName: "User",
          phone: "2025550199",
          phoneVerified: true,
          isActive: true,
          roles: 1,
        });
      });

      await t.run(async (ctx) => {
        await ctx.db.insert("userCommunities", {
          userId: userNoEmail,
          communityId,
          roles: 1,
          status: 1,
          createdAt: mockTimestamp(),
        });
      });

      // Should still find by phone
      const result = await t.run(async (ctx) => {
        return await findTogetherUserByContact(
          ctx,
          communityId,
          "2025550199",
          null
        );
      });

      expect(result).toBe(userNoEmail);
    });
  });

  describe("findUserByPcoPersonId", () => {
    it("finds user by linked PCO person ID", async () => {
      // Link user1 to a PCO person
      await t.run(async (ctx) => {
        await ctx.db.patch(uc1Id, {
          pcoPersonId: "pco-person-123",
          externalIds: {
            planningCenterId: "pco-person-123",
          },
        });
      });

      const result = await t.run(async (ctx) => {
        return await findUserByPcoPersonId(ctx, communityId, "pco-person-123");
      });

      expect(result).toBe(user1Id);
    });

    it("returns null when PCO person ID not linked", async () => {
      const result = await t.run(async (ctx) => {
        return await findUserByPcoPersonId(
          ctx,
          communityId,
          "unknown-pco-id"
        );
      });

      expect(result).toBeNull();
    });

    it("searches only within specified community", async () => {
      // Create another community with a user with same PCO ID
      const otherCommunityId = await t.run(async (ctx) => {
        const id = await ctx.db.insert("communities", {
          name: "Other Community",
          slug: "other",
          isPublic: true,
        });
        return id;
      });

      await t.run(async (ctx) => {
        const otherUserId = await ctx.db.insert("users", {
          firstName: "Other",
          lastName: "User",
          isActive: true,
          roles: 1,
        });

        const ucId = await ctx.db.insert("userCommunities", {
          userId: otherUserId,
          communityId: otherCommunityId,
          roles: 1,
          status: 1,
          createdAt: mockTimestamp(),
        });

        await ctx.db.patch(ucId, {
          pcoPersonId: "pco-person-456",
          externalIds: {
            planningCenterId: "pco-person-456",
          },
        });
      });

      // Link user1 in first community
      await t.run(async (ctx) => {
        await ctx.db.patch(uc1Id, {
          pcoPersonId: "pco-person-456",
          externalIds: {
            planningCenterId: "pco-person-456",
          },
        });
      });

      // Search in first community should find user1
      const resultCommunity1 = await t.run(async (ctx) => {
        return await findUserByPcoPersonId(
          ctx,
          communityId,
          "pco-person-456"
        );
      });
      expect(resultCommunity1).toBe(user1Id);

      // Search in second community should find the other user
      const resultCommunity2 = await t.run(async (ctx) => {
        return await findUserByPcoPersonId(
          ctx,
          otherCommunityId,
          "pco-person-456"
        );
      });
      expect(resultCommunity2).not.toBe(user1Id);
    });

    it("returns null when externalIds is not set", async () => {
      // Don't set externalIds at all
      const result = await t.run(async (ctx) => {
        return await findUserByPcoPersonId(ctx, communityId, "any-id");
      });

      expect(result).toBeNull();
    });

    it("returns null when planningCenterId is not set", async () => {
      // Don't set any externalIds
      // uc1 is created with empty externalIds by default

      const result = await t.run(async (ctx) => {
        return await findUserByPcoPersonId(ctx, communityId, "pco-person-123");
      });

      expect(result).toBeNull();
    });
  });

  describe("linkUserToPcoPerson mutation", () => {
    it("links a user to a PCO person ID", async () => {
      await t.mutation(
        internal.functions.pcoServices.matching.linkUserToPcoPerson,
        {
          communityId,
          userId: user1Id,
          pcoPersonId: "pco-person-123",
        }
      );

      // Verify the link was created
      const result = await t.run(async (ctx) => {
        return await findUserByPcoPersonId(ctx, communityId, "pco-person-123");
      });

      expect(result).toBe(user1Id);
    });

    it("updates existing link to PCO person", async () => {
      // Set initial link
      await t.run(async (ctx) => {
        await ctx.db.patch(uc1Id, {
          externalIds: {
            planningCenterId: "old-pco-id",
          },
        });
      });

      // Update to new link
      await t.mutation(
        internal.functions.pcoServices.matching.linkUserToPcoPerson,
        {
          communityId,
          userId: user1Id,
          pcoPersonId: "new-pco-id",
        }
      );

      // Verify new link exists
      const result = await t.run(async (ctx) => {
        return await findUserByPcoPersonId(ctx, communityId, "new-pco-id");
      });

      expect(result).toBe(user1Id);

      // Old link should not work
      const oldResult = await t.run(async (ctx) => {
        return await findUserByPcoPersonId(ctx, communityId, "old-pco-id");
      });

      expect(oldResult).toBeNull();
    });
  });

  describe("matchAndLinkPcoPerson mutation", () => {
    it("matches and links a user by phone", async () => {
      const result = await t.mutation(
        internal.functions.pcoServices.matching.matchAndLinkPcoPerson,
        {
          communityId,
          pcoPersonId: "pco-person-123",
          pcoPhone: "2025550123",
          pcoEmail: undefined,
        }
      );

      expect(result.status).toBe("matched");
      expect(result.userId).toBe(user1Id);

      // Verify link was created
      const linkedUser = await t.run(async (ctx) => {
        return await findUserByPcoPersonId(ctx, communityId, "pco-person-123");
      });

      expect(linkedUser).toBe(user1Id);
    });

    it("matches and links a user by email", async () => {
      const result = await t.mutation(
        internal.functions.pcoServices.matching.matchAndLinkPcoPerson,
        {
          communityId,
          pcoPersonId: "pco-person-456",
          pcoPhone: undefined,
          pcoEmail: "jane.smith@example.com",
        }
      );

      expect(result.status).toBe("matched");
      expect(result.userId).toBe(user2Id);
    });

    it("returns not_found when user doesn't exist", async () => {
      const result = await t.mutation(
        internal.functions.pcoServices.matching.matchAndLinkPcoPerson,
        {
          communityId,
          pcoPersonId: "pco-person-unknown",
          pcoPhone: "9999999999",
          pcoEmail: "unknown@example.com",
        }
      );

      expect(result.status).toBe("not_found");
      expect(result.userId).toBeNull();
    });

    it("returns already_linked when user is already linked", async () => {
      // Link user1 first
      await t.run(async (ctx) => {
        await ctx.db.patch(uc1Id, {
          pcoPersonId: "pco-person-123",
          externalIds: {
            planningCenterId: "pco-person-123",
          },
        });
      });

      // Try to match the same PCO person again with different contact info
      const result = await t.mutation(
        internal.functions.pcoServices.matching.matchAndLinkPcoPerson,
        {
          communityId,
          pcoPersonId: "pco-person-123",
          pcoPhone: "differentphone",
          pcoEmail: "different@example.com",
        }
      );

      expect(result.status).toBe("already_linked");
      expect(result.userId).toBe(user1Id);
    });

    it("handles null contact info correctly", async () => {
      const result = await t.mutation(
        internal.functions.pcoServices.matching.matchAndLinkPcoPerson,
        {
          communityId,
          pcoPersonId: "pco-person-unknown",
          pcoPhone: undefined,
          pcoEmail: undefined,
        }
      );

      expect(result.status).toBe("not_found");
      expect(result.userId).toBeNull();
    });
  });

  describe("getLinkedPcoUsers query", () => {
    it("returns all linked PCO users in a community", async () => {
      // Link both users
      await t.run(async (ctx) => {
        await ctx.db.patch(uc1Id, {
          pcoPersonId: "pco-person-123",
          externalIds: {
            planningCenterId: "pco-person-123",
          },
        });

        await ctx.db.patch(uc2Id, {
          pcoPersonId: "pco-person-456",
          externalIds: {
            planningCenterId: "pco-person-456",
          },
        });
      });

      const linkedUsers = await t.query(
        internal.functions.pcoServices.matching.getLinkedPcoUsers,
        {
          communityId,
        }
      );

      expect(linkedUsers).toHaveLength(2);
      expect(linkedUsers).toContainEqual({
        userId: user1Id,
        pcoPersonId: "pco-person-123",
      });
      expect(linkedUsers).toContainEqual({
        userId: user2Id,
        pcoPersonId: "pco-person-456",
      });
    });

    it("returns empty array when no users are linked", async () => {
      const linkedUsers = await t.query(
        internal.functions.pcoServices.matching.getLinkedPcoUsers,
        {
          communityId,
        }
      );

      expect(linkedUsers).toHaveLength(0);
    });

    it("only returns linked users from specified community", async () => {
      // Create another community
      const otherCommunityId = await t.run(async (ctx) => {
        const id = await ctx.db.insert("communities", {
          name: "Other Community",
          slug: "other",
          isPublic: true,
        });
        return id;
      });

      // Link user1 in first community
      await t.run(async (ctx) => {
        await ctx.db.patch(uc1Id, {
          pcoPersonId: "pco-person-123",
          externalIds: {
            planningCenterId: "pco-person-123",
          },
        });
      });

      // Create and link user in other community
      await t.run(async (ctx) => {
        const otherUserId = await ctx.db.insert("users", {
          firstName: "Other",
          lastName: "User",
          isActive: true,
          roles: 1,
        });

        const ucId = await ctx.db.insert("userCommunities", {
          userId: otherUserId,
          communityId: otherCommunityId,
          roles: 1,
          status: 1,
          createdAt: mockTimestamp(),
        });

        await ctx.db.patch(ucId, {
          pcoPersonId: "pco-person-789",
          externalIds: {
            planningCenterId: "pco-person-789",
          },
        });
      });

      // Query first community should only return user1
      const linkedUsers1 = await t.query(
        internal.functions.pcoServices.matching.getLinkedPcoUsers,
        {
          communityId,
        }
      );

      expect(linkedUsers1).toHaveLength(1);
      expect(linkedUsers1[0].userId).toBe(user1Id);
    });

    it("excludes users with no planningCenterId", async () => {
      // Set externalIds without planningCenterId
      await t.run(async (ctx) => {
        // Don't set anything for user1

        await ctx.db.patch(uc2Id, {
          pcoPersonId: "pco-person-456",
          externalIds: {
            planningCenterId: "pco-person-456",
          },
        });
      });

      const linkedUsers = await t.query(
        internal.functions.pcoServices.matching.getLinkedPcoUsers,
        {
          communityId,
        }
      );

      expect(linkedUsers).toHaveLength(1);
      expect(linkedUsers[0].userId).toBe(user2Id);
    });
  });
});
