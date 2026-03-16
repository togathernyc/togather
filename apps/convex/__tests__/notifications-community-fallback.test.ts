import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { internal } from "../_generated/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("community logo notification fallback", () => {
  test("join approval uses community logo when group has no photo", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const communityLogoUrl = "https://example.com/community-logo-notification.jpg";

    const communityId = await t.run(async (ctx) => {
      return await ctx.db.insert("communities", {
        name: "Fallback Community",
        slug: "fallback-community",
        subdomain: "fallback-community",
        logo: communityLogoUrl,
        timezone: "America/New_York",
        createdAt: now,
        updatedAt: now,
      });
    });

    const groupTypeId = await t.run(async (ctx) => {
      return await ctx.db.insert("groupTypes", {
        communityId,
        name: "Group Type",
        slug: "group-type",
        isActive: true,
        createdAt: now,
        displayOrder: 1,
      });
    });

    const groupId = await t.run(async (ctx) => {
      return await ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name: "No Photo Group",
        preview: undefined,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      });
    });

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Join",
        lastName: "User",
        phone: "+15551112222",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("pushTokens", {
        userId,
        token: "ExponentPushToken[join-approved-fallback]",
        platform: "ios",
        environment: "staging",
        isActive: true,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: now,
      });
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: "ok", id: "ticket-join-1" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.action(
      internal.functions.notifications.senders.notifyJoinRequestApproved,
      { userId, groupId }
    );

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalled();

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload[0].richContent.image).toBe(communityLogoUrl);
    expect(payload[0].data.groupAvatarUrl).toBe(communityLogoUrl);
  });
});
