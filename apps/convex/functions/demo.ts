/**
 * Self-serve demo communities.
 *
 * A prospective church answers a short questionnaire (name, congregation size,
 * campuses, small groups, zip code, logo, brand colors) and instantly gets a
 * private seeded community where they are the primary admin: realistic groups
 * scaled to their answers, channel conversations, upcoming events with RSVPs,
 * a community-wide event, and prayer requests. Every feature works because a
 * demo community IS a real community row — branding, admin settings, chat,
 * events, and prayer all run through the normal code paths.
 *
 * This is the front door for creating a community: churches start in demo
 * mode and go live from inside the app by adding payment ($1/month per active
 * member — see functions/memberActivity.ts and ee/billing.convertDemoToLive).
 * Conversion flips isDemo off and purges the seeded placeholder members
 * (purgeDemoSeedUsers) while keeping groups, branding, and real accounts.
 *
 * Collaboration: the creator gets a demo code (the community slug). Anyone who
 * joins with the code becomes a community admin too, so a whole staff team can
 * re-brand and click around the same demo simultaneously (Convex mutations are
 * transactional, so concurrent edits are safe). A demo holds at most
 * MAX_REAL_USERS real accounts alongside its DEMO_SEED_USER_COUNT seeded
 * placeholder members.
 *
 * Isolation: demo communities are `isDemo: true` + `isPublic: false`, and are
 * filtered out of community search (functions/resources.ts), so real users
 * never discover them. All tenant scoping is the existing communityId +
 * membership checks — nothing demo-specific is needed.
 */

import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { MutationCtx, QueryCtx } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { now, generateShortId, buildSearchText, getMediaUrl } from "../lib/utils";
import { COMMUNITY_ROLES } from "../lib/permissions";

// ============================================================================
// Template data
// ============================================================================

// Caps keep a single mutation comfortably inside Convex write limits while
// still looking like a real church. Larger answers scale the *labels* (e.g.
// "12 of your 40 groups") rather than the row counts.
const MAX_SMALL_GROUPS = 6;
const MAX_CAMPUSES = 4;

/** Every demo is populated by exactly this many placeholder members. */
export const DEMO_SEED_USER_COUNT = 100;

/**
 * Real (non-placeholder) accounts allowed in one demo — the creator plus the
 * staff teammates they invite with the demo code. Going live lifts the cap.
 */
export const MAX_REAL_USERS = 10;

const FIRST_NAMES = [
  "Sarah", "James", "Grace", "Marcus", "Hannah", "Daniel", "Ruth", "Peter",
  "Naomi", "Caleb", "Esther", "Andre", "Lydia", "Isaiah", "Mary", "Tom",
  "Priya", "Samuel", "Elena", "Joshua",
];

const LAST_NAMES = [
  "Mitchell", "Okafor", "Kim", "Rivera", "Thompson", "Nguyen", "Adeyemi",
  "Kowalski", "Castillo", "Johnson", "Park", "Silva", "Brennan", "Wright",
  "Santos", "Eriksen", "Patel", "Baker", "Ivanova", "Cohen",
];

/** Deterministic unique name for the i-th seeded demo member. */
function demoMemberName(i: number): { firstName: string; lastName: string } {
  const block = Math.floor(i / FIRST_NAMES.length);
  return {
    firstName: FIRST_NAMES[i % FIRST_NAMES.length],
    lastName: LAST_NAMES[(i + block) % LAST_NAMES.length],
  };
}

const GROUP_TYPES = [
  {
    name: "Small Groups",
    slug: "small-groups",
    description: "Weekly small group gatherings for community and study",
    icon: "users",
    displayOrder: 1,
  },
  {
    name: "Teams",
    slug: "teams",
    description: "Ministry and service teams",
    icon: "briefcase",
    displayOrder: 2,
  },
  {
    name: "Classes",
    slug: "classes",
    description: "Educational classes and workshops",
    icon: "book-open",
    displayOrder: 3,
  },
  {
    name: "Announcements",
    slug: "announcements",
    description: "Community announcements",
    icon: "megaphone",
    displayOrder: 0,
  },
];

const CAMPUS_GROUP_TYPE = {
  name: "Campuses",
  slug: "campuses",
  description: "Campus communities",
  icon: "map-pin",
  displayOrder: 4,
};

const SMALL_GROUP_NAMES = [
  "Northside Small Group",
  "Downtown Small Group",
  "Riverside Small Group",
  "Young Adults",
  "Families Small Group",
  "Men's Bible Study",
];

const CAMPUS_NAMES = ["Main Campus", "North Campus", "East Campus", "South Campus"];

// Conversation scripts, sender index rotates through group members.
const SMALL_GROUP_CHAT: string[] = [
  "Hey everyone! Are we still on for this week?",
  "Yes! 7pm at our usual spot. I'll bring snacks 😊",
  "I can grab drinks on the way.",
  "Can I bring a friend who's new to the area?",
  "Of course — the more the merrier!",
  "Praying for you all this week. See you soon!",
];

const TEAM_CHAT: string[] = [
  "Schedule for Sunday is up — check your assignments!",
  "I can swap with anyone who needs this Sunday off.",
  "Sound check is at 8am sharp. Coffee's on me ☕",
  "Thanks team, you all served so well last weekend.",
];

const CLASS_CHAT: string[] = [
  "Welcome to the class! We meet Sundays right after service.",
  "So excited to be here!",
  "Reminder: bring your workbook this week.",
];

const CAMPUS_CHAT: string[] = [
  "Great turnout this Sunday — welcome to all our new faces!",
  "Parking reminder: overflow lot opens at 8:30am.",
  "Volunteers needed for next weekend, reply here if you can help.",
];

const PRAYER_REQUESTS = [
  { body: "Please pray for my mom's surgery this Thursday.", isAnonymous: false, prayedForCount: 4 },
  { body: "Starting a new job next week — prayers for a smooth transition appreciated.", isAnonymous: false, prayedForCount: 2 },
  { body: "Struggling with anxiety lately and could use prayer.", isAnonymous: true, prayedForCount: 7 },
];

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const DEFAULT_RSVP_OPTIONS = [
  { id: 1, label: "Attending", enabled: true },
  { id: 2, label: "Maybe", enabled: true },
  { id: 3, label: "Not Attending", enabled: true },
];

function isValidHex(hex: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(hex);
}

function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

// ============================================================================
// Seeding helpers (plain functions — the whole seed runs in ONE mutation so a
// half-created demo can never exist)
// ============================================================================

type SeededChannels = {
  mainChannelId: Id<"chatChannels">;
  leadersChannelId: Id<"chatChannels">;
  announcementsChannelId?: Id<"chatChannels">;
};

async function createDemoGroup(
  ctx: MutationCtx,
  args: {
    communityId: Id<"communities">;
    groupTypeId: Id<"groupTypes">;
    createdById: Id<"users">;
    name: string;
    description?: string;
    isPublic: boolean;
    isAnnouncementGroup?: boolean;
    includeAnnouncementsChannel?: boolean;
    defaultDay?: number;
    defaultStartTime?: string;
    defaultEndTime?: string;
  },
): Promise<{ groupId: Id<"groups">; channels: SeededChannels }> {
  const timestamp = now();

  const groupId = await ctx.db.insert("groups", {
    communityId: args.communityId,
    groupTypeId: args.groupTypeId,
    name: args.name,
    description: args.description,
    isPublic: args.isPublic,
    isArchived: false,
    shortId: generateShortId(),
    isAnnouncementGroup: args.isAnnouncementGroup,
    defaultDay: args.defaultDay,
    defaultStartTime: args.defaultStartTime,
    defaultEndTime: args.defaultEndTime,
    defaultMeetingType: 1, // In-Person
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const mainChannelId = await ctx.db.insert("chatChannels", {
    groupId,
    slug: "general",
    channelType: "main",
    name: args.name,
    createdById: args.createdById,
    createdAt: timestamp,
    updatedAt: timestamp,
    isArchived: false,
    memberCount: 0,
  });

  const leadersChannelId = await ctx.db.insert("chatChannels", {
    groupId,
    slug: "leaders",
    channelType: "leaders",
    name: `${args.name} Leaders`,
    createdById: args.createdById,
    createdAt: timestamp,
    updatedAt: timestamp,
    isArchived: false,
    memberCount: 0,
  });

  let announcementsChannelId: Id<"chatChannels"> | undefined;
  if (args.includeAnnouncementsChannel) {
    announcementsChannelId = await ctx.db.insert("chatChannels", {
      groupId,
      slug: "announcements",
      channelType: "announcements",
      name: "Announcements",
      description:
        "Leader announcements — visible to all members; only leaders can post.",
      createdById: args.createdById,
      createdAt: timestamp,
      updatedAt: timestamp,
      isArchived: false,
      isEnabled: true,
      memberCount: 0,
    });
  }

  return { groupId, channels: { mainChannelId, leadersChannelId, announcementsChannelId } };
}

async function addGroupMember(
  ctx: MutationCtx,
  groupId: Id<"groups">,
  userId: Id<"users">,
  role: "leader" | "member",
): Promise<void> {
  await ctx.db.insert("groupMembers", {
    groupId,
    userId,
    role,
    joinedAt: now(),
    notificationsEnabled: true,
  });
}

async function addChannelMember(
  ctx: MutationCtx,
  channelId: Id<"chatChannels">,
  userId: Id<"users">,
  role: "admin" | "member",
  displayName: string,
): Promise<void> {
  await ctx.db.insert("chatChannelMembers", {
    channelId,
    userId,
    role,
    joinedAt: now(),
    isMuted: false,
    displayName,
  });
  const channel = await ctx.db.get(channelId);
  if (channel) {
    await ctx.db.patch(channelId, { memberCount: (channel.memberCount || 0) + 1 });
  }
}

/**
 * Bulk-seeding variant of addChannelMember: inserts the membership and counts
 * it in `counts` instead of read+patching the channel per insert (with 100
 * seeded members that halves the write volume). Callers flush `counts` once
 * via flushChannelCounts.
 */
async function addChannelMemberCounted(
  ctx: MutationCtx,
  counts: Map<Id<"chatChannels">, number>,
  channelId: Id<"chatChannels">,
  userId: Id<"users">,
  role: "admin" | "member",
  displayName: string,
): Promise<void> {
  await ctx.db.insert("chatChannelMembers", {
    channelId,
    userId,
    role,
    joinedAt: now(),
    isMuted: false,
    displayName,
  });
  counts.set(channelId, (counts.get(channelId) ?? 0) + 1);
}

async function flushChannelCounts(
  ctx: MutationCtx,
  counts: Map<Id<"chatChannels">, number>,
): Promise<void> {
  for (const [channelId, added] of counts) {
    const channel = await ctx.db.get(channelId);
    if (channel) {
      await ctx.db.patch(channelId, {
        memberCount: (channel.memberCount || 0) + added,
      });
    }
  }
  counts.clear();
}

/** Count the real (non-placeholder) accounts that belong to a demo. */
async function countRealUsers(
  ctx: QueryCtx | MutationCtx,
  communityId: Id<"communities">,
): Promise<number> {
  const memberships = await ctx.db
    .query("userCommunities")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .collect();
  let count = 0;
  for (const membership of memberships) {
    if (membership.status !== 1) continue;
    const user = await ctx.db.get(membership.userId);
    if (user && !user.isPlaceholder) count++;
  }
  return count;
}

/**
 * Post a scripted conversation into a channel from rotating senders, staggered
 * over the past few days, and denormalize the last message onto the channel so
 * inbox previews render.
 */
async function seedConversation(
  ctx: MutationCtx,
  args: {
    channelId: Id<"chatChannels">;
    communityId: Id<"communities">;
    script: string[];
    senders: Array<{ userId: Id<"users">; name: string }>;
  },
): Promise<void> {
  if (args.senders.length === 0 || args.script.length === 0) return;

  const timestamp = now();
  // Oldest message ~2 days ago, newest ~1 hour ago.
  const span = 2 * DAY - HOUR;
  const step = span / args.script.length;

  let lastContent = "";
  let lastSender = args.senders[0];
  let lastAt = timestamp;

  for (let i = 0; i < args.script.length; i++) {
    const sender = args.senders[i % args.senders.length];
    const createdAt = timestamp - 2 * DAY + Math.round(step * (i + 1));
    await ctx.db.insert("chatMessages", {
      channelId: args.channelId,
      communityId: args.communityId,
      senderId: sender.userId,
      content: args.script[i],
      contentType: "text",
      createdAt,
      isDeleted: false,
      senderName: sender.name,
      lastActivityAt: createdAt,
    });
    lastContent = args.script[i];
    lastSender = sender;
    lastAt = createdAt;
  }

  await ctx.db.patch(args.channelId, {
    lastMessageAt: lastAt,
    lastMessagePreview: lastContent.slice(0, 100),
    lastMessageSenderId: lastSender.userId,
    lastMessageSenderName: lastSender.name,
    updatedAt: lastAt,
  });
}

async function createDemoMeeting(
  ctx: MutationCtx,
  args: {
    groupId: Id<"groups">;
    communityId: Id<"communities">;
    createdById: Id<"users">;
    title: string;
    scheduledAt: number;
    note?: string;
    communityWideEventId?: Id<"communityWideEvents">;
  },
): Promise<Id<"meetings">> {
  return await ctx.db.insert("meetings", {
    groupId: args.groupId,
    createdById: args.createdById,
    hostUserIds: [args.createdById],
    title: args.title,
    scheduledAt: args.scheduledAt,
    meetingType: 1, // In-Person
    note: args.note,
    status: "scheduled",
    shortId: generateShortId(),
    rsvpEnabled: true,
    rsvpOptions: DEFAULT_RSVP_OPTIONS,
    visibility: "group",
    locationMode: "tbd",
    communityWideEventId: args.communityWideEventId,
    communityId: args.communityId,
    searchText: args.title.toLowerCase(),
    createdAt: now(),
    reminderSent: false,
    attendanceConfirmationSent: false,
  });
}

/**
 * Generate a unique demo slug like "demo-grace-fellowship". The slug doubles
 * as the shareable demo code, so keep it readable; add a random suffix only on
 * collision.
 */
async function uniqueDemoSlug(ctx: MutationCtx, name: string): Promise<string> {
  const base = `demo-${nameToSlug(name) || "church"}`;
  const existing = await ctx.db
    .query("communities")
    .withIndex("by_slug", (q) => q.eq("slug", base))
    .first();
  if (!existing) return base;

  // Retry with random suffixes until free (collisions are vanishingly rare).
  for (;;) {
    const candidate = `${base}-${generateShortId().slice(-4)}`;
    const taken = await ctx.db
      .query("communities")
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .first();
    if (!taken) return candidate;
  }
}

/**
 * Add a real user to every group and channel of a demo community so their
 * inbox, groups, and leader surfaces are fully populated the moment they land.
 * Used for both the creator and teammates joining via demo code.
 */
async function enrollUserEverywhere(
  ctx: MutationCtx,
  communityId: Id<"communities">,
  userId: Id<"users">,
  displayName: string,
): Promise<void> {
  const groups = await ctx.db
    .query("groups")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .collect();

  for (const group of groups) {
    const existingMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) => q.eq("groupId", group._id).eq("userId", userId))
      .first();
    if (!existingMembership) {
      await addGroupMember(ctx, group._id, userId, "leader");
    }

    const channels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", group._id))
      .collect();
    for (const channel of channels) {
      const existingChannelMembership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channel._id).eq("userId", userId),
        )
        .first();
      if (!existingChannelMembership) {
        await addChannelMember(ctx, channel._id, userId, "admin", displayName);
      }
    }
  }
}

// ============================================================================
// Public mutations
// ============================================================================

export const createDemoCommunity = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    // Questionnaire answers. All sizing inputs are optional — sensible church
    // defaults apply when omitted.
    totalSize: v.optional(v.number()),
    campusCount: v.optional(v.number()),
    smallGroupCount: v.optional(v.number()),
    zipCode: v.optional(v.string()),
    logo: v.optional(v.string()), // "r2:..." storage path from getR2UploadUrl
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const name = args.name.trim();
    if (!name) throw new Error("Church name is required");
    if (args.primaryColor && !isValidHex(args.primaryColor)) {
      throw new Error("Primary color must be a hex color like #3B82F6");
    }
    if (args.secondaryColor && !isValidHex(args.secondaryColor)) {
      throw new Error("Secondary color must be a hex color like #1E293B");
    }

    const caller = await ctx.db.get(userId);
    if (!caller) throw new Error("User not found");
    const callerName =
      [caller.firstName, caller.lastName].filter(Boolean).join(" ") || "You";

    const timestamp = now();
    const slug = await uniqueDemoSlug(ctx, name);

    // Congregation size only steers the default group count — every demo is
    // populated by exactly DEMO_SEED_USER_COUNT placeholder members.
    const totalSize = args.totalSize ?? 100;
    const smallGroups = clamp(
      args.smallGroupCount ?? Math.ceil(totalSize / 50),
      1,
      MAX_SMALL_GROUPS,
    );
    const campuses = clamp(args.campusCount ?? 1, 1, MAX_CAMPUSES);

    // ---- Community ----
    const communityId = await ctx.db.insert("communities", {
      name,
      slug,
      isPublic: false,
      isDemo: true,
      demoCreatedById: userId,
      logo: args.logo,
      zipCode: args.zipCode?.trim() || undefined,
      timezone: "America/New_York",
      country: "USA",
      primaryColor: args.primaryColor ?? "#1E8449",
      secondaryColor: args.secondaryColor ?? "#2E86C1",
      // Every feature on, so the whole product is explorable in the demo.
      churchFeatures: { prayerEnabled: true, eventTasksEnabled: true },
      searchText: `${name} ${slug}`.toLowerCase(),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // ---- Creator membership (primary admin) ----
    await ctx.db.insert("userCommunities", {
      userId,
      communityId,
      roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
      status: 1, // Active
      createdAt: timestamp,
      updatedAt: timestamp,
      lastLogin: timestamp,
    });
    await ctx.db.patch(userId, { activeCommunityId: communityId, updatedAt: timestamp });

    // ---- Placeholder members ----
    const members: Array<{ userId: Id<"users">; name: string }> = [];
    for (let i = 0; i < DEMO_SEED_USER_COUNT; i++) {
      const person = demoMemberName(i);
      const memberId = await ctx.db.insert("users", {
        firstName: person.firstName,
        lastName: person.lastName,
        isPlaceholder: true, // never a real login; see users.isPlaceholder
        isActive: true,
        searchText: buildSearchText(person),
        timezone: "America/New_York",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await ctx.db.insert("userCommunities", {
        userId: memberId,
        communityId,
        roles: COMMUNITY_ROLES.MEMBER,
        status: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      members.push({ userId: memberId, name: `${person.firstName} ${person.lastName}` });
    }

    // ---- Group types ----
    const groupTypeIds: Record<string, Id<"groupTypes">> = {};
    const typesToCreate =
      campuses > 1 ? [...GROUP_TYPES, CAMPUS_GROUP_TYPE] : GROUP_TYPES;
    for (const groupType of typesToCreate) {
      groupTypeIds[groupType.slug] = await ctx.db.insert("groupTypes", {
        communityId,
        name: groupType.name,
        slug: groupType.slug,
        description: groupType.description,
        icon: groupType.icon,
        displayOrder: groupType.displayOrder,
        isActive: true,
        createdAt: timestamp,
      });
    }

    // ---- Groups ----
    // Each entry: seeded group + which members populate it + its chat script.
    const seededGroups: Array<{
      groupId: Id<"groups">;
      name: string;
      channels: SeededChannels;
      groupMembers: Array<{ userId: Id<"users">; name: string }>;
      isSmallGroup: boolean;
    }> = [];

    // Announcement group (named after the church, everyone belongs).
    const announcement = await createDemoGroup(ctx, {
      communityId,
      groupTypeId: groupTypeIds["announcements"],
      createdById: userId,
      name,
      description: "Official community announcements",
      isPublic: true,
      isAnnouncementGroup: true,
      includeAnnouncementsChannel: true,
    });
    const channelCounts = new Map<Id<"chatChannels">, number>();
    for (const member of members) {
      await addGroupMember(ctx, announcement.groupId, member.userId, "member");
      await addChannelMemberCounted(ctx, channelCounts, announcement.channels.mainChannelId, member.userId, "member", member.name);
      if (announcement.channels.announcementsChannelId) {
        await addChannelMemberCounted(ctx, channelCounts, announcement.channels.announcementsChannelId, member.userId, "member", member.name);
      }
    }

    const groupDefs: Array<{
      name: string;
      typeSlug: string;
      description: string;
      script: string[];
      isSmallGroup?: boolean;
      defaultDay?: number;
    }> = [];

    for (let i = 0; i < smallGroups; i++) {
      groupDefs.push({
        name: SMALL_GROUP_NAMES[i],
        typeSlug: "small-groups",
        description: "Weekly gathering for community, study, and prayer",
        script: SMALL_GROUP_CHAT,
        isSmallGroup: true,
        defaultDay: (i % 5) + 1, // spread across weekdays
      });
    }
    groupDefs.push(
      {
        name: "Worship Team",
        typeSlug: "teams",
        description: "Musicians and vocalists serving in weekend services",
        script: TEAM_CHAT,
      },
      {
        name: "Welcome Team",
        typeSlug: "teams",
        description: "First impressions, greeting, and hospitality",
        script: TEAM_CHAT,
      },
      {
        name: "New Members Class",
        typeSlug: "classes",
        description: "Introduction to our community for new attendees",
        script: CLASS_CHAT,
      },
    );
    if (campuses > 1) {
      for (let i = 0; i < campuses; i++) {
        groupDefs.push({
          name: CAMPUS_NAMES[i],
          typeSlug: "campuses",
          description: "Campus community and updates",
          script: CAMPUS_CHAT,
        });
      }
    }

    for (let g = 0; g < groupDefs.length; g++) {
      const def = groupDefs[g];
      const created = await createDemoGroup(ctx, {
        communityId,
        groupTypeId: groupTypeIds[def.typeSlug],
        createdById: userId,
        name: def.name,
        description: def.description,
        isPublic: true,
        defaultDay: def.defaultDay,
        defaultStartTime: def.defaultDay !== undefined ? "19:00" : undefined,
        defaultEndTime: def.defaultDay !== undefined ? "21:00" : undefined,
      });

      // Rotate 6-8 placeholder members into each group; first one leads.
      const groupMembers: Array<{ userId: Id<"users">; name: string }> = [];
      const size = 6 + (g % 3);
      for (let m = 0; m < Math.min(size, members.length); m++) {
        const member = members[(g * 7 + m * 3) % members.length];
        const isLeader = m === 0;
        await addGroupMember(ctx, created.groupId, member.userId, isLeader ? "leader" : "member");
        await addChannelMemberCounted(ctx, channelCounts, created.channels.mainChannelId, member.userId, isLeader ? "admin" : "member", member.name);
        if (isLeader) {
          await addChannelMemberCounted(ctx, channelCounts, created.channels.leadersChannelId, member.userId, "admin", member.name);
        }
        groupMembers.push(member);
      }

      await seedConversation(ctx, {
        channelId: created.channels.mainChannelId,
        communityId,
        script: def.script,
        senders: groupMembers,
      });

      seededGroups.push({
        groupId: created.groupId,
        name: def.name,
        channels: created.channels,
        groupMembers,
        isSmallGroup: def.isSmallGroup ?? false,
      });
    }

    // ---- Community-wide event (spawns a child meeting per small group) ----
    const serveDayAt = timestamp + 10 * DAY;
    const cweId = await ctx.db.insert("communityWideEvents", {
      communityId,
      groupTypeId: groupTypeIds["small-groups"],
      createdById: userId,
      title: "Serve Day",
      scheduledAt: serveDayAt,
      meetingType: 1,
      note: "All small groups serving our city together.",
      status: "scheduled",
      createdAt: timestamp,
    });

    // ---- Meetings + RSVPs ----
    for (let g = 0; g < seededGroups.length; g++) {
      const group = seededGroups[g];
      const meetingIds: Id<"meetings">[] = [];

      meetingIds.push(
        await createDemoMeeting(ctx, {
          groupId: group.groupId,
          communityId,
          createdById: userId,
          title: `${group.name} Weekly Meeting`,
          scheduledAt: timestamp + (3 + g) * DAY,
          note: "Regular weekly gathering",
        }),
      );
      if (group.isSmallGroup) {
        meetingIds.push(
          await createDemoMeeting(ctx, {
            groupId: group.groupId,
            communityId,
            createdById: userId,
            title: "Serve Day",
            scheduledAt: serveDayAt,
            note: "All small groups serving our city together.",
            communityWideEventId: cweId,
          }),
        );
      }

      // Most members RSVP so attendance lists look alive.
      for (const meetingId of meetingIds) {
        for (let m = 0; m < group.groupMembers.length; m++) {
          const member = group.groupMembers[m];
          const optionId = m % 3 === 2 ? 2 : 1; // mostly Attending, some Maybe
          await ctx.db.insert("meetingRsvps", {
            meetingId,
            userId: member.userId,
            rsvpOptionId: optionId,
            guestCount: optionId === 1 && m % 4 === 0 ? 1 : undefined,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      }
    }

    // ---- Announcements conversation ----
    await seedConversation(ctx, {
      channelId: announcement.channels.mainChannelId,
      communityId,
      script: [
        `Welcome to ${name} on Togather! 🎉`,
        "Serve Day is coming up — RSVP in your group's events tab!",
      ],
      senders: members.slice(0, 2),
    });

    // ---- Prayer requests ----
    for (let p = 0; p < PRAYER_REQUESTS.length; p++) {
      const prayer = PRAYER_REQUESTS[p];
      await ctx.db.insert("prayers", {
        communityId,
        authorUserId: members[p % members.length].userId,
        isAnonymous: prayer.isAnonymous,
        bodyText: prayer.body,
        status: "active",
        prayedForCount: prayer.prayedForCount,
        moderationStatus: "approved",
        approvedAt: timestamp - (p + 1) * DAY,
        createdAt: timestamp - (p + 1) * DAY,
        updatedAt: timestamp - (p + 1) * DAY,
      });
    }

    // ---- Enroll the creator in every group/channel as leader ----
    await flushChannelCounts(ctx, channelCounts);
    await enrollUserEverywhere(ctx, communityId, userId, callerName);

    return {
      communityId,
      name,
      logo: getMediaUrl(args.logo) ?? null,
      primaryColor: args.primaryColor ?? "#1E8449",
      secondaryColor: args.secondaryColor ?? "#2E86C1",
      // Shareable code teammates enter to join this demo as co-admins.
      demoCode: slug,
    };
  },
});

/**
 * Join an existing demo community with its demo code. The joiner becomes a
 * community ADMIN (not primary) and is enrolled in every group and channel,
 * so several people can explore and modify the same demo simultaneously.
 */
export const joinDemoCommunity = mutation({
  args: {
    token: v.string(),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const code = args.code.trim().toLowerCase();
    if (!code) throw new Error("Demo code is required");

    const community = await ctx.db
      .query("communities")
      .withIndex("by_slug", (q) => q.eq("slug", code))
      .first();
    // Only demo communities are joinable by code — this must never become a
    // side door into a real community.
    if (!community || !community.isDemo) {
      throw new Error("No demo found for that code");
    }

    const caller = await ctx.db.get(userId);
    if (!caller) throw new Error("User not found");
    const callerName =
      [caller.firstName, caller.lastName].filter(Boolean).join(" ") || "Guest";

    const timestamp = now();
    const existing = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", community._id),
      )
      .first();

    // Demos hold at most MAX_REAL_USERS real accounts (the placeholder
    // members don't count). Existing members can always re-enter.
    if (!existing || existing.status !== 1) {
      const realUsers = await countRealUsers(ctx, community._id);
      if (realUsers >= MAX_REAL_USERS) {
        throw new Error(
          `This demo already has ${MAX_REAL_USERS} people in it. Go live to invite your whole community.`,
        );
      }
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        // Never downgrade (the creator re-entering their own code stays primary).
        roles: Math.max(existing.roles ?? 0, COMMUNITY_ROLES.ADMIN),
        status: 1,
        updatedAt: timestamp,
        lastLogin: timestamp,
      });
    } else {
      await ctx.db.insert("userCommunities", {
        userId,
        communityId: community._id,
        roles: COMMUNITY_ROLES.ADMIN,
        status: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastLogin: timestamp,
      });
    }
    await ctx.db.patch(userId, { activeCommunityId: community._id, updatedAt: timestamp });

    await enrollUserEverywhere(ctx, community._id, userId, callerName);

    return {
      communityId: community._id,
      name: community.name ?? "",
      logo: getMediaUrl(community.logo) ?? null,
      primaryColor: community.primaryColor ?? null,
      secondaryColor: community.secondaryColor ?? null,
      demoCode: community.slug ?? code,
    };
  },
});

/**
 * Demo state for the current community — drives the app-wide demo banner and
 * the go-live screen. Returns { isDemo: false } for live communities so the
 * banner can cheaply no-op.
 */
export const getDemoStatus = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const membership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", args.communityId),
      )
      .first();
    if (!membership || membership.status !== 1) {
      return { isDemo: false as const };
    }

    const community = await ctx.db.get(args.communityId);
    if (!community?.isDemo) {
      return { isDemo: false as const };
    }

    return {
      isDemo: true as const,
      demoCode: community.slug ?? "",
      realUserCount: await countRealUsers(ctx, args.communityId),
      maxRealUsers: MAX_REAL_USERS,
      isAdmin: (membership.roles ?? 0) >= COMMUNITY_ROLES.ADMIN,
    };
  },
});

// ============================================================================
// Going live
// ============================================================================

/**
 * Remove the seeded placeholder members (and everything they authored) after
 * a demo converts to a live community. Groups, channels, branding, settings,
 * events, and the real staff accounts all stay — only the fake people go.
 *
 * Scheduled by ee/billing.handleCheckoutCompleted when the demo-conversion
 * checkout finishes. Idempotent: placeholders are deleted as they're found,
 * so a webhook retry that schedules it twice finds nothing the second time.
 */
export const purgeDemoSeedUsers = internalMutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    let purged = 0;
    for (const membership of memberships) {
      const user = await ctx.db.get(membership.userId);
      if (!user?.isPlaceholder) continue;

      // Placeholder members exist only inside their demo community, so every
      // row keyed to them belongs to this community and is safe to delete.
      const groupRows = await ctx.db
        .query("groupMembers")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      for (const row of groupRows) await ctx.db.delete(row._id);

      const channelRows = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      for (const row of channelRows) await ctx.db.delete(row._id);

      const messages = await ctx.db
        .query("chatMessages")
        .withIndex("by_sender", (q) => q.eq("senderId", user._id))
        .collect();
      for (const row of messages) await ctx.db.delete(row._id);

      const rsvps = await ctx.db
        .query("meetingRsvps")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      for (const row of rsvps) await ctx.db.delete(row._id);

      const prayers = await ctx.db
        .query("prayers")
        .withIndex("by_author", (q) => q.eq("authorUserId", user._id))
        .collect();
      for (const row of prayers) await ctx.db.delete(row._id);

      await ctx.db.delete(membership._id);
      await ctx.db.delete(user._id);
      purged++;
    }

    // Recompute the denormalized channel state the purge invalidated:
    // memberCount and the inbox lastMessage preview.
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    for (const group of groups) {
      const channels = await ctx.db
        .query("chatChannels")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .collect();
      for (const channel of channels) {
        const remaining = await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
          .collect();
        const lastMessage = await ctx.db
          .query("chatMessages")
          .withIndex("by_channel_createdAt", (q) => q.eq("channelId", channel._id))
          .order("desc")
          .first();
        await ctx.db.patch(channel._id, {
          memberCount: remaining.filter((m) => m.leftAt === undefined).length,
          lastMessageAt: lastMessage?.createdAt,
          lastMessagePreview: lastMessage?.content.slice(0, 100),
          lastMessageSenderId: lastMessage?.senderId,
          lastMessageSenderName: lastMessage?.senderName,
        });
      }
    }

    console.log(
      `[demo] Purged ${purged} placeholder members from community ${args.communityId}`,
    );
    return { purged };
  },
});
