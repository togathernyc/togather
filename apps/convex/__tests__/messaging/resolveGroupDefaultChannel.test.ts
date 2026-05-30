/**
 * Tests for resolveGroupDefaultChannel + getGroupDefaultChannel.
 *
 * General (the `main` channel) is now optional. resolveGroupDefaultChannel
 * picks the highest-priority ACTIVE channel for a group so backend sites that
 * used to assume a main channel exists have a deterministic fallback.
 *
 * "Active" means `isArchived !== true && isEnabled !== false`.
 *
 * Priority:
 *   1. main  2. announcements  3. reach_out, then custom/pco_services/cross_team
 *   (by lastMessageAt desc, then name)  4. leaders  5. null
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, afterEach } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { api } from "../../_generated/api";
import { generateTokens } from "../../lib/auth";
import { resolveGroupDefaultChannel } from "../../functions/messaging/channels";
import type { Id } from "../../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

vi.useFakeTimers();
afterEach(() => {
  vi.clearAllTimers();
});

interface Seed {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  userId: Id<"users">;
  accessToken: string;
}

let createdByUserId: Id<"users">;

async function seed(t: ReturnType<typeof convexTest>): Promise<Seed> {
  const now = Date.now();
  const communityId = await t.run((ctx) =>
    ctx.db.insert("communities", {
      name: "Test Community",
      subdomain: "test",
      slug: "test",
      timezone: "America/New_York",
      createdAt: now,
      updatedAt: now,
    }),
  );
  const groupTypeId = await t.run((ctx) =>
    ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Groups",
      slug: "small-groups",
      isActive: true,
      displayOrder: 1,
      createdAt: now,
    }),
  );
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      firstName: "Test",
      lastName: "User",
      phone: "+15555550001",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const groupId = await t.run((ctx) =>
    ctx.db.insert("groups", {
      name: "Test Group",
      communityId,
      groupTypeId,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("groupMembers", {
      userId,
      groupId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    }),
  );
  const { accessToken } = await generateTokens(userId);
  createdByUserId = userId;
  return { communityId, groupId, userId, accessToken };
}

async function addChannel(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
  channelType: string,
  opts: {
    slug?: string;
    name?: string;
    isArchived?: boolean;
    isEnabled?: boolean;
    lastMessageAt?: number;
  } = {},
): Promise<Id<"chatChannels">> {
  const now = Date.now();
  return await t.run((ctx) =>
    ctx.db.insert("chatChannels", {
      groupId,
      slug: opts.slug ?? channelType,
      channelType,
      name: opts.name ?? channelType,
      createdById: createdByUserId,
      createdAt: now,
      updatedAt: now,
      isArchived: opts.isArchived ?? false,
      isEnabled: opts.isEnabled,
      lastMessageAt: opts.lastMessageAt,
      memberCount: 0,
    }),
  );
}

describe("resolveGroupDefaultChannel", () => {
  test("main active -> main", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seed(t);
    const mainId = await addChannel(t, groupId, "main", { slug: "general", name: "General" });
    await addChannel(t, groupId, "announcements", { name: "Announcements" });
    await addChannel(t, groupId, "leaders", { name: "Leaders" });

    const resolved = await t.run((ctx) => resolveGroupDefaultChannel(ctx, groupId));
    expect(resolved?._id).toBe(mainId);
  });

  test("main disabled + announcements active -> announcements", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seed(t);
    await addChannel(t, groupId, "main", { slug: "general", name: "General", isArchived: true });
    const annId = await addChannel(t, groupId, "announcements", { name: "Announcements" });
    await addChannel(t, groupId, "leaders", { name: "Leaders" });

    const resolved = await t.run((ctx) => resolveGroupDefaultChannel(ctx, groupId));
    expect(resolved?._id).toBe(annId);
  });

  test("main + announcements disabled + reach_out active -> reach_out", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seed(t);
    await addChannel(t, groupId, "main", { slug: "general", name: "General", isArchived: true });
    await addChannel(t, groupId, "announcements", { name: "Announcements", isEnabled: false });
    const reachId = await addChannel(t, groupId, "reach_out", { name: "Reach Out" });
    await addChannel(t, groupId, "leaders", { name: "Leaders" });

    const resolved = await t.run((ctx) => resolveGroupDefaultChannel(ctx, groupId));
    expect(resolved?._id).toBe(reachId);
  });

  test("custom channels chosen by lastMessageAt desc, tie-break by name", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seed(t);
    await addChannel(t, groupId, "custom", { slug: "old", name: "Alpha", lastMessageAt: 1000 });
    const recentId = await addChannel(t, groupId, "custom", { slug: "new", name: "Zulu", lastMessageAt: 5000 });

    const resolved = await t.run((ctx) => resolveGroupDefaultChannel(ctx, groupId));
    expect(resolved?._id).toBe(recentId);
  });

  test("only leaders active -> leaders", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seed(t);
    await addChannel(t, groupId, "main", { slug: "general", name: "General", isArchived: true });
    await addChannel(t, groupId, "announcements", { name: "Announcements", isArchived: true });
    await addChannel(t, groupId, "reach_out", { name: "Reach Out", isEnabled: false });
    const leadersId = await addChannel(t, groupId, "leaders", { name: "Leaders" });

    const resolved = await t.run((ctx) => resolveGroupDefaultChannel(ctx, groupId));
    expect(resolved?._id).toBe(leadersId);
  });

  test("all disabled -> null", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seed(t);
    await addChannel(t, groupId, "main", { slug: "general", name: "General", isArchived: true });
    await addChannel(t, groupId, "leaders", { name: "Leaders", isEnabled: false });

    const resolved = await t.run((ctx) => resolveGroupDefaultChannel(ctx, groupId));
    expect(resolved).toBeNull();
  });

  test("dm / group_dm / event channel types are excluded", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seed(t);
    await addChannel(t, groupId, "dm", { name: "DM" });
    await addChannel(t, groupId, "group_dm", { name: "Group DM" });
    await addChannel(t, groupId, "event", { name: "Event" });

    const resolved = await t.run((ctx) => resolveGroupDefaultChannel(ctx, groupId));
    expect(resolved).toBeNull();
  });
});

describe("getGroupDefaultChannel query", () => {
  test("returns the resolved channel for an active member", async () => {
    const t = convexTest(schema, modules);
    const { groupId, accessToken } = await seed(t);
    await addChannel(t, groupId, "main", { slug: "general", name: "General", isArchived: true });
    const annId = await addChannel(t, groupId, "announcements", { name: "Announcements" });

    const result = await t.query(api.functions.messaging.channels.getGroupDefaultChannel, {
      token: accessToken,
      groupId,
    });
    expect(result).toEqual({
      channelId: annId,
      slug: "announcements",
      channelType: "announcements",
    });
  });

  test("returns null when caller is not a group member", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seed(t);
    await addChannel(t, groupId, "main", { slug: "general", name: "General" });

    const outsiderId = await t.run((ctx) =>
      ctx.db.insert("users", {
        firstName: "Out",
        lastName: "Sider",
        phone: "+15555559999",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const { accessToken: outsiderToken } = await generateTokens(outsiderId);

    const result = await t.query(api.functions.messaging.channels.getGroupDefaultChannel, {
      token: outsiderToken,
      groupId,
    });
    expect(result).toBeNull();
  });

  test("returns null when the group has no active channel", async () => {
    const t = convexTest(schema, modules);
    const { groupId, accessToken } = await seed(t);
    await addChannel(t, groupId, "main", { slug: "general", name: "General", isArchived: true });

    const result = await t.query(api.functions.messaging.channels.getGroupDefaultChannel, {
      token: accessToken,
      groupId,
    });
    expect(result).toBeNull();
  });
});
