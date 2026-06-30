/**
 * Followup Bot Tests
 *
 * Tests for the Followup Bot, which assigns a leader to follow up with each
 * new member when they join a group. The assigned leader is chosen by the
 * configured strategy — a single specific leader, or round-robin across the
 * group's active leaders — and is notified via an @mention in the target
 * channel (defaults to the Leaders channel).
 *
 * The followup bot:
 * - Is event-triggered when a NEW member joins a group (mirrors Welcome Bot)
 * - Is configured per-group via the groupBotConfigs table (botType "followup")
 * - Uses placeholders [[leader_name]], [[member_name]], [[group_name]],
 *   [[community_name]]
 * - Rotates leaders in round-robin mode, advancing a saved pointer each time
 * - Always assigns to the configured leader in specific-leader mode
 * - Never assigns a newly-joined leader to follow up with themselves
 * - Does nothing when disabled or when the group has no other leaders
 *
 * Run with: cd apps/convex && pnpm test __tests__/followup-bot.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, beforeEach, afterEach } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// Scheduled functions triggered by message inserts (mentions, etc.) can reject
// in the test environment because external APIs aren't available. Swallow those
// expected rejections so they don't fail unrelated assertions.
const unhandledRejectionHandler = (reason: unknown) => {
  const errorMessage = String(reason);
  if (
    errorMessage.includes("Write outside of transaction") ||
    errorMessage.includes("_scheduled_functions")
  ) {
    return;
  }
  throw reason;
};

describe("Followup Bot", () => {
  beforeEach(() => {
    process.on("unhandledRejection", unhandledRejectionHandler);
  });

  afterEach(() => {
    process.off("unhandledRejection", unhandledRejectionHandler);
  });

  describe("Bot Definition", () => {
    test("is registered as an event bot with a round-robin default", async () => {
      const t = convexTest(schema, modules);

      const bots = await t.query(api.functions.groupBots.listAvailable, {});
      const followup = bots.find((bot) => bot.id === "followup");

      expect(followup).toBeDefined();
      expect(followup?.name).toBe("Followup Bot");
      expect(followup?.triggerType).toBe("event");

      const assignmentField = followup?.configFields?.find(
        (field) => field.key === "assignmentMode",
      );
      const roundRobinOption = assignmentField?.options?.find(
        (option) => option.value === "round_robin",
      );
      expect(roundRobinOption?.label).toBe("Rotate leaders");
    });

    test("exposes default config via getConfig", async () => {
      const t = convexTest(schema, modules);
      const { groupId } = await seedFollowupGroup(t, { enabled: false });

      const config = await t.query(api.functions.groupBots.getConfig, {
        groupId,
        botId: "followup",
      });

      expect(config.defaultConfig.assignmentMode).toBe("round_robin");
      expect(config.defaultConfig.targetChannelSlug).toBe("leaders");
      expect(config.defaultConfig.message).toContain("[[member_name]]");
    });
  });

  describe("Config lookup", () => {
    test("returns the config when enabled", async () => {
      const t = convexTest(schema, modules);
      const { groupId, communityName, groupName } = await seedFollowupGroup(t, {
        enabled: true,
      });

      const config = await t.query(
        internal.functions.scheduledJobs.getFollowupBotConfig,
        { groupId },
      );

      expect(config).not.toBeNull();
      expect(config?.enabled).toBe(true);
      expect(config?.groupName).toBe(groupName);
      expect(config?.communityName).toBe(communityName);
      expect(config?.assignmentMode).toBe("round_robin");
    });

    test("returns null when disabled", async () => {
      const t = convexTest(schema, modules);
      const { groupId } = await seedFollowupGroup(t, { enabled: false });

      const config = await t.query(
        internal.functions.scheduledJobs.getFollowupBotConfig,
        { groupId },
      );

      expect(config).toBeNull();
    });
  });

  describe("Assignment", () => {
    test("round-robin rotates leaders and advances the pointer", async () => {
      const t = convexTest(schema, modules);
      const { groupId, configId, leaderAId, leaderBId } =
        await seedFollowupGroup(t, {
          enabled: true,
          assignmentMode: "round_robin",
        });

      // First new member → first leader in rotation.
      const newMember1 = await addUser(t, "First", "+15555551001");
      const result1 = await t.action(
        internal.functions.scheduledJobs.assignNewMemberFollowup,
        { groupId, userId: newMember1 },
      );
      expect(result1).toMatchObject({ success: true });

      const messages1 = await getChannelMessages(t, groupId);
      expect(messages1).toHaveLength(1);
      expect(messages1[0].senderName).toBe("Followup Bot 🤝");
      expect(messages1[0].contentType).toBe("bot");
      const firstAssignee = messages1[0].mentionedUserIds?.[0];
      expect([leaderAId, leaderBId]).toContain(firstAssignee);

      // Second new member → the *other* leader (rotation advanced).
      const newMember2 = await addUser(t, "Second", "+15555551002");
      await t.action(
        internal.functions.scheduledJobs.assignNewMemberFollowup,
        { groupId, userId: newMember2 },
      );

      const messages2 = await getChannelMessages(t, groupId);
      expect(messages2).toHaveLength(2);
      const secondAssignee = messages2[1].mentionedUserIds?.[0];
      expect(secondAssignee).not.toBe(firstAssignee);
      expect([leaderAId, leaderBId]).toContain(secondAssignee);

      // The saved pointer advanced to a valid index.
      const state = await t.run(async (ctx) => {
        const config = await ctx.db.get(configId);
        return config?.state as { lastLeaderIndex?: number };
      });
      expect(typeof state.lastLeaderIndex).toBe("number");
    });

    test("specific-leader mode always assigns the chosen leader", async () => {
      const t = convexTest(schema, modules);
      const { groupId, leaderBId } = await seedFollowupGroup(t, {
        enabled: true,
        assignmentMode: "specific_leader",
        specificLeaderId: "B",
      });

      const newMember1 = await addUser(t, "First", "+15555552001");
      const newMember2 = await addUser(t, "Second", "+15555552002");
      await t.action(internal.functions.scheduledJobs.assignNewMemberFollowup, {
        groupId,
        userId: newMember1,
      });
      await t.action(internal.functions.scheduledJobs.assignNewMemberFollowup, {
        groupId,
        userId: newMember2,
      });

      const messages = await getChannelMessages(t, groupId);
      expect(messages).toHaveLength(2);
      expect(messages[0].mentionedUserIds?.[0]).toBe(leaderBId);
      expect(messages[1].mentionedUserIds?.[0]).toBe(leaderBId);
    });

    test("replaces placeholders in the assignment message", async () => {
      const t = convexTest(schema, modules);
      const { groupId, groupName } = await seedFollowupGroup(t, {
        enabled: true,
        assignmentMode: "specific_leader",
        specificLeaderId: "A",
        message:
          "Hi [[leader_name]], welcome [[member_name]] to [[group_name]] ([[community_name]])",
      });

      const newMember = await addUser(t, "Jordan", "+15555553001");
      await t.action(internal.functions.scheduledJobs.assignNewMemberFollowup, {
        groupId,
        userId: newMember,
      });

      const messages = await getChannelMessages(t, groupId);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toContain("Hi Alice Leader");
      expect(messages[0].content).toContain("welcome Jordan Member to " + groupName);
      expect(messages[0].content).toContain("(Test Community)");
      expect(messages[0].content).not.toContain("[[");
    });

    test("skips silently when the bot is disabled", async () => {
      const t = convexTest(schema, modules);
      const { groupId } = await seedFollowupGroup(t, { enabled: false });

      const newMember = await addUser(t, "Nobody", "+15555554001");
      const result = await t.action(
        internal.functions.scheduledJobs.assignNewMemberFollowup,
        { groupId, userId: newMember },
      );

      expect(result).toMatchObject({ skipped: true, reason: "bot_not_enabled" });
      expect(await getChannelMessages(t, groupId)).toHaveLength(0);
    });

    test("never assigns a newly-joined leader to follow up with themselves", async () => {
      const t = convexTest(schema, modules);
      // Group whose only leader is the person who just joined.
      const { groupId, soleLeaderId } = await seedSingleLeaderGroup(t);

      const result = await t.action(
        internal.functions.scheduledJobs.assignNewMemberFollowup,
        { groupId, userId: soleLeaderId },
      );

      expect(result).toMatchObject({ skipped: true, reason: "no_leaders" });
      expect(await getChannelMessages(t, groupId)).toHaveLength(0);
    });
  });
});

// ============================================================================
// Test helpers
// ============================================================================

async function addUser(
  t: ReturnType<typeof convexTest>,
  firstName: string,
  phone: string,
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName,
      lastName: "Member",
      phone,
      phoneVerified: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

type SeedOptions = {
  enabled: boolean;
  assignmentMode?: string;
  /** "A" or "B" — which seeded leader to pin in specific-leader mode. */
  specificLeaderId?: "A" | "B";
  message?: string;
};

async function seedFollowupGroup(
  t: ReturnType<typeof convexTest>,
  opts: SeedOptions,
): Promise<{
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  configId: Id<"groupBotConfigs">;
  leaderAId: Id<"users">;
  leaderBId: Id<"users">;
  groupName: string;
  communityName: string;
}> {
  const communityName = "Test Community";
  const groupName = "Test Followup Group";

  const communityId = await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: communityName,
      subdomain: "test-followup",
      slug: "test-followup",
      timezone: "America/New_York",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const groupTypeId = await t.run(async (ctx) => {
    return await ctx.db.insert("groupTypes", {
      communityId,
      name: "Test Group Type",
      slug: "test-group-type",
      isActive: true,
      displayOrder: 1,
      createdAt: Date.now(),
    });
  });

  const leaderAId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Alice",
      lastName: "Leader",
      phone: "+15555550001",
      phoneVerified: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const leaderBId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Bob",
      lastName: "Leader",
      phone: "+15555550002",
      phoneVerified: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const groupId = await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      name: groupName,
      communityId,
      groupTypeId,
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  await t.run(async (ctx) => {
    for (const userId of [leaderAId, leaderBId]) {
      await ctx.db.insert("groupMembers", {
        userId,
        groupId,
        role: "leader",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    }
  });

  // Leaders channel so the bot message has somewhere to post.
  await t.run(async (ctx) => {
    await ctx.db.insert("chatChannels", {
      groupId,
      communityId,
      slug: "leaders",
      channelType: "leaders",
      name: "Leaders",
      createdById: leaderAId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isArchived: false,
      isEnabled: true,
      memberCount: 2,
    });
  });

  const specificLeaderId =
    opts.specificLeaderId === "A"
      ? leaderAId
      : opts.specificLeaderId === "B"
        ? leaderBId
        : undefined;

  const configId = await t.run(async (ctx) => {
    return await ctx.db.insert("groupBotConfigs", {
      groupId,
      botType: "followup",
      enabled: opts.enabled,
      config: {
        message:
          opts.message ??
          "🤝 Hey [[leader_name]], please follow up with [[member_name]] who just joined [[group_name]]!",
        assignmentMode: opts.assignmentMode ?? "round_robin",
        ...(specificLeaderId ? { specificLeaderId } : {}),
        targetChannelSlug: "leaders",
      },
      state: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  return {
    communityId,
    groupId,
    configId,
    leaderAId,
    leaderBId,
    groupName,
    communityName,
  };
}

/** A group whose only leader is the user we'll pass as the new member. */
async function seedSingleLeaderGroup(
  t: ReturnType<typeof convexTest>,
): Promise<{ groupId: Id<"groups">; soleLeaderId: Id<"users"> }> {
  const communityId = await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: "Solo Community",
      subdomain: "solo-followup",
      slug: "solo-followup",
      timezone: "America/New_York",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const groupTypeId = await t.run(async (ctx) => {
    return await ctx.db.insert("groupTypes", {
      communityId,
      name: "Solo Group Type",
      slug: "solo-group-type",
      isActive: true,
      displayOrder: 1,
      createdAt: Date.now(),
    });
  });

  const soleLeaderId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Solo",
      lastName: "Leader",
      phone: "+15555559001",
      phoneVerified: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const groupId = await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      name: "Solo Group",
      communityId,
      groupTypeId,
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      userId: soleLeaderId,
      groupId,
      role: "leader",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupBotConfigs", {
      groupId,
      botType: "followup",
      enabled: true,
      config: { assignmentMode: "round_robin", targetChannelSlug: "leaders" },
      state: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  return { groupId, soleLeaderId };
}

async function getChannelMessages(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
): Promise<
  Array<{
    content: string;
    senderName?: string;
    contentType?: string;
    mentionedUserIds?: Id<"users">[];
    createdAt: number;
  }>
> {
  return await t.run(async (ctx) => {
    const channels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    const channelIds = new Set(channels.map((c) => c._id));
    const allMessages = await ctx.db.query("chatMessages").collect();
    return allMessages
      .filter((m) => channelIds.has(m.channelId))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((m) => ({
        content: m.content,
        senderName: m.senderName,
        contentType: m.contentType,
        mentionedUserIds: m.mentionedUserIds,
        createdAt: m.createdAt,
      }));
  });
}
