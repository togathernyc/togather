/**
 * Notification Queries — Archived Community Tests
 *
 * unreadCount, inboxSummary, and list are mounted unconditionally at app boot
 * (NotificationProvider / Inbox), before the user can navigate away from a
 * community that was archived out from under them. requireAuth's strict
 * COMMUNITY_ARCHIVED rejection would throw during React render and crash the
 * app (see lib/auth.ts requireAuthWithArchivedStatus). These queries must
 * instead detect the archived community and return benign empty data.
 *
 * Run with: cd apps/convex && npx vitest run __tests__/notifications-archived-community.test.ts
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
  archivedCommunityId: Id<"communities">;
  activeCommunityId: Id<"communities">;
  archivedToken: string;
  activeToken: string;
}

async function seedTestData(t: ReturnType<typeof convexTest>): Promise<TestSetup> {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();

    const userId = await ctx.db.insert("users", {
      firstName: "Test",
      lastName: "User",
      phone: "+12025559999",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const archivedCommunityId = await ctx.db.insert("communities", {
      name: "Closed Church",
      slug: "closed-church",
      subdomain: "closed-church",
      isArchived: true,
      timezone: "America/New_York",
      createdAt: now,
      updatedAt: now,
    });

    const activeCommunityId = await ctx.db.insert("communities", {
      name: "Open Church",
      slug: "open-church",
      subdomain: "open-church",
      isArchived: false,
      timezone: "America/New_York",
      createdAt: now,
      updatedAt: now,
    });

    // An unread notification tied to the user — should never surface once
    // the token is scoped to an archived community.
    await ctx.db.insert("notifications", {
      userId,
      communityId: archivedCommunityId,
      notificationType: "announcement",
      title: "Should not appear",
      body: "This notification must not leak through an archived-community token.",
      data: {},
      status: "sent",
      isRead: false,
      createdAt: now,
    });

    return { userId, archivedCommunityId, activeCommunityId };
  });

  const [archived, active] = await Promise.all([
    generateTokens(ids.userId, ids.archivedCommunityId),
    generateTokens(ids.userId, ids.activeCommunityId),
  ]);

  return {
    ...ids,
    archivedToken: archived.accessToken,
    activeToken: active.accessToken,
  };
}

describe("notification queries with an archived-community token", () => {
  test("unreadCount returns 0 instead of throwing", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const result = await t.query(
      api.functions.notifications.queries.unreadCount,
      { token: setup.archivedToken },
    );

    expect(result).toEqual({ unreadCount: 0 });
  });

  test("unreadCount still counts normally for a non-archived community", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // unreadCount counts notifications by userId regardless of which
    // community the token is scoped to, so the seeded unread notification
    // shows up for a token scoped to the (non-archived) active community.
    // This confirms the normal path still executes and isn't short-circuited
    // to 0 for every token.
    const result = await t.query(
      api.functions.notifications.queries.unreadCount,
      { token: setup.activeToken },
    );

    expect(result).toEqual({ unreadCount: 1 });
  });

  test("inboxSummary returns a benign empty summary instead of throwing", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const result = await t.query(
      api.functions.notifications.queries.inboxSummary,
      { token: setup.archivedToken },
    );

    expect(result).toEqual({ latest: null, unreadCount: 0 });
  });

  test("list returns a benign empty page instead of throwing", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const result = await t.query(api.functions.notifications.queries.list, {
      token: setup.archivedToken,
    });

    expect(result).toEqual({
      notifications: [],
      unreadCount: 0,
      totalCount: 0,
    });
  });
});
