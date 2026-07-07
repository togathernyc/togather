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
import { DEFAULT_RSVP_OPTIONS } from "../lib/meetingConfig";

// ============================================================================
// Template data
// ============================================================================

// Caps keep a single mutation comfortably inside Convex write limits while
// still looking like a real church.
const MAX_SMALL_GROUPS = 12;
const MAX_CAMPUSES = 12;

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

// Demo-only external imagery so the app doesn't feel like an empty shell of
// initials (getMediaUrl passes absolute https URLs through untouched).
// Portraits live on seeded member rows (deleted on go-live); stock covers/
// avatars live on groups/events that SURVIVE go-live, so purgeDemoSeedUsers
// strips them (via isDemoStockUrl) rather than leaving a live community
// depending on these third-party hosts in production.
const DEMO_PORTRAIT_HOST = "https://randomuser.me/api/portraits/";
const DEMO_STOCK_HOST = "https://picsum.photos/";

// FIRST_NAMES alternates female/male, so portrait gender tracks the name.
function demoMemberPhoto(i: number): string {
  const gender = i % 2 === 0 ? "women" : "men";
  return `${DEMO_PORTRAIT_HOST}${gender}/${Math.floor(i / 2) % 100}.jpg`;
}

/** Stable per-seed stock photo (Lorem Picsum serves a fixed image per seed). */
function demoStockPhoto(seed: string, width = 800, height = 450): string {
  return `${DEMO_STOCK_HOST}seed/${encodeURIComponent(seed)}/${width}/${height}`;
}

/** True for a placeholder stock image this seeder put on a row. */
function isDemoStockUrl(url: string | undefined | null): boolean {
  return !!url && url.startsWith(DEMO_STOCK_HOST);
}

/**
 * Deterministic jitter around the church's home coordinates so seeded groups
 * and campuses spread out on the explore map instead of stacking on one pin
 * (~±0.04° ≈ a few miles).
 */
function jitterCoordinates(
  base: { latitude: number; longitude: number },
  index: number,
): { latitude: number; longitude: number } {
  return {
    latitude: base.latitude + (((index * 37) % 21) - 10) * 0.004,
    longitude: base.longitude + (((index * 53) % 21) - 10) * 0.005,
  };
}

// Type names are singular — they label individual groups ("Young Adults ·
// Small Group"), not the category listing.
const GROUP_TYPES = [
  {
    name: "Small Group",
    slug: "small-groups",
    description: "Weekly small group gatherings for community and study",
    icon: "users",
    displayOrder: 1,
  },
  {
    name: "Team",
    slug: "teams",
    description: "Ministry and service teams",
    icon: "briefcase",
    displayOrder: 2,
  },
  {
    name: "Class",
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
  name: "Campus",
  slug: "campuses",
  description: "Campus communities",
  icon: "map-pin",
  displayOrder: 4,
};

// Placeholder names used when the questionnaire doesn't provide real ones —
// the church can rename everything later.
const SMALL_GROUP_NAMES = [
  "Northside Small Group",
  "Downtown Small Group",
  "Riverside Small Group",
  "Young Adults",
  "Families Small Group",
  "Men's Bible Study",
  "Women's Bible Study",
  "College & Career",
  "Newlyweds Group",
  "Parents of Littles",
  "Neighborhood Group",
  "Seniors Fellowship",
];

const CAMPUS_NAMES = [
  "Main Campus",
  "North Campus",
  "South Campus",
  "East Campus",
  "West Campus",
  "Downtown Campus",
  "Riverside Campus",
  "Lakeside Campus",
  "Hillside Campus",
  "Midtown Campus",
  "Uptown Campus",
  "Parkside Campus",
];

/**
 * Resolve the names for N seeded groups/campuses: questionnaire-provided
 * names first (trimmed, blanks dropped), placeholder names for the rest.
 */
function resolveNames(
  requested: number,
  provided: string[] | undefined,
  placeholders: string[],
): string[] {
  const custom = (provided ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .slice(0, requested);
  const names = [...custom];
  for (let i = names.length; i < requested; i++) {
    names.push(placeholders[i % placeholders.length]);
  }
  return names;
}

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

const DM_CHAT: string[] = [
  "Hey! So glad you're checking out the app 😊",
  "Same! The groups map is really nice.",
  "Let's grab coffee after service Sunday?",
  "Deal. See you then!",
];

const GROUP_DM_CHAT: string[] = [
  "Starting a thread for Serve Day planning 🙌",
  "I can own sign-ups if someone takes supplies.",
  "Supplies are mine. What's our headcount target?",
  "Let's aim for 40 and see who RSVPs this week.",
];

/**
 * "Getting Started" guided missions — the SINGLE source of truth for both the
 * bot's numbered tour messages and getDemoProgress's checklist, so the two
 * can't drift. `title` shows on the Go Live screen; `instruction` is the bot
 * line. Every mission here is tracked by getDemoProgress.
 */
const GETTING_STARTED_MISSIONS = [
  {
    key: "send_message",
    title: "Send a message in a group",
    instruction:
      "Send a message — open any group's chat and say hi. Everything here is editable and safe to play with.",
  },
  {
    key: "create_event",
    title: "Create an event",
    instruction:
      "Create an event — open a group → Events → New Event. Try RSVP options and a cover photo.",
  },
  {
    key: "birthday_bot",
    title: "Set up the Birthday Bot",
    instruction:
      "Set up the Birthday Bot — open a group → settings → Bots. New members feel welcome when their birthday gets celebrated automatically.",
  },
  {
    key: "invite_teammate",
    title: "Invite a teammate with your demo code",
    instruction:
      "Invite a teammate — share your demo code (on the Go Live screen) so a co-worker can explore with you. Up to 10 people can join.",
  },
] as const;

const MISSION_NUMBER_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];

const GETTING_STARTED_MESSAGES: string[] = [
  "Welcome to your demo community! 👋 I'm the Togather bot. Here are the things worth trying while you explore — I'll check them off on the Go Live screen (tap the demo banner) as you go.",
  ...GETTING_STARTED_MISSIONS.map(
    (m, i) => `${MISSION_NUMBER_EMOJI[i]} ${m.instruction}`,
  ),
  "Any time, head to Admin → Settings to change your name, logo, and brand color — the whole app re-themes instantly. ✨",
  "When you're ready for the real thing, tap Go live on the banner — your groups, branding, and teammates stay; these demo members and I clean ourselves up. 🎉",
];

const PRAYER_REQUESTS = [
  { body: "Please pray for my mom's surgery this Thursday.", isAnonymous: false, prayedForCount: 4 },
  { body: "Starting a new job next week — prayers for a smooth transition appreciated.", isAnonymous: false, prayedForCount: 2 },
  { body: "Struggling with anxiety lately and could use prayer.", isAnonymous: true, prayedForCount: 7 },
];

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

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
    /** Group avatar (storage path or absolute URL) so the inbox has faces. */
    preview?: string;
    zipCode?: string;
    coordinates?: { latitude: number; longitude: number };
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
    preview: args.preview,
    zipCode: args.zipCode,
    coordinates: args.coordinates,
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
  profilePhoto?: string,
): Promise<void> {
  await ctx.db.insert("chatChannelMembers", {
    channelId,
    userId,
    role,
    joinedAt: now(),
    isMuted: false,
    displayName,
    profilePhoto,
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
  profilePhoto?: string,
): Promise<void> {
  await ctx.db.insert("chatChannelMembers", {
    channelId,
    userId,
    role,
    joinedAt: now(),
    isMuted: false,
    displayName,
    profilePhoto,
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

/**
 * Count the real (non-placeholder) accounts that belong to a demo. Seeded
 * members are always inserted as COMMUNITY_ROLES.MEMBER and real accounts are
 * always ADMIN+ (creator = primary admin, code-joiners = admin), so role
 * alone separates them — no per-user document read needed. This runs on the
 * hot path (getDemoStatus, subscribed by the app-wide banner on every screen).
 */
async function countRealUsers(
  ctx: QueryCtx | MutationCtx,
  communityId: Id<"communities">,
): Promise<number> {
  const memberships = await ctx.db
    .query("userCommunities")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .collect();
  return memberships.filter(
    (m) => m.status === 1 && (m.roles ?? 0) >= COMMUNITY_ROLES.ADMIN,
  ).length;
}

/**
 * Post a scripted conversation into a channel from rotating senders, staggered
 * over the past few days, and denormalize the last message onto the channel so
 * inbox previews render.
 */
type DemoSender = { userId?: Id<"users">; name: string; photo?: string };

async function seedConversation(
  ctx: MutationCtx,
  args: {
    channelId: Id<"chatChannels">;
    communityId: Id<"communities">;
    script: string[];
    /** Rotating senders; a sender without userId posts as a bot message. */
    senders: DemoSender[];
    contentType?: string;
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
      contentType: args.contentType ?? "text",
      createdAt,
      isDeleted: false,
      isDemoSeed: true, // distinguishes seed chatter from real user activity
      senderName: sender.name,
      senderProfilePhoto: sender.photo,
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
    coverImage?: string;
    /** e.g. "Main Campus · 11201" — the events map geocodes the zip inside. */
    locationOverride?: string;
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
    locationMode: args.locationOverride ? "address" : "tbd",
    locationOverride: args.locationOverride,
    coverImage: args.coverImage,
    communityWideEventId: args.communityWideEventId,
    communityId: args.communityId,
    searchText: args.title.toLowerCase(),
    isDemoSeed: true, // distinguishes seed events from ones the church creates
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
 * Add a real user to a demo community's groups with a REALISTIC role mix:
 * leader of the announcement group and the first couple of regular groups,
 * plain member everywhere else — like an actual staff member, not an
 * everything-leader. Channel access follows the role: main (and announcement
 * group extras like the Getting Started channel) everywhere, the
 * leaders-only channel just where they lead. Used for both the creator and
 * teammates joining via demo code; idempotent for re-joins.
 */
const REAL_USER_LEADER_GROUP_COUNT = 2;

async function enrollUserEverywhere(
  ctx: MutationCtx,
  communityId: Id<"communities">,
  userId: Id<"users">,
  displayName: string,
  profilePhoto?: string,
): Promise<void> {
  const groups = await ctx.db
    .query("groups")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .collect();

  // Stable ordering so "the first N groups" is deterministic across joins.
  const orderedGroups = [...groups].sort((a, b) =>
    a._creationTime - b._creationTime,
  );

  let regularGroupsLed = 0;
  for (const group of orderedGroups) {
    const leadsThisGroup =
      group.isAnnouncementGroup === true ||
      (!group.isAnnouncementGroup && regularGroupsLed < REAL_USER_LEADER_GROUP_COUNT);
    if (leadsThisGroup && !group.isAnnouncementGroup) regularGroupsLed++;

    const existingMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) => q.eq("groupId", group._id).eq("userId", userId))
      .first();
    if (!existingMembership) {
      await addGroupMember(ctx, group._id, userId, leadsThisGroup ? "leader" : "member");
    }

    const channels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", group._id))
      .collect();
    for (const channel of channels) {
      // Leaders-only channels stay leaders-only.
      if (channel.channelType === "leaders" && !leadsThisGroup) continue;

      const existingChannelMembership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channel._id).eq("userId", userId),
        )
        .first();
      if (!existingChannelMembership) {
        await addChannelMember(
          ctx,
          channel._id,
          userId,
          leadsThisGroup ? "admin" : "member",
          displayName,
          profilePhoto,
        );
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
    // Optional real names for campuses/groups; placeholders fill the rest.
    campusNames: v.optional(v.array(v.string())),
    groupNames: v.optional(v.array(v.string())),
    // Home coordinates (client geocodes the zip) — seeded groups and events
    // spread around this point on the map.
    baseCoordinates: v.optional(
      v.object({ latitude: v.number(), longitude: v.number() }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const name = args.name.trim();
    if (!name) throw new Error("Church name is required");
    if (args.primaryColor && !isValidHex(args.primaryColor)) {
      throw new Error("Primary color must be a hex color like #3B82F6");
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
    const members: Array<{ userId: Id<"users">; name: string; photo: string }> = [];
    for (let i = 0; i < DEMO_SEED_USER_COUNT; i++) {
      const person = demoMemberName(i);
      const photo = demoMemberPhoto(i);
      const memberId = await ctx.db.insert("users", {
        firstName: person.firstName,
        lastName: person.lastName,
        isPlaceholder: true, // never a real login; see users.isPlaceholder
        isDemoSeed: true, // purged on go-live; see purgeDemoSeedUsers
        isActive: true,
        profilePhoto: photo,
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
      members.push({
        userId: memberId,
        name: `${person.firstName} ${person.lastName}`,
        photo,
      });
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
      groupMembers: Array<{ userId: Id<"users">; name: string; photo: string }>;
      isSmallGroup: boolean;
    }> = [];

    const zipCode = args.zipCode?.trim() || undefined;

    // Announcement group (named after the church, everyone belongs). Its
    // avatar is the uploaded church logo so the inbox leads with their brand.
    const announcement = await createDemoGroup(ctx, {
      communityId,
      groupTypeId: groupTypeIds["announcements"],
      createdById: userId,
      name,
      description: "Official community announcements",
      isPublic: true,
      isAnnouncementGroup: true,
      includeAnnouncementsChannel: true,
      preview: args.logo ?? demoStockPhoto(`${slug}-announcements`, 400, 400),
      zipCode,
      coordinates: args.baseCoordinates,
    });
    const channelCounts = new Map<Id<"chatChannels">, number>();
    for (const member of members) {
      await addGroupMember(ctx, announcement.groupId, member.userId, "member");
      await addChannelMemberCounted(ctx, channelCounts, announcement.channels.mainChannelId, member.userId, "member", member.name, member.photo);
      if (announcement.channels.announcementsChannelId) {
        await addChannelMemberCounted(ctx, channelCounts, announcement.channels.announcementsChannelId, member.userId, "member", member.name, member.photo);
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

    const smallGroupNames = resolveNames(
      smallGroups,
      args.groupNames,
      SMALL_GROUP_NAMES,
    );
    for (let i = 0; i < smallGroups; i++) {
      groupDefs.push({
        name: smallGroupNames[i],
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
      const campusNames = resolveNames(campuses, args.campusNames, CAMPUS_NAMES);
      for (let i = 0; i < campuses; i++) {
        groupDefs.push({
          name: campusNames[i],
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
        preview: demoStockPhoto(`${slug}-group-${g}`, 400, 400),
        zipCode,
        // Scatter groups/campuses around the church's home coordinates so the
        // explore map looks like a real multi-site church, not a single pin.
        coordinates: args.baseCoordinates
          ? jitterCoordinates(args.baseCoordinates, g + 1)
          : undefined,
      });

      // Rotate 6-8 placeholder members into each group; first one leads.
      const groupMembers: Array<{ userId: Id<"users">; name: string; photo: string }> = [];
      const size = 6 + (g % 3);
      for (let m = 0; m < Math.min(size, members.length); m++) {
        const member = members[(g * 7 + m * 3) % members.length];
        const isLeader = m === 0;
        await addGroupMember(ctx, created.groupId, member.userId, isLeader ? "leader" : "member");
        await addChannelMemberCounted(ctx, channelCounts, created.channels.mainChannelId, member.userId, isLeader ? "admin" : "member", member.name, member.photo);
        if (isLeader) {
          await addChannelMemberCounted(ctx, channelCounts, created.channels.leadersChannelId, member.userId, "admin", member.name, member.photo);
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
      coverImage: demoStockPhoto(`${slug}-serve-day`),
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
          coverImage: demoStockPhoto(`${slug}-event-${g}`),
          // Zip inside the location string puts the event on the events map.
          locationOverride: zipCode ? `${group.name} · ${zipCode}` : undefined,
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
            coverImage: demoStockPhoto(`${slug}-serve-day`),
            locationOverride: zipCode ? `City-wide · ${zipCode}` : undefined,
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

    // ---- Getting Started channel (guided missions from the Togather bot) ----
    const gettingStartedChannelId = await ctx.db.insert("chatChannels", {
      groupId: announcement.groupId,
      slug: "getting-started",
      channelType: "custom",
      name: "🎓 Getting Started",
      description: "Guided tour: the best things to try in your demo.",
      createdById: userId,
      createdAt: timestamp,
      updatedAt: timestamp,
      isArchived: false,
      isEnabled: true,
      memberCount: 0,
    });
    await seedConversation(ctx, {
      channelId: gettingStartedChannelId,
      communityId,
      script: GETTING_STARTED_MESSAGES,
      // No userId -> stored like production bot messages (no senderId).
      senders: [{ name: "Togather Bot" }],
      contentType: "bot",
    });

    // ---- Enroll the creator with a realistic role mix ----
    await flushChannelCounts(ctx, channelCounts);
    const callerPhoto = caller.profilePhoto ?? undefined;
    await enrollUserEverywhere(ctx, communityId, userId, callerName, callerPhoto);

    // ---- DMs + a group DM so the inbox reads like a lived-in church ----
    const seedDmConversation = async (
      partners: Array<{ userId: Id<"users">; name: string; photo: string }>,
      groupName: string | undefined,
      script: string[],
    ) => {
      const isGroupDm = partners.length > 1;
      const participantIds = [String(userId), ...partners.map((p) => String(p.userId))];
      const dmChannelId = await ctx.db.insert("chatChannels", {
        communityId,
        isAdHoc: true,
        channelType: isGroupDm ? "group_dm" : "dm",
        name: groupName ?? "",
        dmPairKey: isGroupDm
          ? undefined
          : `${communityId}::${participantIds.sort().join("::")}`,
        createdById: userId,
        createdAt: timestamp,
        updatedAt: timestamp,
        isArchived: false,
        memberCount: partners.length + 1,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: dmChannelId,
        userId,
        role: "admin",
        joinedAt: timestamp,
        isMuted: false,
        requestState: "accepted",
        displayName: callerName,
        profilePhoto: callerPhoto,
      });
      for (const partner of partners) {
        await ctx.db.insert("chatChannelMembers", {
          channelId: dmChannelId,
          userId: partner.userId,
          role: "member",
          joinedAt: timestamp,
          isMuted: false,
          requestState: "accepted", // seeded chats are already in-progress
          invitedById: userId,
          displayName: partner.name,
          profilePhoto: partner.photo,
        });
      }
      await seedConversation(ctx, {
        channelId: dmChannelId,
        communityId,
        script,
        senders: [partners[0], { userId, name: callerName, photo: callerPhoto }],
      });
    };
    await seedDmConversation([members[0]], undefined, DM_CHAT);
    await seedDmConversation([members[2]], undefined, DM_CHAT.slice(0, 2));
    await seedDmConversation(
      [members[1], members[3], members[5]],
      "Serve Day planning",
      GROUP_DM_CHAT,
    );

    return {
      communityId,
      name,
      logo: getMediaUrl(args.logo) ?? null,
      primaryColor: args.primaryColor ?? "#1E8449",
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

    await enrollUserEverywhere(
      ctx,
      community._id,
      userId,
      callerName,
      caller.profilePhoto ?? undefined,
    );

    return {
      communityId: community._id,
      name: community.name ?? "",
      logo: getMediaUrl(community.logo) ?? null,
      primaryColor: community.primaryColor ?? null,
      demoCode: community.slug ?? code,
    };
  },
});

/**
 * Live progress through the Getting Started missions (see
 * GETTING_STARTED_MESSAGES) — computed from what real users actually did, so
 * the go-live screen can show "3 of 4 explored". Only meaningful for demos.
 */
export const getDemoProgress = query({
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
    if (!membership || membership.status !== 1) return null;

    const community = await ctx.db.get(args.communityId);
    if (!community?.isDemo) return null;

    // Real accounts = ADMIN+ memberships (seeds are always MEMBER); no
    // per-user reads. See countRealUsers.
    const memberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    const realUserIds = memberships
      .filter((m) => m.status === 1 && (m.roles ?? 0) >= COMMUNITY_ROLES.ADMIN)
      .map((m) => m.userId);

    // "Sent a message" = a real user authored a NON-seeded message in this
    // community. The by_sender_community index bounds the scan to this
    // community (a real user could have thousands of messages elsewhere), and
    // isDemoSeed excludes the scripted DM lines attributed to the creator —
    // no wall-clock heuristic, so a message sent seconds after entering counts.
    let sentMessage = false;
    for (const realUserId of realUserIds) {
      const message = await ctx.db
        .query("chatMessages")
        .withIndex("by_sender_community", (q) =>
          q.eq("senderId", realUserId).eq("communityId", args.communityId),
        )
        .filter((q) => q.neq(q.field("isDemoSeed"), true))
        .first();
      if (message) {
        sentMessage = true;
        break;
      }
    }

    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    const realUserIdSet = new Set(realUserIds.map((id) => String(id)));
    const createdEvent = meetings.some(
      (m) =>
        !m.isDemoSeed &&
        m.createdById !== undefined &&
        realUserIdSet.has(String(m.createdById)),
    );

    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    let birthdayBot = false;
    for (const group of groups) {
      const config = await ctx.db
        .query("groupBotConfigs")
        .withIndex("by_group_botType", (q) =>
          q.eq("groupId", group._id).eq("botType", "birthday"),
        )
        .first();
      if (config?.enabled) {
        birthdayBot = true;
        break;
      }
    }

    // Derived from the same GETTING_STARTED_MISSIONS the bot posts, so the
    // checklist and the tour can never disagree.
    const doneByKey: Record<string, boolean> = {
      send_message: sentMessage,
      create_event: createdEvent,
      birthday_bot: birthdayBot,
      invite_teammate: realUserIds.length >= 2,
    };
    const missions = GETTING_STARTED_MISSIONS.map((m) => ({
      key: m.key,
      title: m.title,
      done: doneByKey[m.key] ?? false,
    }));

    return {
      missions,
      completed: missions.filter((m) => m.done).length,
      total: missions.length,
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

    // Seeded DMs/group DMs involve demo members — delete the whole ad-hoc
    // channel (members + messages) rather than leaving one-sided orphans.
    const adHocChannels = await ctx.db
      .query("chatChannels")
      .withIndex("by_community_isAdHoc", (q) =>
        q.eq("communityId", args.communityId).eq("isAdHoc", true),
      )
      .collect();
    for (const channel of adHocChannels) {
      const channelMembers = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
        .collect();
      let involvesSeedMember = false;
      for (const member of channelMembers) {
        const user = await ctx.db.get(member.userId);
        if (user?.isDemoSeed) {
          involvesSeedMember = true;
          break;
        }
      }
      if (!involvesSeedMember) continue; // real-user DMs survive go-live

      for (const member of channelMembers) await ctx.db.delete(member._id);
      const channelMessages = await ctx.db
        .query("chatMessages")
        .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
        .collect();
      for (const message of channelMessages) await ctx.db.delete(message._id);
      await ctx.db.delete(channel._id);
    }

    let purged = 0;
    for (const membership of memberships) {
      const user = await ctx.db.get(membership.userId);
      // Only the accounts this module seeded (isDemoSeed) — other flows also
      // create isPlaceholder users for REAL pending invitees (e.g.
      // scheduling's invite-new-person), and those must survive go-live.
      if (!user?.isPlaceholder || !user.isDemoSeed) continue;

      // Seeded members exist only inside their demo community, so every
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
      // Seeded group avatars are placeholder stock photos on a third-party
      // host — drop them so the now-live community isn't left depending on
      // picsum.photos in production. The church's own uploaded logo (an r2:
      // path on the announcement group) is kept.
      if (isDemoStockUrl(group.preview)) {
        await ctx.db.patch(group._id, { preview: undefined });
      }

      const channels = await ctx.db
        .query("chatChannels")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .collect();
      for (const channel of channels) {
        // The Getting Started tour is demo-only and removes itself on go-live,
        // as its bot messages promise. Match it narrowly — the announcement
        // group's tour channel whose messages are ALL bot-authored — so a
        // real "Getting Started" channel a church happened to create (the slug
        // isn't reserved) is never mistaken for it and deleted.
        if (channel.slug === "getting-started" && group.isAnnouncementGroup) {
          const tourMessages = await ctx.db
            .query("chatMessages")
            .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
            .collect();
          const allBotAuthored = tourMessages.every(
            (m) => m.senderId === undefined,
          );
          if (allBotAuthored) {
            const tourMembers = await ctx.db
              .query("chatChannelMembers")
              .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
              .collect();
            for (const member of tourMembers) await ctx.db.delete(member._id);
            for (const message of tourMessages) await ctx.db.delete(message._id);
            await ctx.db.delete(channel._id);
            continue;
          }
        }

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

    // Strip placeholder stock covers from the events that survive go-live
    // (meetings + the community-wide event are authored by the real creator,
    // so they aren't deleted with the seed members).
    const survivingMeetings = await ctx.db
      .query("meetings")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    for (const meeting of survivingMeetings) {
      if (isDemoStockUrl(meeting.coverImage)) {
        await ctx.db.patch(meeting._id, { coverImage: undefined });
      }
    }
    const cwes = await ctx.db
      .query("communityWideEvents")
      .withIndex("by_community_status", (q) =>
        q.eq("communityId", args.communityId).eq("status", "scheduled"),
      )
      .collect();
    for (const cwe of cwes) {
      if (isDemoStockUrl(cwe.coverImage)) {
        await ctx.db.patch(cwe._id, { coverImage: undefined });
      }
    }

    console.log(
      `[demo] Purged ${purged} placeholder members from community ${args.communityId}`,
    );
    return { purged };
  },
});
