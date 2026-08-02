/**
 * Notification Queries — Unauthenticated / Stale Token Tests
 *
 * `unreadCount` is mounted unconditionally at app boot by
 * NotificationProvider, with a token read straight out of AsyncStorage before
 * the auth lifecycle has had a chance to validate (or refresh) it. On mobile
 * web, returning from a Stripe checkout full-page redirect cold-boots the SPA
 * and does exactly this. A strict `requireAuth` throw there becomes a
 * ConvexError re-thrown by `convex/react` during render, which the
 * AuthErrorBoundary does NOT handle (it only recovers COMMUNITY_ARCHIVED), so
 * the app hard-crashes to the root "Something went wrong" screen.
 *
 * A badge count of 0 is the correct answer for a caller we can't authenticate,
 * so this query must degrade instead of throwing.
 *
 * Run with: cd apps/convex && npx vitest run __tests__/notifications-unauthenticated.test.ts
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

interface TestSetup {
  userId: Id<"users">;
  communityId: Id<"communities">;
  token: string;
}

async function seedTestData(
  t: ReturnType<typeof convexTest>,
): Promise<TestSetup> {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();

    const userId = await ctx.db.insert("users", {
      firstName: "Test",
      lastName: "User",
      phone: "+12025558888",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const communityId = await ctx.db.insert("communities", {
      name: "Open Church",
      slug: "open-church-unauth",
      subdomain: "open-church-unauth",
      isArchived: false,
      timezone: "America/New_York",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("notifications", {
      userId,
      communityId,
      notificationType: "announcement",
      title: "Unread announcement",
      body: "Counts toward the badge for an authenticated caller.",
      data: {},
      status: "sent",
      isRead: false,
      createdAt: now,
    });

    return { userId, communityId };
  });

  const { accessToken } = await generateTokens(ids.userId, ids.communityId);

  return { ...ids, token: accessToken };
}

describe("unreadCount with an unusable token", () => {
  test("returns 0 instead of throwing when no token is supplied", async () => {
    const t = convexTest(schema, modules);
    await seedTestData(t);

    const result = await t.query(
      api.functions.notifications.queries.unreadCount,
      {},
    );

    expect(result).toEqual({ unreadCount: 0 });
  });

  test("returns 0 instead of throwing for an empty token", async () => {
    const t = convexTest(schema, modules);
    await seedTestData(t);

    const result = await t.query(
      api.functions.notifications.queries.unreadCount,
      { token: "" },
    );

    expect(result).toEqual({ unreadCount: 0 });
  });

  test("returns 0 instead of throwing for a malformed token", async () => {
    const t = convexTest(schema, modules);
    await seedTestData(t);

    const result = await t.query(
      api.functions.notifications.queries.unreadCount,
      { token: "not-a-jwt" },
    );

    expect(result).toEqual({ unreadCount: 0 });
  });

  test("returns 0 instead of throwing for a token whose user no longer exists", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // A token minted for a user row that has since been deleted resolves to
    // null — the shape a stale token from storage takes after account removal.
    await t.run(async (ctx) => {
      await ctx.db.delete(setup.userId);
    });

    const result = await t.query(
      api.functions.notifications.queries.unreadCount,
      { token: setup.token },
    );

    expect(result).toEqual({ unreadCount: 0 });
  });

  test("returns 0 instead of throwing for a revoked (signed-out) token", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Signout blacklists every token issued before `revokedAt` — the exact
    // shape of a stale token still sitting in AsyncStorage after logout.
    await t.run(async (ctx) => {
      await ctx.db.insert("tokenRevocations", {
        userId: setup.userId,
        revokedBefore: Date.now() + 60_000,
        createdAt: Date.now(),
      });
    });

    const result = await t.query(
      api.functions.notifications.queries.unreadCount,
      { token: setup.token },
    );

    expect(result).toEqual({ unreadCount: 0 });
  });

  test("still counts normally for a valid token", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const result = await t.query(
      api.functions.notifications.queries.unreadCount,
      { token: setup.token },
    );

    expect(result).toEqual({ unreadCount: 1 });
  });
});
