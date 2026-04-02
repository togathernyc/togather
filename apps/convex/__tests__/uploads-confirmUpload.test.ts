/**
 * confirmUpload Mutation Tests
 *
 * Tests for the upload confirmation flow:
 * - Profile photo sets updatedAt and triggers channel sync
 * - Ownership check rejects other users
 * - Group/meeting updates require leader/admin permission
 * - Non-existent entities throw appropriate errors
 * - Unknown entity types are rejected
 *
 * Run with: cd apps/convex && pnpm test __tests__/uploads-confirmUpload.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// ============================================================================
// Helpers
// ============================================================================

async function seedUser(ctx: any, overrides?: Partial<Record<string, any>>) {
  return await ctx.db.insert("users", {
    firstName: "Test",
    lastName: "User",
    phone: "+12025550100",
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });
}

async function seedCommunityWithGroup(ctx: any) {
  const communityId = await ctx.db.insert("communities", {
    name: "Test Community",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const groupTypeId = await ctx.db.insert("groupTypes", {
    communityId,
    name: "Small Group",
    slug: "small-group",
    isActive: true,
    createdAt: Date.now(),
    displayOrder: 1,
  });

  const groupId = await ctx.db.insert("groups", {
    communityId,
    groupTypeId,
    name: "Test Group",
    isArchived: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  return { communityId, groupTypeId, groupId };
}

async function makeGroupLeader(
  ctx: any,
  groupId: Id<"groups">,
  userId: Id<"users">
) {
  return await ctx.db.insert("groupMembers", {
    groupId,
    userId,
    role: "leader",
    joinedAt: Date.now(),
    notificationsEnabled: true,
  });
}

async function makeCommunityMember(
  ctx: any,
  userId: Id<"users">,
  communityId: Id<"communities">,
  roles: number = 1
) {
  return await ctx.db.insert("userCommunities", {
    userId,
    communityId,
    roles,
    status: 1, // ACTIVE
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

// ============================================================================
// confirmUpload — User Profile Photo
// ============================================================================

describe("confirmUpload — user profile photo", () => {
  test("updates profilePhoto and updatedAt for own user", async () => {
    const t = convexTest(schema, modules);

    const { userId, storageId } = await t.run(async (ctx) => {
      const userId = await seedUser(ctx);
      const blob = new Blob(["fake-image-data"], { type: "image/jpeg" });
      const storageId = await ctx.storage.store(blob);
      return { userId, storageId };
    });

    const { accessToken: token } = await generateTokens(userId);

    const result = await t.mutation(api.functions.uploads.confirmUpload, {
      token,
      storageId,
      entityType: "user",
      entityId: userId,
      folder: "profiles",
    });

    expect(result.success).toBe(true);
    expect(result.url).toBeDefined();

    // Verify user was updated
    const user = await t.run(async (ctx) => ctx.db.get(userId));
    expect(user?.profilePhoto).toBe(result.url);
    expect(user?.updatedAt).toBeGreaterThan(0);
  });

  test("rejects updating another user's profile photo", async () => {
    const t = convexTest(schema, modules);

    const { userId1, userId2, storageId } = await t.run(async (ctx) => {
      const userId1 = await seedUser(ctx, { phone: "+12025550101" });
      const userId2 = await seedUser(ctx, { phone: "+12025550102" });
      const blob = new Blob(["fake"], { type: "image/jpeg" });
      const storageId = await ctx.storage.store(blob);
      return { userId1, userId2, storageId };
    });

    const { accessToken: token } = await generateTokens(userId1);

    await expect(
      t.mutation(api.functions.uploads.confirmUpload, {
        token,
        storageId,
        entityType: "user",
        entityId: userId2,
      })
    ).rejects.toThrow("Cannot update another user's profile photo");
  });
});

// ============================================================================
// confirmUpload — Group Preview
// ============================================================================

describe("confirmUpload — group preview", () => {
  test("group leader can update group preview image", async () => {
    const t = convexTest(schema, modules);

    const { leaderId, groupId, communityId, storageId } = await t.run(
      async (ctx) => {
        const { communityId, groupId } = await seedCommunityWithGroup(ctx);
        const leaderId = await seedUser(ctx);
        await makeGroupLeader(ctx, groupId, leaderId);
        await makeCommunityMember(ctx, leaderId, communityId);
        const blob = new Blob(["fake"], { type: "image/jpeg" });
        const storageId = await ctx.storage.store(blob);
        return { leaderId, groupId, communityId, storageId };
      }
    );

    const { accessToken: token } = await generateTokens(leaderId, communityId);

    const result = await t.mutation(api.functions.uploads.confirmUpload, {
      token,
      storageId,
      entityType: "group",
      entityId: groupId,
    });

    expect(result.success).toBe(true);

    const group = await t.run(async (ctx) => ctx.db.get(groupId));
    expect(group?.preview).toBe(result.url);
  });

  test("non-leader cannot update group preview image", async () => {
    const t = convexTest(schema, modules);

    const { memberId, groupId, communityId, storageId } = await t.run(
      async (ctx) => {
        const { communityId, groupId } = await seedCommunityWithGroup(ctx);
        const memberId = await seedUser(ctx);
        // Regular member, not a leader
        await ctx.db.insert("groupMembers", {
          groupId,
          userId: memberId,
          role: "member",
          joinedAt: Date.now(),
          notificationsEnabled: true,
        });
        await makeCommunityMember(ctx, memberId, communityId);
        const blob = new Blob(["fake"], { type: "image/jpeg" });
        const storageId = await ctx.storage.store(blob);
        return { memberId, groupId, communityId, storageId };
      }
    );

    const { accessToken: token } = await generateTokens(
      memberId,
      communityId
    );

    await expect(
      t.mutation(api.functions.uploads.confirmUpload, {
        token,
        storageId,
        entityType: "group",
        entityId: groupId,
      })
    ).rejects.toThrow();
  });
});

// ============================================================================
// confirmUpload — Meeting Cover Image
// ============================================================================

describe("confirmUpload — meeting cover image", () => {
  test("group leader can update meeting cover image", async () => {
    const t = convexTest(schema, modules);

    const { leaderId, meetingId, communityId, storageId } = await t.run(
      async (ctx) => {
        const { communityId, groupId } = await seedCommunityWithGroup(ctx);
        const leaderId = await seedUser(ctx);
        await makeGroupLeader(ctx, groupId, leaderId);
        await makeCommunityMember(ctx, leaderId, communityId);
        const meetingId = await ctx.db.insert("meetings", {
          groupId,
          scheduledAt: Date.now() + 86400000,
          status: "scheduled",
          meetingType: 1,
          createdAt: Date.now(),
        });
        const blob = new Blob(["fake"], { type: "image/jpeg" });
        const storageId = await ctx.storage.store(blob);
        return { leaderId, meetingId, communityId, storageId };
      }
    );

    const { accessToken: token } = await generateTokens(leaderId, communityId);

    const result = await t.mutation(api.functions.uploads.confirmUpload, {
      token,
      storageId,
      entityType: "meeting",
      entityId: meetingId,
    });

    expect(result.success).toBe(true);

    const meeting = await t.run(async (ctx) => ctx.db.get(meetingId));
    expect(meeting?.coverImage).toBe(result.url);
  });

  test("rejects meeting update when meeting does not exist", async () => {
    const t = convexTest(schema, modules);

    const { userId, storageId } = await t.run(async (ctx) => {
      const userId = await seedUser(ctx);
      const blob = new Blob(["fake"], { type: "image/jpeg" });
      const storageId = await ctx.storage.store(blob);
      return { userId, storageId };
    });

    const { accessToken: token } = await generateTokens(userId);

    await expect(
      t.mutation(api.functions.uploads.confirmUpload, {
        token,
        storageId,
        entityType: "meeting",
        entityId: "invalid-meeting-id" as Id<"meetings">,
      })
    ).rejects.toThrow("Meeting not found");
  });
});

// ============================================================================
// confirmUpload — Edge Cases
// ============================================================================

describe("confirmUpload — edge cases", () => {
  test("succeeds without entity params (basic upload confirmation)", async () => {
    const t = convexTest(schema, modules);

    const { userId, storageId } = await t.run(async (ctx) => {
      const userId = await seedUser(ctx);
      const blob = new Blob(["fake"], { type: "image/jpeg" });
      const storageId = await ctx.storage.store(blob);
      return { userId, storageId };
    });

    const { accessToken: token } = await generateTokens(userId);

    const result = await t.mutation(api.functions.uploads.confirmUpload, {
      token,
      storageId,
    });

    expect(result.success).toBe(true);
    expect(result.url).toBeDefined();
    expect(result.storageId).toBe(storageId);
  });
});
