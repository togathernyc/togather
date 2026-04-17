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
    isPublic: v.optional(v.boolean()), // Whether community is publicly listed
    // Explore page default filters (admin-configurable)
    exploreDefaultGroupTypes: v.optional(v.array(v.id("groupTypes"))),
    exploreDefaultMeetingType: v.optional(v.number()), // 1=In-Person, 2=Online
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
    username: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    isStaff: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
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
    // Cross-app field: Togather shares its dev Convex deployment with other
    // Supa apps (Fount Studios etc.) that write platform-level role tags.
    // Togather doesn't read or write this — the schema just stays tolerant
    // so `convex dev` pushes don't fail on cross-app data.
    platformRoles: v.optional(v.array(v.string())),
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
    lastLogin: v.optional(v.number()), // Unix timestamp ms - updated when user switches to this community
    // External integrations - stores IDs from external systems per community membership
    // e.g., { planningCenterId: "12345" }
    externalIds: v.optional(
      v.object({
        planningCenterId: v.optional(v.string()),
      }),
    ),
    // Denormalized PCO person ID for efficient indexed lookups
    // This mirrors externalIds.planningCenterId but is top-level for indexing
    pcoPersonId: v.optional(v.string()),
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
    icon: v.optional(v.string()), // Ionicons icon name
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

    // Visibility
    visibility: v.optional(v.string()), // 'group' | 'community' | 'public'

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
    .index("by_reminderAt_sent", ["reminderAt", "reminderSent"])
    .index("by_attendanceConfirmation", [
      "attendanceConfirmationAt",
      "attendanceConfirmationSent",
    ])
    .index("by_communityWideEvent", ["communityWideEventId"])
    .index("by_series", ["seriesId"])
    .index("by_community", ["communityId"])
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
    .index("by_trackingId", ["trackingId"]),

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
   * Represents a chat channel (group chat, leaders chat, or DM).
   * Channel types:
   *   - "main" - Default channel for a group
   *   - "leaders" - Leaders-only channel
   *   - "dm" - Direct message
   *   - "custom" - Custom channel with manual membership
   *   - "pco_services" - Auto channel synced from PCO Services
   *   - Future: "elvanto", "ccb", etc.
   */
  chatChannels: defineTable({
    groupId: v.id("groups"),
    slug: v.optional(v.string()), // URL-friendly, unique per group, immutable (optional for migration)
    channelType: v.string(), // "main" | "leaders" | "dm" | "custom" | "pco_services"
    name: v.string(),
    description: v.optional(v.string()),
    createdById: v.id("users"),
    createdAt: v.number(), // Unix timestamp ms
    updatedAt: v.number(), // Unix timestamp ms
    isArchived: v.boolean(),
    archivedAt: v.optional(v.number()), // Unix timestamp ms
    /** false = leader hid channel from members; memberships stay (unlike archive). undefined/true = active. */
    isEnabled: v.optional(v.boolean()),
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
        }),
      ),
    ),
    // Channel invite link fields
    inviteShortId: v.optional(v.string()), // 9-char alphanumeric from generateShortId()
    inviteEnabled: v.optional(v.boolean()), // toggle link on/off
    joinMode: v.optional(v.string()), // "open" | "approval_required"
  })
    .index("by_group", ["groupId"])
    .index("by_group_type", ["groupId", "channelType"])
    .index("by_group_slug", ["groupId", "slug"])
    .index("by_createdBy", ["createdById"])
    .index("by_lastMessageAt", ["lastMessageAt"])
    .index("by_archived", ["isArchived"])
    .index("by_isShared", ["isShared"])
    .index("by_inviteShortId", ["inviteShortId"]),

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
    // Auto-sync tracking (for auto channels like PCO Services)
    syncSource: v.optional(v.string()), // "pco_services" | null (manual)
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
  })
    .index("by_channel", ["channelId"])
    .index("by_user", ["userId"])
    .index("by_channel_user", ["channelId", "userId"])
    .index("by_channel_syncSource", ["channelId", "syncSource"])
    .index("by_role", ["role"]),

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
    senderId: v.optional(v.id("users")), // Optional for bot/system messages
    content: v.string(), // Message text
    contentType: v.string(), // "text" | "image" | "file" | "system" | "bot" | "reach_out_request" | "task_card"
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
    // Optional idempotency key for generated bot/task posts
    sourceKey: v.optional(v.string()),
  })
    .index("by_channel", ["channelId"])
    .index("by_channel_createdAt", ["channelId", "createdAt"])
    .index("by_channel_lastActivityAt", ["channelId", "lastActivityAt"])
    .index("by_sender", ["senderId"])
    .index("by_parentMessage", ["parentMessageId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_sourceKey", ["sourceKey"]),

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
          type: v.string(), // "set_assignee"
          assigneePhone: v.optional(v.string()),
          assigneeUserId: v.optional(v.id("users")),
        }),
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
    addedAt: v.optional(v.number()),
    latestNote: v.optional(v.string()),
    latestNoteAt: v.optional(v.number()),

    // Alerts
    alerts: v.optional(v.array(v.string())),

    // Snooze
    isSnoozed: v.optional(v.boolean()),
    snoozedUntil: v.optional(v.number()),

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
});
