/**
 * FOUNT Service Planning Bot - Seed Config
 *
 * One-shot mutation to populate slackBotConfig from the current hardcoded
 * config.ts values. Run once per environment to migrate to DB config:
 *
 *   npx convex run functions/slackServiceBot/seedConfig:seedSlackBotConfig
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";
import {
  DEV_MODE,
  SERVICES_CHANNEL_ID,
  BOT_SLACK_USER_ID,
  TEAM_MEMBERS,
  THREAD_MENTIONS,
  NAG_SCHEDULE,
  THREAD_CREATION,
  SERVICE_PLAN_ITEMS,
  SERVICE_PLAN_LABELS,
  ITEM_RESPONSIBLE_ROLES,
  PCO_COMMUNITY_ID,
  PCO_SERVICE_TYPE_IDS,
  PCO_ROLE_MAPPINGS,
  OPENAI_MODEL,
} from "./config";

export const seedSlackBotConfig = internalMutation({
  args: { communityName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    let communityId: Id<"communities">;

    if (args.communityName) {
      // Look up community by name — prefer exact match, fall back to partial
      const communities = await ctx.db.query("communities").collect();
      const query = args.communityName!.toLowerCase();
      const exact = communities.find((c) => c.name?.toLowerCase() === query);
      if (exact) {
        communityId = exact._id;
      } else {
        const partial = communities.filter((c) => c.name?.toLowerCase().includes(query));
        if (partial.length === 0) {
          throw new Error(`Community "${args.communityName}" not found.`);
        }
        if (partial.length > 1) {
          throw new Error(
            `Multiple communities match "${args.communityName}": ${partial.map((c) => c.name).join(", ")}. Use an exact name.`
          );
        }
        communityId = partial[0]._id;
      }
    } else {
      communityId = PCO_COMMUNITY_ID as Id<"communities">;
    }

    // Check if config already exists
    const existing = await ctx.db
      .query("slackBotConfig")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .first();

    if (existing) {
      console.log("[SeedConfig] Config already exists for this community, skipping.");
      return { skipped: true, configId: existing._id };
    }

    const configId = await ctx.db.insert("slackBotConfig", {
      communityId,
      enabled: true,

      // Slack config
      slackChannelId: SERVICES_CHANNEL_ID,
      botSlackUserId: BOT_SLACK_USER_ID,
      devMode: DEV_MODE,

      // Team members
      teamMembers: TEAM_MEMBERS.map((m) => ({
        name: m.name,
        slackUserId: m.slackUserId,
        roles: [...m.roles],
        locations: [...m.locations],
      })),
      threadMentions: { ...THREAD_MENTIONS },

      // Schedule
      nagSchedule: NAG_SCHEDULE.map((n) => ({
        dayOfWeek: n.dayOfWeek,
        hourET: n.hourET,
        urgency: n.urgency,
        label: n.label,
      })),
      threadCreation: { ...THREAD_CREATION },

      // Service plan items (V1)
      servicePlanItems: [...SERVICE_PLAN_ITEMS],
      servicePlanLabels: { ...SERVICE_PLAN_LABELS },
      itemResponsibleRoles: Object.fromEntries(
        Object.entries(ITEM_RESPONSIBLE_ROLES).map(([k, v]) => [k, [...v]])
      ),

      // Service plan items (V2) — unified format with action config
      servicePlanItemsV2: [
        {
          id: "preacher",
          label: "Preacher",
          responsibleRoles: ["preacher"],
          actionType: "assign_role",
          pcoTeamNamePattern: "platform",
          pcoPositionName: "Preacher",
        },
        {
          id: "meetingLead",
          label: "Meeting Lead (ML)",
          responsibleRoles: ["ml", "preacher"],
          actionType: "assign_role",
          pcoTeamNamePattern: "platform",
          pcoPositionName: "Meeting Leader",
        },
        {
          id: "preachNotes",
          label: "Preach Notes",
          responsibleRoles: ["preacher"],
          actionType: "update_plan_item",
          pcoItemTitlePattern: "message|preach|sermon",
          pcoItemField: "description",
        },
        {
          id: "setlist",
          label: "Setlist",
          responsibleRoles: ["ml", "worship"],
          actionType: "none",
        },
        {
          id: "serviceFlow",
          label: "Service Flow",
          responsibleRoles: ["production", "preacher"],
          actionType: "none",
        },
        {
          id: "announcements",
          label: "Announcements",
          responsibleRoles: ["admin", "preacher", "production"],
          actionType: "update_plan_item",
          pcoItemTitlePattern: "announcement",
          pcoItemField: "description",
          preserveSections: ["GIVING"],
        },
        {
          id: "serviceVideo",
          label: "Service Video",
          responsibleRoles: ["creative"],
          actionType: "none",
        },
      ],

      // PCO config — use the resolved communityId so custom-seeded configs
      // target the correct tenant at runtime
      pcoConfig: {
        communityId: communityId as string,
        serviceTypeIds: { ...PCO_SERVICE_TYPE_IDS },
        roleMappings: Object.fromEntries(
          Object.entries(PCO_ROLE_MAPPINGS).map(([k, v]) => [
            k,
            { teamNamePattern: v.teamNamePattern, positionName: v.positionName },
          ])
        ),
      },

      // AI config
      aiConfig: {
        model: OPENAI_MODEL,
        botPersonality:
          "You are the FOUNT service planning assistant, a Slack bot that helps coordinate Sunday services. You're friendly, efficient, and knowledgeable about FOUNT's two locations (Manhattan and Brooklyn).",
        responseRules:
          "Keep replies concise. Use Slack markdown (*bold*, _italic_, bullet points with •). Don't repeat information the team already knows. Be conversational, not robotic.",
        nagToneByLevel: {
          gentle: "Be warm and encouraging. This is a mid-week check-in, not a demand.",
          direct: "Be clear and specific about what's needed. Name who should provide what.",
          urgent: "Convey urgency. Service is in 2 days. Be direct but not rude.",
          critical: "This is the final call. Service is tomorrow. Be very direct about what's still missing.",
        },
        teamContext:
          "FOUNT has two locations: Manhattan (MH) and Brooklyn (BK). Each has its own Sunday service plan with a preacher, meeting lead, worship team, and production crew. Plans are coordinated in the Slack #services channel.",
      },

      // Initialize empty dedup and nag tracking
      processedMessageTs: [],
      nagsSent: {},

      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    console.log(`[SeedConfig] Created slackBotConfig: ${configId}`);
    return { created: true, configId };
  },
});

/**
 * Dev-only: Seed slackbot config for the Demo Community (where test user is admin).
 * Useful for testing the admin page in dev environments.
 *
 *   npx convex run functions/slackServiceBot/seedConfig:seedSlackBotConfigForDemo
 */
export const seedSlackBotConfigForDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Find Demo Community
    const communities = await ctx.db.query("communities").collect();
    const demo = communities.find((c) => c.name === "Demo Community");
    if (!demo) {
      throw new Error("Demo Community not found. Run seedDemoData first.");
    }

    // Check if config already exists
    const existing = await ctx.db
      .query("slackBotConfig")
      .withIndex("by_community", (q) => q.eq("communityId", demo._id))
      .first();

    if (existing) {
      console.log("[SeedConfig] Config already exists for Demo Community, skipping.");
      return { skipped: true, configId: existing._id };
    }

    const configId = await ctx.db.insert("slackBotConfig", {
      communityId: demo._id,
      enabled: true,
      slackChannelId: SERVICES_CHANNEL_ID,
      botSlackUserId: BOT_SLACK_USER_ID,
      devMode: true,
      teamMembers: TEAM_MEMBERS.map((m) => ({
        name: m.name,
        slackUserId: m.slackUserId,
        roles: [...m.roles],
        locations: [...m.locations],
      })),
      threadMentions: { ...THREAD_MENTIONS },
      nagSchedule: NAG_SCHEDULE.map((n) => ({
        dayOfWeek: n.dayOfWeek,
        hourET: n.hourET,
        urgency: n.urgency,
        label: n.label,
      })),
      threadCreation: { ...THREAD_CREATION },
      servicePlanItems: [...SERVICE_PLAN_ITEMS],
      servicePlanLabels: { ...SERVICE_PLAN_LABELS },
      itemResponsibleRoles: Object.fromEntries(
        Object.entries(ITEM_RESPONSIBLE_ROLES).map(([k, v]) => [k, [...v]])
      ),
      servicePlanItemsV2: [
        {
          id: "preacher",
          label: "Preacher",
          responsibleRoles: ["preacher"],
          actionType: "assign_role",
          pcoTeamNamePattern: "platform",
          pcoPositionName: "Preacher",
        },
        {
          id: "meetingLead",
          label: "Meeting Lead (ML)",
          responsibleRoles: ["ml", "preacher"],
          actionType: "assign_role",
          pcoTeamNamePattern: "platform",
          pcoPositionName: "Meeting Leader",
        },
        {
          id: "preachNotes",
          label: "Preach Notes",
          responsibleRoles: ["preacher"],
          actionType: "update_plan_item",
          pcoItemTitlePattern: "message|preach|sermon",
          pcoItemField: "description",
        },
        {
          id: "setlist",
          label: "Setlist",
          responsibleRoles: ["ml", "worship"],
          actionType: "none",
        },
        {
          id: "serviceFlow",
          label: "Service Flow",
          responsibleRoles: ["production", "preacher"],
          actionType: "none",
        },
        {
          id: "announcements",
          label: "Announcements",
          responsibleRoles: ["admin", "preacher", "production"],
          actionType: "update_plan_item",
          pcoItemTitlePattern: "announcement",
          pcoItemField: "description",
          preserveSections: ["GIVING"],
        },
        {
          id: "serviceVideo",
          label: "Service Video",
          responsibleRoles: ["creative"],
          actionType: "none",
        },
      ],
      pcoConfig: {
        communityId: demo._id,
        serviceTypeIds: { ...PCO_SERVICE_TYPE_IDS },
        roleMappings: Object.fromEntries(
          Object.entries(PCO_ROLE_MAPPINGS).map(([k, v]) => [
            k,
            { teamNamePattern: v.teamNamePattern, positionName: v.positionName },
          ])
        ),
      },
      aiConfig: {
        model: OPENAI_MODEL,
        botPersonality:
          "You are the FOUNT service planning assistant, a Slack bot that helps coordinate Sunday services.",
        responseRules:
          "Keep replies concise. Use Slack markdown. Be conversational, not robotic.",
        nagToneByLevel: {
          gentle: "Be warm and encouraging.",
          direct: "Be clear and specific about what's needed.",
          urgent: "Convey urgency. Service is in 2 days.",
          critical: "This is the final call. Service is tomorrow.",
        },
        teamContext:
          "FOUNT has two locations: Manhattan (MH) and Brooklyn (BK).",
      },
      processedMessageTs: [],
      nagsSent: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    console.log(`[SeedConfig] Created slackBotConfig for Demo Community: ${configId}`);
    return { created: true, configId, communityId: demo._id };
  },
});

/**
 * Dev-only: Ensure the given user is an admin on Demo Community.
 *
 *   npx convex run functions/slackServiceBot/seedConfig:ensureDemoAdmin '{"phone":"+15550001234"}'
 */
export const ensureDemoAdmin = internalMutation({
  args: { phone: v.string() },
  handler: async (ctx, { phone }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_phone", (q: any) => q.eq("phone", phone))
      .first();
    if (!user) throw new Error(`User not found for phone: ${phone}`);

    const communities = await ctx.db.query("communities").collect();
    const demo = communities.find((c: any) => c.name === "Demo Community");
    if (!demo) throw new Error("Demo Community not found.");

    const existing = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q: any) =>
        q.eq("userId", user._id).eq("communityId", demo._id)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { roles: 4, status: 1 });
      return { updated: true, userId: user._id, communityId: demo._id };
    }

    const id = await ctx.db.insert("userCommunities", {
      userId: user._id,
      communityId: demo._id,
      roles: 4,
      status: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { created: true, id, userId: user._id, communityId: demo._id };
  },
});
