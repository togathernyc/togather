/**
 * Admin Broadcast Tests (Phase 3)
 *
 * Tests the targeted broadcast system with 2-party approval workflow.
 *
 * Run with: cd apps/convex && pnpm test __tests__/admin-broadcasts.test.ts
 */

import { vi, expect, test, describe, beforeEach, afterEach } from "vitest";

vi.mock("jose", () => ({
  jwtVerify: vi.fn(async (token: string) => {
    const match = token.match(/^test-token-(.+)$/);
    if (!match) throw new Error("Invalid token");
    return { payload: { userId: match[1], type: "access" } };
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
import type { Id } from "../_generated/dataModel";
import { modules } from "../test.setup";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

// ============================================================================
// Helpers
// ============================================================================

interface TestData {
  communityId: Id<"communities">;
  admin1Id: Id<"users">;
  admin2Id: Id<"users">;
  regularUserId: Id<"users">;
  newUserId: Id<"users">;
  userWithoutPicId: Id<"users">;
  admin1Token: string;
  admin2Token: string;
  regularUserToken: string;
}

async function setupTestData(t: ReturnType<typeof convexTest>): Promise<TestData> {
  return await t.run(async (ctx) => {
    const ts = Date.now();

    const communityId = await ctx.db.insert("communities", {
      name: "Broadcast Community", slug: "broadcast-test", isPublic: true, createdAt: ts, updatedAt: ts,
    });

    // Admin 1
    const admin1Id = await ctx.db.insert("users", {
      firstName: "Admin", lastName: "One", email: "admin1@test.com", profilePhoto: "photo.jpg", createdAt: ts, updatedAt: ts,
    });
    await ctx.db.insert("userCommunities", {
      userId: admin1Id, communityId, roles: 3, status: 1, createdAt: ts, updatedAt: ts,
    });

    // Admin 2
    const admin2Id = await ctx.db.insert("users", {
      firstName: "Admin", lastName: "Two", email: "admin2@test.com", profilePhoto: "photo.jpg", createdAt: ts, updatedAt: ts,
    });
    await ctx.db.insert("userCommunities", {
      userId: admin2Id, communityId, roles: 3, status: 1, createdAt: ts, updatedAt: ts,
    });

    // Regular member with profile pic
    const regularUserId = await ctx.db.insert("users", {
      firstName: "Regular", lastName: "User", profilePhoto: "pic.jpg", createdAt: ts, updatedAt: ts,
    });
    await ctx.db.insert("userCommunities", {
      userId: regularUserId, communityId, roles: 1, status: 1, createdAt: ts, updatedAt: ts,
    });

    // New user (joined recently)
    const newUserId = await ctx.db.insert("users", {
      firstName: "New", lastName: "User", profilePhoto: "pic.jpg", createdAt: ts, updatedAt: ts,
    });
    await ctx.db.insert("userCommunities", {
      userId: newUserId, communityId, roles: 1, status: 1, createdAt: ts, updatedAt: ts,
    });

    // User without profile picture
    const userWithoutPicId = await ctx.db.insert("users", {
      firstName: "NoPic", lastName: "User", createdAt: ts, updatedAt: ts,
    });
    await ctx.db.insert("userCommunities", {
      userId: userWithoutPicId, communityId, roles: 1, status: 1, createdAt: ts, updatedAt: ts,
    });

    return {
      communityId, admin1Id, admin2Id, regularUserId, newUserId, userWithoutPicId,
      admin1Token: `test-token-${admin1Id}`,
      admin2Token: `test-token-${admin2Id}`,
      regularUserToken: `test-token-${regularUserId}`,
    };
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("Admin Broadcasts", () => {
  describe("adminBroadcasts schema", () => {
    test("table accepts valid broadcast records", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      await t.run(async (ctx) => {
        const id = await ctx.db.insert("adminBroadcasts", {
          communityId: data.communityId,
          createdById: data.admin1Id,
          targetCriteria: { type: "all_users" },
          targetUserCount: 5,
          title: "Welcome everyone!",
          body: "Just a test broadcast",
          channels: ["push", "email"],
          status: "draft",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const broadcast = await ctx.db.get(id);
        expect(broadcast).not.toBeNull();
        expect(broadcast?.title).toBe("Welcome everyone!");
        expect(broadcast?.status).toBe("draft");
        expect(broadcast?.channels).toEqual(["push", "email"]);
      });
    });

    test("by_community_status index works", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      await t.run(async (ctx) => {
        await ctx.db.insert("adminBroadcasts", {
          communityId: data.communityId,
          createdById: data.admin1Id,
          targetCriteria: { type: "all_users" },
          targetUserCount: 5,
          title: "Draft",
          body: "Draft broadcast",
          channels: ["push"],
          status: "draft",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        await ctx.db.insert("adminBroadcasts", {
          communityId: data.communityId,
          createdById: data.admin1Id,
          targetCriteria: { type: "all_users" },
          targetUserCount: 5,
          title: "Pending",
          body: "Pending broadcast",
          channels: ["push"],
          status: "pending_approval",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const pending = await ctx.db
          .query("adminBroadcasts")
          .withIndex("by_community_status", (q) =>
            q.eq("communityId", data.communityId).eq("status", "pending_approval")
          )
          .collect();
        expect(pending).toHaveLength(1);
        expect(pending[0].title).toBe("Pending");
      });
    });
  });

  describe("create mutation", () => {
    test("admin can create a broadcast", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      const result = await t.mutation(
        // @ts-expect-error - test token auth
        "functions/adminBroadcasts:create" as any,
        {
          token: data.admin1Token,
          communityId: data.communityId,
          targetCriteria: { type: "all_users" },
          title: "Hello everyone",
          body: "This is a test",
          channels: ["push"],
        }
      );

      expect(result.id).toBeDefined();
      expect(result.targetUserCount).toBe(0); // count resolves async via scheduled function
    });

    test("non-admin cannot create a broadcast", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      await expect(
        t.mutation(
          // @ts-expect-error - test token auth
          "functions/adminBroadcasts:create" as any,
          {
            token: data.regularUserToken,
            communityId: data.communityId,
            targetCriteria: { type: "all_users" },
            title: "Sneaky",
            body: "Should fail",
            channels: ["push"],
          }
        )
      ).rejects.toThrow();
    });
  });

  describe("2-party approval workflow", () => {
    test("creator cannot approve their own broadcast", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      // Create broadcast
      const broadcastId = await t.run(async (ctx) => {
        return await ctx.db.insert("adminBroadcasts", {
          communityId: data.communityId,
          createdById: data.admin1Id,
          targetCriteria: { type: "all_users" },
          targetUserCount: 5,
          title: "Self-approve test",
          body: "Should not work",
          channels: ["push"],
          status: "pending_approval",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      // Admin1 (creator) tries to approve
      await expect(
        t.mutation(
          // @ts-expect-error - test token auth
          "functions/adminBroadcasts:approve" as any,
          {
            token: data.admin1Token,
            broadcastId,
          }
        )
      ).rejects.toThrow("cannot approve your own");
    });

    test("different admin can approve a broadcast", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      // Create broadcast by admin1
      const broadcastId = await t.run(async (ctx) => {
        return await ctx.db.insert("adminBroadcasts", {
          communityId: data.communityId,
          createdById: data.admin1Id,
          targetCriteria: { type: "all_users" },
          targetUserCount: 5,
          title: "Cross-approve test",
          body: "Should work",
          channels: ["push"],
          status: "pending_approval",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      // Admin2 approves
      const result = await t.mutation(
        // @ts-expect-error - test token auth
        "functions/adminBroadcasts:approve" as any,
        {
          token: data.admin2Token,
          broadcastId,
        }
      );

      expect(result.success).toBe(true);

      // Verify status changed
      await t.run(async (ctx) => {
        const broadcast = await ctx.db.get(broadcastId);
        expect(broadcast?.status).toBe("approved");
        expect(broadcast?.approvedById).toBe(data.admin2Id);
      });
    });

    test("admin can reject a pending broadcast", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      const broadcastId = await t.run(async (ctx) => {
        return await ctx.db.insert("adminBroadcasts", {
          communityId: data.communityId,
          createdById: data.admin1Id,
          targetCriteria: { type: "all_users" },
          targetUserCount: 5,
          title: "Reject test",
          body: "Will be rejected",
          channels: ["push"],
          status: "pending_approval",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      const result = await t.mutation(
        // @ts-expect-error - test token auth
        "functions/adminBroadcasts:reject" as any,
        {
          token: data.admin2Token,
          broadcastId,
        }
      );

      expect(result.success).toBe(true);

      await t.run(async (ctx) => {
        const broadcast = await ctx.db.get(broadcastId);
        expect(broadcast?.status).toBe("rejected");
      });
    });

    test("cannot send unapproved broadcast", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      const broadcastId = await t.run(async (ctx) => {
        return await ctx.db.insert("adminBroadcasts", {
          communityId: data.communityId,
          createdById: data.admin1Id,
          targetCriteria: { type: "all_users" },
          targetUserCount: 5,
          title: "Unapproved send",
          body: "Should fail",
          channels: ["push"],
          status: "draft",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      await expect(
        t.mutation(
          // @ts-expect-error - test token auth
          "functions/adminBroadcasts:sendBroadcast" as any,
          {
            token: data.admin1Token,
            broadcastId,
          }
        )
      ).rejects.toThrow("must be approved");
    });
  });

  describe("targeting", () => {
    test("no_profile_pic targets users without profilePhoto", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      const result = await t.action(
        // @ts-expect-error - test token auth
        "functions/adminBroadcasts:previewTargeting" as any,
        {
          token: data.admin1Token,
          communityId: data.communityId,
          targetCriteria: { type: "no_profile_pic" },
        }
      );

      // Only userWithoutPicId has no profilePhoto
      expect(result.count).toBe(1);
    });

    test("all_users returns all community members", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      const result = await t.action(
        // @ts-expect-error - test token auth
        "functions/adminBroadcasts:previewTargeting" as any,
        {
          token: data.admin1Token,
          communityId: data.communityId,
          targetCriteria: { type: "all_users" },
        }
      );

      // 5 users: admin1, admin2, regularUser, newUser, userWithoutPic
      expect(result.count).toBe(5);
    });
  });

  describe("request approval flow", () => {
    test("requestApproval changes status from draft to pending", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      const broadcastId = await t.run(async (ctx) => {
        return await ctx.db.insert("adminBroadcasts", {
          communityId: data.communityId,
          createdById: data.admin1Id,
          targetCriteria: { type: "all_users" },
          targetUserCount: 5,
          title: "Approval flow test",
          body: "Testing",
          channels: ["push"],
          status: "draft",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      await t.mutation(
        // @ts-expect-error - test token auth
        "functions/adminBroadcasts:requestApproval" as any,
        {
          token: data.admin1Token,
          broadcastId,
        }
      );

      await t.run(async (ctx) => {
        const broadcast = await ctx.db.get(broadcastId);
        expect(broadcast?.status).toBe("pending_approval");
      });
    });
  });
});
