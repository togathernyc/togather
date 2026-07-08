/**
 * Self-serve demo communities.
 *
 * A prospective church answers a short questionnaire (name, congregation size,
 * campuses, small groups, teams, zip code, logo, brand colors) and instantly
 * gets a private seeded community where they are the primary admin: a
 * size-appropriate group/campus/team structure, channel conversations, upcoming
 * events with RSVPs, a native event card, a six-week service-planning roster, a
 * community-wide event, and prayer requests. Every feature works because a demo
 * community IS a real community row — branding, admin settings, chat, events,
 * scheduling, and prayer all run through the normal code paths.
 *
 * This is the front door for creating a community: churches start in demo
 * mode and go live from inside the app by adding payment ($1/month per active
 * member — see functions/memberActivity.ts and ee/billing.convertDemoToLive).
 * Conversion flips isDemo off and purges the seeded placeholder members plus
 * demo-only scaffolding (purgeDemoSeedUsers) while keeping groups, branding,
 * and real accounts.
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

/**
 * Placeholder "give" destination on the seeded "Partner with us" link. A church
 * points this at their real giving page (that edit is one of the Getting
 * Started missions); the link is removed on go-live if left unchanged.
 */
export const DEMO_GIVING_URL = "https://pushpay.com/g/togatherdemo";

/** Fallback service times when a campus doesn't specify any. */
const DEFAULT_SERVICE_TIMES = [
  { label: "9:00 AM", hour: 9, minute: 0 },
  { label: "11:00 AM", hour: 11, minute: 0 },
];

/** Default team names when the questionnaire omits them (single campus). */
const DEFAULT_SINGLE_CAMPUS_TEAMS = [
  "Worship Team",
  "Welcome Team",
  "Production Team",
  "Kids Team",
  "Prayer Team",
];
/** Multi-campus defaults: churchwide teams (each its own Team group)… */
const DEFAULT_CENTRALIZED_TEAMS = ["Worship Team", "Production Team", "Kids Team"];
/** …and per-campus teams (a channel inside every campus group). */
const DEFAULT_PER_CAMPUS_TEAMS = ["Welcome Team", "Prayer Team"];

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
 * Deterministic pseudo-random scatter of groups in a disc around the church's
 * home coordinates, so seeded groups and campuses spread out on the explore map
 * instead of stacking on a single pin. Uses a golden-angle spiral for even
 * angular coverage plus an integer hash for a varied radius (no grid, no ring,
 * no Math.random/Date — mutations must be deterministic).
 */
function scatterCoordinates(
  base: { latitude: number; longitude: number },
  i: number,
): { latitude: number; longitude: number } {
  const goldenAngle = 2.399963229728653;
  const angle = i * goldenAngle;
  // Pseudo-random radius in ~[0.008, 0.06]° from an integer hash of i.
  const h = ((i + 1) * 2654435761) >>> 0;
  const radius = 0.008 + ((h % 1000) / 1000) * 0.052;
  return {
    latitude: base.latitude + radius * Math.cos(angle),
    // Longitude compressed a bit for US latitudes so the disc looks round.
    longitude: base.longitude + radius * Math.sin(angle) * 1.35,
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
    key: "create_channel",
    title: "Create a custom channel",
    instruction:
      "Create a custom channel — open a group you lead → the channel tabs → add a channel (e.g. a 'Prayer' or 'Serve Team' channel).",
  },
  {
    key: "create_event",
    title: "Create an event",
    instruction:
      "Create an event — open a group → Events → New Event. Try RSVP options and a cover photo.",
  },
  {
    key: "roster_service",
    title: "Roster your team for Sunday",
    instruction:
      "Roster your team for Sunday — open your campus → Schedule → an upcoming Sunday, and assign people to a team.",
  },
  {
    key: "add_prayer",
    title: "Share a prayer request",
    instruction:
      "Share a prayer request — open the Prayer tab and post one; watch it appear in the community prayer wall.",
  },
  {
    key: "setup_landing_page",
    title: "Set up your landing page",
    instruction:
      "Set up your landing page — open Admin → Landing Page, customize your public sign-up form, and share the link so visitors add themselves to your database.",
  },
  {
    key: "member_health",
    title: "Check in on member health",
    instruction:
      "Check in on member health — open Admin → People, see who needs attention, and assign someone to a leader to follow up.",
  },
  {
    key: "update_giving",
    title: "Make giving yours",
    instruction:
      "Make giving yours — open the announcements group → ⓘ Info → Toolbar Settings, and point 'Partner with us' at your church's giving page.",
  },
  {
    key: "birthday_bot",
    title: "Set up the Birthday Bot",
    instruction:
      "Set up the Birthday Bot — open a group → settings → Bots, so new members get celebrated automatically.",
  },
  {
    key: "invite_teammate",
    title: "Invite a teammate with your demo code",
    instruction:
      "Invite a teammate — share your demo code (on the Go Live screen) so a co-worker can explore with you. Up to 10 people can join.",
  },
] as const;

const MISSION_NUMBER_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

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

// ---- Rostering templates (the six-week Sunday service roster) ----

/**
 * Serving teams (the `teams` table — distinct from Team GROUPS) seeded under
 * the host group, each with its roles. `defaultNeeded` becomes each role's slot
 * count on every plan.
 */
const ROSTER_TEAMS: Array<{
  name: string;
  roles: Array<{ name: string; defaultNeeded: number }>;
}> = [
  {
    name: "Worship",
    roles: [
      { name: "Worship Leader", defaultNeeded: 1 },
      { name: "Vocals", defaultNeeded: 2 },
      { name: "Acoustic Guitar", defaultNeeded: 1 },
      { name: "Bass", defaultNeeded: 1 },
      { name: "Drums", defaultNeeded: 1 },
      { name: "Keys", defaultNeeded: 1 },
    ],
  },
  {
    name: "Production",
    roles: [
      { name: "Sound", defaultNeeded: 1 },
      { name: "Slides/ProPresenter", defaultNeeded: 1 },
      { name: "Camera", defaultNeeded: 1 },
    ],
  },
  {
    name: "Kids",
    roles: [
      { name: "Kids Lead", defaultNeeded: 1 },
      { name: "Kids Helper", defaultNeeded: 2 },
    ],
  },
];

/** Run-sheet segments for each seeded Sunday plan (`eventItems`). */
const RUN_SHEET: Array<{
  segment: "before" | "during" | "after";
  items: Array<{
    type: string;
    title: string;
    durationSec: number;
    songDetails?: { key?: string; bpm?: number };
    notes?: Array<{ category: string; content: string }>;
  }>;
}> = [
  {
    segment: "before",
    items: [{ type: "item", title: "Team huddle & prayer", durationSec: 600 }],
  },
  {
    segment: "during",
    items: [
      { type: "header", title: "Worship Set", durationSec: 0 },
      { type: "song", title: "Opening Song", durationSec: 300, songDetails: { key: "G", bpm: 72 } },
      { type: "song", title: "Song 2", durationSec: 300 },
      { type: "header", title: "Welcome & Announcements", durationSec: 0 },
      {
        type: "item",
        title: "Message",
        durationSec: 1800,
        notes: [{ category: "Video", content: "Lower thirds for speaker" }],
      },
      { type: "song", title: "Response Song", durationSec: 300 },
    ],
  },
  {
    segment: "after",
    items: [{ type: "item", title: "Tear down & reset", durationSec: 600 }],
  },
];

/** How many upcoming Sundays the roster spans. */
const ROSTER_WEEKS = 6;
/** Roster/availability pool size cap (bounds the rostering write volume). */
const ROSTER_POOL_SIZE = 24;

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** Unix epoch day 0 (1970-01-01) was a Thursday; +4 aligns 0 = Sunday. */
function dayOfWeekUTC(t: number): number {
  return Math.floor(t / DAY + 4) % 7;
}

/** The next `count` Sundays (00:00 UTC) strictly after `from`. */
function nextSundays(from: number, count: number): number[] {
  const dow = dayOfWeekUTC(from);
  const firstSunday =
    from - (from % DAY) + (((7 - dow) % 7) || 7) * DAY;
  const sundays: number[] = [];
  for (let i = 0; i < count; i++) sundays.push(firstSunday + i * 7 * DAY);
  return sundays;
}

// Every demo community is seeded in this timezone (see the community insert).
const COMMUNITY_TIMEZONE = "America/New_York";

/**
 * Convert a wall-clock local time (hour:minute) on `dayMidnightUtc`'s calendar
 * day to a UTC ms instant in COMMUNITY_TIMEZONE, so a service labeled "9:00 AM"
 * is stored as 9 AM local — not 9:00 UTC (which would display as ~5 AM ET on
 * the roster). Mirrors the offset approach in lib/scheduling.ts; the per-day
 * offset means DST across the seeded weeks is handled correctly. Intl is
 * deterministic inside Convex.
 */
function localTimeToUtc(
  dayMidnightUtc: number,
  hour: number,
  minute: number,
): number {
  const d = new Date(dayMidnightUtc);
  const asUtc = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    hour,
    minute,
  );
  const tzHour =
    parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: COMMUNITY_TIMEZONE,
        hour: "numeric",
        hour12: false,
      }).format(new Date(asUtc)),
      10,
    ) % 24;
  let offsetHours = tzHour - hour;
  if (offsetHours > 12) offsetHours -= 24;
  else if (offsetHours < -12) offsetHours += 24;
  return asUtc - offsetHours * HOUR;
}

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

/** Insert a per-campus custom "team" channel and return its id. */
async function createCustomChannel(
  ctx: MutationCtx,
  groupId: Id<"groups">,
  createdById: Id<"users">,
  name: string,
): Promise<Id<"chatChannels">> {
  const timestamp = now();
  return await ctx.db.insert("chatChannels", {
    groupId,
    slug: nameToSlug(name) || "team",
    channelType: "custom",
    name,
    createdById,
    createdAt: timestamp,
    updatedAt: timestamp,
    isArchived: false,
    isEnabled: true,
    memberCount: 0,
  });
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
    /** Provide to reuse a known shortId (e.g. for a shareable event card link). */
    shortId?: string;
    /** Defaults to "group". Pass "community" for a community-wide card. */
    visibility?: string;
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
    shortId: args.shortId ?? generateShortId(),
    rsvpEnabled: true,
    rsvpOptions: DEFAULT_RSVP_OPTIONS,
    visibility: args.visibility ?? "group",
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
 * Add a real user (creator or code-joiner) to a REALISTIC, curated subset of a
 * demo's groups — never everything. Like an actual staff member:
 *   • the announcement group as LEADER,
 *   • up to 2 campus groups as member (multi-campus only),
 *   • up to 2 small groups (leader of the first, member of the second),
 *   • up to 2 team groups (leader of the first, member of the second).
 * Everything else (classes, extra groups) is not joined — capping a real user
 * at ~6 groups so the inbox stays legible. Channel access follows the role:
 * main + announcements channel everywhere they're in, the leaders channel only
 * where they lead, plus the announcement group's Getting Started tour channel.
 *
 * Also seeds per-channel read-state so the inbox isn't a wall of unread: every
 * channel they join is marked READ except the Getting Started tour (its bot
 * messages stay unread to pull them into the tour). Idempotent for re-joins.
 */
async function enrollUserInDemo(
  ctx: MutationCtx,
  communityId: Id<"communities">,
  userId: Id<"users">,
  displayName: string,
  profilePhoto?: string,
): Promise<void> {
  const groupTypes = await ctx.db
    .query("groupTypes")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .collect();
  const slugByType = new Map(groupTypes.map((t) => [String(t._id), t.slug]));

  const groups = await ctx.db
    .query("groups")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .collect();
  // Stable ordering so "the first N groups" is deterministic across joins.
  const ordered = [...groups].sort((a, b) => a._creationTime - b._creationTime);

  let announcement: (typeof ordered)[number] | undefined;
  const campusGroups: typeof ordered = [];
  const smallGroups: typeof ordered = [];
  const teamGroups: typeof ordered = [];
  for (const g of ordered) {
    if (g.isAnnouncementGroup) {
      announcement = g;
      continue;
    }
    const slug = slugByType.get(String(g.groupTypeId));
    if (slug === "campuses") campusGroups.push(g);
    else if (slug === "small-groups") smallGroups.push(g);
    else if (slug === "teams") teamGroups.push(g);
  }

  const plan: Array<{ group: (typeof ordered)[number]; role: "leader" | "member" }> = [];
  if (announcement) plan.push({ group: announcement, role: "leader" });
  for (const g of campusGroups.slice(0, 2)) plan.push({ group: g, role: "member" });
  smallGroups.slice(0, 2).forEach((g, i) =>
    plan.push({ group: g, role: i === 0 ? "leader" : "member" }),
  );
  teamGroups.slice(0, 2).forEach((g, i) =>
    plan.push({ group: g, role: i === 0 ? "leader" : "member" }),
  );

  for (const { group, role } of plan) {
    const leads = role === "leader";

    const existingMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) => q.eq("groupId", group._id).eq("userId", userId))
      .first();
    if (!existingMembership) await addGroupMember(ctx, group._id, userId, role);

    const channels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", group._id))
      .collect();
    for (const channel of channels) {
      // Leaders-only channels stay leaders-only.
      if (channel.channelType === "leaders" && !leads) continue;

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
          leads ? "admin" : "member",
          displayName,
          profilePhoto,
        );
      }

      // Suppress the unread badge everywhere EXCEPT the Getting Started tour,
      // which stays unread to draw the user into it.
      if (channel.slug !== "getting-started") {
        const existingRead = await ctx.db
          .query("chatReadState")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channel._id).eq("userId", userId),
          )
          .first();
        if (!existingRead) {
          await ctx.db.insert("chatReadState", {
            channelId: channel._id,
            userId,
            lastReadAt: now(),
            unreadCount: 0,
          });
        }
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
    zipCode: v.optional(v.string()),
    logo: v.optional(v.string()), // "r2:..." storage path from getR2UploadUrl
    primaryColor: v.optional(v.string()),
    // Home coordinates (client geocodes the zip) — seeded groups and events
    // spread around this point on the map.
    baseCoordinates: v.optional(
      v.object({ latitude: v.number(), longitude: v.number() }),
    ),
    // Structured campuses (authoritative for campus COUNT when present).
    campuses: v.optional(
      v.array(
        v.object({
          name: v.optional(v.string()),
          serviceTimes: v.optional(
            v.array(
              v.object({
                label: v.string(),
                hour: v.number(),
                minute: v.number(),
              }),
            ),
          ),
        }),
      ),
    ),
    smallGroupCount: v.optional(v.number()),
    groupNames: v.optional(v.array(v.string())),
    // Teams:
    teams: v.optional(v.array(v.string())), // SINGLE-campus: each becomes its own Team group
    centralizedTeams: v.optional(v.array(v.string())), // MULTI-campus: each becomes its own Team group
    perCampusTeams: v.optional(v.array(v.string())), // MULTI-campus: each becomes a CHANNEL in every campus group
    // Back-compat fallbacks (used only when `campuses` is omitted):
    campusCount: v.optional(v.number()),
    campusNames: v.optional(v.array(v.string())),
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

    // ---- Resolve sizing ----
    // Congregation size only steers the default group count — every demo is
    // populated by exactly DEMO_SEED_USER_COUNT placeholder members.
    const totalSize = args.totalSize ?? 100;
    const smallGroups = clamp(
      args.smallGroupCount ?? Math.ceil(totalSize / 50),
      1,
      MAX_SMALL_GROUPS,
    );
    const campusCount = clamp(
      args.campuses?.length ?? args.campusCount ?? 1,
      1,
      MAX_CAMPUSES,
    );
    const isMultiCampus = campusCount > 1;

    // Campus names: structured campus name → campusNames fallback → placeholder.
    const campusNames: string[] = [];
    for (let i = 0; i < campusCount; i++) {
      const structured = args.campuses?.[i]?.name?.trim();
      const fallback = args.campusNames?.[i]?.trim();
      campusNames.push(
        structured || fallback || CAMPUS_NAMES[i % CAMPUS_NAMES.length],
      );
    }
    // Service times per campus: structured (if non-empty) else default.
    const campusServiceTimes = (i: number) => {
      const st = args.campuses?.[i]?.serviceTimes;
      return st && st.length > 0 ? st : DEFAULT_SERVICE_TIMES;
    };

    // Team resolution.
    const cleanList = (list: string[] | undefined) =>
      (list ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
    let teamGroupNames: string[];
    let perCampusTeamNames: string[];
    if (isMultiCampus) {
      const centralized = cleanList(args.centralizedTeams);
      teamGroupNames = centralized.length > 0 ? centralized : DEFAULT_CENTRALIZED_TEAMS;
      const perCampus = cleanList(args.perCampusTeams);
      perCampusTeamNames = perCampus.length > 0 ? perCampus : DEFAULT_PER_CAMPUS_TEAMS;
    } else {
      const single = cleanList(args.teams);
      teamGroupNames = single.length > 0 ? single : DEFAULT_SINGLE_CAMPUS_TEAMS;
      perCampusTeamNames = [];
    }

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
    const typesToCreate = isMultiCampus
      ? [...GROUP_TYPES, CAMPUS_GROUP_TYPE]
      : GROUP_TYPES;
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

    const zipCode = args.zipCode?.trim() || undefined;
    const channelCounts = new Map<Id<"chatChannels">, number>();
    // Distinct scatter index per group so nothing stacks on one map pin.
    let scatterIndex = 0;
    const coordsFor = () =>
      args.baseCoordinates
        ? scatterCoordinates(args.baseCoordinates, scatterIndex++)
        : (scatterIndex++, undefined);

    /**
     * Rotate placeholder members into a group (first = leader), seed its main
     * channel with a script, and return the members enrolled. `poolOffset`
     * deterministically varies which members land in each group.
     */
    const populateGroup = async (
      created: { groupId: Id<"groups">; channels: SeededChannels },
      memberCount: number,
      script: string[],
      poolOffset: number,
    ): Promise<Array<{ userId: Id<"users">; name: string; photo: string }>> => {
      const groupMembers: Array<{ userId: Id<"users">; name: string; photo: string }> = [];
      const size = Math.min(memberCount, members.length);
      for (let m = 0; m < size; m++) {
        const member = members[(poolOffset * 7 + m * 3) % members.length];
        const isLeader = m === 0;
        await addGroupMember(ctx, created.groupId, member.userId, isLeader ? "leader" : "member");
        await addChannelMemberCounted(
          ctx,
          channelCounts,
          created.channels.mainChannelId,
          member.userId,
          isLeader ? "admin" : "member",
          member.name,
          member.photo,
        );
        if (created.channels.announcementsChannelId) {
          await addChannelMemberCounted(
            ctx,
            channelCounts,
            created.channels.announcementsChannelId,
            member.userId,
            "member",
            member.name,
            member.photo,
          );
        }
        if (isLeader) {
          await addChannelMemberCounted(
            ctx,
            channelCounts,
            created.channels.leadersChannelId,
            member.userId,
            "admin",
            member.name,
            member.photo,
          );
        }
        groupMembers.push(member);
      }
      await seedConversation(ctx, {
        channelId: created.channels.mainChannelId,
        communityId,
        script,
        senders: groupMembers,
      });
      return groupMembers;
    };

    // ---- Announcement group (church name, everyone belongs, brand logo) ----
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
      coordinates: coordsFor(),
    });
    for (const member of members) {
      await addGroupMember(ctx, announcement.groupId, member.userId, "member");
      await addChannelMemberCounted(ctx, channelCounts, announcement.channels.mainChannelId, member.userId, "member", member.name, member.photo);
      if (announcement.channels.announcementsChannelId) {
        await addChannelMemberCounted(ctx, channelCounts, announcement.channels.announcementsChannelId, member.userId, "member", member.name, member.photo);
      }
    }

    // Track seeded groups for meetings/RSVPs, and the first campus group so
    // rostering can attach to it.
    const seededGroups: Array<{
      groupId: Id<"groups">;
      name: string;
      channels: SeededChannels;
      groupMembers: Array<{ userId: Id<"users">; name: string; photo: string }>;
      isSmallGroup: boolean;
    }> = [];
    let firstCampusGroupId: Id<"groups"> | undefined;
    let firstCampusMembers:
      | Array<{ userId: Id<"users">; name: string; photo: string }>
      | undefined;

    let poolOffset = 1;

    // ---- Small groups ----
    const smallGroupNames = resolveNames(smallGroups, args.groupNames, SMALL_GROUP_NAMES);
    for (let i = 0; i < smallGroups; i++) {
      const created = await createDemoGroup(ctx, {
        communityId,
        groupTypeId: groupTypeIds["small-groups"],
        createdById: userId,
        name: smallGroupNames[i],
        description: "Weekly gathering for community, study, and prayer",
        isPublic: true,
        defaultDay: (i % 5) + 1,
        defaultStartTime: "19:00",
        defaultEndTime: "21:00",
        preview: demoStockPhoto(`${slug}-sg-${i}`, 400, 400),
        zipCode,
        coordinates: coordsFor(),
      });
      const gm = await populateGroup(created, 6 + (i % 3), SMALL_GROUP_CHAT, poolOffset++);
      seededGroups.push({ groupId: created.groupId, name: smallGroupNames[i], channels: created.channels, groupMembers: gm, isSmallGroup: true });
    }

    // ---- Team groups (single: teams; multi: centralizedTeams) ----
    for (let i = 0; i < teamGroupNames.length; i++) {
      const created = await createDemoGroup(ctx, {
        communityId,
        groupTypeId: groupTypeIds["teams"],
        createdById: userId,
        name: teamGroupNames[i],
        description: "Ministry team serving in weekend services",
        isPublic: true,
        preview: demoStockPhoto(`${slug}-team-${i}`, 400, 400),
        zipCode,
        coordinates: coordsFor(),
      });
      const gm = await populateGroup(created, 6 + (i % 3), TEAM_CHAT, poolOffset++);
      seededGroups.push({ groupId: created.groupId, name: teamGroupNames[i], channels: created.channels, groupMembers: gm, isSmallGroup: false });
    }

    // ---- New Members Class ----
    {
      const created = await createDemoGroup(ctx, {
        communityId,
        groupTypeId: groupTypeIds["classes"],
        createdById: userId,
        name: "New Members Class",
        description: "Introduction to our community for new attendees",
        isPublic: true,
        preview: demoStockPhoto(`${slug}-class`, 400, 400),
        zipCode,
        coordinates: coordsFor(),
      });
      const gm = await populateGroup(created, 7, CLASS_CHAT, poolOffset++);
      seededGroups.push({ groupId: created.groupId, name: "New Members Class", channels: created.channels, groupMembers: gm, isSmallGroup: false });
    }

    // ---- Campus groups (multi-campus only) ----
    if (isMultiCampus) {
      for (let i = 0; i < campusCount; i++) {
        const created = await createDemoGroup(ctx, {
          communityId,
          groupTypeId: groupTypeIds["campuses"],
          createdById: userId,
          name: campusNames[i],
          description: "Campus community and updates",
          isPublic: true,
          // Same brand logo as the announcement group so campuses lead with it.
          preview: args.logo ?? demoStockPhoto(`${slug}-campus-${i}`, 400, 400),
          zipCode,
          coordinates: coordsFor(),
        });
        // Larger pool so a campus reads like a campus and can support rostering.
        const gm = await populateGroup(created, ROSTER_POOL_SIZE, CAMPUS_CHAT, poolOffset++);

        // Per-campus team channels, each seeded with a short team chat.
        for (const teamName of perCampusTeamNames) {
          const channelId = await createCustomChannel(ctx, created.groupId, userId, teamName);
          for (let m = 0; m < gm.length; m++) {
            const member = gm[m];
            await addChannelMemberCounted(ctx, channelCounts, channelId, member.userId, m === 0 ? "admin" : "member", member.name, member.photo);
          }
          await seedConversation(ctx, { channelId, communityId, script: TEAM_CHAT, senders: gm });
        }

        if (i === 0) {
          firstCampusGroupId = created.groupId;
          firstCampusMembers = gm;
        }
        seededGroups.push({ groupId: created.groupId, name: campusNames[i], channels: created.channels, groupMembers: gm, isSmallGroup: false });
      }
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

    // ---- Per-group weekly meetings + RSVPs ----
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

      for (const meetingId of meetingIds) {
        for (let m = 0; m < group.groupMembers.length; m++) {
          const member = group.groupMembers[m];
          const optionId = m % 3 === 2 ? 2 : 1; // mostly Going, some Maybe
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

    // ---- Serve Day native event card in the announcement chat (60+ RSVPs) ----
    // Events render as a native card by having a togather.nyc/e/<shortId> URL in
    // a message; RSVP counts are read live from meetingRsvps.
    const serveDayShortId = generateShortId();
    const serveDayCardMeetingId = await createDemoMeeting(ctx, {
      groupId: announcement.groupId,
      communityId,
      createdById: userId,
      title: "Serve Day",
      scheduledAt: serveDayAt,
      note: "Join us as we serve our city together — everyone welcome!",
      coverImage: demoStockPhoto(`${slug}-serve-day-card`),
      locationOverride: zipCode ? `Serve Day · ${zipCode}` : undefined,
      shortId: serveDayShortId,
      visibility: "community",
    });
    // 65 RSVPs from distinct placeholder members — mostly Going, a handful Maybe.
    const serveDayRsvpCount = Math.min(65, members.length);
    for (let m = 0; m < serveDayRsvpCount; m++) {
      const member = members[m];
      const optionId = m % 8 === 3 ? 2 : 1; // ~1 in 8 Maybe, rest Going
      await ctx.db.insert("meetingRsvps", {
        meetingId: serveDayCardMeetingId,
        userId: member.userId,
        rsvpOptionId: optionId,
        guestCount: optionId === 1 && m % 6 === 0 ? 1 : undefined,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    // ---- Announcements conversation (welcome + the Serve Day card) ----
    await seedConversation(ctx, {
      channelId: announcement.channels.mainChannelId,
      communityId,
      script: [`Welcome to ${name} on Togather! 🎉`],
      senders: members.slice(0, 1),
    });
    // The card message: a togather.nyc/e/<shortId> URL renders as a native
    // event card (contentType stays "text").
    {
      const cardSender = members[1] ?? members[0];
      const cardAt = timestamp - 30 * 60 * 1000; // ~30 min ago, newest in channel
      await ctx.db.insert("chatMessages", {
        channelId: announcement.channels.mainChannelId,
        communityId,
        senderId: cardSender.userId,
        content: `Serve Day is coming up — join us! https://togather.nyc/e/${serveDayShortId}`,
        contentType: "text",
        createdAt: cardAt,
        isDeleted: false,
        isDemoSeed: true,
        senderName: cardSender.name,
        senderProfilePhoto: cardSender.photo,
        lastActivityAt: cardAt,
      });
      await ctx.db.patch(announcement.channels.mainChannelId, {
        lastMessageAt: cardAt,
        lastMessagePreview: `Serve Day is coming up — join us!`,
        lastMessageSenderId: cardSender.userId,
        lastMessageSenderName: cardSender.name,
        updatedAt: cardAt,
      });
    }

    // ---- "Partner with us" giving link on the announcement group ----
    await ctx.db.insert("groupResources", {
      groupId: announcement.groupId,
      title: "Partner with us",
      icon: "heart-outline",
      linkUrl: DEMO_GIVING_URL,
      showInInbox: true,
      visibility: { type: "everyone" },
      sections: [],
      order: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: userId,
      isDemoSeed: true,
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

    // ---- Public landing page (Community Landing Page feature) ----
    // Seeded so /c<slug> renders during the demo, and it survives go-live as the
    // church's real landing page (the same default go-live would otherwise
    // create). createdAt === updatedAt marks it untouched; a real admin save
    // (saveConfig) bumps updatedAt, which completes the setup_landing_page mission.
    await ctx.db.insert("communityLandingPages", {
      communityId,
      isEnabled: true,
      title: `Welcome to ${name}`,
      description: "New here? Fill this out and we'll connect with you this week.",
      submitButtonText: "I'm New Here",
      successMessage: "Thanks! Someone from our team will reach out soon. 🙌",
      generateNoteSummary: true,
      requireZipCode: false,
      requireBirthday: false,
      formFields: [
        { slot: "customBool1", label: "First time visiting?", type: "boolean", required: false, order: 0, includeInNotes: true, showOnLanding: true },
        { slot: "customText1", label: "How did you hear about us?", type: "text", required: false, order: 1, includeInNotes: true, showOnLanding: true },
        { slot: "customText2", label: "Anything we can pray for or help with?", type: "text", required: false, order: 2, includeInNotes: true, showOnLanding: true },
      ],
      automationRules: [],
      autoReplySms: undefined,
      createdAt: timestamp,
      updatedAt: timestamp, // === createdAt: untouched until a real admin saves
    });

    // ---- Member health (Admin → People roster) ----
    // A varied slice of the roster on the announcement group: some needing
    // attention, some assigned to a (seeded) leader with follow-up history, some
    // healthy. Leaders come from the seeded group leaders (placeholders), so a
    // REAL admin assigning someone cleanly signals they used the feature.
    const healthLeaders = seededGroups
      .map((g) => g.groupMembers[0])
      .filter((m): m is (typeof members)[number] => Boolean(m))
      .slice(0, 2);
    if (healthLeaders.length > 0) {
      const healthMembers = members.slice(70, 82); // 12 distinct placeholders
      const assignedHealthMembers: Array<{ userId: Id<"users">; name: string }> = [];
      for (let h = 0; h < healthMembers.length; h++) {
        const person = healthMembers[h];
        const [firstName, ...rest] = person.name.split(" ");
        const lastName = rest.join(" ");
        const base = {
          communityId,
          groupId: announcement.groupId,
          userId: person.userId,
          firstName,
          lastName,
          avatarUrl: person.photo,
          searchText: person.name.toLowerCase(),
          isActive: true,
          addedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        if (h < 5) {
          // Needs attention: low attendance/togather scores, an alert, stale
          // last-attended, unassigned.
          await ctx.db.insert("communityPeople", {
            ...base,
            score1: 22 + h,
            score2: 15 + h * 3,
            score3: 18 + h * 2,
            status: "Needs follow-up",
            alerts: [h % 2 === 0 ? "Low Attendance" : "No recent attendance"],
            lastAttendedAt: timestamp - (30 + h * 4) * DAY,
          });
        } else if (h < 9) {
          // Assigned to a leader, with a recent note.
          const leader = healthLeaders[h % healthLeaders.length];
          const cpId = await ctx.db.insert("communityPeople", {
            ...base,
            score1: 45,
            score2: 38,
            score3: 41,
            status: "Following up",
            assigneeId: leader.userId,
            assigneeIds: [leader.userId],
            assigneeSortKey: leader.name,
            latestNote: "Left a voicemail — will try again this week.",
            latestNoteAt: timestamp - 2 * DAY,
            lastFollowupAt: timestamp - 2 * DAY,
          });
          await ctx.db.insert("communityPeopleAssignees", {
            communityPersonId: cpId,
            assigneeUserId: leader.userId,
            groupId: announcement.groupId,
            communityId,
          });
          assignedHealthMembers.push({ userId: person.userId, name: person.name });
        } else {
          // Healthy: high scores, no alerts.
          await ctx.db.insert("communityPeople", {
            ...base,
            score1: 88,
            score2: 92,
            score3: 85,
            alerts: [],
          });
        }
      }

      // A couple of follow-up history entries authored by a seeded leader.
      for (let k = 0; k < Math.min(2, assignedHealthMembers.length); k++) {
        const target = assignedHealthMembers[k];
        const gm = await ctx.db
          .query("groupMembers")
          .withIndex("by_group_user", (q) =>
            q.eq("groupId", announcement.groupId).eq("userId", target.userId),
          )
          .first();
        if (gm) {
          await ctx.db.insert("memberFollowups", {
            groupMemberId: gm._id,
            createdById: healthLeaders[0].userId,
            type: k % 2 === 0 ? "call" : "note",
            content: "Left a voicemail — will try again this week.",
            createdAt: timestamp - (k + 1) * DAY,
          });
        }
      }
    }

    // ---- Rostering: six upcoming Sundays of service planning ----
    // Host group: first campus (multi-campus) or the announcement group (single-
    // campus, so all 100 members are valid assignees). Member pool comes from
    // that group; the roster/availability set is capped for write bounds.
    const hostGroupId = isMultiCampus
      ? (firstCampusGroupId as Id<"groups">)
      : announcement.groupId;
    const rosterPool = (
      isMultiCampus ? (firstCampusMembers as typeof members) : members
    ).slice(0, ROSTER_POOL_SIZE);

    if (rosterPool.length > 0) {
      const serviceTimes = campusServiceTimes(0);
      const firstService = serviceTimes[0];
      const sundays = nextSundays(timestamp, ROSTER_WEEKS);

      // Serving teams + roles under the host group.
      const rosterTeams: Array<{
        teamId: Id<"teams">;
        name: string;
        roles: Array<{ roleId: Id<"teamRoles">; defaultNeeded: number }>;
      }> = [];
      for (const teamDef of ROSTER_TEAMS) {
        const teamId = await ctx.db.insert("teams", {
          groupId: hostGroupId,
          communityId,
          name: teamDef.name,
          createdAt: timestamp,
          createdById: userId,
          updatedAt: timestamp,
          isDemoSeed: true,
        });
        const roles: Array<{ roleId: Id<"teamRoles">; defaultNeeded: number }> = [];
        for (let r = 0; r < teamDef.roles.length; r++) {
          const roleDef = teamDef.roles[r];
          const roleId = await ctx.db.insert("teamRoles", {
            teamId,
            communityId,
            name: roleDef.name,
            sortOrder: r,
            defaultNeeded: roleDef.defaultNeeded,
            createdAt: timestamp,
            createdById: userId,
          });
          roles.push({ roleId, defaultNeeded: roleDef.defaultNeeded });
        }
        rosterTeams.push({ teamId, name: teamDef.name, roles });
      }
      const worshipTeamId = rosterTeams[0].teamId;
      const kidsTeamId = rosterTeams[2].teamId;

      // Rotate assignees across roles and weeks so nobody is always on.
      let assignPtr = 0;
      // Distinct people who received at least one assignment (drives availability).
      const assignedOrder: Array<{ userId: Id<"users"> }> = [];
      const assignedSeen = new Set<string>();

      for (let w = 0; w < sundays.length; w++) {
        const sunday = sundays[w];
        const eventDate = localTimeToUtc(
          sunday,
          firstService.hour,
          firstService.minute,
        );
        const times = serviceTimes.map((s) => ({
          label: s.label,
          startsAt: localTimeToUtc(sunday, s.hour, s.minute),
        }));

        const planId = await ctx.db.insert("eventPlans", {
          groupId: hostGroupId,
          communityId,
          title: "Sunday Service",
          eventDate,
          times,
          status: "published",
          createdAt: timestamp,
          createdById: userId,
          updatedAt: timestamp,
          isDemoSeed: true,
        });

        // Needed roles + assignments.
        for (const team of rosterTeams) {
          for (const role of team.roles) {
            await ctx.db.insert("neededRoles", {
              planId,
              teamId: team.teamId,
              roleId: role.roleId,
              count: role.defaultNeeded,
            });
            for (let k = 0; k < role.defaultNeeded; k++) {
              const member = rosterPool[assignPtr % rosterPool.length];
              assignPtr++;
              // ~1 in 5 left unconfirmed so the roster shows real follow-up.
              const confirmed = assignPtr % 5 !== 0;
              await ctx.db.insert("roleAssignments", {
                planId,
                teamId: team.teamId,
                roleId: role.roleId,
                userId: member.userId,
                eventDate,
                status: confirmed ? "confirmed" : "unconfirmed",
                timeLabel: firstService.label,
                assignedById: userId,
                assignedAt: timestamp,
                respondedAt: confirmed ? timestamp : undefined,
                isDemoSeed: true,
              });
              if (!assignedSeen.has(String(member.userId))) {
                assignedSeen.add(String(member.userId));
                assignedOrder.push({ userId: member.userId });
              }
            }
          }
        }

        // Run sheet.
        for (const seg of RUN_SHEET) {
          for (let s = 0; s < seg.items.length; s++) {
            const item = seg.items[s];
            await ctx.db.insert("eventItems", {
              planId,
              communityId,
              segment: seg.segment,
              sequence: s,
              type: item.type,
              title: item.title,
              durationSec: item.durationSec,
              notes: item.notes,
              songDetails: item.songDetails,
              createdAt: timestamp,
              createdById: userId,
              updatedAt: timestamp,
            });
          }
        }

        // A couple of event tasks.
        await ctx.db.insert("eventTasks", {
          planId,
          communityId,
          teamIds: [worshipTeamId],
          roleIds: [],
          segment: "before",
          title: "Sound check",
          howToType: "none",
          sortOrder: 0,
          createdById: userId,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        await ctx.db.insert("eventTasks", {
          planId,
          communityId,
          teamIds: [kidsTeamId],
          roleIds: [],
          segment: "before",
          title: "Check-in table setup",
          howToType: "none",
          sortOrder: 1,
          createdById: userId,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }

      // Availability — only for people actually rostered, one row per plan.
      // Each is available except one deterministically-chosen Sunday.
      const planIds = await ctx.db
        .query("eventPlans")
        .withIndex("by_community_date", (q) => q.eq("communityId", communityId))
        .collect();
      const seededPlanIds = planIds.filter((p) => p.isDemoSeed);
      for (let a = 0; a < assignedOrder.length; a++) {
        const person = assignedOrder[a];
        const unavailWeek = a % seededPlanIds.length;
        for (let w = 0; w < seededPlanIds.length; w++) {
          const plan = seededPlanIds[w];
          const unavailable = w === unavailWeek;
          await ctx.db.insert("eventAvailability", {
            planId: plan._id,
            groupId: hostGroupId,
            communityId,
            userId: person.userId,
            status: unavailable ? "unavailable" : "available",
            note: unavailable ? "Out of town" : undefined,
            respondedAt: timestamp,
            updatedAt: timestamp,
          });
        }
      }
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
    await enrollUserInDemo(ctx, communityId, userId, callerName, callerPhoto);

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
 * community ADMIN (not primary) and is enrolled in a realistic subset of groups
 * and channels, so several people can explore and modify the same demo
 * simultaneously.
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

    await enrollUserInDemo(
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
 * the go-live screen can show "5 of 10 explored". Only meaningful for demos.
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
    const realUserIdSet = new Set(realUserIds.map((id) => String(id)));

    // "Sent a message" = a real user authored a NON-seeded message in this
    // community. The by_sender_community index bounds the scan; isDemoSeed
    // excludes the scripted lines attributed to real users.
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
    const createdEvent = meetings.some(
      (m) =>
        !m.isDemoSeed &&
        m.createdById !== undefined &&
        realUserIdSet.has(String(m.createdById)),
    );

    // A church-created custom channel (not the seeded Getting Started tour).
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    let createdChannel = false;
    let birthdayBot = false;
    let updatedGiving = false;
    for (const group of groups) {
      if (!createdChannel) {
        const channels = await ctx.db
          .query("chatChannels")
          .withIndex("by_group", (q) => q.eq("groupId", group._id))
          .collect();
        if (
          channels.some(
            (c) =>
              c.channelType === "custom" &&
              c.slug !== "getting-started" &&
              realUserIdSet.has(String(c.createdById)) &&
              // Exclude channels created by the seeder itself (per-campus team
              // channels are custom and authored by the real creator). Every
              // seeded row shares the mutation's fixed now() == the community's
              // createdAt; a channel the admin creates later is strictly newer.
              c.createdAt > (community.createdAt ?? community._creationTime),
          )
        ) {
          createdChannel = true;
        }
      }

      if (!birthdayBot) {
        const config = await ctx.db
          .query("groupBotConfigs")
          .withIndex("by_group_botType", (q) =>
            q.eq("groupId", group._id).eq("botType", "birthday"),
          )
          .first();
        if (config?.enabled) birthdayBot = true;
      }

      // "Made giving yours" = the announcement group's giving link now points
      // somewhere other than the seeded placeholder (edited or replaced).
      if (!updatedGiving && group.isAnnouncementGroup) {
        const resources = await ctx.db
          .query("groupResources")
          .withIndex("by_group", (q) => q.eq("groupId", group._id))
          .collect();
        if (
          resources.some((r) => r.linkUrl && r.linkUrl !== DEMO_GIVING_URL)
        ) {
          updatedGiving = true;
        }
      }
    }

    // "Rostered your team" = a non-seed role assignment made by a real user.
    let rosterService = false;
    const plans = await ctx.db
      .query("eventPlans")
      .withIndex("by_community_date", (q) => q.eq("communityId", args.communityId))
      .collect();
    for (const plan of plans) {
      const assignments = await ctx.db
        .query("roleAssignments")
        .withIndex("by_plan", (q) => q.eq("planId", plan._id))
        .collect();
      if (
        assignments.some(
          (a) => a.isDemoSeed !== true && realUserIdSet.has(String(a.assignedById)),
        )
      ) {
        rosterService = true;
        break;
      }
    }

    // "Shared a prayer" = a real user authored a prayer (seeded prayers are
    // authored by placeholder members).
    const prayers = await ctx.db
      .query("prayers")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    const addedPrayer = prayers.some((p) => realUserIdSet.has(String(p.authorUserId)));

    // "Set up your landing page" = the seeded page was actually saved by an
    // admin. saveConfig bumps updatedAt (never createdAt), so any real edit
    // makes updatedAt !== createdAt. (A church that created its own page from
    // scratch also has updatedAt !== createdAt.)
    const landingPage = await ctx.db
      .query("communityLandingPages")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    const setupLandingPage =
      !!landingPage && landingPage.updatedAt !== landingPage.createdAt;

    // "Checked member health" = a real user is a People-roster assignee, or
    // authored a follow-up. Seeded assignments/follow-ups use placeholder
    // leaders, so a real user here means the admin used the feature. Bounded by
    // realUserIds (≤ MAX_REAL_USERS).
    let memberHealth = false;
    for (const realUserId of realUserIds) {
      const assigned = await ctx.db
        .query("communityPeople")
        .withIndex("by_community_assignee", (q) =>
          q.eq("communityId", args.communityId).eq("assigneeId", realUserId),
        )
        .first();
      if (assigned) {
        memberHealth = true;
        break;
      }
      // Follow-ups aren't community-scoped (keyed by groupMember), so verify
      // the row belongs to THIS community before counting it — a real staffer
      // may author follow-ups in other communities they lead.
      const followups = await ctx.db
        .query("memberFollowups")
        .withIndex("by_createdBy", (q) => q.eq("createdById", realUserId))
        .collect();
      let authoredHere = false;
      for (const followup of followups) {
        const gm = await ctx.db.get(followup.groupMemberId);
        if (!gm) continue;
        const group = await ctx.db.get(gm.groupId);
        if (group?.communityId === args.communityId) {
          authoredHere = true;
          break;
        }
      }
      if (authoredHere) {
        memberHealth = true;
        break;
      }
    }

    // Derived from the same GETTING_STARTED_MISSIONS the bot posts, so the
    // checklist and the tour can never disagree.
    const doneByKey: Record<string, boolean> = {
      send_message: sentMessage,
      create_channel: createdChannel,
      create_event: createdEvent,
      roster_service: rosterService,
      add_prayer: addedPrayer,
      setup_landing_page: setupLandingPage,
      member_health: memberHealth,
      update_giving: updatedGiving,
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
 * Remove the seeded placeholder members (and everything they authored) plus the
 * demo-only scaffolding (rostering, the giving link) after a demo converts to a
 * live community. Groups, channels, branding, settings, events, and the real
 * staff accounts all stay — only the fake people and demo props go.
 *
 * Scheduled by ee/billing.handleCheckoutCompleted when the demo-conversion
 * checkout finishes. Idempotent: placeholders and demo-flagged rows are deleted
 * as they're found, so a webhook retry that schedules it twice finds nothing
 * the second time.
 */
export const purgeDemoSeedUsers = internalMutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    // ---- Rostering scaffolding (independent of any single user) ----
    // Seeded event plans + their children.
    const demoPlans = (
      await ctx.db
        .query("eventPlans")
        .withIndex("by_community_date", (q) => q.eq("communityId", args.communityId))
        .collect()
    ).filter((p) => p.isDemoSeed);
    for (const plan of demoPlans) {
      const kids = [
        ctx.db.query("neededRoles").withIndex("by_plan", (q) => q.eq("planId", plan._id)),
        ctx.db.query("roleAssignments").withIndex("by_plan", (q) => q.eq("planId", plan._id)),
        ctx.db.query("eventItems").withIndex("by_plan", (q) => q.eq("planId", plan._id)),
        ctx.db.query("eventTasks").withIndex("by_plan", (q) => q.eq("planId", plan._id)),
        ctx.db.query("eventAvailability").withIndex("by_plan", (q) => q.eq("planId", plan._id)),
      ];
      for (const q of kids) {
        for (const row of await q.collect()) await ctx.db.delete(row._id);
      }
      await ctx.db.delete(plan._id);
    }
    // Seeded serving teams + their roles.
    const demoTeams = (
      await ctx.db
        .query("teams")
        .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
        .collect()
    ).filter((t) => t.isDemoSeed);
    for (const team of demoTeams) {
      const roles = await ctx.db
        .query("teamRoles")
        .withIndex("by_team", (q) => q.eq("teamId", team._id))
        .collect();
      for (const role of roles) await ctx.db.delete(role._id);
      await ctx.db.delete(team._id);
    }

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
      for (const row of groupRows) {
        // Delete follow-up history hung off this membership before the
        // membership itself, so no orphaned rows are left behind.
        const followupRows = await ctx.db
          .query("memberFollowups")
          .withIndex("by_groupMember", (q) => q.eq("groupMemberId", row._id))
          .collect();
        for (const f of followupRows) await ctx.db.delete(f._id);
        await ctx.db.delete(row._id);
      }

      // People-roster rows for this seed member, plus their assignee junctions.
      const peopleRows = await ctx.db
        .query("communityPeople")
        .withIndex("by_community_user", (q) =>
          q.eq("communityId", args.communityId).eq("userId", user._id),
        )
        .collect();
      for (const person of peopleRows) {
        const junctions = await ctx.db
          .query("communityPeopleAssignees")
          .withIndex("by_communityPerson", (q) => q.eq("communityPersonId", person._id))
          .collect();
        for (const j of junctions) await ctx.db.delete(j._id);
        await ctx.db.delete(person._id);
      }
      // Junction rows where this seed member was the assignee (leaders).
      const assigneeJunctions = await ctx.db
        .query("communityPeopleAssignees")
        .withIndex("by_community_assignee", (q) =>
          q.eq("communityId", args.communityId).eq("assigneeUserId", user._id),
        )
        .collect();
      for (const j of assigneeJunctions) await ctx.db.delete(j._id);
      // Follow-ups this seed member authored (as a seeded leader).
      const authoredFollowups = await ctx.db
        .query("memberFollowups")
        .withIndex("by_createdBy", (q) => q.eq("createdById", user._id))
        .collect();
      for (const f of authoredFollowups) await ctx.db.delete(f._id);

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

      // Belt-and-suspenders: any rostering rows keyed to this seed member.
      // (The plan/team cascade above already removed the seeded ones, but a
      // member could linger on a plan the church kept.)
      const seedAssignments = await ctx.db
        .query("roleAssignments")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      for (const row of seedAssignments) await ctx.db.delete(row._id);

      const seedAvailability = await ctx.db
        .query("eventAvailability")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      for (const row of seedAvailability) await ctx.db.delete(row._id);

      await ctx.db.delete(membership._id);
      await ctx.db.delete(user._id);
      purged++;
    }

    // The seeded landing page SURVIVES go-live — it becomes the live
    // community's real landing page (the same default handleCheckoutCompleted
    // would otherwise create), so /c/[slug] and its join form keep working.

    // Recompute the denormalized channel state the purge invalidated, drop
    // demo-only props (stock avatars, giving link, tour channel).
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    for (const group of groups) {
      // Seeded group avatars are placeholder stock photos on a third-party
      // host — drop them so the now-live community isn't left depending on
      // picsum.photos in production. The church's own uploaded logo (an r2:
      // path on the announcement/campus groups) is kept.
      if (isDemoStockUrl(group.preview)) {
        await ctx.db.patch(group._id, { preview: undefined });
      }

      // Delete the demo-only "Partner with us" giving link ONLY if it still
      // points at the placeholder Pushpay URL. If the church edited it (the
      // "Make giving yours" mission), it's their real giving link now — keep it
      // even though isDemoSeed is still set (groupResources.update doesn't
      // clear the flag).
      const resources = await ctx.db
        .query("groupResources")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .collect();
      for (const resource of resources) {
        if (resource.isDemoSeed && resource.linkUrl === DEMO_GIVING_URL) {
          await ctx.db.delete(resource._id);
        }
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
