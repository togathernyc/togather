/**
 * FOUNT Service Planning Bot - Configuration
 *
 * Hardcoded constants for the FOUNT-specific Slack service planning bot.
 * This is intentionally not stored in the database -- it changes rarely
 * and keeping it in code makes it easy to review and deploy.
 */

// ============================================================================
// Dev Mode
// ============================================================================

/**
 * When true, posts to #togather-playground with reduced mentions.
 * Set to false for production (#services channel with full team mentions).
 */
export const DEV_MODE = false;

// ============================================================================
// Slack Channel
// ============================================================================

/** The #services channel ID in FOUNT's Slack workspace (from env var or fallback) */
const PROD_CHANNEL_ID = process.env.SLACK_PROD_CHANNEL_ID ?? "PLACEHOLDER_PROD_CHANNEL";

/** The #togather-playground channel ID for dev/testing (from env var or fallback) */
const DEV_CHANNEL_ID = process.env.SLACK_DEV_CHANNEL_ID ?? "PLACEHOLDER_DEV_CHANNEL";

export const SERVICES_CHANNEL_ID = DEV_MODE ? DEV_CHANNEL_ID : PROD_CHANNEL_ID;

// ============================================================================
// Team Members
// ============================================================================

export interface TeamMember {
  name: string;
  slackUserId: string;
  roles: string[]; // "preacher", "ml" (music leader), "av", "creative", "production", "admin", etc.
  locations: ("Manhattan" | "Brooklyn")[]; // Which locations they serve
}

/**
 * Team members involved in Sunday services.
 * These are the people tagged in weekly service planning threads.
 *
 * NOTE: Names and Slack user IDs are anonymized in source control.
 * Update with real values via environment configuration or database seeding.
 */
export const TEAM_MEMBERS: TeamMember[] = [
  // Leadership / Preachers
  { name: "Admin 1", slackUserId: "PLACEHOLDER_USER_01", roles: ["preacher", "admin"], locations: ["Manhattan", "Brooklyn"] },
  { name: "Admin 2", slackUserId: "PLACEHOLDER_USER_02", roles: ["preacher"], locations: ["Manhattan"] },
  { name: "Admin 3", slackUserId: "PLACEHOLDER_USER_03", roles: ["preacher", "ml"], locations: ["Manhattan", "Brooklyn"] },

  // Music / Worship
  { name: "Worship Lead 1", slackUserId: "PLACEHOLDER_USER_04", roles: ["ml", "worship"], locations: ["Manhattan", "Brooklyn"] },

  // Creative / Production
  { name: "Creative Lead 1", slackUserId: "PLACEHOLDER_USER_05", roles: ["creative", "admin"], locations: ["Manhattan", "Brooklyn"] },
  { name: "Production 1", slackUserId: "PLACEHOLDER_USER_06", roles: ["production"], locations: ["Manhattan", "Brooklyn"] },
  { name: "Production 2", slackUserId: "PLACEHOLDER_USER_07", roles: ["production"], locations: ["Manhattan", "Brooklyn"] },
  { name: "Production 3", slackUserId: "PLACEHOLDER_USER_08", roles: ["production"], locations: ["Manhattan", "Brooklyn"] },
  { name: "Production 4", slackUserId: "PLACEHOLDER_USER_09", roles: ["production"], locations: ["Manhattan", "Brooklyn"] },

  // Brooklyn-specific
  { name: "Production 5", slackUserId: "PLACEHOLDER_USER_10", roles: ["production"], locations: ["Brooklyn"] },
];

/**
 * Standard @mention list per location.
 * These are the user IDs tagged in thread openers.
 */
export const THREAD_MENTIONS: Record<"Manhattan" | "Brooklyn", string[]> = {
  Manhattan: [
    "PLACEHOLDER_USER_01", // Admin 1
    "PLACEHOLDER_USER_04", // Worship Lead 1
    "PLACEHOLDER_USER_02", // Admin 2
    "PLACEHOLDER_USER_06", // Production 1
    "PLACEHOLDER_USER_05", // Creative Lead 1
    "PLACEHOLDER_USER_08", // Production 3
    "PLACEHOLDER_USER_07", // Production 2
    "PLACEHOLDER_USER_09", // Production 4
    "PLACEHOLDER_USER_03", // Admin 3
  ],
  Brooklyn: [
    "PLACEHOLDER_USER_01", // Admin 1
    "PLACEHOLDER_USER_04", // Worship Lead 1
    "PLACEHOLDER_USER_10", // Production 5
    "PLACEHOLDER_USER_08", // Production 3
    "PLACEHOLDER_USER_06", // Production 1
    "PLACEHOLDER_USER_05", // Creative Lead 1
    "PLACEHOLDER_USER_07", // Production 2
    "PLACEHOLDER_USER_09", // Production 4
    "PLACEHOLDER_USER_03", // Admin 3
  ],
};

/**
 * Reduced mention list for testing — only tags Admin 1 and Admin 3
 * to avoid notifying the whole team during test runs.
 */
export const TEST_MENTIONS: Record<"Manhattan" | "Brooklyn", string[]> = {
  Manhattan: [
    "PLACEHOLDER_USER_01", // Admin 1
    "PLACEHOLDER_USER_03", // Admin 3
  ],
  Brooklyn: [
    "PLACEHOLDER_USER_01", // Admin 1
    "PLACEHOLDER_USER_03", // Admin 3
  ],
};

/** Active mention list — uses reduced set in dev mode to avoid spamming the team */
export const ACTIVE_MENTIONS = DEV_MODE ? TEST_MENTIONS : THREAD_MENTIONS;

// ============================================================================
// Service Plan Checklist
// ============================================================================

/** Items that need to be confirmed for each service */
export const SERVICE_PLAN_ITEMS = [
  "preacher",
  "meetingLead",
  "preachNotes",
  "setlist",
  "serviceFlow",
  "announcements",
  "serviceVideo",
] as const;

export type ServicePlanItem = (typeof SERVICE_PLAN_ITEMS)[number];

/** Human-readable labels for each checklist item */
export const SERVICE_PLAN_LABELS: Record<ServicePlanItem, string> = {
  preacher: "Preacher",
  meetingLead: "Meeting Lead (ML)",
  preachNotes: "Preach Notes",
  setlist: "Setlist",
  serviceFlow: "Service Flow",
  announcements: "Announcements",
  serviceVideo: "Service Video",
};

/** Which roles are responsible for each item */
export const ITEM_RESPONSIBLE_ROLES: Record<ServicePlanItem, string[]> = {
  preacher: ["preacher"],
  meetingLead: ["ml", "preacher"],
  preachNotes: ["preacher"],
  setlist: ["ml", "worship"],
  serviceFlow: ["production", "preacher"],
  announcements: ["admin", "preacher", "production"],
  serviceVideo: ["creative"],
};

// ============================================================================
// Nag Schedule (Eastern Time)
// ============================================================================

export interface NagSchedule {
  dayOfWeek: number; // 0=Sunday, 3=Wednesday, etc.
  hourET: number; // Hour in Eastern Time (24h)
  urgency: "gentle" | "direct" | "urgent" | "critical";
  label: string;
}

/**
 * When to send nag/status messages.
 * Each entry represents a check -- the bot looks at what's missing and nags.
 */
export const NAG_SCHEDULE: NagSchedule[] = [
  { dayOfWeek: 3, hourET: 11, urgency: "gentle", label: "Wednesday status" },
  { dayOfWeek: 4, hourET: 10, urgency: "direct", label: "Thursday check-in" },
  { dayOfWeek: 5, hourET: 10, urgency: "urgent", label: "Friday reminder" },
  { dayOfWeek: 6, hourET: 9, urgency: "critical", label: "Saturday final call" },
];

// ============================================================================
// Thread Creation Schedule
// ============================================================================

/** Day and hour (ET) to create weekly threads */
export const THREAD_CREATION = {
  dayOfWeek: 2, // Tuesday
  hourET: 10, // 10 AM ET
};

// ============================================================================
// Bot Identity
// ============================================================================

export const BOT_NAME = "Service Planning Bot";

export const BOT_EMOJI = ":church:";

/** The bot's Slack user ID — used to detect @mentions directed at the bot */
export const BOT_SLACK_USER_ID = process.env.SLACK_BOT_USER_ID ?? "PLACEHOLDER_BOT_USER";

// ============================================================================
// OpenAI Configuration
// ============================================================================

export const OPENAI_MODEL = "gpt-4o-mini";

/** Max tokens for parsing/classification responses */
export const OPENAI_MAX_TOKENS = 1200;

/** Max tokens for content generation (preach points, service flows, etc.) */
export const OPENAI_GENERATION_MAX_TOKENS = 2000;

/** Higher temperature for creative content generation */
export const OPENAI_GENERATION_TEMPERATURE = 0.7;

// ============================================================================
// PCO Configuration
// ============================================================================

/** Convex community ID for PCO integration credentials (from env var or fallback) */
const PROD_PCO_COMMUNITY_ID = process.env.PCO_PROD_COMMUNITY_ID ?? "PLACEHOLDER_PROD_PCO_COMMUNITY";
const DEV_PCO_COMMUNITY_ID = process.env.PCO_DEV_COMMUNITY_ID ?? "PLACEHOLDER_DEV_PCO_COMMUNITY";
export const PCO_COMMUNITY_ID = DEV_MODE ? DEV_PCO_COMMUNITY_ID : PROD_PCO_COMMUNITY_ID;

/** PCO Sunday service type IDs */
export const PCO_SERVICE_TYPE_IDS: Record<string, string> = {
  Manhattan: "1125518",
  Brooklyn: "398272",
};

/**
 * Maps service plan roles to PCO team name patterns and position names.
 * Team IDs are looked up dynamically via the PCO API at sync time.
 *
 * teamNamePattern: case-insensitive substring to match against PCO team names
 * positionName: the position title to assign within that team
 */
export const PCO_ROLE_MAPPINGS: Record<
  string,
  { teamNamePattern: string; positionName: string }
> = {
  preacher: { teamNamePattern: "platform", positionName: "Preacher" },
  meetingLead: { teamNamePattern: "platform", positionName: "Meeting Leader" },
};
