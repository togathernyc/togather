import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/**
 * Convex Schema for Togather
 *
 * Converted from Prisma schema. See /docs/schema-mapping.md for detailed field mappings.
 *
 * Key conventions:
 * - All timestamps stored as Unix milliseconds (v.number())
 * - Legacy BigInt IDs stored as v.string() for compatibility
 * - Relations use v.id("tableName") for Convex-native references
 * - Prisma unique constraints become indexes (uniqueness enforced in mutations)
 * - camelCase field names (converted from snake_case)
 *
 * Authentication:
 * - Uses Convex Auth (authTables) for session management
 * - Links to our existing 'users' table via authAccounts.userId
 */

export default defineSchema({
  // =============================================================================
  // CONVEX AUTH TABLES
  // =============================================================================
  // These tables are required by Convex Auth for session management.
  // See: https://labs.convex.dev/auth
  ...authTables,

  // =============================================================================
  // TOKEN REVOCATIONS (signout blacklist)
  // =============================================================================
  // Tracks when users sign out so tokens issued before that time are rejected.
  // Each record means "all tokens for this user issued before revokedBefore are invalid."
  tokenRevocations: defineTable({
    userId: v.id("users"),
    revokedBefore: v.number(), // Unix ms; compared to JWT iat (whole seconds) via floor(revokedBefore/1000)
    createdAt: v.number(), // Unix timestamp ms
  }).index("by_userId", ["userId"]),

  // =============================================================================
  // API KEYS (external integrations)
  // =============================================================================
  // Community-scoped API keys that let external apps (e.g. an attendance
  // dashboard) call the public HTTP API. The raw key is shown to the admin
  // exactly once at creation time; only a SHA-256 hash is persisted, so a
  // leaked database row can't be used to reconstruct a working key.
  apiKeys: defineTable({
    communityId: v.id("communities"),
    name: v.string(), // Human label, e.g. "Fount Attendance Dashboard"
    keyHash: v.string(), // SHA-256 hex of the raw key (never store the raw key)
    keyPrefix: v.string(), // First chars of the raw key, for display only (e.g. "tgk_a1b2c3d4")
    createdById: v.id("users"),
    createdAt: v.number(), // Unix timestamp ms
    lastUsedAt: v.optional(v.number()), // Unix timestamp ms; updated on each authenticated call
    revokedAt: v.optional(v.number()), // Unix timestamp ms; set when revoked (key stops working)
    revokedById: v.optional(v.id("users")),
  })
    .index("by_community", ["communityId"])
    .index("by_keyHash", ["keyHash"]),

  // =============================================================================
  // COMMUNITIES
  // =============================================================================

  communities: defineTable({
    // Legacy ID for migration compatibility
    legacyId: v.optional(v.string()), // Was: BigInt @id

    name: v.optional(v.string()),
    slug: v.optional(v.string()), // URL-friendly identifier
    logo: v.optional(v.string()),
    timezone: v.optional(v.string()),
    createdAt: v.optional(v.number()), // Unix timestamp ms
    updatedAt: v.optional(v.number()), // Unix timestamp ms
    homepageUrl: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    appIcon: v.optional(v.string()),
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    subdomain: v.optional(v.string()),
    country: v.optional(v.string()),
    primaryColor: v.optional(v.string()), // Hex color e.g. #1E8449
    secondaryColor: v.optional(v.string()), // Hex color e.g. #1E8449
    // LEGACY — Knicks mode is now an app-wide feature flag ("knicks-mode" in
    // the featureFlags table, flipped via /admin/features), no longer a
    // per-community setting. This column is unused by app logic; it stays in
    // the schema only so existing community rows pass schema validation.
    // Clear it with functions/migrations:clearCommunityKnicksMode, then drop
    // this field in a follow-up once every environment has been migrated.
    knicksMode: v.optional(v.boolean()),
    isPublic: v.optional(v.boolean()), // Whether community is publicly listed
    // Self-serve demo communities (see functions/demo.ts): seeded sandboxes a
    // prospective church spins up from a short questionnaire. Excluded from
    // community search/discovery; everyone who joins via the demo code becomes
    // an admin so a whole staff team can click around and re-brand together.
    isDemo: v.optional(v.boolean()),
    // The user who created the demo (for attribution and future cleanup).
    demoCreatedById: v.optional(v.id("users")),
    // Explore page default filters (admin-configurable)
    exploreDefaultGroupTypes: v.optional(v.array(v.id("groupTypes"))),
    exploreDefaultMeetingType: v.optional(v.number()), // 1=In-Person, 2=Online
    // Church-specific feature toggles. Absent / undefined = all off.
    // Forward-compat object so we can add more religious-tradition features
    // (e.g. confessionEnabled) without further schema changes.
    churchFeatures: v.optional(
      v.object({
        prayerEnabled: v.boolean(),
        eventTasksEnabled: v.optional(v.boolean()),
      }),
    ),
    // Community-level custom field definitions for People tab
    peopleCustomFields: v.optional(
      v.array(
        v.object({
          slot: v.string(), // e.g. "customText1", "customBool2"
          name: v.string(), // display label
          type: v.string(), // "text" | "number" | "boolean" | "dropdown" | "multiselect"
          options: v.optional(v.array(v.string())),
        }),
      ),
    ),


    // Community-level custom alert definitions for People tab
    alertConfig: v.optional(
      v.array(
        v.object({
          id: v.string(),
          variableId: v.string(),
          operator: v.string(), // "above" | "below"
          threshold: v.number(),
          label: v.optional(v.string()),
        }),
      ),
    ),

    // Denormalized field for full-text search (combines name and subdomain)
    searchText: v.optional(v.string()),

    // Stripe billing fields
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    subscriptionStatus: v.optional(v.string()), // "active" | "past_due" | "canceled" etc.
    subscriptionPriceMonthly: v.optional(v.number()),
    billingEmail: v.optional(v.string()),
    // "per_active_user" = $1/month per billable active member (see
    // functions/memberActivity.ts); a monthly cron syncs the Stripe
    // subscription quantity. Absent = legacy fixed-price subscription.
    billingModel: v.optional(v.string()),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_subdomain", ["subdomain"])
    .index("by_slug", ["slug"])
    .index("by_public", ["isPublic"])
    .index("by_stripeCustomerId", ["stripeCustomerId"])
    .index("by_stripeSubscriptionId", ["stripeSubscriptionId"])
    .searchIndex("search_communities", {
      searchField: "searchText",
      filterFields: ["isPublic"],
    }),

  // =============================================================================
  // USERS
  // =============================================================================

  users: defineTable({
    // Legacy ID for migration compatibility
    legacyId: v.optional(v.string()), // Was: BigInt @id

    password: v.optional(v.string()),
    lastLogin: v.optional(v.number()), // Unix timestamp ms
    isSuperuser: v.optional(v.boolean()),
    // Granular platform-level roles for delegated operator access.
    // Values: "poster_admin" (may expand later). isSuperuser/isStaff bypass this check.
    platformRoles: v.optional(v.array(v.string())),
    username: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    isStaff: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
    // True when a leader created a *provisional* user via the
    // assign-from-community "invite new person" flow — the row carries a
    // name + phone but no real account behind it. Cleared (and `isActive`
    // flipped to true) when that phone completes phone-OTP signup; until
    // then `users` rows with this flag must not be treated as real accounts.
    // See `assignFromCommunity` / `inviteAndAssign` in
    // `functions/scheduling/assignments.ts` and the claim path in
    // `verifyPhoneOTP` / `registerNewUser`.
    isPlaceholder: v.optional(v.boolean()),
    dateJoined: v.optional(v.number()), // Unix timestamp ms
    roles: v.optional(v.number()), // Was: SmallInt bitmask
    profilePhoto: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    createdAt: v.optional(v.number()), // Unix timestamp ms
    updatedAt: v.optional(v.number()), // Unix timestamp ms
    dateOfBirth: v.optional(v.number()), // Unix timestamp ms (date only)
    phoneVerified: v.optional(v.boolean()),
    associatedEmails: v.optional(v.array(v.string())), // Was: Json @default("[]")
    externalIds: v.optional(v.any()), // Was: Json @default("{}")
    timezone: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    activeCommunityId: v.optional(v.id("communities")),
    lastActiveAt: v.optional(v.number()), // Unix timestamp ms — updated on app foreground
    pushNotificationsEnabled: v.optional(v.boolean()),
    emailNotificationsEnabled: v.optional(v.boolean()),
    smsNotificationsEnabled: v.optional(v.boolean()),
    notifyNewMessages: v.optional(v.boolean()),
    notifyDailyBookings: v.optional(v.boolean()),
    // Denormalized field for full-text search (combines firstName, lastName, email, phone)
    searchText: v.optional(v.string()),

    // Public profile fields (displayed on the user profile page).
    // Kept separate from `dateOfBirth` — birthdayMonth/Day are shareable
    // (M/D only, no year) whereas `dateOfBirth` is PII used for age checks
    // and is never returned by the profile query.
    bio: v.optional(v.string()),
    instagramHandle: v.optional(v.string()),
    linkedinHandle: v.optional(v.string()),
    // Self-entered GitHub username for contributor attribution (ADR-029
    // Phase 2). Honor-system, not OAuth-verified — it only feeds the
    // Co-authored-by trailer on dev-dashboard PRs, never authentication.
    githubUsername: v.optional(v.string()),
    birthdayMonth: v.optional(v.number()), // 1–12
    birthdayDay: v.optional(v.number()), // 1–31
    location: v.optional(v.string()),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_email", ["email"])
    .index("by_phone", ["phone"])
    .index("by_username", ["username"])
    .index("by_activeCommunity", ["activeCommunityId"])
    .index("by_lastLogin", ["lastLogin"])
    .index("by_lastActiveAt", ["lastActiveAt"])
    .searchIndex("search_users", {
      searchField: "searchText",
      filterFields: [],
    }),

  // =============================================================================
  // USER COMMUNITY (Junction table for user-community membership)
  // =============================================================================

  userCommunities: defineTable({
    // Legacy ID for migration compatibility
    legacyId: v.optional(v.string()), // Was: BigInt @id

    userId: v.id("users"),
    communityId: v.id("communities"),
    roles: v.optional(v.number()), // Was: SmallInt bitmask
    createdAt: v.optional(v.number()), // Unix timestamp ms
    updatedAt: v.optional(v.number()), // Unix timestamp ms
    communityAnniversary: v.optional(v.number()), // Unix timestamp ms (date only)
    status: v.optional(v.number()), // Was: SmallInt
    // Unix timestamp ms — per-community activity: stamped on login, on
    // switching to this community, and on app foreground while it's the
    // active community (users.recordActivity). Drives the admin "Active
    // Members" stat and per-active-user billing (functions/memberActivity.ts).
    lastLogin: v.optional(v.number()),
    // External integrations - stores IDs from external systems per community membership
    // e.g., { planningCenterId: "12345" }
    externalIds: v.optional(
      v.object({
        planningCenterId: v.optional(v.string()),
        clearstreamContactId: v.optional(v.string()),
        flodeskSubscriberId: v.optional(v.string()),
      }),
    ),
    // Denormalized PCO person ID for efficient indexed lookups
    // This mirrors externalIds.planningCenterId but is top-level for indexing
    pcoPersonId: v.optional(v.string()),
    // Manual billing override for the per-active-user pricing model: admins
    // and leaders can mark a member inactive so they don't count toward the
    // $1/month/active-user subscription even if they opened the app this
    // month. See functions/memberActivity.ts.
    billingInactive: v.optional(v.boolean()),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_user", ["userId"])
    .index("by_community", ["communityId"])
    .index("by_user_community", ["userId", "communityId"])
    .index("by_community_lastLogin", ["communityId", "lastLogin"])
    .index("by_community_createdAt", ["communityId", "createdAt"])
    .index("by_community_pcoPersonId", ["communityId", "pcoPersonId"]),

  // =============================================================================
  // GROUP TYPES
  // =============================================================================

  groupTypes: defineTable({
    // Legacy ID for migration compatibility
    legacyId: v.optional(v.string()), // Was: Int @id

    communityId: v.id("communities"),
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(), // Unix timestamp ms
    displayOrder: v.number(),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_community", ["communityId"])
    .index("by_community_slug", ["communityId", "slug"])
    .index("by_community_active", ["communityId", "isActive"])
    .index("by_slug", ["slug"]),

  // =============================================================================
  // GROUPS
  // =============================================================================

  groups: defineTable({
    // Legacy ID for migration compatibility (was UUID string in Prisma)
    legacyId: v.optional(v.string()), // Was: String @id @db.Uuid

    communityId: v.id("communities"),
    groupTypeId: v.id("groupTypes"),
    name: v.string(),
    description: v.optional(v.string()),
    createdAt: v.number(), // Unix timestamp ms
    updatedAt: v.number(), // Unix timestamp ms
    isArchived: v.boolean(),
    archivedAt: v.optional(v.number()), // Unix timestamp ms

    // Address fields
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zipCode: v.optional(v.string()),

    // Meeting defaults
    defaultDay: v.optional(v.number()), // 0-6 (Sunday-Saturday)
    defaultStartTime: v.optional(v.string()), // Store as HH:MM string
    defaultEndTime: v.optional(v.string()), // Store as HH:MM string
    defaultMeetingLink: v.optional(v.string()),
    defaultMeetingType: v.optional(v.number()), // 1=In-Person, 2=Online

    // Break status
    isOnBreak: v.optional(v.boolean()),
    breakUntil: v.optional(v.number()), // Unix timestamp ms (date only)

    // Other fields
    preview: v.optional(v.string()), // Image path
    externalChatLink: v.optional(v.string()),
    isAnnouncementGroup: v.optional(v.boolean()),
    isPublic: v.optional(v.boolean()), // Whether group is publicly visible
    // When true, the group is hidden from discovery surfaces (near-me map,
    // community landing page list, search/browse). Direct share links still
    // work and existing members retain access. Community-admin toggle only.
    hiddenFromDiscovery: v.optional(v.boolean()),
    shortId: v.optional(v.string()), // For shareable links (/g/[shortId])
    coordinates: v.optional(
      v.object({
        latitude: v.number(),
        longitude: v.number(),
      }),
    ),

    // Channel pinning - ordered array of channel slugs that should appear pinned
    pinnedChannelSlugs: v.optional(v.array(v.string())),

    // Leader toolbar configuration - ordered list of tool IDs to show
    // If undefined, shows default tools: ["attendance", "followup", "events", "bots"]
    // Empty array = hide toolbar entirely
    // Tool IDs: "attendance", "followup", "events", "bots", "sync"
    leaderToolbarTools: v.optional(v.array(v.string())),

    // Toolbar visibility settings for non-leaders
    // Global toggle - show toolbar to non-leader members (default: false)
    showToolbarToMembers: v.optional(v.boolean()),
    // Per-tool visibility settings
    // Keys = tool IDs, Values = "leaders" | "everyone"
    // Tools not in this record use their defaultVisibility from toolbarTools.ts
    toolVisibility: v.optional(v.record(v.string(), v.string())),

    // Custom display names for built-in tools
    // Keys = tool IDs, Values = custom display name (overrides default label)
    toolDisplayNames: v.optional(v.record(v.string(), v.string())),

    // Follow-up score configuration
    // Allows group admins to define custom scoring formulas with weighted variables
    // If undefined, uses default Attendance + Connection scores
    followupScoreConfig: v.optional(
      v.object({
        scores: v.array(
          v.object({
            id: v.string(),
            name: v.string(), // max 12 chars, displayed in UI
            variables: v.array(
              v.object({
                variableId: v.string(),
                weight: v.number(), // positive, relative weight
              }),
            ),
          }),
        ),
        memberSubtitle: v.optional(v.string()), // custom subtitle for member cards, e.g. "Last follow-up: {lastFollowup}"
        alerts: v.optional(
          v.array(
            v.object({
              id: v.string(),
              variableId: v.string(),
              operator: v.string(), // "above" | "below"
              threshold: v.number(),
              label: v.optional(v.string()),
            }),
          ),
        ),
      }),
    ),

    // Follow-up column configuration (column order, visibility, custom fields)
    followupColumnConfig: v.optional(
      v.object({
        columnOrder: v.array(v.string()),
        hiddenColumns: v.array(v.string()),
        customFields: v.array(
          v.object({
            slot: v.string(), // e.g. "customText1", "customBool2"
            name: v.string(), // display label
            type: v.string(), // "text" | "number" | "boolean" | "dropdown"
            options: v.optional(v.array(v.string())),
          }),
        ),
      }),
    ),

    // Follow-up refresh status (for manual/automated denormalized table rebuilds)
    followupRefreshState: v.optional(
      v.object({
        status: v.string(), // "running" | "idle" | "failed"
        runId: v.string(),
        startedAt: v.number(),
        completedAt: v.optional(v.number()),
        failedAt: v.optional(v.number()),
        error: v.optional(v.string()),
        requestedById: v.optional(v.id("users")),
        trigger: v.optional(v.string()), // "manual" | "score_config_update" | "scheduled"
      }),
    ),

    // PCO serving counts — written by the getServingCounts action,
    // read by the follow-up scoring query. Lightweight alternative to a cache table.
    pcoServingCounts: v.optional(
      v.object({
        updatedAt: v.number(),
        counts: v.array(
          v.object({
            userId: v.id("users"),
            count: v.number(),
          }),
        ),
        // Per-user serving detail records (date, team, position) from PCO
        servingDetails: v.optional(
          v.array(
            v.object({
              userId: v.id("users"),
              date: v.string(), // ISO date string from plan sort_date
              serviceTypeName: v.string(),
              teamName: v.string(),
              position: v.optional(v.string()),
            }),
          ),
        ),
      }),
    ),

    // Run Sheet configuration for PCO integration
    // Stores default service type filters and view preferences
    runSheetConfig: v.optional(
      v.object({
        // Which run sheet the leader-tools "Run Sheet" tool shows for this
        // group: "pco" (default/legacy — live from Planning Center) or
        // "native" (the group's upcoming event-plan run sheet, ADR-026). Typed
        // as a permissive string here so the schema also tolerates pre-existing
        // legacy `source` drift on some prod docs; writes are constrained to
        // "pco"|"native" by `updateRunSheetConfig`, and readers default any
        // other/absent value to "pco".
        source: v.optional(v.string()),
        defaultServiceTypeIds: v.optional(v.array(v.string())),
        defaultView: v.optional(v.string()), // "compact" | "detailed"
        // Chip configuration for filtering/ordering plan item categories
        chipConfig: v.optional(
          v.object({
            hidden: v.array(v.string()), // category names to hide
            order: v.array(v.string()), // ordered visible category names
          }),
        ),
      }),
    ),

    // Reach Out channel configuration
    reachOutConfig: v.optional(
      v.object({
        enabled: v.boolean(),
        channelName: v.optional(v.string()), // Default: "Reach Out"
      }),
    ),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_community", ["communityId"])
    .index("by_groupType", ["groupTypeId"])
    .index("by_community_type_archived", [
      "communityId",
      "groupTypeId",
      "isArchived",
    ])
    .index("by_community_public", ["communityId", "isPublic"])
    .index("by_createdAt", ["createdAt"])
    .index("by_shortId", ["shortId"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["communityId"],
    }),

  // =============================================================================
  // GROUP MEMBERS
  // =============================================================================

  groupMembers: defineTable({
    // Legacy ID for migration compatibility
    legacyId: v.optional(v.string()), // Was: Int @id

    groupId: v.id("groups"),
    userId: v.id("users"),
    role: v.string(), // 'leader', 'member', etc.
    joinedAt: v.number(), // Unix timestamp ms
    leftAt: v.optional(v.number()), // Unix timestamp ms
    notificationsEnabled: v.boolean(),

    // Join request fields
    requestStatus: v.optional(v.string()), // 'pending', 'accepted', 'declined'
    requestedAt: v.optional(v.number()), // Unix timestamp ms
    requestReviewedAt: v.optional(v.number()), // Unix timestamp ms
    requestReviewedById: v.optional(v.id("users")),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_group", ["groupId"])
    .index("by_user", ["userId"])
    .index("by_group_user", ["groupId", "userId"])
    .index("by_requestStatus", ["requestStatus"])
    .index("by_group_requestStatus", ["groupId", "requestStatus"])
    .index("by_role", ["role"]),

  // =============================================================================
  // GROUP RESOURCES
  // =============================================================================
  // Custom resource pages that groups can create for members.
  // Examples: "Welcome" page for new members, "Resources" with helpful links, etc.

  groupResources: defineTable({
    groupId: v.id("groups"),
    title: v.string(), // "Welcome", "Roles", "Resources", etc.
    icon: v.optional(v.string()), // Icon name. Plain string = Ionicons; "mci:<name>" = MaterialCommunityIcons.
    // When set, tapping the resource opens this URL instead of the resource
    // detail page. Lets a resource act as a pure link (e.g. a "Give" button
    // that opens a donation page) with no sections/content of its own.
    linkUrl: v.optional(v.string()),
    // When true, the resource is shown under its group's item in the chat
    // inbox. Independent of the toolbar (a resource can appear in the inbox
    // without being added to the group's toolbar, and vice versa).
    showInInbox: v.optional(v.boolean()),
    visibility: v.object({
      type: v.union(
        v.literal("everyone"),
        v.literal("joined_within"),
        v.literal("channel_members"),
      ),
      // For "joined_within" type - number of days
      daysWithin: v.optional(v.number()),
      // For "channel_members" type - list of channel IDs
      channelIds: v.optional(v.array(v.id("chatChannels"))),
    }),
    sections: v.array(
      v.object({
        id: v.string(), // Unique ID for ordering/editing
        title: v.string(),
        description: v.optional(v.string()),
        imageUrls: v.optional(v.array(v.string())),
        linkUrl: v.optional(v.string()),
        order: v.number(),
      }),
    ),
    order: v.number(), // Order in toolbar
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_group", ["groupId"]),

  // =============================================================================
  // TOOL SHORT LINKS
  // =============================================================================
  // Short URLs for sharing direct links to group tools (e.g. togather.nyc/t/abc123).
  // Supports Run Sheet and Resource tools. A separate table is needed because
  // Run Sheet is a built-in tool with no DB record to attach a shortId to.

  toolShortLinks: defineTable({
    shortId: v.string(),
    groupId: v.id("groups"),
    toolType: v.string(), // "runsheet" | "resource"
    resourceId: v.optional(v.id("groupResources")),
    createdAt: v.number(),
    createdBy: v.optional(v.id("users")),
  })
    .index("by_shortId", ["shortId"])
    .index("by_group_toolType", ["groupId", "toolType"])
    .index("by_group_toolType_resourceId", [
      "groupId",
      "toolType",
      "resourceId",
    ]),

  // =============================================================================
  // EVENT SERIES
  // =============================================================================
  // Group-scoped series that link multiple meetings together (e.g., "Weekly Dinner Party").
  // For community-wide series, each group gets its own eventSeries record;
  // the series name serves as the implicit cross-group link.

  eventSeries: defineTable({
    groupId: v.id("groups"),
    createdById: v.id("users"),
    name: v.string(), // e.g., "Weekly Dinner Party"
    status: v.string(), // 'active' | 'cancelled'
    createdAt: v.number(), // Unix timestamp ms
  })
    .index("by_group", ["groupId"])
    .index("by_group_name", ["groupId", "name"])
    .index("by_group_status", ["groupId", "status"]),

  // =============================================================================
  // COMMUNITY-WIDE EVENTS
  // =============================================================================
  // Parent events that spawn individual meetings for all groups of a type.
  // Created by community admins to coordinate events across multiple groups.

  communityWideEvents: defineTable({
    communityId: v.id("communities"),
    groupTypeId: v.id("groupTypes"), // e.g., "dinner_parties"
    createdById: v.id("users"),
    title: v.string(),
    scheduledAt: v.number(), // Unix timestamp ms
    meetingType: v.number(), // 1=In-Person, 2=Online
    meetingLink: v.optional(v.string()),
    note: v.optional(v.string()),
    // Shared cover image for the parent CWE. Children display this when
    // they don't have their own — so updating the parent cover doesn't
    // force-override any child event.
    coverImage: v.optional(v.string()),
    status: v.string(), // 'scheduled' | 'cancelled'
    createdAt: v.number(), // Unix timestamp ms
    updatedAt: v.optional(v.number()), // Unix timestamp ms
  })
    .index("by_community_groupType", ["communityId", "groupTypeId"])
    .index("by_community_status", ["communityId", "status"])
    .index("by_scheduledAt", ["communityId", "scheduledAt"]),

  // =============================================================================
  // MEETINGS
  // =============================================================================

  meetings: defineTable({
    // Legacy ID for migration compatibility (was UUID string in Prisma)
    legacyId: v.optional(v.string()), // Was: String @id @db.Uuid

    groupId: v.id("groups"),
    createdById: v.optional(v.id("users")),

    // Hosts own the event for permissions, event chat, and RSVP notifications.
    // When undefined/empty, the backend falls back to [createdById] via
    // getHostUserIds() in lib/meetingPermissions.ts. New events always write
    // this field explicitly (defaulting to [creator]); undefined only appears
    // on legacy rows created before hosts existed.
    hostUserIds: v.optional(v.array(v.id("users"))),

    title: v.optional(v.string()),
    scheduledAt: v.number(), // Unix timestamp ms
    actualEnd: v.optional(v.number()), // Unix timestamp ms
    status: v.string(), // 'scheduled', 'completed', 'cancelled'
    cancellationReason: v.optional(v.string()),
    meetingType: v.number(), // 1=In-Person, 2=Online
    meetingLink: v.optional(v.string()),
    locationOverride: v.optional(v.string()),
    note: v.optional(v.string()),
    coverImage: v.optional(v.string()),
    // When the cover came from the curated poster library, this references the source.
    // Null when the user uploaded a custom image via the fallback flow.
    posterId: v.optional(v.id("posters")),
    createdAt: v.number(), // Unix timestamp ms

    // RSVP configuration
    rsvpEnabled: v.optional(v.boolean()),
    rsvpOptions: v.optional(
      v.array(
        v.object({
          id: v.number(),
          label: v.string(),
          enabled: v.boolean(),
        }),
      ),
    ),
    // When true, attendees can RSVP but the count is hidden from non-leaders.
    // Leaders/host still see the count with a "Visible to leaders only" badge.
    hideRsvpCount: v.optional(v.boolean()),

    // Visibility
    visibility: v.optional(v.string()), // 'group' | 'community' | 'public' | 'groups'
    // When visibility is 'groups', members of these groups can also see and
    // RSVP, in addition to the hosting group. Ignored for other visibilities.
    visibleGroupIds: v.optional(v.array(v.id("groups"))),

    // Public sharing
    publicSlug: v.optional(v.string()),
    shortId: v.optional(v.string()),

    // Reminder fields
    reminderAt: v.optional(v.number()), // Unix timestamp ms
    reminderSent: v.optional(v.boolean()),

    // Attendance confirmation fields
    attendanceConfirmationAt: v.optional(v.number()), // Unix timestamp ms
    attendanceConfirmationSent: v.optional(v.boolean()),

    // Scheduled job IDs for cancellation when rescheduling
    reminderJobId: v.optional(v.id("_scheduled_functions")),
    attendanceConfirmationJobId: v.optional(v.id("_scheduled_functions")),

    // Community-wide event link
    communityWideEventId: v.optional(v.id("communityWideEvents")), // Link to parent
    isOverridden: v.optional(v.boolean()), // Leader customized, stops cascade

    // Event series link
    seriesId: v.optional(v.id("eventSeries")),

    // RSVP leader notification toggle (defaults to true)
    rsvpNotifyLeaders: v.optional(v.boolean()),

    // Max guests (plus-ones) allowed per RSVP. Falls back to MAX_GUESTS_PER_RSVP constant.
    maxGuestsPerRsvp: v.optional(v.number()),

    // Location flexibility: "address" uses locationOverride, "online" uses meetingLink,
    // "tbd" means intentionally unspecified. Optional for backwards compatibility with
    // legacy rows; enforced on create/update for new writes. See ADR-022.
    locationMode: v.optional(
      v.union(v.literal("address"), v.literal("online"), v.literal("tbd"))
    ),

    // Search support (denormalized)
    communityId: v.optional(v.id("communities")), // Denormalized from group for search filtering
    searchText: v.optional(v.string()), // Denormalized: title + location + group name
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_group", ["groupId"])
    .index("by_createdBy", ["createdById"])
    .index("by_group_scheduledAt", ["groupId", "scheduledAt"])
    .index("by_group_status", ["groupId", "status"])
    .index("by_scheduledAt", ["scheduledAt"])
    .index("by_publicSlug", ["publicSlug"])
    .index("by_shortId", ["shortId"])
    .index("by_communityWideEvent", ["communityWideEventId"])
    .index("by_series", ["seriesId"])
    .index("by_community", ["communityId"])
    .index("by_community_scheduledAt", ["communityId", "scheduledAt"])
    .searchIndex("search_meetings", {
      searchField: "searchText",
      filterFields: ["communityId", "status"],
    }),

  // =============================================================================
  // MEETING RSVP
  // =============================================================================

  meetingRsvps: defineTable({
    // Legacy ID for migration compatibility (was UUID string in Prisma)
    legacyId: v.optional(v.string()), // Was: String @id @db.Uuid

    meetingId: v.id("meetings"),
    userId: v.id("users"),
    rsvpOptionId: v.number(), // References rsvpOptions.id in meeting
    guestCount: v.optional(v.number()), // Plus-ones brought (0-N). Only valid on "Going" option.
    createdAt: v.number(), // Unix timestamp ms
    updatedAt: v.number(), // Unix timestamp ms
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_meeting", ["meetingId"])
    .index("by_user", ["userId"])
    .index("by_meeting_user", ["meetingId", "userId"]),

  // =============================================================================
  // EVENT BLASTS (message blasts to RSVPed attendees)
  // =============================================================================

  eventBlasts: defineTable({
    meetingId: v.id("meetings"),
    groupId: v.id("groups"),
    communityId: v.id("communities"),
    sentById: v.id("users"),
    message: v.string(),
    channels: v.array(v.string()), // ["sms", "push"]
    recipientCount: v.number(),
    status: v.string(), // "sent" | "failed" | "partial"
    results: v.optional(v.any()), // { smsSucceeded, smsFailed, pushSucceeded, pushFailed }
    createdAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_group", ["groupId"]),

  // =============================================================================
  // EVENT INVITES (one row per recipient — dedupes "already invited")
  // =============================================================================

  eventInvites: defineTable({
    meetingId: v.id("meetings"),
    groupId: v.id("groups"),
    communityId: v.id("communities"),
    sentById: v.id("users"),
    recipientUserId: v.id("users"),
    phone: v.optional(v.string()), // snapshot at send time
    personalNote: v.optional(v.string()),
    channels: v.array(v.string()), // ["sms", "push"]
    // per-recipient status — pending → sent | partial | failed
    status: v.string(),
    smsStatus: v.optional(v.string()), // "succeeded" | "failed" | "skipped"
    pushStatus: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    inviteRound: v.number(), // 1 = first invite, 2+ = manual reminders
    lastSentAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_meeting_recipient", ["meetingId", "recipientUserId"])
    .index("by_group", ["groupId"]),

  // =============================================================================
  // ADMIN BROADCASTS (targeted notifications with 2-party approval)
  // =============================================================================

  adminBroadcasts: defineTable({
    communityId: v.id("communities"),
    createdById: v.id("users"),
    approvedById: v.optional(v.id("users")),

    // Targeting
    targetCriteria: v.object({
      type: v.string(),
      groupTypeSlug: v.optional(v.string()),
      daysThreshold: v.optional(v.number()),
    }),
    targetUserCount: v.number(),

    // Content
    title: v.string(),
    body: v.string(),
    channels: v.array(v.string()), // ["push", "email", "sms"]
    deepLink: v.optional(v.string()),

    // Status
    status: v.string(), // "draft" | "pending_approval" | "approved" | "sent" | "rejected"
    sentAt: v.optional(v.number()),
    results: v.optional(v.any()),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_community", ["communityId"])
    .index("by_community_status", ["communityId", "status"]),

  // =============================================================================
  // MEETING ATTENDANCE
  // =============================================================================

  meetingAttendances: defineTable({
    // Legacy ID for migration compatibility (was UUID string in Prisma)
    legacyId: v.optional(v.string()), // Was: String @id @db.Uuid

    meetingId: v.id("meetings"),
    userId: v.id("users"),
    status: v.number(), // Attendance status code
    // Legacy field from the inline leader-attendance panel (feat/event-attendance-and-plus-ones).
    // No longer written by any mutation, but kept optional so pre-existing prod docs validate.
    guestAttendedCount: v.optional(v.number()),
    recordedAt: v.number(), // Unix timestamp ms
    recordedById: v.optional(v.id("users")),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_meeting", ["meetingId"])
    .index("by_user", ["userId"])
    .index("by_meeting_user", ["meetingId", "userId"])
    .index("by_meeting_status", ["meetingId", "status"]),

  // =============================================================================
  // MEETING GUESTS
  // =============================================================================

  meetingGuests: defineTable({
    // Legacy ID for migration compatibility (was UUID string in Prisma)
    legacyId: v.optional(v.string()), // Was: String @id @db.Uuid

    meetingId: v.id("meetings"),
    userId: v.optional(v.id("users")), // Optional: if guest is linked to a user
    recordedById: v.optional(v.id("users")),

    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
    recordedAt: v.number(), // Unix timestamp ms
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_meeting", ["meetingId"])
    .index("by_user", ["userId"])
    .index("by_phoneNumber", ["phoneNumber"]),

  // =============================================================================
  // NOTIFICATIONS
  // =============================================================================

  notifications: defineTable({
    // Legacy ID for migration compatibility (was UUID string in Prisma)
    legacyId: v.optional(v.string()), // Was: String @id @db.Uuid

    userId: v.id("users"),
    communityId: v.optional(v.id("communities")),
    groupId: v.optional(v.id("groups")),

    notificationType: v.string(),
    title: v.string(),
    body: v.string(),
    data: v.any(), // JSON data
    status: v.string(), // 'pending', 'sent', 'failed'
    isRead: v.boolean(),
    readAt: v.optional(v.number()), // Unix timestamp ms
    createdAt: v.number(), // Unix timestamp ms
    sentAt: v.optional(v.number()), // Unix timestamp ms
    errorMessage: v.optional(v.string()),

    // Tracking fields for impression/click analytics
    trackingId: v.optional(v.string()),
    impressedAt: v.optional(v.number()), // Unix timestamp ms when displayed on device
    clickedAt: v.optional(v.number()), // Unix timestamp ms when user tapped
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_user", ["userId"])
    .index("by_community", ["communityId"])
    .index("by_group", ["groupId"])
    .index("by_user_read_created", ["userId", "isRead", "createdAt"])
    .index("by_user_type", ["userId", "notificationType"])
    .index("by_type", ["notificationType"])
    .index("by_createdAt", ["createdAt"])
    .index("by_impressedAt", ["impressedAt"])
    .index("by_clickedAt", ["clickedAt"])
    .index("by_trackingId", ["trackingId"]),

  // =============================================================================
  // NOTIFICATION HOURLY ROLLUPS
  // =============================================================================
  // Counter rows keyed by (hourStartMs, notificationType). Populated hourly by
  // a cron that scans the notifications table for the previous hour, so the
  // admin dashboard can read O(hours × types) instead of scanning notifications
  // directly. Hourly granularity lets any viewer timezone slice "today" exactly.

  notificationHourlyStats: defineTable({
    hourStartMs: v.number(), // UTC timestamp at the start of the hour
    type: v.string(),        // notificationType
    sent: v.number(),
    impressed: v.number(),
    clicked: v.number(),
    updatedAt: v.number(),
  })
    .index("by_hour", ["hourStartMs"])
    .index("by_hour_type", ["hourStartMs", "type"])
    .index("by_type_hour", ["type", "hourStartMs"]),

  // Cursor tracking the latest hour `runHourlyRollup` has fully processed.
  // Needed as a separate doc because hours with zero notifications produce
  // no rows in `notificationHourlyStats` — so we can't derive progress from
  // that table (the cron would stall after >MAX_CATCH_UP_HOURS empty hours).
  // Singleton — the only expected key is "default".
  notificationRollupCursor: defineTable({
    key: v.string(),
    lastProcessedHourMs: v.number(),
  }).index("by_key", ["key"]),

  // Daily snapshot of distinct users with at least one active push token,
  // scoped per environment. Populated by `dailyEnabledSnapshot.run` cron at
  // 0:05 UTC. Drives the "notifications enabled — today vs yesterday" card on
  // the superuser admin dashboard.
  //
  // We snapshot rather than compute historically because tokens are deleted
  // on disable, so the row count at any past moment isn't reconstructible
  // from the current `pushTokens` table.
  //
  // `date` is the UTC day this snapshot represents (e.g. "2026-04-29" for the
  // run that fired at 00:05 UTC on 2026-04-30 covering the day that just ended).
  dailyNotificationStats: defineTable({
    date: v.string(),         // "YYYY-MM-DD" in UTC
    environment: v.string(),  // "production" | "staging"
    enabledCount: v.number(), // distinct userIds with ≥1 push token in this env
    createdAt: v.number(),    // when the snapshot row was written
  })
    .index("by_environment_date", ["environment", "date"])
    .index("by_date", ["date"]),

  // Running count of distinct users with ≥1 push token, scoped per
  // environment. Maintained incrementally by mutations that insert/delete
  // pushTokens rows (registerToken, unregisterToken, updatePreferences
  // disable, user-delete cascade). Both the daily snapshot cron and the
  // superuser dashboard query read this counter in O(1) instead of scanning
  // the full pushTokens table — that scan would hit Convex transaction
  // limits as token volume grows.
  //
  // One row per environment. Seeded by `backfillEnabledCounter`
  // (paginated action) on first deploy.
  notificationEnabledCounter: defineTable({
    environment: v.string(),  // "production" | "staging"
    count: v.number(),        // distinct userIds with ≥1 push token in this env
    updatedAt: v.number(),
  }).index("by_environment", ["environment"]),

  // =============================================================================
  // PUSH TOKENS
  // =============================================================================

  pushTokens: defineTable({
    // Legacy ID for migration compatibility (was UUID string in Prisma)
    legacyId: v.optional(v.string()), // Was: String @id @db.Uuid

    userId: v.id("users"),
    token: v.string(),
    platform: v.string(), // 'ios', 'android', 'web'
    deviceId: v.optional(v.string()),
    bundleId: v.optional(v.string()),
    environment: v.optional(v.string()), // 'development', 'production'
    isActive: v.boolean(),
    createdAt: v.number(), // Unix timestamp ms
    updatedAt: v.number(), // Unix timestamp ms
    lastUsedAt: v.number(), // Unix timestamp ms
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_user", ["userId"])
    .index("by_token", ["token"])
    .index("by_token_bundleId", ["token", "bundleId"])
    .index("by_user_active_environment", ["userId", "isActive", "environment"]),

  // =============================================================================
  // GROUP BOT CONFIG
  // =============================================================================

  groupBotConfigs: defineTable({
    // Legacy ID for migration compatibility (was UUID string in Prisma)
    legacyId: v.optional(v.string()), // Was: String @id @db.Uuid

    groupId: v.id("groups"),
    botType: v.string(), // 'reminder', 'engagement', etc.
    enabled: v.boolean(),
    state: v.any(), // JSON state
    config: v.any(), // JSON config
    nextScheduledAt: v.optional(v.number()), // Unix timestamp ms
    // NOTE: targetChannelSlug is currently stored in config.targetChannelSlug (JSON)
    // This top-level field is reserved for future migration to enable easier querying
    targetChannelSlug: v.optional(v.string()), // Channel slug (general, leaders, or custom slug)
    createdAt: v.number(), // Unix timestamp ms
    updatedAt: v.number(), // Unix timestamp ms
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_group", ["groupId"])
    .index("by_group_botType", ["groupId", "botType"])
    .index("by_botType_enabled", ["botType", "enabled"])
    .index("by_botType_enabled_scheduled", [
      "botType",
      "enabled",
      "nextScheduledAt",
    ]),

  // =============================================================================
  // GROUP CREATION REQUESTS
  // =============================================================================

  groupCreationRequests: defineTable({
    // Legacy ID for migration compatibility (was UUID string in Prisma)
    legacyId: v.optional(v.string()), // Was: String @id @db.Uuid

    communityId: v.id("communities"),
    requesterId: v.id("users"),
    status: v.string(), // 'pending', 'approved', 'declined'

    // Proposed group details
    name: v.string(),
    description: v.optional(v.string()),
    groupTypeId: v.id("groupTypes"),
    proposedStartDay: v.optional(v.number()), // 0-6 (Sunday-Saturday)
    maxCapacity: v.optional(v.number()),
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    defaultStartTime: v.optional(v.string()), // Store as HH:MM string
    defaultEndTime: v.optional(v.string()), // Store as HH:MM string
    defaultMeetingType: v.optional(v.number()), // 1=In-Person, 2=Online
    defaultMeetingLink: v.optional(v.string()),
    preview: v.optional(v.string()), // Image path

    // Proposed additional leaders
    proposedLeaderIds: v.optional(v.array(v.string())), // Array of user IDs

    // Review tracking
    reviewedAt: v.optional(v.number()), // Unix timestamp ms
    reviewedById: v.optional(v.id("users")),
    declineReason: v.optional(v.string()),
    createdGroupId: v.optional(v.id("groups")),

    createdAt: v.number(), // Unix timestamp ms
    updatedAt: v.number(), // Unix timestamp ms
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_community", ["communityId"])
    .index("by_requester", ["requesterId"])
    .index("by_community_status", ["communityId", "status"])
    .index("by_status", ["status"]),

  // =============================================================================
  // MEMBER FOLLOWUP
  // =============================================================================

  memberFollowups: defineTable({
    // Legacy ID for migration compatibility (was UUID string in Prisma)
    legacyId: v.optional(v.string()), // Was: String @id @db.Uuid

    groupMemberId: v.id("groupMembers"),
    createdById: v.id("users"),
    type: v.string(), // 'note', 'call', 'text', 'snooze', 'followed_up', 'reach_out'
    content: v.optional(v.string()),
    snoozeUntil: v.optional(v.number()), // Unix timestamp ms
    reachOutRequestId: v.optional(v.id("reachOutRequests")), // Link to reach-out request
    createdAt: v.number(), // Unix timestamp ms
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_groupMember", ["groupMemberId"])
    .index("by_groupMember_createdAt", ["groupMemberId", "createdAt"])
    // For "most recent of type X for member" lookups in score recomputes —
    // back-dated rows can sit far behind newer entries, so we need to
    // resolve them via an index rather than a filtered scan.
    .index("by_groupMember_type_createdAt", ["groupMemberId", "type", "createdAt"])
    .index("by_createdBy", ["createdById"])
    .index("by_snoozeUntil", ["snoozeUntil"]),

  // =============================================================================
  // TASKS
  // =============================================================================
  // Canonical leader task system for reminders, reach-out intake, and manual work.
  // Supports group-level ownership, person assignment, hierarchy, and source tracing.

  tasks: defineTable({
    groupId: v.id("groups"),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.string(), // "open" | "snoozed" | "done" | "canceled"
    responsibilityType: v.string(), // "group" | "person"
    assignedToId: v.optional(v.id("users")),
    createdById: v.optional(v.id("users")), // optional for system-created tasks
    sourceType: v.string(), // "manual" | "bot_task_reminder" | "reach_out" | "followup" | "workflow_template"
    sourceRef: v.optional(v.string()),
    sourceKey: v.optional(v.string()), // idempotency key for generated tasks
    targetType: v.string(), // "none" | "member" | "group" | "placeholder"
    targetMemberId: v.optional(v.id("users")),
    targetGroupId: v.optional(v.id("groups")),
    // Placeholder contact used when a workflow is applied to a person who has not
    // signed up yet. On registration we auto-match by normalized phone and rewrite
    // targetMemberId / targetType. See functions/tasks.linkPlaceholderTasksForUser.
    targetPlaceholderName: v.optional(v.string()),
    targetPlaceholderPhone: v.optional(v.string()), // E.164, normalized
    targetPlaceholderEmail: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    parentTaskId: v.optional(v.id("tasks")),
    orderKey: v.optional(v.number()),
    dueAt: v.optional(v.number()),
    snoozedUntil: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_group", ["groupId"])
    .index("by_group_status", ["groupId", "status"])
    .index("by_group_assignee_status", ["groupId", "assignedToId", "status"])
    .index("by_assignee_status", ["assignedToId", "status"])
    .index("by_responsibility_status", ["responsibilityType", "status"])
    .index("by_parent", ["parentTaskId"])
    .index("by_sourceKey", ["sourceKey"])
    .index("by_target_member", ["targetMemberId"])
    .index("by_target_group", ["targetGroupId"])
    .index("by_target_placeholder_phone", ["targetPlaceholderPhone"])
    .index("by_target_placeholder_email", ["targetPlaceholderEmail"]),

  // =============================================================================
  // TASK EVENTS
  // =============================================================================
  // Append-only audit timeline for task lifecycle changes.

  taskEvents: defineTable({
    taskId: v.id("tasks"),
    groupId: v.id("groups"),
    type: v.string(), // "created" | "assigned" | "claimed" | "done" | "snoozed" | "canceled" | "updated"
    performedById: v.optional(v.id("users")),
    payload: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_task", ["taskId"])
    .index("by_task_createdAt", ["taskId", "createdAt"])
    .index("by_group_createdAt", ["groupId", "createdAt"]),

  // =============================================================================
  // TASK TEMPLATES (leader workflow checklists applied to members)
  // =============================================================================

  taskTemplates: defineTable({
    groupId: v.id("groups"),
    title: v.string(),
    description: v.optional(v.string()),
    createdById: v.id("users"),
    steps: v.array(
      v.object({
        title: v.string(),
        description: v.optional(v.string()),
        orderIndex: v.number(),
      }),
    ),
    tags: v.optional(v.array(v.string())),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_group", ["groupId"])
    .index("by_group_active", ["groupId", "isActive"]),

  // =============================================================================
  // MEMBER FOLLOWUP SCORES (pre-computed for paginated list reads)
  // =============================================================================
  // Single source of truth for the followup screen. Pre-computed scores + manual
  // leader fields in one doc per group member. The `list` query reads this table
  // directly — zero joins, zero computation at read time.
  //
  // Separate from groupMembers to isolate reactivity: only the followup screen
  // subscribes to these docs. Score updates from cron/events don't trigger
  // re-renders in member lists, search, chat, etc.

  memberFollowupScores: defineTable({
    groupId: v.id("groups"),
    groupMemberId: v.id("groupMembers"),
    userId: v.id("users"),

    // ── Denormalized display info (zero-join reads) ──
    firstName: v.string(),
    lastName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    memberSubtitleValue: v.optional(v.string()),

    // ── Computed score columns (auto-updated by events + cron) ──
    // Mapped from ScoreConfig: scores[0] → score1, scores[1] → score2, etc.
    score1: v.number(),
    score2: v.number(),
    score3: v.optional(v.number()),
    score4: v.optional(v.number()),

    // Alert labels (pre-evaluated from score config thresholds)
    alerts: v.array(v.string()),

    // Snooze state
    isSnoozed: v.boolean(),
    snoozedUntil: v.optional(v.number()),

    // Raw variable values (for detail view breakdown, avoids recompute)
    rawValues: v.optional(v.any()),

    // Legacy scores (for backward compatibility with detail view)
    attendanceScore: v.number(),
    connectionScore: v.number(),
    followupScore: v.number(),
    missedMeetings: v.number(),
    consecutiveMissed: v.number(),
    lastAttendedAt: v.optional(v.number()),
    lastFollowupAt: v.optional(v.number()),
    lastActiveAt: v.optional(v.number()),
    scoreFactors: v.optional(v.any()),

    // Score IDs mapping (which scoreConfig.scores[i].id maps to score1, score2, etc.)
    scoreIds: v.array(v.string()),

    // ── Additional denormalized display info ──
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    dateOfBirth: v.optional(v.number()), // Unix timestamp ms (date only)
    latestNote: v.optional(v.string()),
    latestNoteAt: v.optional(v.number()),

    // ── Manual leader fields (Phase 2 — set via mutations) ──
    status: v.optional(v.string()),
    assigneeId: v.optional(v.id("users")),
    assigneeIds: v.optional(v.array(v.id("users"))),
    connectionPoint: v.optional(v.string()),

    // ── Custom field slots (configurable columns) ──
    customText1: v.optional(v.string()),
    customText2: v.optional(v.string()),
    customText3: v.optional(v.string()),
    customText4: v.optional(v.string()),
    customText5: v.optional(v.string()),
    customNum1: v.optional(v.number()),
    customNum2: v.optional(v.number()),
    customNum3: v.optional(v.number()),
    customNum4: v.optional(v.number()),
    customNum5: v.optional(v.number()),
    customBool1: v.optional(v.boolean()),
    customBool2: v.optional(v.boolean()),
    customBool3: v.optional(v.boolean()),
    customBool4: v.optional(v.boolean()),
    customBool5: v.optional(v.boolean()),
    customBool6: v.optional(v.boolean()),
    customBool7: v.optional(v.boolean()),
    customBool8: v.optional(v.boolean()),
    customBool9: v.optional(v.boolean()),
    customBool10: v.optional(v.boolean()),

    // ── Denormalized search field (firstName + lastName + email + phone) ──
    searchText: v.optional(v.string()),

    // ── Timestamps ──
    updatedAt: v.number(),
    addedAt: v.optional(v.number()),
  })
    // Sort indexes — score columns
    .index("by_group_score1", ["groupId", "score1"])
    .index("by_group_score2", ["groupId", "score2"])
    // Sort indexes — display columns
    .index("by_group_firstName", ["groupId", "firstName"])
    .index("by_group_lastName", ["groupId", "lastName"])
    .index("by_group_addedAt", ["groupId", "addedAt"])
    .index("by_group_lastAttendedAt", ["groupId", "lastAttendedAt"])
    .index("by_group_lastFollowupAt", ["groupId", "lastFollowupAt"])
    .index("by_group_lastActiveAt", ["groupId", "lastActiveAt"])
    // Sort indexes — manual fields (Phase 2)
    .index("by_group_status", ["groupId", "status"])
    .index("by_group_assignee", ["groupId", "assigneeId"])
    // Sort indexes — custom fields (first 3 of each type for server-side sorting)
    .index("by_group_customText1", ["groupId", "customText1"])
    .index("by_group_customText2", ["groupId", "customText2"])
    .index("by_group_customText3", ["groupId", "customText3"])
    .index("by_group_customNum1", ["groupId", "customNum1"])
    .index("by_group_customNum2", ["groupId", "customNum2"])
    .index("by_group_customNum3", ["groupId", "customNum3"])
    .index("by_group_customBool1", ["groupId", "customBool1"])
    .index("by_group_customBool2", ["groupId", "customBool2"])
    .index("by_group_customBool3", ["groupId", "customBool3"])
    // Lookup indexes
    .index("by_groupMember", ["groupMemberId"])
    .index("by_group", ["groupId"])
    .index("by_assignee", ["assigneeId"])
    // Full-text search
    .searchIndex("search_followup", {
      searchField: "searchText",
      filterFields: ["groupId", "status", "assigneeId"],
    }),

  // =============================================================================
  // COMMUNITY INTEGRATIONS
  // =============================================================================

  communityIntegrations: defineTable({
    // Legacy ID for migration compatibility
    legacyId: v.optional(v.string()), // Was: Int @id

    communityId: v.id("communities"),
    connectedById: v.optional(v.id("users")),
    integrationType: v.string(), // 'planning_center', etc.
    credentials: v.any(), // Encrypted JSON
    config: v.any(), // JSON config
    status: v.string(), // 'active', 'inactive', 'error'
    lastSyncAt: v.optional(v.number()), // Unix timestamp ms
    lastError: v.optional(v.string()),
    createdAt: v.number(), // Unix timestamp ms
    updatedAt: v.number(), // Unix timestamp ms
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_community", ["communityId"])
    .index("by_community_type", ["communityId", "integrationType"])
    .index("by_status", ["status"])
    .index("by_connectedBy", ["connectedById"]),

  // =============================================================================
  // AUTO CHANNEL CONFIGS
  // =============================================================================
  // Generic configuration for auto channels that sync membership from external sources.
  // Supports multiple integrations: PCO Services, Elvanto, CCB, etc.
  // See: /docs/architecture/PCO-auto-channels-design.md

  autoChannelConfigs: defineTable({
    communityId: v.id("communities"),
    channelId: v.id("chatChannels"),
    integrationType: v.string(), // "pco_services" | "elvanto" | "ccb" | etc.

    // Integration-specific configuration
    // PCO Services: serviceTypeId, serviceTypeName, syncScope, teamIds, teamNames
    // Other integrations will have their own fields
    config: v.object({
      // NEW: Filter-based configuration (preferred)
      // All filter fields are optional - empty/missing = include all
      filters: v.optional(
        v.object({
          // Service Type filter - which services to sync from
          serviceTypeIds: v.optional(v.array(v.string())),
          serviceTypeNames: v.optional(v.array(v.string())), // For display

          // Team filter - which teams within services
          teamIds: v.optional(v.array(v.string())),
          teamNames: v.optional(v.array(v.string())), // For display

          // Position filter - supports both simple strings and objects with context
          // Strings: fuzzy match on position names (e.g., ["Director", "Staff"])
          // Objects: match with team/service context for disambiguation
          positions: v.optional(
            v.array(
              v.union(
                v.string(), // Simple string for backward compatibility
                v.object({
                  name: v.string(),
                  teamId: v.optional(v.string()),
                  teamName: v.optional(v.string()),
                  serviceTypeId: v.optional(v.string()),
                  serviceTypeName: v.optional(v.string()),
                }),
              ),
            ),
          ), // e.g., ["Director"] or [{ name: "Worship Leader", teamId: "manhattan-worship" }]

          // Schedule status filter
          statuses: v.optional(v.array(v.string())), // "C" (confirmed), "U" (unconfirmed), etc.
        }),
      ),

      // LEGACY: Keep existing fields for backward compatibility
      serviceTypeId: v.optional(v.string()),
      serviceTypeName: v.optional(v.string()),
      syncScope: v.optional(v.string()), // "all_teams" | "single_team" | "multi_team"
      teamIds: v.optional(v.array(v.string())),
      teamNames: v.optional(v.array(v.string())),

      // Generic timing (all auto channels use these)
      addMembersDaysBefore: v.number(),
      removeMembersDaysAfter: v.number(),
    }),

    // Sync state
    currentEventId: v.optional(v.string()), // PCO Plan ID, Elvanto Event ID, etc.
    currentEventDate: v.optional(v.number()), // Unix timestamp ms
    lastSyncAt: v.optional(v.number()), // Unix timestamp ms
    lastSyncStatus: v.optional(v.string()), // "success" | "error"
    lastSyncError: v.optional(v.string()),

    // Sync results - tracks matched vs unmatched people
    lastSyncResults: v.optional(
      v.object({
        matchedCount: v.number(),
        unmatchedCount: v.number(),
        // Unmatched people from PCO who couldn't be found in Togather
        unmatchedPeople: v.optional(
          v.array(
            v.object({
              pcoPersonId: v.string(),
              pcoName: v.string(), // Name from PCO
              pcoPhone: v.optional(v.string()),
              pcoEmail: v.optional(v.string()),
              serviceTypeName: v.optional(v.string()), // Service type from PCO for display (e.g., "MANHATTAN")
              teamName: v.optional(v.string()), // Team from PCO for display
              position: v.optional(v.string()), // Position from PCO for display
              reason: v.string(), // "not_in_community" | "not_in_group" | "no_contact_info" | "phone_mismatch" | "email_mismatch"
            }),
          ),
        ),
      }),
    ),

    isActive: v.boolean(),
    createdAt: v.number(), // Unix timestamp ms
    updatedAt: v.number(), // Unix timestamp ms
  })
    .index("by_community", ["communityId"])
    .index("by_channel", ["channelId"])
    .index("by_integration_type", ["integrationType"])
    .index("by_active", ["isActive"])
    .index("by_active_integrationType", ["isActive", "integrationType"]),

  // =============================================================================
  // ATTENDANCE CONFIRMATION TOKENS
  // =============================================================================

  attendanceConfirmationTokens: defineTable({
    // Legacy ID for migration compatibility (was UUID string in Prisma)
    legacyId: v.optional(v.string()), // Was: String @id @db.Uuid

    token: v.string(),
    userId: v.id("users"),
    meetingId: v.id("meetings"),
    expiresAt: v.number(), // Unix timestamp ms
    usedAt: v.optional(v.number()), // Unix timestamp ms
    createdAt: v.number(), // Unix timestamp ms
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_token", ["token"])
    .index("by_user_meeting", ["userId", "meetingId"]),

  // =============================================================================
  // LEGACY ACCOUNT CLAIMS
  // =============================================================================

  legacyAccountClaims: defineTable({
    // Legacy ID for migration compatibility
    legacyId: v.optional(v.string()), // Was: BigInt @id

    name: v.string(),
    communityName: v.string(),
    phone: v.string(),
    possibleEmails: v.array(v.string()), // Was: Json
    status: v.string(), // 'pending', 'resolved', 'rejected'
    notes: v.string(),
    resolvedAt: v.optional(v.number()), // Unix timestamp ms
    createdAt: v.number(), // Unix timestamp ms
    updatedAt: v.number(), // Unix timestamp ms
    resolvedById: v.optional(v.id("users")),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_status", ["status"])
    .index("by_resolvedBy", ["resolvedById"]),

  // =============================================================================
  // EMAIL VERIFICATION CODES
  // =============================================================================

  emailVerificationCodes: defineTable({
    email: v.string(), // The email address
    /** Distinguishes account-claim vs password-reset so OTPs are not interchangeable. */
    purpose: v.union(
      v.literal("account_claim"),
      v.literal("password_reset")
    ),
    code: v.string(), // The 6-digit verification code
    expiresAt: v.number(), // Unix timestamp ms when the code expires
    usedAt: v.optional(v.number()), // Unix timestamp ms when the code was used
    createdAt: v.number(), // Unix timestamp ms when the code was created
  })
    .index("by_email", ["email"])
    .index("by_email_code", ["email", "code"])
    .index("by_email_purpose", ["email", "purpose"])
    .index("by_email_code_purpose", ["email", "code", "purpose"])
    .index("by_expiresAt", ["expiresAt"]),

  // =============================================================================
  // PHONE VERIFICATION TOKENS
  // =============================================================================
  // Stores tokens proving a phone number was verified via OTP.
  // Used to secure the registration flow - users must present a valid token
  // to prove they went through the phone verification step.

  phoneVerificationTokens: defineTable({
    phone: v.string(), // The verified phone number
    token: v.string(), // Random token (UUID) proving verification
    expiresAt: v.number(), // Unix timestamp ms when the token expires (10 min)
    usedAt: v.optional(v.number()), // Unix timestamp ms when token was consumed
    createdAt: v.number(), // Unix timestamp ms when the token was created
  })
    .index("by_phone", ["phone"])
    .index("by_phone_token", ["phone", "token"])
    .index("by_expiresAt", ["expiresAt"]),

  // =============================================================================
  // CONVEX-NATIVE MESSAGING
  // =============================================================================
  // These tables implement a native messaging system to replace Stream Chat.
  // See: /docs/architecture/ADR-020-convex-native-messaging.md

  /**
   * Chat Channels
   * Represents a chat channel (group chat, leaders chat, DM, or ad-hoc group chat).
   * Channel types:
   *   - "main" - Default channel for a group
   *   - "leaders" - Leaders-only channel
   *   - "dm" - 1:1 direct message (ad-hoc, not tied to a group)
   *   - "group_dm" - Ad-hoc group chat (not tied to a group)
   *   - "custom" - Custom channel with manual membership
   *   - "pco_services" - Auto channel synced from PCO Services
   *   - "event" - Event-tied channel scoped to a meeting
   *   - "announcements" - Leader-broadcast channel; visible to all members, only leaders can post (opt-in per group)
   *   - Future: "elvanto", "ccb", etc.
   *
   * Invariant: exactly one of `groupId` or `communityId` is set.
   *   - groupId set: traditional group-channel ("main" | "leaders" | "custom" | "pco_services" | "event" | "reach_out" | "announcements")
   *   - communityId set: ad-hoc channel ("dm" | "group_dm"), with `isAdHoc: true`
   * Enforced in mutations, not at the DB level (Convex has no constraints).
   */
  chatChannels: defineTable({
    groupId: v.optional(v.id("groups")),
    /**
     * Set for ad-hoc channels (dm, group_dm) that are not bound to a group,
     * and for announcements/shared channels so `by_community_isShared` can
     * scope share scans to one community.
     */
    communityId: v.optional(v.id("communities")),
    /** Convenience flag: true for ad-hoc dm/group_dm channels. */
    isAdHoc: v.optional(v.boolean()),
    /** For 1:1 DMs: deterministic key for dedup, sorted "userIdA::userIdB". */
    dmPairKey: v.optional(v.string()),
    slug: v.optional(v.string()), // URL-friendly, unique per group, immutable (optional for migration)
    channelType: v.string(), // "main" | "leaders" | "dm" | "group_dm" | "custom" | "pco_services" | "event" | "reach_out" | "announcements" | "cross_team"
    name: v.string(),
    description: v.optional(v.string()),
    /**
     * Optional per-channel hint shown as the composer placeholder (e.g.
     * "put experience updates here"). Guides members to post the right kind of
     * content in this thread. Editable by leaders on the channel info screen.
     */
    hint: v.optional(v.string()),
    createdById: v.id("users"),
    createdAt: v.number(), // Unix timestamp ms
    updatedAt: v.number(), // Unix timestamp ms
    isArchived: v.boolean(),
    archivedAt: v.optional(v.number()), // Unix timestamp ms
    /** false = leader hid channel from members; memberships stay (unlike archive). undefined/true = active. */
    isEnabled: v.optional(v.boolean()),
    /** For channelType === "event": the meeting this channel is scoped to. */
    meetingId: v.optional(v.id("meetings")),
    /** Who toggled isEnabled=false (audit trail for disabling event chats). */
    disabledByUserId: v.optional(v.id("users")),
    // Denormalized for performance
    lastMessageAt: v.optional(v.number()), // Unix timestamp ms
    lastMessagePreview: v.optional(v.string()), // First 100 chars
    lastMessageSenderId: v.optional(v.id("users")), // For inbox preview
    lastMessageSenderName: v.optional(v.string()), // For inbox preview
    memberCount: v.number(),
    // Shared channel fields
    isShared: v.optional(v.boolean()), // Quick flag to identify shared channels
    sharedGroups: v.optional(
      v.array(
        v.object({
          groupId: v.id("groups"), // The secondary group
          status: v.union(v.literal("pending"), v.literal("accepted")),
          invitedById: v.id("users"), // Primary group leader who sent invite
          invitedAt: v.number(), // Unix timestamp ms
          respondedById: v.optional(v.id("users")), // Secondary group leader who responded
          respondedAt: v.optional(v.number()), // Unix timestamp ms
          sortOrder: v.optional(v.number()), // How this group orders the channel
          /** Linked group's leaders hid the channel from tab bar / chat; owning group unchanged. */
          hiddenFromNavigation: v.optional(v.boolean()),
          /**
           * Announcements-type shares only: whether this group's OWN
           * announcements channel was enabled when it accepted the share
           * (accepting disables it). Used to restore the prior state when the
           * group later leaves the share. Carried over when switching shares
           * so the true original state survives back-to-back shares.
           */
          previousAnnouncementsChannelEnabled: v.optional(v.boolean()),
        }),
      ),
    ),
    // Channel invite link fields
    inviteShortId: v.optional(v.string()), // 9-char alphanumeric from generateShortId()
    inviteEnabled: v.optional(v.boolean()), // toggle link on/off
    joinMode: v.optional(v.string()), // "open" | "approval_required"
    /**
     * When true, this channel doubles as a serving team: its members are the
     * roster, and it can own teamRoles + be scheduled on eventPlans.
     * See ADR-023. Undefined/false = ordinary channel.
     */
    isServingTeam: v.optional(v.boolean()),
    /**
     * Set for `channelType === "cross_team"` channels. A cross-team channel
     * owns no roles or events of its own; its membership is auto-synced (same
     * rotation window + `event_plan` syncSource as a serving-team channel)
     * from `roleAssignments` across the listed source serving-team channels.
     * Each selector pulls in everyone assigned `roleId` on `sourceChannelId`,
     * or — when `roleId` is omitted — everyone assigned any role there.
     */
    crossTeamSync: v.optional(
      v.object({
        selectors: v.array(
          v.object({
            sourceTeamId: v.id("teams"),
            /** ADR-025 legacy — unused dead column, stripped in a follow-up. */
            sourceChannelId: v.optional(v.id("chatChannels")),
            roleId: v.optional(v.id("teamRoles")),
          }),
        ),
      }),
    ),
  })
    .index("by_group", ["groupId"])
    .index("by_group_type", ["groupId", "channelType"])
    .index("by_group_slug", ["groupId", "slug"])
    .index("by_createdBy", ["createdById"])
    .index("by_lastMessageAt", ["lastMessageAt"])
    .index("by_archived", ["isArchived"])
    .index("by_isShared", ["isShared"])
    .index("by_community_isShared", ["communityId", "isShared"])
    .index("by_inviteShortId", ["inviteShortId"])
    .index("by_meetingId", ["meetingId"])
    .index("by_dmPairKey", ["dmPairKey"])
    .index("by_community_isAdHoc", ["communityId", "isAdHoc"]),

  /**
   * Chat Channel Members
   * Junction table for channel membership with roles and preferences.
   */
  chatChannelMembers: defineTable({
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
    role: v.string(), // "admin" | "moderator" | "member"
    joinedAt: v.number(), // Unix timestamp ms
    leftAt: v.optional(v.number()), // Unix timestamp ms
    isMuted: v.boolean(),
    mutedUntil: v.optional(v.number()), // Unix timestamp ms
    // Denormalized user info for display
    displayName: v.optional(v.string()),
    profilePhoto: v.optional(v.string()),
    /**
     * Manually pinned member. When true, the auto-sync reconcile
     * (`teamChannelSync.ts`) never soft-removes this row — a leader added them
     * by hand and they stay in the channel even when off-roster. Independent of
     * `syncSource`: a row can be BOTH `isPermanent` and role-synced
     * (`syncSource === "event_plan"`), in which case they render in both the
     * "Permanent" and "Synced by role" sections of a cross-team Channel Info page.
     */
    isPermanent: v.optional(v.boolean()),
    // Auto-sync tracking (for auto channels like PCO Services)
    syncSource: v.optional(v.string()), // "pco_services" | "event_rsvp" | null (manual)
    syncEventId: v.optional(v.string()), // External event/plan ID that added them
    scheduledRemovalAt: v.optional(v.number()), // Unix timestamp ms for auto-removal
    // Additional sync metadata (team, position, service date for display)
    syncMetadata: v.optional(
      v.object({
        serviceTypeName: v.optional(v.string()), // e.g. "MANHATTAN", "BROOKLYN"
        teamName: v.optional(v.string()), // e.g. "Worship Band"
        position: v.optional(v.string()), // e.g. "Lead Vocals", "Drums"
        serviceDate: v.optional(v.number()), // Unix timestamp ms
        serviceName: v.optional(v.string()), // e.g. "Sunday Service"
      }),
    ),
    /**
     * Per-user request state for ad-hoc channels (dm, group_dm).
     *   - "pending": user was added but has not accepted; messages held from their view, no read-receipt/typing leakage
     *   - "accepted": full access
     *   - "declined": user rejected the chat; row treated as soft-deleted (creator not notified)
     * Undefined for legacy/group-channel members → treated as "accepted".
     */
    requestState: v.optional(v.string()),
    requestRespondedAt: v.optional(v.number()), // Unix timestamp ms; for analytics + 30d expiry
    /** Who added this user to the channel (for ad-hoc invites). */
    invitedById: v.optional(v.id("users")),
  })
    .index("by_channel", ["channelId"])
    .index("by_user", ["userId"])
    .index("by_channel_user", ["channelId", "userId"])
    .index("by_channel_syncSource", ["channelId", "syncSource"])
    .index("by_role", ["role"])
    .index("by_user_requestState", ["userId", "requestState"])
    // Cross-user index used by the daily cron to expire stale pending requests.
    .index("by_requestState_joinedAt", ["requestState", "joinedAt"]),

  /**
   * Channel Join Requests
   * Tracks join request lifecycle for channels with joinMode === "approval_required".
   */
  channelJoinRequests: defineTable({
    channelId: v.id("chatChannels"),
    groupId: v.id("groups"), // Denormalized for efficient group-level queries
    userId: v.id("users"),
    status: v.string(), // "pending" | "approved" | "declined"
    requestedAt: v.number(), // Unix timestamp ms
    reviewedAt: v.optional(v.number()), // Unix timestamp ms
    reviewedById: v.optional(v.id("users")),
  })
    .index("by_channel_status", ["channelId", "status"])
    .index("by_channel_user", ["channelId", "userId"])
    .index("by_group_status", ["groupId", "status"])
    .index("by_user", ["userId"]),

  /**
   * Chat Messages
   * Stores all messages with support for threads and soft deletion.
   */
  chatMessages: defineTable({
    channelId: v.id("chatChannels"),
    /**
     * Denormalized community the message belongs to (derived from the channel's
     * group, or the channel's own communityId for ad-hoc dm/group_dm channels).
     * Set at write time and backfilled for existing rows; used as a search-index
     * filter field so inbox search scopes to a community without scanning other
     * tenants' messages. Optional only for legacy rows pending backfill.
     */
    communityId: v.optional(v.id("communities")),
    senderId: v.optional(v.id("users")), // Optional for bot/system messages
    content: v.string(), // Message text
    contentType: v.string(), // "text" | "image" | "file" | "system" | "bot" | "reach_out_request" | "task_card" | "bug_card" | "poll" | "availability_request"
    attachments: v.optional(
      v.array(
        v.object({
          type: v.string(), // "image" | "file" | "link"
          url: v.string(),
          name: v.optional(v.string()),
          size: v.optional(v.number()),
          mimeType: v.optional(v.string()),
          thumbnailUrl: v.optional(v.string()),
          waveform: v.optional(v.array(v.number())),
          duration: v.optional(v.number()),
        }),
      ),
    ),
    // Threading
    parentMessageId: v.optional(v.id("chatMessages")),
    threadReplyCount: v.optional(v.number()),
    // Timestamps
    createdAt: v.number(), // Unix timestamp ms
    updatedAt: v.optional(v.number()), // Unix timestamp ms
    editedAt: v.optional(v.number()), // Unix timestamp ms
    // Soft delete
    isDeleted: v.boolean(),
    deletedAt: v.optional(v.number()), // Unix timestamp ms
    deletedById: v.optional(v.id("users")),
    // Denormalized sender info
    senderName: v.optional(v.string()),
    senderProfilePhoto: v.optional(v.string()),
    // Mentions
    mentionedUserIds: v.optional(v.array(v.id("users"))),
    // Thread bump: tracks when thread last had activity (reply or creation)
    // Used for sorting top-level messages so threads with new replies float up
    lastActivityAt: v.optional(v.number()),
    // Link preview control
    hideLinkPreview: v.optional(v.boolean()),
    // Reach Out request reference (for request cards in leaders channel)
    reachOutRequestId: v.optional(v.id("reachOutRequests")),
    // Canonical task reference for task-aware chat cards
    taskId: v.optional(v.id("tasks")),
    // Dev-assistant bug reference for contentType === "bug_card"
    bugId: v.optional(v.id("devBugs")),
    // Poll reference for contentType === "poll"
    pollId: v.optional(v.id("polls")),
    // Availability-request reference for contentType === "availability_request"
    availabilityRequestId: v.optional(v.id("availabilityRequests")),
    // Optional idempotency key for generated bot/task posts
    sourceKey: v.optional(v.string()),
    // For mirrored text blasts — backlink to the eventBlasts row so the UI
    // can render an "Also sent via SMS" badge and deep-link to delivery stats.
    blastId: v.optional(v.id("eventBlasts")),
  })
    .index("by_channel", ["channelId"])
    .index("by_channel_createdAt", ["channelId", "createdAt"])
    .index("by_channel_lastActivityAt", ["channelId", "lastActivityAt"])
    .index("by_sender", ["senderId"])
    .index("by_parentMessage", ["parentMessageId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_sourceKey", ["sourceKey"])
    // Full-text search over message body for inbox search. `communityId`
    // scopes the search to a single tenant in the index (so other communities'
    // messages aren't scanned), and `isDeleted` keeps soft-deleted messages out
    // of the result budget. Per-channel permission scoping is still enforced in
    // the query handler against the user's accessible channels — Convex search
    // filters can't OR across the user's channel set.
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["communityId", "isDeleted"],
    }),

  /**
   * Polls
   *
   * Posted into channels via the chat composer. Backed by a `chatMessages`
   * row with `contentType: "poll"` and `pollId` pointing here. The card UI
   * renders inline in place of the normal message bubble.
   *
   * v1 semantics:
   *  - `isAnonymous`: always written `false`. Field is reserved for a future
   *    setting that hides voter identity in `getPollVoters`.
   *  - `closesAt`: never set in v1 (no deadline picker). Field is reserved
   *    for a future scheduler-based auto-close. `status` only flips via
   *    the manual `closePoll` mutation today.
   *  - Authors and group leaders can edit/close/delete via `editPoll`,
   *    `closePoll`, `deletePoll`. `editCount`/`editedAt` track edits so the
   *    card can render an "edited" badge.
   */
  polls: defineTable({
    channelId: v.id("chatChannels"),
    /** Back-pointer to the host message. Set after the message is inserted. */
    messageId: v.optional(v.id("chatMessages")),
    authorId: v.id("users"),
    question: v.string(),
    options: v.array(
      v.object({
        /** Stable id; survives text edits so vote rows stay attached. */
        id: v.string(),
        text: v.string(),
      }),
    ),
    allowMultiple: v.boolean(),
    isAnonymous: v.boolean(),
    closesAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("closed")),
    closedAt: v.optional(v.number()),
    /** Total votes (each ticked option counts once). */
    voteCount: v.number(),
    /** Unique voters (one per user even if they ticked multiple options). */
    voterCount: v.number(),
    editedAt: v.optional(v.number()),
    editCount: v.number(),
    createdAt: v.number(),
  })
    .index("by_channel", ["channelId"])
    .index("by_message", ["messageId"]),

  /**
   * Poll Votes
   *
   * One row per (poll, option, voter). For multi-select polls a single voter
   * may have multiple rows in the same poll. For single-select, the
   * `by_poll_voter` index is used to enforce one row per voter.
   *
   * `voterId` is stored even though v1 isn't anonymous — needed for "you
   * voted" indicators, double-vote prevention, and to support a future
   * anonymous mode where identity is hidden in queries but tracked at rest.
   */
  pollVotes: defineTable({
    pollId: v.id("polls"),
    optionId: v.string(),
    voterId: v.id("users"),
    /** Denormalized for permission checks without re-fetching the poll. */
    channelId: v.id("chatChannels"),
    createdAt: v.number(),
  })
    .index("by_poll", ["pollId"])
    .index("by_poll_option", ["pollId", "optionId"])
    .index("by_poll_voter", ["pollId", "voterId"]),

  /**
   * Chat Message Reactions
   * Stores individual reactions to messages.
   */
  chatMessageReactions: defineTable({
    messageId: v.id("chatMessages"),
    userId: v.id("users"),
    emoji: v.string(), // Emoji character or shortcode
    createdAt: v.number(), // Unix timestamp ms
  })
    .index("by_message", ["messageId"])
    .index("by_message_user", ["messageId", "userId"])
    .index("by_message_emoji", ["messageId", "emoji"])
    .index("by_user", ["userId"])
    .index("by_createdAt", ["createdAt"]),

  /**
   * Chat Read State
   * Tracks read/unread state per user per channel.
   */
  chatReadState: defineTable({
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
    lastReadMessageId: v.optional(v.id("chatMessages")),
    lastReadAt: v.number(), // Unix timestamp ms
    unreadCount: v.number(),
  })
    .index("by_channel", ["channelId"])
    .index("by_user", ["userId"])
    .index("by_channel_user", ["channelId", "userId"]),

  /**
   * Chat Thread Subscriptions
   *
   * Per-user notification preference for a single thread (a parent message and
   * its replies). The absence of a row is the default: a member is notified
   * about a reply only when they are @mentioned. A row overrides that default:
   *   - "all":  notify on every reply, even without a mention
   *   - "none": never notify, even when @mentioned
   *
   * `threadId` is the parent (root) message of the thread. Toggled from the
   * bell control in the thread view (see ThreadHeader on mobile).
   */
  chatThreadSubscriptions: defineTable({
    threadId: v.id("chatMessages"),
    userId: v.id("users"),
    state: v.union(v.literal("all"), v.literal("none")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_thread_user", ["threadId", "userId"])
    .index("by_user", ["userId"]),

  /**
   * Chat Typing Indicators
   * Ephemeral typing indicators with automatic cleanup.
   */
  chatTypingIndicators: defineTable({
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
    startedAt: v.number(), // Unix timestamp ms
    expiresAt: v.number(), // Unix timestamp ms - auto-cleanup after 5s
  })
    .index("by_channel", ["channelId"])
    .index("by_channel_user", ["channelId", "userId"])
    .index("by_expiresAt", ["expiresAt"]),

  /**
   * Chat User Blocks
   * User-to-user blocking within the chat system.
   */
  chatUserBlocks: defineTable({
    blockerId: v.id("users"),
    blockedId: v.id("users"),
    createdAt: v.number(), // Unix timestamp ms
    reason: v.optional(v.string()),
  })
    .index("by_blocker", ["blockerId"])
    .index("by_blocked", ["blockedId"])
    .index("by_blocker_blocked", ["blockerId", "blockedId"]),

  /**
   * Chat Message Flags
   * Content moderation flags for messages.
   */
  chatMessageFlags: defineTable({
    messageId: v.id("chatMessages"),
    reportedById: v.id("users"),
    reason: v.string(), // "spam" | "harassment" | "inappropriate" | "other"
    details: v.optional(v.string()),
    status: v.string(), // "pending" | "reviewed" | "dismissed" | "actioned"
    reviewedById: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()), // Unix timestamp ms
    actionTaken: v.optional(v.string()),
    createdAt: v.number(), // Unix timestamp ms
  })
    .index("by_message", ["messageId"])
    .index("by_reportedBy", ["reportedById"])
    .index("by_status", ["status"])
    .index("by_reviewedBy", ["reviewedById"]),

  /**
   * Meeting Reports
   * Content moderation reports for meetings (mirrors chatMessageFlags).
   * Reports route to the event's group leaders. See ADR-022.
   */
  meetingReports: defineTable({
    meetingId: v.id("meetings"),
    reportedById: v.id("users"),
    reason: v.string(), // "spam" | "inappropriate" | "other"
    details: v.optional(v.string()),
    status: v.string(), // "pending" | "reviewed" | "dismissed" | "actioned"
    reviewedById: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()), // Unix timestamp ms
    actionTaken: v.optional(v.string()),
    createdAt: v.number(), // Unix timestamp ms
  })
    .index("by_meeting", ["meetingId"])
    .index("by_reportedBy", ["reportedById"])
    .index("by_status", ["status"])
    .index("by_reviewedBy", ["reviewedById"]),

  /**
   * Chat User Flags
   * Content moderation flags for users (pattern of behavior).
   */
  chatUserFlags: defineTable({
    userId: v.id("users"),
    reportedById: v.id("users"),
    channelId: v.optional(v.id("chatChannels")), // Context where reported
    reason: v.string(), // "spam" | "harassment" | "inappropriate" | "other"
    details: v.optional(v.string()),
    status: v.string(), // "pending" | "reviewed" | "dismissed" | "actioned"
    reviewedById: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()), // Unix timestamp ms
    actionTaken: v.optional(v.string()),
    createdAt: v.number(), // Unix timestamp ms
  })
    .index("by_user", ["userId"])
    .index("by_reportedBy", ["reportedById"])
    .index("by_channel", ["channelId"])
    .index("by_status", ["status"])
    .index("by_reviewedBy", ["reviewedById"]),

  /**
   * Direct Message Rate Limits
   * Per-(sender, channel, recipient) counter for messages sent while a recipient is still
   * in `pending` requestState. Enforces the 1-message-per-pending-pair-per-24h rule that
   * prevents a single sender from spamming a not-yet-accepted DM/group_dm. Hourly cron
   * cleans up rows older than 24h.
   */
  directMessageRateLimits: defineTable({
    userId: v.id("users"), // sender
    channelId: v.id("chatChannels"),
    recipientUserId: v.id("users"),
    windowStartedAt: v.number(), // Unix timestamp ms
    messageCount: v.number(),
  })
    .index("by_user_channel_recipient", [
      "userId",
      "channelId",
      "recipientUserId",
    ])
    .index("by_windowStartedAt", ["windowStartedAt"]),

  /**
   * Chat Push Notification Queue
   * Queue for push notifications (replaces Stream webhooks).
   */
  chatPushNotificationQueue: defineTable({
    channelId: v.id("chatChannels"),
    messageId: v.id("chatMessages"),
    recipientId: v.id("users"),
    type: v.string(), // "new_message" | "mention" | "reply"
    status: v.string(), // "pending" | "sent" | "failed"
    scheduledFor: v.number(), // Unix timestamp ms
    sentAt: v.optional(v.number()), // Unix timestamp ms
    error: v.optional(v.string()),
    retryCount: v.number(),
  })
    .index("by_recipient", ["recipientId"])
    .index("by_status", ["status"])
    .index("by_scheduledFor", ["scheduledFor"])
    .index("by_message", ["messageId"]),

  // =============================================================================
  // FEATURE FLAGS
  // =============================================================================
  // Global on/off switches for staged feature rollouts, flipped by primary
  // admins from /(user)/admin/features. One row per flag key. The frontend
  // gates render a brief loading state while the query hydrates, then either
  // the feature or the disabled placeholder.
  //
  // Intentionally simple: single boolean for all users, no per-cohort
  // targeting (we have PostHog for that and Seyi finds it too complex for
  // these rollouts). When a feature flag has fully ramped to 100%, the row +
  // the gate code are removed together.
  featureFlags: defineTable({
    key: v.string(), // canonical identifier, e.g. "direct-messages"
    enabled: v.boolean(),
    description: v.optional(v.string()),
    updatedAt: v.number(), // Unix timestamp ms
    updatedById: v.optional(v.id("users")),
  }).index("by_key", ["key"]),

  // =============================================================================
  // DEV-ASSISTANT BUGS
  // =============================================================================
  // Backs the @Togather in-chat dev-assistant pipeline. The originating chat
  // thread is the system of record for intent; this row tracks lifecycle state;
  // the PR tracks code. Each transition posts a bot message into the thread.
  // Gated behind the "dev-assistant-bot" feature flag; staff/superuser only.
  devBugs: defineTable({
    // Chat-originated items carry the originating community/channel/thread.
    // Dashboard-originated items (contributor dev dashboard, ADR-029) are
    // platform-level and have none of the three.
    communityId: v.optional(v.id("communities")),
    channelId: v.optional(v.id("chatChannels")),
    // All bot replies/callbacks post into this thread (the root message).
    threadRootMessageId: v.optional(v.id("chatMessages")),
    originatorUserId: v.id("users"),

    status: v.union(
      v.literal("DRAFT"),
      v.literal("IN_REVIEW"),
      v.literal("READY_FOR_IMPL"),
      v.literal("IN_PROGRESS"),
      v.literal("CODE_REVIEW"),
      v.literal("READY_TO_MERGE"),
      v.literal("MERGED"),
      v.literal("REJECTED"),
    ),

    title: v.string(),
    body: v.string(), // clean implementation brief (synthesized)
    repro: v.optional(v.string()),
    screenshotUrls: v.optional(v.array(v.string())), // pulled from thread image attachments

    // Contributor dev dashboard (ADR-029). All optional for backward compat;
    // pre-existing rows are chat-originated bugs.
    kind: v.optional(v.union(v.literal("bug"), v.literal("feature"))), // default "bug"
    source: v.optional(v.union(v.literal("chat"), v.literal("dashboard"))),
    riskLevel: v.optional(
      v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    ),
    spec: v.optional(v.string()), // AI-drafted spec, markdown
    specApprovedAt: v.optional(v.number()), // contributor sign-off

    // AI triage fields (ADR-029 Phase 1.5), delivered by the spec-mode routine
    // via the signed callback alongside spec/riskLevel.
    aiTitle: v.optional(v.string()), // short imperative headline
    area: v.optional(v.string()), // "events" | "chat" | "groups" | "prayer" | "settings" | "other"
    // "buildable" = one pipeline run; "split" = too big, spec proposes slices;
    // "design_needed" = a maintainer must make architectural decisions first.
    // Non-buildable items cannot be spec-approved (see approveSpec).
    scope: v.optional(
      v.union(
        v.literal("buildable"),
        v.literal("split"),
        v.literal("design_needed"),
      ),
    ),
    // True for anything interactive — the originator is asked to verify the
    // change on staging before merge; false for pure copy/color tweaks.
    verifyOnStaging: v.optional(v.boolean()),
    stagingVerifiedAt: v.optional(v.number()), // set by confirmStaging
    // AI review cycle: verdict reported by the review-mode routine via the
    // signed callback after it reviews the PR ("approved" promotes the bug to
    // READY_TO_MERGE; "changes_requested" leaves it in CODE_REVIEW). Cleared
    // whenever the bug genuinely (re-)enters CODE_REVIEW so a stale verdict
    // never lingers on a new PR revision.
    reviewVerdict: v.optional(
      v.union(v.literal("approved"), v.literal("changes_requested")),
    ),
    reviewSummary: v.optional(v.string()),
    // For "split"-scope items (ADR-029): the spec routine proposes the
    // buildable slices, each with a self-contained prompt a maintainer can
    // copy straight into a fresh dev session to build that slice on its own.
    // Cleared when a revision re-triages the item back to "buildable".
    splitSlices: v.optional(
      v.array(v.object({ title: v.string(), prompt: v.string() })),
    ),
    // Count of auto-fix dispatches (ADR-029 Phase 3 review→fix→re-review
    // loop). Capped at 3 — after that a changes_requested verdict escalates
    // to a human instead of dispatching another fix run.
    fixRounds: v.optional(v.number()),
    githubIssueNumber: v.optional(v.number()),
    githubIssueUrl: v.optional(v.string()),
    shippedAt: v.optional(v.number()), // set when status reaches MERGED
    // Contributor set the conversation aside (abandoned it, or the scope was
    // judged not doable) — ADR-029. Orthogonal to `status`: an item can be
    // archived from any pipeline state and unarchived to restore it. Archived
    // items drop out of the active dashboard tabs into an "Archived" view.
    archivedAt: v.optional(v.number()),

    prUrl: v.optional(v.string()),
    reviewLink: v.optional(v.string()),
    routineRunId: v.optional(v.string()), // we generate; routine echoes on callbacks
    // Mode the in-flight Routine run (the one holding routineRunId) was
    // dispatched in. Stamped by the mark*Dispatched mutations; applyCallback
    // restricts what each mode's callback may deliver (e.g. only review runs
    // carry a review verdict). Unset on legacy rows dispatched before the
    // stamping existed — those get the permissive legacy callback policy
    // (minus MERGED, which is webhook/auto-merge-only).
    activeRunMode: v.optional(
      v.union(
        v.literal("spec"),
        v.literal("implement"),
        v.literal("review"),
        v.literal("fix"),
      ),
    ),
    dispatchedAt: v.optional(v.number()),
    lastCallbackAt: v.optional(v.number()),
    lastError: v.optional(v.string()),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_channel", ["channelId"])
    .index("by_originator", ["originatorUserId"])
    .index("by_routineRunId", ["routineRunId"]),

  /**
   * Conversation thread on a devBugs item (contributor dev dashboard,
   * ADR-029 Phase 1.5). Every contribution is a conversation with the AI:
   * the submitted report is the first "user" message, spec drafts arrive as
   * "assistant" messages, and lifecycle transitions post "system" messages.
   */
  devBugMessages: defineTable({
    bugId: v.id("devBugs"),
    authorType: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
    ),
    userId: v.optional(v.id("users")), // set when authorType === "user"
    body: v.string(),
    // Screenshots/pictures attached to a "user" message (contributors can file
    // and chat with images — ADR-029). Stored as R2 storage paths ("r2:…");
    // read paths (getThread) resolve them to public URLs via getMediaUrl.
    imageUrls: v.optional(v.array(v.string())),
    createdAt: v.number(),
  }).index("by_bug", ["bugId", "createdAt"]),

  // =============================================================================

  // =============================================================================
  // SLACK SERVICE BOT THREADS
  // =============================================================================
  // Tracks threads created by the FOUNT service planning bot in Slack.
  // Minimal state -- Slack is the source of truth for thread content.
  // The bot reads thread history on-demand via Slack API.

  slackServiceThreads: defineTable({
    serviceDate: v.number(), // Unix ms of the Sunday this thread is for
    location: v.string(), // "Manhattan" | "Brooklyn"
    slackChannelId: v.string(),
    slackThreadTs: v.string(), // Thread parent message timestamp
    createdAt: v.number(), // Unix timestamp ms
  })
    .index("by_serviceDate_location", ["serviceDate", "location"])
    .index("by_slackThreadTs", ["slackThreadTs"])
    .index("by_serviceDate", ["serviceDate"]),

  // =============================================================================
  // SLACK BOT CONFIG
  // =============================================================================
  // Admin-editable configuration for the FOUNT service planning bot.
  // One document per community. Replaces hardcoded config.ts values.

  slackBotConfig: defineTable({
    communityId: v.id("communities"),
    enabled: v.boolean(),

    // Slack config
    slackChannelId: v.string(),
    botSlackUserId: v.string(),
    devMode: v.boolean(),

    // Team members (who gets mentioned, who's responsible for what)
    teamMembers: v.array(
      v.object({
        name: v.string(),
        slackUserId: v.string(),
        roles: v.array(v.string()),
        locations: v.array(v.string()),
      }),
    ),
    threadMentions: v.record(v.string(), v.array(v.string())), // location -> slackUserIds

    // Schedule
    nagSchedule: v.array(
      v.object({
        dayOfWeek: v.number(),
        hourET: v.number(),
        urgency: v.string(),
        label: v.string(),
      }),
    ),
    threadCreation: v.object({ dayOfWeek: v.number(), hourET: v.number() }),

    // Service plan items to track
    servicePlanItems: v.array(v.string()),
    servicePlanLabels: v.record(v.string(), v.string()),
    itemResponsibleRoles: v.record(v.string(), v.array(v.string())),

    // V2: Unified service plan items with action configuration
    servicePlanItemsV2: v.optional(
      v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          responsibleRoles: v.array(v.string()),
          actionType: v.string(), // "assign_role" | "update_plan_item" | "none"
          pcoTeamNamePattern: v.optional(v.string()),
          pcoPositionName: v.optional(v.string()),
          pcoItemTitlePattern: v.optional(v.string()),
          pcoItemField: v.optional(v.string()), // "description" | "notes"
          preserveSections: v.optional(v.array(v.string())),
          aiInstructions: v.optional(v.string()),
        }),
      ),
    ),

    // PCO config
    pcoConfig: v.object({
      communityId: v.string(),
      serviceTypeIds: v.record(v.string(), v.string()),
      roleMappings: v.record(
        v.string(),
        v.object({
          teamNamePattern: v.string(),
          positionName: v.string(),
        }),
      ),
    }),

    // AI/Prompt config
    aiConfig: v.object({
      model: v.string(),
      botPersonality: v.string(),
      responseRules: v.string(),
      nagToneByLevel: v.record(v.string(), v.string()),
      teamContext: v.string(),
    }),

    // Activity log: structured trace of bot interactions (circular buffer, last 50)
    activityLog: v.optional(
      v.array(
        v.object({
          trigger: v.string(), // "thread_reply" | "nag_check" | "thread_creation"
          location: v.optional(v.string()),
          threadTs: v.optional(v.string()),
          messageTs: v.optional(v.string()),
          userId: v.optional(v.string()),
          nagUrgency: v.optional(v.string()),
          nagLabel: v.optional(v.string()),
          toolCalls: v.array(
            v.object({
              tool: v.string(),
              args: v.any(),
              result: v.any(),
              durationMs: v.number(),
            }),
          ),
          agentResponse: v.optional(v.string()),
          iterations: v.number(),
          status: v.string(), // "success" | "error" | "skipped"
          error: v.optional(v.string()),
          skipReason: v.optional(v.string()),
          durationMs: v.number(),
          timestamp: v.number(),
        }),
      ),
    ),

    // Dedup: recent processed message timestamps (circular buffer, last ~100)
    processedMessageTs: v.array(v.string()),

    // Nag tracking: threadTs -> array of urgency levels already sent
    nagsSent: v.record(v.string(), v.array(v.string())),

    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_community", ["communityId"]),

  // =============================================================================
  // RATE LIMITS
  // =============================================================================
  // Tracks rate limit attempts for authentication endpoints.
  // Prevents brute-force attacks on OTP send and verify flows.
  // Records auto-reset when the time window expires on next check.

  rateLimits: defineTable({
    key: v.string(), // e.g., "otp:+12025550123" or "verify:+12025550123"
    attempts: v.number(),
    windowStart: v.number(), // Unix timestamp ms
  }).index("by_key", ["key"]),

  // =============================================================================
  // REACH OUT REQUESTS
  // =============================================================================
  // Tracks member requests submitted via the "Reach Out" channel.
  // Leaders see these as interactive cards in their leaders channel.

  reachOutRequests: defineTable({
    groupId: v.id("groups"),
    channelId: v.id("chatChannels"), // The reach_out channel
    leadersChannelId: v.id("chatChannels"), // The leaders channel
    submittedById: v.id("users"),
    groupMemberId: v.id("groupMembers"), // For followup integration
    content: v.string(),
    status: v.string(), // "pending" | "assigned" | "contacted" | "resolved" | "revoked"
    assignedToId: v.optional(v.id("users")),
    assignedAt: v.optional(v.number()),
    contactActions: v.optional(
      v.array(
        v.object({
          id: v.string(),
          type: v.string(), // "call" | "text" | "email"
          performedById: v.id("users"),
          performedAt: v.number(),
          notes: v.optional(v.string()),
        }),
      ),
    ),
    resolvedById: v.optional(v.id("users")),
    resolvedAt: v.optional(v.number()),
    resolutionNotes: v.optional(v.string()),
    leadersMessageId: v.optional(v.id("chatMessages")), // Card in leaders channel
    taskId: v.optional(v.id("tasks")), // Linked canonical task (migration path)
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_group", ["groupId"])
    .index("by_group_status", ["groupId", "status"])
    .index("by_submittedBy", ["submittedById"])
    .index("by_assignedTo", ["assignedToId"])
    .index("by_groupMember", ["groupMemberId"]),

  // =============================================================================
  // COMMUNITY LANDING PAGES
  // =============================================================================

  communityLandingPages: defineTable({
    communityId: v.id("communities"),
    isEnabled: v.boolean(),
    // Page content
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    submitButtonText: v.optional(v.string()),
    successMessage: v.optional(v.string()),
    generateNoteSummary: v.optional(v.boolean()),
    // Built-in field requirements (configurable per community)
    requireZipCode: v.optional(v.boolean()),
    requireBirthday: v.optional(v.boolean()),
    // Form fields — maps to followup custom field slots
    formFields: v.array(
      v.object({
        slot: v.optional(v.string()), // "customText1", "customBool3", etc. If null, field only appears in notes summary
        label: v.string(),
        type: v.string(), // "text" | "number" | "boolean" | "dropdown" | "multiselect" | "section_header" | "subtitle" | "button"
        placeholder: v.optional(v.string()),
        options: v.optional(v.array(v.string())),
        buttonUrl: v.optional(v.string()),
        required: v.boolean(),
        order: v.number(),
        includeInNotes: v.optional(v.boolean()),
        showOnLanding: v.optional(v.boolean()),
      }),
    ),
    // Automation rules
    automationRules: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        isEnabled: v.boolean(),
        condition: v.object({
          field: v.string(), // Slot name or form field label
          operator: v.string(), // "equals" | "contains" | "not_equals" | "is_true" | "is_false"
          value: v.optional(v.string()),
        }),
        action: v.object({
          type: v.string(), // "set_assignee" | "append_sms"
          assigneePhone: v.optional(v.string()),
          assigneeUserId: v.optional(v.id("users")),
          // For append_sms: a single bullet/line appended to the auto-reply SMS
          // when the rule's condition matches. Supports {firstName} substitution.
          snippet: v.optional(v.string()),
        }),
      }),
    ),
    // Auto-reply SMS sent to the submitter after their form submission.
    // Each matching automation rule with type "append_sms" contributes a
    // snippet between the intro and outro. Snippets and the intro/outro
    // support {firstName} substitution.
    autoReplySms: v.optional(
      v.object({
        enabled: v.boolean(),
        intro: v.string(),
        outro: v.string(),
        // If true, the intro+outro is sent even when no append_sms rules match.
        // If false, no SMS is sent unless at least one snippet is collected.
        sendIfNoSnippetsMatch: v.boolean(),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_community", ["communityId"]),

  // =============================================================================
  // COMMUNITY PEOPLE (community-level followup scores)
  // =============================================================================
  // Pre-computed community-level view of all members. System scores are
  // always computed; custom fields are defined at the community level.
  // Coexists with memberFollowupScores during transition.

  communityPeople: defineTable({
    communityId: v.id("communities"),
    groupId: v.id("groups"),
    userId: v.id("users"),

    // Denormalized member info
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    searchText: v.optional(v.string()),

    // System scores (always computed)
    score1: v.optional(v.number()), // Service (PCO)
    score2: v.optional(v.number()), // Attendance (all groups)
    score3: v.optional(v.number()), // Togather

    // Leader actions (community-level)
    status: v.optional(v.string()),
    assigneeId: v.optional(v.id("users")), // Primary assignee for indexing (assigneeIds?.[0])
    assigneeIds: v.optional(v.array(v.id("users"))),
    assigneeSortKey: v.optional(v.string()),
    connectionPoint: v.optional(v.string()),

    // Followup metadata
    lastFollowupAt: v.optional(v.number()),
    lastActiveAt: v.optional(v.number()),
    lastAttendedAt: v.optional(v.number()),
    // Most recent serving date (PCO + native rostering). Persisted so the
    // per-group fan-out can carry serving activity into the archive computation.
    lastServedAt: v.optional(v.number()),
    addedAt: v.optional(v.number()),
    latestNote: v.optional(v.string()),
    latestNoteAt: v.optional(v.number()),

    // Alerts
    alerts: v.optional(v.array(v.string())),

    // Snooze
    isSnoozed: v.optional(v.boolean()),
    snoozedUntil: v.optional(v.number()),

    // Active/archived state.
    // `isActive === false` means the person is archived/inactive and is hidden
    // from the people table by default. `undefined`/`true` = active.
    // `archivedAt` records when they were last set inactive (manual or auto) and
    // is used by the daily score job to detect app activity that occurred AFTER
    // archiving (so a returning user is reactivated, but a manual archive otherwise
    // sticks). See computePersonActiveState in communityScoreComputation.ts.
    isActive: v.optional(v.boolean()),
    archivedAt: v.optional(v.number()),

    // When the person was last manually unarchived or reactivated by a form
    // submission. Counts as activity for the 60-day auto-archive clock, so a
    // manual unarchive sticks until the person is quiet for the full window
    // measured from this moment (not from their stale last activity). See
    // computePersonActiveState in communityScoreComputation.ts.
    reactivatedAt: v.optional(v.number()),

    // When the "approaching auto-archive" check-in notice was last sent to the
    // person's leaders/assignees. Used to send that notice once per inactivity
    // spell (see shouldSendPreArchiveNotice in functions/memberArchiveNotice.ts).
    preArchiveNoticeSentAt: v.optional(v.number()),

    // Custom field slots (5 text + 5 number + 5 boolean)
    customText1: v.optional(v.string()),
    customText2: v.optional(v.string()),
    customText3: v.optional(v.string()),
    customText4: v.optional(v.string()),
    customText5: v.optional(v.string()),
    customNum1: v.optional(v.number()),
    customNum2: v.optional(v.number()),
    customNum3: v.optional(v.number()),
    customNum4: v.optional(v.number()),
    customNum5: v.optional(v.number()),
    customBool1: v.optional(v.boolean()),
    customBool2: v.optional(v.boolean()),
    customBool3: v.optional(v.boolean()),
    customBool4: v.optional(v.boolean()),
    customBool5: v.optional(v.boolean()),

    // Inverted addedAt for composite index sorting (MAX_SAFE_INTEGER - addedAt)
    // Allows score ASC + addedAt DESC via a single index direction
    addedAtInv: v.optional(v.number()),

    // Raw values (for detail view breakdown)
    rawValues: v.optional(v.any()),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_community", ["communityId"])
    .index("by_community_assignee", ["communityId", "assigneeId"])
    .index("by_community_user", ["communityId", "userId"])
    .index("by_group", ["groupId"])
    .index("by_group_user", ["groupId", "userId"])
    .index("by_group_score1", ["groupId", "score1", "addedAtInv"])
    .index("by_group_score2", ["groupId", "score2", "addedAtInv"])
    .index("by_group_score3", ["groupId", "score3", "addedAtInv"])
    .index("by_group_firstName", ["groupId", "firstName"])
    .index("by_group_lastName", ["groupId", "lastName"])
    .index("by_group_addedAt", ["groupId", "addedAt"])
    .index("by_group_lastAttendedAt", ["groupId", "lastAttendedAt"])
    .index("by_group_lastFollowupAt", ["groupId", "lastFollowupAt"])
    .index("by_group_lastActiveAt", ["groupId", "lastActiveAt"])
    .index("by_group_status", ["groupId", "status"])
    .index("by_group_customText1", ["groupId", "customText1"])
    .index("by_group_customText2", ["groupId", "customText2"])
    .index("by_group_customText3", ["groupId", "customText3"])
    .index("by_group_customText4", ["groupId", "customText4"])
    .index("by_group_customText5", ["groupId", "customText5"])
    .index("by_group_customNum1", ["groupId", "customNum1"])
    .index("by_group_customNum2", ["groupId", "customNum2"])
    .index("by_group_customNum3", ["groupId", "customNum3"])
    .index("by_group_customNum4", ["groupId", "customNum4"])
    .index("by_group_customNum5", ["groupId", "customNum5"])
    .index("by_group_customBool1", ["groupId", "customBool1"])
    .index("by_group_customBool2", ["groupId", "customBool2"])
    .index("by_group_customBool3", ["groupId", "customBool3"])
    .index("by_group_customBool4", ["groupId", "customBool4"])
    .index("by_group_customBool5", ["groupId", "customBool5"])
    .index("by_group_zipCode", ["groupId", "zipCode"])
    .index("by_group_assigneeSortKey", ["groupId", "assigneeSortKey"])
    .index("by_user", ["userId"])
    .searchIndex("search_communityPeople", {
      searchField: "searchText",
      filterFields: ["communityId", "groupId", "status", "assigneeId"],
    }),

  // =============================================================================
  // PEOPLE SAVED VIEWS
  // =============================================================================
  // Saved column/sort/filter configurations for the People tab.
  // Personal or shared views per community.

  peopleSavedViews: defineTable({
    communityId: v.id("communities"),
    createdById: v.id("users"),
    visibility: v.union(v.literal("personal"), v.literal("shared")),
    name: v.string(),
    sortBy: v.optional(v.string()),
    sortDirection: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    columnOrder: v.optional(v.array(v.string())),
    hiddenColumns: v.optional(v.array(v.string())),
    filters: v.optional(
      v.object({
        groupId: v.optional(v.id("groups")),
        statusFilter: v.optional(v.string()),
        assigneeFilter: v.optional(v.string()),
        scoreField: v.optional(v.string()),
        scoreMin: v.optional(v.number()),
        scoreMax: v.optional(v.number()),
      }),
    ),
    isDefault: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_community", ["communityId"])
    .index("by_user_community", ["createdById", "communityId"]),

  // =============================================================================
  // COMMUNITY PROPOSALS (onboarding & billing)
  // =============================================================================
  // Tracks proposals from community leaders to create a new community on
  // the platform. Includes Stripe billing fields for subscription setup.

  communityProposals: defineTable({
    proposerId: v.id("users"),
    communityName: v.string(),
    estimatedSize: v.number(),
    needsMigration: v.boolean(),
    proposedMonthlyPrice: v.number(),
    notes: v.optional(v.string()),
    status: v.string(), // "pending" | "accepted" | "rejected"
    reviewedById: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    rejectionReason: v.optional(v.string()),
    communityId: v.optional(v.id("communities")),
    setupToken: v.optional(v.string()),
    setupCompletedAt: v.optional(v.number()),
    setupDescription: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_proposer", ["proposerId"])
    .index("by_status", ["status"])
    .index("by_setupToken", ["setupToken"])
    .index("by_createdAt", ["createdAt"]),

  // =============================================================================
  // COMMUNITY PEOPLE ASSIGNEES (junction table for multi-assignee indexing)
  // =============================================================================
  // Mirrors the assigneeIds array on communityPeople as individual rows
  // so we can do efficient indexed lookups by assignee (Convex doesn't
  // support array-contains in indexes).

  communityPeopleAssignees: defineTable({
    communityPersonId: v.id("communityPeople"),
    assigneeUserId: v.id("users"),
    groupId: v.id("groups"),
    communityId: v.id("communities"),
  })
    .index("by_group_assignee", ["groupId", "assigneeUserId"])
    .index("by_community_assignee", ["communityId", "assigneeUserId"])
    .index("by_communityPerson", ["communityPersonId"]),

  // =============================================================================
  // POSTERS (global curated event cover library)
  // =============================================================================
  // Curated by platform-level poster_admins. Global-only: every community sees
  // the same library. Used as event cover art in the event-create flow.

  posters: defineTable({
    imageUrl: v.string(),
    imageStorageKey: v.optional(v.string()), // R2 key for deletion
    keywords: v.array(v.string()),
    // Denormalized joined keywords (space-separated) for the search index.
    searchText: v.string(),
    uploadedById: v.id("users"),
    active: v.boolean(), // Soft-delete flag; inactive posters hidden from picker
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active_createdAt", ["active", "createdAt"])
    .index("by_uploader", ["uploadedById"])
    .searchIndex("search_posters", {
      searchField: "searchText",
      filterFields: ["active"],
    }),

  // =============================================================================
  // EVENT SCHEDULING & ROSTERING (ADR-023, ADR-025)
  // Native replacement for the Planning Center scheduling dependency.
  // ADR-025: `teams` is a first-class table; teamRoles / neededRoles /
  // roleAssignments are keyed by `teamId`. The legacy `channelId` fields are
  // unused dead columns, kept optional until a follow-up strips them.
  // Run `migrateChannelsToTeams` BEFORE deploying this schema — it makes
  // `teamId` required, so every row must be backfilled first. See ADR-025.
  // =============================================================================

  /**
   * A serving team — a roster of volunteers that owns roles and is scheduled
   * onto event plans. Belongs to a campus group. A team OPTIONALLY has a chat
   * channel (`channelId`); a channel-less team is a pure roster. See ADR-025.
   */
  teams: defineTable({
    groupId: v.id("groups"),
    communityId: v.id("communities"),
    name: v.string(),
    description: v.optional(v.string()),
    /** The team's chat channel, if it has one. A team may have none. */
    channelId: v.optional(v.id("chatChannels")),
    isArchived: v.optional(v.boolean()),
    createdAt: v.number(),
    createdById: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_group", ["groupId"])
    .index("by_community", ["communityId"])
    .index("by_channel", ["channelId"]),

  /**
   * A role within a serving team, e.g. "Drums", "Greeter". Free-form labels
   * owned by the team; no global taxonomy, no qualification rules — anyone in
   * the campus group can be assigned any role.
   */
  teamRoles: defineTable({
    teamId: v.id("teams"),
    /** ADR-025 legacy — unused dead column, stripped in a follow-up. */
    channelId: v.optional(v.id("chatChannels")),
    communityId: v.id("communities"),
    name: v.string(),
    color: v.optional(v.string()),
    sortOrder: v.number(),
    /** Slot count a new event starts with for this role; stays editable per-event. */
    defaultNeeded: v.optional(v.number()),
    isArchived: v.optional(v.boolean()),
    createdAt: v.number(),
    createdById: v.id("users"),
  }).index("by_team", ["teamId"]),

  /**
   * A dated event volunteers are rostered to. Belongs to a campus group.
   * Distinct from `meetings` (Events-tab events) — joined via optional
   * `meetingIds` when a rostered event also wants an Events-tab presence.
   */
  eventPlans: defineTable({
    groupId: v.id("groups"),
    communityId: v.id("communities"),
    title: v.string(),
    eventDate: v.number(), // event date (Unix ms)
    times: v.array(
      v.object({
        label: v.string(), // "9:00 AM"
        startsAt: v.number(), // Unix ms
      }),
    ),
    status: v.string(), // "draft" | "published"
    notes: v.optional(v.string()),
    /** Optional links to Events-tab events (multi-service day, multi-campus). */
    meetingIds: v.optional(v.array(v.id("meetings"))),
    /** Set when imported from a Planning Center plan (migration linkage). */
    pcoPlanId: v.optional(v.string()),
    /**
     * Scheduled-job IDs for the automatic "you're still unconfirmed" nudges
     * fired 4 days and 1 day before `eventDate`. Set on publish (only for
     * fire times still in the future); cancelled + re-scheduled when the
     * event date changes, and cancelled on delete. The matching `*Sent`
     * flags make each reminder idempotent.
     */
    reminder4dJobId: v.optional(v.id("_scheduled_functions")),
    reminder1dJobId: v.optional(v.id("_scheduled_functions")),
    reminder4dSent: v.optional(v.boolean()),
    reminder1dSent: v.optional(v.boolean()),
    /**
     * Event-templates linkage (Phase 3). When set, this plan is LINKED to a
     * task and/or run-sheet template: its `eventTasks` / `eventItems` are
     * materialized from the template's items and future template edits
     * propagate forward to this plan's still-synced rows (past plans are
     * frozen — never touched). Cleared on unlink.
     */
    taskTemplateId: v.optional(v.id("eventTaskTemplates")),
    runSheetTemplateId: v.optional(v.id("runSheetTemplates")),
    /**
     * Template item ids the user removed LOCALLY from this plan. Propagation
     * must NOT re-add these, so a deleted-locally template task/item stays
     * gone even though it still exists on the template.
     */
    detachedTaskTemplateItemIds: v.optional(
      v.array(v.id("eventTaskTemplateItems")),
    ),
    detachedRunSheetTemplateItemIds: v.optional(
      v.array(v.id("runSheetTemplateItems")),
    ),
    createdAt: v.number(),
    createdById: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_group", ["groupId"])
    .index("by_community_date", ["communityId", "eventDate"])
    // Forward-propagation lookups: all plans linked to a given template.
    .index("by_task_template", ["taskTemplateId"])
    .index("by_run_sheet_template", ["runSheetTemplateId"]),

  /** "We need N of role X" on a given event. */
  neededRoles: defineTable({
    planId: v.id("eventPlans"),
    teamId: v.id("teams"),
    /** ADR-025 legacy — unused dead column, stripped in a follow-up. */
    channelId: v.optional(v.id("chatChannels")),
    roleId: v.id("teamRoles"),
    count: v.number(),
  })
    .index("by_plan", ["planId"])
    .index("by_plan_team", ["planId", "teamId"]),

  /** A person scheduled to a role on an event. */
  roleAssignments: defineTable({
    planId: v.id("eventPlans"),
    teamId: v.id("teams"),
    /** ADR-025 legacy — unused dead column, stripped in a follow-up. */
    channelId: v.optional(v.id("chatChannels")),
    roleId: v.id("teamRoles"),
    userId: v.id("users"),
    eventDate: v.number(), // denormalized for same-day double-booking queries
    status: v.string(), // "unconfirmed" | "confirmed" | "declined"
    timeLabel: v.optional(v.string()),
    declineNote: v.optional(v.string()),
    assignedById: v.id("users"),
    assignedAt: v.number(),
    respondedAt: v.optional(v.number()),
    pcoAssignmentId: v.optional(v.string()),
  })
    .index("by_plan", ["planId"])
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
    // Most-recent serving lookup for archive activity (ordered by event date).
    .index("by_user_eventDate", ["userId", "eventDate"])
    .index("by_plan_role", ["planId", "roleId"])
    .index("by_role", ["roleId"]) // powers "previously filled by"
    // powers team auto-sync: desired members of a team within a rotation
    // window are derived from assignments matched by team + date.
    .index("by_team_eventDate", ["teamId", "eventDate"]),

  /**
   * History of serving requests SENT to volunteers (one row per recipient per
   * send). Unlike `roleAssignments` — which is mutated in place and hard-deleted
   * on `unassign` — these rows are append-only, so a leader can review the full
   * "who was asked, when, and how many times" trail and re-send a request to a
   * single person from it. Written by `sendAssignmentRequests` (publish +
   * re-send) and the per-person `resendAssignmentRequest` action.
   */
  assignmentRequestLog: defineTable({
    planId: v.id("eventPlans"),
    groupId: v.id("groups"),
    communityId: v.id("communities"),
    // The assignment the request was for. The assignment may later be removed
    // (`unassign` hard-deletes), so this id can dangle — readers tolerate a
    // missing target. The log row itself is never deleted.
    assignmentId: v.id("roleAssignments"),
    userId: v.id("users"), // recipient (the volunteer who was asked)
    roleId: v.id("teamRoles"),
    teamId: v.id("teams"),
    eventDate: v.number(), // denormalized from the plan for display/sorting
    sentById: v.id("users"), // the scheduler who triggered the send
    sentAt: v.number(),
    kind: v.string(), // "initial" | "resend"
    channels: v.array(v.string()), // delivery channels used, e.g. ["push","sms"]
  })
    .index("by_plan", ["planId"])
    .index("by_assignment", ["assignmentId"])
    .index("by_plan_role", ["planId", "roleId"]),

  /**
   * A single ordered item on an event plan's run sheet (ADR-026). The native
   * replacement for the PCO-derived order-of-items. One run sheet = many rows,
   * keyed by `planId` and ordered by `sequence`; the same run sheet is shared
   * across all of the plan's `times` (clock times are computed client-side by
   * cascading `durationSec` from the selected service time — never stored).
   */
  eventItems: defineTable({
    planId: v.id("eventPlans"),
    communityId: v.id("communities"),
    /**
     * When this item happens relative to the event's service times:
     * "before" | "during" | "after". Items group into these three phases
     * (PCO's "Before All" / "After All"). Optional for legacy rows, which are
     * treated as "during". `sequence` orders items WITHIN a segment.
     */
    segment: v.optional(v.string()),
    /** Ordering within the run sheet segment; reordering rewrites these. */
    sequence: v.number(),
    /** "song" | "header" | "media" | "item" (mirrors PCO vocabulary). */
    type: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    /** Drives the cascading clock times. A `header` is typically 0. */
    durationSec: v.number(),
    /** Role-categorized free-text notes (e.g. Audio / Video cues). */
    notes: v.optional(
      v.array(v.object({ category: v.string(), content: v.string() })),
    ),
    /**
     * Links this item to roles rostered on the plan. The row displays
     * "whoever currently fills this role", resolved live from the plan's
     * `roleAssignments` — it never copies a person's name, so there is no
     * second source of truth to drift.
     */
    assignments: v.optional(
      v.array(v.object({ roleId: v.id("teamRoles") })),
    ),
    /**
     * Lightweight per-occurrence song metadata, retained as an OVERRIDE of the
     * linked library song's defaults (ADR-027). Display resolves
     * `songDetails.key ?? song.defaultKey`.
     */
    songDetails: v.optional(
      v.object({
        key: v.optional(v.string()),
        bpm: v.optional(v.number()),
        author: v.optional(v.string()),
      }),
    ),
    /**
     * Optional link to a library song (ADR-027). When set, the run sheet row
     * renders the joined song's title/charts/links; `songDetails` overrides its
     * defaults. Cleared (nulled) when the referenced song is deleted.
     */
    songId: v.optional(v.id("songs")),
    /**
     * Event-templates linkage (Phase 3). Set => this row was materialized from
     * the run-sheet template item with this id. SYNCED (`templateDetached`
     * falsy) rows are updated/deleted by propagation to match the template;
     * OVERRIDDEN rows (`templateDetached` true, set on a local edit) are left
     * alone. Rows with no `sourceTemplateItemId` are plain local additions.
     */
    sourceTemplateItemId: v.optional(v.id("runSheetTemplateItems")),
    templateDetached: v.optional(v.boolean()),
    createdAt: v.number(),
    createdById: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_plan", ["planId"])
    // Scan items referencing a song so deleteSong can null them out (ADR-027).
    .index("by_song", ["songId"]),

  /**
   * Per-plan serving tasks (Event Tasks feature). A task is a high-level thing
   * one or more teams (or specific roles on those teams) need to do for an
   * event, tagged with when it happens ("before" | "during" | "after").
   * Optional "how to" guidance can be plain text, a link, an R2 media asset, or
   * a markdown doc.
   *
   * Assignment model (multi-team / multi-role):
   *   • `teamIds` — the team(s) this task belongs to (always >= 1).
   *   • `roleIds` — the role(s) responsible. NON-EMPTY => per-person completion
   *     (each confirmed person in ANY of `roleIds` completes it individually via
   *     `eventTaskCompletions`). EMPTY => team-level task: ONE shared completion
   *     for the whole task (`sharedTaskCompletions`), togglable by any confirmed
   *     member of ANY team in `teamIds`. A team-level task spanning multiple
   *     teams is still ONE shared checkbox.
   *
   * `teamId` / `roleId` are LEGACY single-value columns kept optional for the
   * migration window; reads go through `taskTeamIds()` / `taskRoleIds()` which
   * fall back to them when the arrays are absent.
   * TODO(followup): drop legacy teamId/roleId after
   * `backfillTaskAssignmentArrays` has run in all envs.
   */
  eventTasks: defineTable({
    planId: v.id("eventPlans"),
    communityId: v.id("communities"),
    // Legacy single-value columns (pre multi-assign). Optional during migration.
    teamId: v.optional(v.id("teams")),
    roleId: v.optional(v.id("teamRoles")), // legacy: null => team-level task
    // Multi-assign columns. `teamIds` >= 1; empty `roleIds` => team-level task.
    teamIds: v.optional(v.array(v.id("teams"))),
    roleIds: v.optional(v.array(v.id("teamRoles"))),
    segment: v.union(
      v.literal("before"),
      v.literal("during"),
      v.literal("after"),
    ),
    title: v.string(), // short high-level description
    howToType: v.union(
      v.literal("none"),
      v.literal("text"),
      v.literal("link"),
      v.literal("media"),
      v.literal("doc"),
    ),
    howToText: v.optional(v.string()),
    howToUrl: v.optional(v.string()),
    howToMediaPath: v.optional(v.string()), // r2: path
    howToDoc: v.optional(v.string()), // markdown source
    sortOrder: v.number(),
    /**
     * Event-templates linkage (Phase 3). Set => this task was materialized from
     * the task-template item with this id. SYNCED (`templateDetached` falsy)
     * rows are updated/deleted by propagation to match the template; OVERRIDDEN
     * rows (`templateDetached` true, set on a local edit) are left alone. Tasks
     * with no `sourceTemplateItemId` are plain local additions.
     */
    sourceTemplateItemId: v.optional(v.id("eventTaskTemplateItems")),
    templateDetached: v.optional(v.boolean()),
    createdById: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_plan", ["planId"])
    .index("by_plan_segment", ["planId", "segment"]),

  /**
   * A per-user completion record for an event task. "during" tasks are
   * completed per service time, so `timeLabel` distinguishes those; "before" /
   * "after" tasks leave it unset.
   */
  eventTaskCompletions: defineTable({
    taskId: v.id("eventTasks"),
    planId: v.id("eventPlans"),
    communityId: v.id("communities"),
    userId: v.id("users"),
    timeLabel: v.optional(v.string()), // set only for "during" tasks (per service time)
    completedAt: v.number(),
  })
    .index("by_task", ["taskId"])
    .index("by_task_user", ["taskId", "userId"])
    .index("by_plan_user", ["planId", "userId"]),

  /**
   * Ad-hoc, single-user serving tasks a user adds for themselves in serving
   * mode. These are personal-only: they never affect the shared template
   * (`eventTasks`) and are NOT copied when a plan is duplicated. Completion is
   * inline (`completedAt`) since only one user ever sees the row.
   */
  personalServingTasks: defineTable({
    planId: v.id("eventPlans"),
    communityId: v.id("communities"),
    userId: v.id("users"),
    segment: v.union(
      v.literal("before"),
      v.literal("during"),
      v.literal("after"),
    ),
    title: v.string(),
    note: v.optional(v.string()),
    timeLabel: v.optional(v.string()), // for "during" tasks at a specific service time
    sortOrder: v.number(),
    completedAt: v.optional(v.number()), // inline completion (single user, no separate table)
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_plan_user", ["planId", "userId"]),

  /**
   * Per-user checked state for the interactive checklist inside a serving
   * task's "doc" How-To. One row per (user, task) holding the set of checked
   * checklist-item indices (positional, in document order). This is personal —
   * each volunteer sees only their own checks — and never mutates the shared
   * `howToDoc` markdown itself.
   */
  howToDocChecks: defineTable({
    userId: v.id("users"),
    taskId: v.id("eventTasks"),
    // Content-based keys for the checked items (a stable hash of the item's
    // text + its occurrence, so checks survive reordering the doc). Replaces the
    // old positional-index scheme.
    checkedKeys: v.array(v.string()),
    updatedAt: v.number(),
  })
    .index("by_user_task", ["userId", "taskId"])
    // Scan a task's checks (across users) so task/plan deletion can cascade.
    .index("by_task", ["taskId"]),

  /**
   * Team-WIDE completion of a team-level event task (the "Shared" serving
   * surface). Unlike `eventTaskCompletions` (per-user), this is a single shared
   * state per task: any confirmed member of the task's team may mark the task
   * done for the whole team, and a row's mere existence means "done". Only used
   * for team-level tasks (`eventTasks.roleId == null`); one row per task, keyed
   * by `taskId`. `completedByUserId` records who last flipped it done (for a
   * "completed by …" label). Deleting the row un-completes the task.
   */
  sharedTaskCompletions: defineTable({
    taskId: v.id("eventTasks"),
    planId: v.id("eventPlans"),
    communityId: v.id("communities"),
    completedByUserId: v.id("users"),
    completedAt: v.number(),
  })
    .index("by_task", ["taskId"])
    .index("by_plan", ["planId"]),

  /**
   * A reusable, per-GROUP event-task template — a named, saved checklist of
   * `eventTaskTemplateItems` a leader can keep for a location and later apply to
   * a plan's `eventTasks`. Named `eventTaskTemplates` (not `taskTemplates`, which
   * is a separate feature) to avoid a table collision. Scoped to one campus group
   * (mirrors how cross-team channels / teams are group-scoped); `communityId` is
   * denormalized for the community read gate. Phase 1 stores the template only —
   * there is no plan linkage or propagation yet.
   */
  eventTaskTemplates: defineTable({
    groupId: v.id("groups"),
    communityId: v.id("communities"),
    name: v.string(),
    createdById: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_group", ["groupId"]),

  /**
   * A single item on an `eventTaskTemplates` template — the template mirror of
   * `eventTasks` MINUS `planId` (keyed by `templateId` instead) and using ONLY
   * the multi-assign array model (`teamIds` >= 0, `roleIds` empty => a
   * team-level task). No legacy single-value `teamId` / `roleId` columns, and no
   * completion records (templates are never "done" — they seed a plan's tasks).
   * `sortOrder` orders items WITHIN a segment.
   */
  eventTaskTemplateItems: defineTable({
    templateId: v.id("eventTaskTemplates"),
    communityId: v.id("communities"),
    teamIds: v.array(v.id("teams")),
    roleIds: v.array(v.id("teamRoles")),
    segment: v.union(
      v.literal("before"),
      v.literal("during"),
      v.literal("after"),
    ),
    title: v.string(),
    howToType: v.union(
      v.literal("none"),
      v.literal("text"),
      v.literal("link"),
      v.literal("media"),
      v.literal("doc"),
    ),
    howToText: v.optional(v.string()),
    howToUrl: v.optional(v.string()),
    howToMediaPath: v.optional(v.string()), // r2: path
    howToDoc: v.optional(v.string()), // markdown source
    sortOrder: v.number(),
    createdById: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_template", ["templateId"])
    .index("by_template_segment", ["templateId", "segment"]),

  /**
   * A reusable, per-GROUP run-sheet template — a named, saved order-of-items of
   * `runSheetTemplateItems` a leader can keep for a location and later apply to a
   * plan's `eventItems`. Group-scoped, with `communityId` denormalized for the
   * community read gate. Phase 1 stores the template only (no plan linkage or
   * propagation yet).
   */
  runSheetTemplates: defineTable({
    groupId: v.id("groups"),
    communityId: v.id("communities"),
    name: v.string(),
    createdById: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_group", ["groupId"]),

  /**
   * A single item on a `runSheetTemplates` template — the template mirror of
   * `eventItems` MINUS `planId` (keyed by `templateId` instead). Same segment +
   * `sequence` ordering, notes, role `assignments`, and library `songId` join as
   * a real run sheet item. Clock times are never stored (durations cascade
   * client-side), matching `eventItems`.
   */
  runSheetTemplateItems: defineTable({
    templateId: v.id("runSheetTemplates"),
    communityId: v.id("communities"),
    /** "before" | "during" | "after"; optional, treated as "during" if absent. */
    segment: v.optional(v.string()),
    /** Ordering within the segment; reordering rewrites these. */
    sequence: v.number(),
    /** "song" | "header" | "media" | "item" (mirrors PCO vocabulary). */
    type: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    durationSec: v.number(),
    notes: v.optional(
      v.array(v.object({ category: v.string(), content: v.string() })),
    ),
    assignments: v.optional(v.array(v.object({ roleId: v.id("teamRoles") }))),
    songDetails: v.optional(
      v.object({
        key: v.optional(v.string()),
        bpm: v.optional(v.number()),
        author: v.optional(v.string()),
      }),
    ),
    songId: v.optional(v.id("songs")),
    createdById: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_template", ["templateId"])
    // Scan items referencing a song so deleteSong can null them out (ADR-027).
    .index("by_song", ["songId"]),

  /**
   * Per-community song library (ADR-027). A song lives once and is referenced
   * by run sheet `eventItems` via `songId`, so editing its charts/metadata
   * updates every plan that uses it (no copied-string drift). `ccliNumber` is
   * the worship world's universal song ID, stored as plain metadata — there is
   * no live CCLI/MultiTracks integration. Charts are key-specific files in the
   * existing R2 document pipeline (`functions/uploads.ts`); `multitracksUrl` is
   * a link-out, never re-hosted audio.
   *
   * TODO: cascade songs on community delete — there is no central
   * community-deletion cascade in the codebase today (eventPlans/eventItems
   * aren't cascaded either), so `songs` follows the same (absent) pattern. Add
   * `songs` to that cascade if/when one lands.
   */
  songs: defineTable({
    communityId: v.id("communities"),
    title: v.string(),
    author: v.optional(v.string()),
    /** Universal song ID; the join key for a future Phase-3 integration. */
    ccliNumber: v.optional(v.string()),
    defaultKey: v.optional(v.string()),
    bpm: v.optional(v.number()),
    meter: v.optional(v.string()),
    arrangementName: v.optional(v.string()),
    structure: v.optional(v.array(v.string())),
    /**
     * Bring-your-own charts (Phase 2). One file per key. `fileKey` is the R2
     * stored path (e.g. `r2:...`) from the upload pipeline; the served `url` is
     * resolved on read, never stored.
     */
    charts: v.optional(
      v.array(
        v.object({
          key: v.optional(v.string()),
          label: v.string(),
          fileKey: v.string(),
          mimeType: v.string(),
        }),
      ),
    ),
    multitracksUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    createdById: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_community", ["communityId"])
    .index("by_community_ccli", ["communityId", "ccliNumber"]),

  /**
   * A member's self-reported availability for a single event plan (ADR-023
   * follow-up). This is *intentional availability* — "I am available to serve
   * this date" — not a block-out calendar. Being available does NOT assign the
   * member; leaders still decide who serves via `roleAssignments`. The absence
   * of a row means "no response", which the leader grid renders distinctly from
   * an explicit "unavailable".
   *
   * Keyed per (plan, user): availability is collected at the event-plan level,
   * not per time-slot. `groupId`/`communityId` are denormalized from the plan
   * so the dedicated "My Availability" page can scope by group without a join.
   */
  eventAvailability: defineTable({
    planId: v.id("eventPlans"),
    groupId: v.id("groups"),
    communityId: v.id("communities"),
    userId: v.id("users"),
    status: v.string(), // "available" | "unavailable"
    note: v.optional(v.string()),
    respondedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_plan", ["planId"])
    .index("by_plan_user", ["planId", "userId"])
    .index("by_user", ["userId"])
    .index("by_group_user", ["groupId", "userId"]),

  /**
   * Debounce bookkeeping for the "member updated their availability" leader
   * notification. One row per (group, member) holds the pending scheduled
   * notify job; each availability write cancels and reschedules it, so a burst
   * of clicks collapses into a single notification that fires once the member
   * stops (a rolling trailing debounce). Cleared when the job fires.
   */
  availabilityNotifyDebounce: defineTable({
    groupId: v.id("groups"),
    userId: v.id("users"),
    communityId: v.id("communities"),
    jobId: v.id("_scheduled_functions"),
    // Identity of the currently-scheduled job. The notify job only sends/clears
    // when its nonce still matches this row, so a stale job that couldn't be
    // cancelled can't delete a newer replacement row or fire an early/extra
    // notification.
    nonce: v.string(),
    scheduledAt: v.number(),
  }).index("by_group_user", ["groupId", "userId"]),

  /**
   * An availability request. Two flavors share this table:
   *  - **In-chat**: posted into a channel, backed by a `chatMessages` row with
   *    `contentType: "availability_request"` and `availabilityRequestId`
   *    pointing here (mirrors the `polls` pattern, flows through chat/push).
   *  - **Standalone link**: created with no `channelId`, shared as a public web
   *    URL (`/a/<publicToken>`) that works WITHOUT the app. A guest enters their
   *    name + phone and marks availability; the response is matched to their
   *    account when they later sign up and verify that phone (placeholder-claim
   *    path), exactly like guest invites.
   *
   * Either way the card/page lists a snapshot of the group's upcoming event
   * plans (`planIds`, captured at creation, date-ordered) and responses are
   * stored in `eventAvailability`. Every request gets a `publicToken` so it is
   * always shareable as a link, whether or not it was also posted to chat.
   */
  availabilityRequests: defineTable({
    /** Set for in-chat requests; absent for standalone link-only requests. */
    channelId: v.optional(v.id("chatChannels")),
    /** Back-pointer to the host message. Set after the message is inserted. */
    messageId: v.optional(v.id("chatMessages")),
    groupId: v.id("groups"),
    communityId: v.id("communities"),
    authorId: v.id("users"),
    /** Optional leader note shown above the event list on the card. */
    message: v.optional(v.string()),
    /** Snapshot of the event plans this request asks about, in date order. */
    planIds: v.array(v.id("eventPlans")),
    /** Unguessable token for the public `/a/<token>` web link. */
    publicToken: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_channel", ["channelId"])
    .index("by_message", ["messageId"])
    .index("by_public_token", ["publicToken"]),

  // =============================================================================
  // PRAYERS (Church feature, gated by communities.churchFeatures.prayerEnabled)
  // =============================================================================

  /**
   * A single prayer request posted by a community member.
   *
   * Anonymity contract: `authorUserId` is ALWAYS stored so the author can
   * receive notifications when others pray for them, but `feed`/`getDetail`
   * NEVER expose it when `isAnonymous` is true — not even to community admins.
   * The single chokepoint is `stripAuthor()` in functions/prayers.ts.
   */
  prayers: defineTable({
    communityId: v.id("communities"),
    authorUserId: v.id("users"),
    isAnonymous: v.boolean(),
    bodyText: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("answered"),
      v.literal("archived"),
    ),
    // Denormalized count, source of truth is `prayerResponses`. Indexed so
    // the feed query can sort cheaply by "needs prayer most" (fewest first).
    prayedForCount: v.number(),
    // Tiered moderation outcome:
    //   pending          — newly inserted; LLM hasn't responded yet.
    //                      Hidden from feed so borderline content never leaks
    //                      in the 1-5s before the LLM resolves.
    //   approved         — green: safe to publish.
    //   pending_review   — yellow: held for community admin to approve/reject.
    //                      Hidden from feed; visible in admin queue.
    //   rejected         — red: never publishes, author sees a reason.
    moderationStatus: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("pending_review"),
      v.literal("rejected"),
    ),
    // Crisis flag is independent of severity — a prayer can be APPROVED + flagged
    // (the "show resources, don't suppress" pattern from 7 Cups / Crisis Text
    // Line). When true, viewers see a 988 / Find-a-Helpline resource card
    // attached above the body.
    crisisFlag: v.optional(v.boolean()),
    // Detail surfaced to author (transparency) and to admins (review queue).
    // Never sent to other viewers.
    moderationDetail: v.optional(
      v.object({
        severity: v.union(v.literal("green"), v.literal("yellow"), v.literal("red")),
        category: v.optional(v.string()),
        note: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
    // When the prayer's moderationStatus most recently flipped to "approved".
    // Used by the daily-digest cron to count "new since last digest" by
    // publish time rather than creation time — a prayer held in
    // pending_review across a digest boundary still surfaces to members
    // once an admin approves it. Falls back to createdAt for any pre-
    // migration row that has no approvedAt yet.
    approvedAt: v.optional(v.number()),
  })
    .index("by_community", ["communityId"])
    .index("by_author", ["authorUserId"])
    // Powers the feed: active+APPROVED prayers sorted by count asc (fewest
    // prayers first). The moderation predicate is in the index, not a
    // post-filter — without it, pending/rejected rows (which are also
    // `status: "active"`) can fill the candidate window and starve
    // approved prayers from ever being seen.
    .index("by_community_status_modStatus_count", [
      "communityId",
      "status",
      "moderationStatus",
      "prayedForCount",
    ])
    // Powers the admin review queue: pending_review prayers per community.
    .index("by_community_moderationStatus", ["communityId", "moderationStatus"]),

  /**
   * A single 3-minute prayer session a user completed for a prayer.
   * Uniqueness on (prayerId, userId) is enforced in the mutation by
   * checking `by_prayer_user` before inserting.
   */
  prayerResponses: defineTable({
    prayerId: v.id("prayers"),
    userId: v.id("users"),
    // Denormalized so per-community counts (today/week pill) don't have
    // to load every prayer doc to check membership. Optional only to
    // accommodate any pre-migration rows; new inserts always set it.
    communityId: v.optional(v.id("communities")),
    prayedAt: v.number(),
  })
    .index("by_prayer", ["prayerId"])
    .index("by_user", ["userId"])
    .index("by_prayer_user", ["prayerId", "userId"])
    // Powers `myPrayedThisWeekCount` scoped per community.
    .index("by_user_community", ["userId", "communityId"]),

  /**
   * Author-posted follow-ups on a prayer: updates and "praise reports"
   * (celebrating answered prayer). Visible to everyone who prayed.
   */
  prayerFollowUps: defineTable({
    prayerId: v.id("prayers"),
    authorUserId: v.id("users"),
    kind: v.union(v.literal("update"), v.literal("praise_report")),
    bodyText: v.string(),
    createdAt: v.number(),
  }).index("by_prayer", ["prayerId"]),

  /**
   * Member-filed reports against a published prayer — the last-line
   * defense after our LLM and any author-side nudges. Each report is one
   * (prayer, reporter) pair; we enforce uniqueness in the mutation via
   * `by_prayer_reporter`. `communityId` is denormalized so admins can
   * query their queue without joining through prayers.
   *
   * Status:
   *   open      — visible in admin queue.
   *   actioned  — admin took action (typically rejected the prayer).
   *   dismissed — admin reviewed and chose to leave the prayer up.
   */
  prayerReports: defineTable({
    prayerId: v.id("prayers"),
    communityId: v.id("communities"),
    reporterUserId: v.id("users"),
    reason: v.union(
      v.literal("names_person"),
      v.literal("intimate_explicit"),
      v.literal("spam_solicitation"),
      v.literal("hateful"),
      v.literal("crisis_needs_resources"),
      v.literal("other"),
    ),
    customNote: v.optional(v.string()),
    status: v.union(
      v.literal("open"),
      v.literal("actioned"),
      v.literal("dismissed"),
    ),
    createdAt: v.number(),
  })
    .index("by_prayer", ["prayerId"])
    .index("by_reporter", ["reporterUserId"])
    // Admin queue: open reports in this community, oldest first.
    .index("by_community_status", ["communityId", "status"])
    // Uniqueness check inside reportPrayer.
    .index("by_prayer_reporter", ["prayerId", "reporterUserId"]),

  // =============================================================================
  // PRAYER NOTIFICATION PREFERENCES + CRON STATE
  // =============================================================================

  /**
   * Per-(user, community) prayer notification preferences.
   *
   * `masterEnabled: false` short-circuits every prayer notification path for
   * this user — it's the bell-off toggle surfaced on the prayer page.
   *
   * Per-type fields are optional; `undefined` means "use the type's default"
   * (every prayer type defaults to ON in v1). Reading code applies the
   * default — we never write defaults eagerly so flipping the global
   * default later doesn't require a backfill.
   */
  userPrayerNotificationPreferences: defineTable({
    userId: v.id("users"),
    communityId: v.id("communities"),
    masterEnabled: v.boolean(),
    prayedFor: v.optional(v.boolean()),
    update: v.optional(v.boolean()),
    praiseReport: v.optional(v.boolean()),
    dailyDigest: v.optional(v.boolean()),
    mondayNudge: v.optional(v.boolean()),
    updateNudge: v.optional(v.boolean()),
    updatedAt: v.number(),
  }).index("by_user_community", ["userId", "communityId"]),

  /**
   * Per-(user, community) cron scheduling state for prayer notifications.
   * Separated from the prefs table because it's high-write — keeping it on
   * the prefs row would churn its `_creationTime` and invalidate any cache
   * on every cron send.
   *
   * Dedup keys:
   *   - dailyDigestLastSentDateKey: UTC YYYY-MM-DD of last digest sent
   *   - mondayNudgeLastSentWeekKey: ISO year+week of last Monday nudge sent
   */
  userPrayerNotificationState: defineTable({
    userId: v.id("users"),
    communityId: v.id("communities"),
    dailyDigestLastSentDateKey: v.optional(v.string()),
    dailyDigestLastSentAt: v.optional(v.number()),
    mondayNudgeLastSentWeekKey: v.optional(v.string()),
    mondayNudgeLastSentAt: v.optional(v.number()),
  }).index("by_user_community", ["userId", "communityId"]),

  /**
   * Per-prayer one-shot tracking for notification events that fire at most
   * once per prayer (e.g. T+14d update nudge). Insertion is the "lock" —
   * the cron looks up `by_prayer_type` before sending and inserts on send.
   */
  prayerNotificationEvents: defineTable({
    prayerId: v.id("prayers"),
    type: v.string(),
    sentAt: v.number(),
  }).index("by_prayer_type", ["prayerId", "type"]),

  /**
   * Lightweight live presence for the roster grid (#477) — "who else is
   * viewing/editing this roster right now". Convex-native: a heartbeat row per
   * (gridKey, user), refreshed every few seconds by the client; a reactive
   * `listViewers` query returns whoever's row is within the staleness window.
   * No external presence service.
   *
   * `gridKey` is the rostering group's id as a string — the grid is scoped per
   * campus group (`rosterMatrix({ groupId })`), so the group id is the natural
   * stable grid scope. `name`/`avatarUrl` are denormalized from the user at
   * heartbeat time so `listViewers` needs no per-row user join. Staleness is
   * enforced read-side in `listViewers` (rows older than the window are
   * filtered out), so a missed `leave` self-heals; a cleanup cron is optional.
   */
  rosterPresence: defineTable({
    /** The grid scope — the rostering group's id, as a string. */
    gridKey: v.string(),
    userId: v.id("users"),
    /** Unix ms of the last heartbeat. Drives the staleness filter. */
    lastSeenAt: v.number(),
    /** Denormalized display name (snapshot at heartbeat). */
    name: v.string(),
    /** Denormalized resolved avatar URL, if any (snapshot at heartbeat). */
    avatarUrl: v.optional(v.string()),
  })
    .index("by_gridKey", ["gridKey"])
    .index("by_gridKey_user", ["gridKey", "userId"]),
});
