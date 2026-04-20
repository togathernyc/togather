/**
 * Seed Script for Demo Data
 *
 * Generates test data for new developer environments.
 * Run with: npx convex run functions/seed:seedDemoData
 *
 * What it creates:
 * - Demo Community with realistic settings
 * - Standard group types (Small Groups, Teams, Classes)
 * - Several sample groups
 * - Test users including the bypass phone number (2025550123)
 * - Group memberships
 * - Sample meetings
 * - Basic notification preferences
 *
 * This script is idempotent - running it twice won't create duplicates.
 */

import { v } from "convex/values";
import { action, internalAction, internalMutation, mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { now, generateShortId, normalizePhone, buildSearchText } from "../lib/utils";
import { COMMUNITY_ROLES } from "../lib/permissions";
import { isLeaderRole } from "../lib/helpers";

// ============================================================================
// Constants
// ============================================================================

const TEST_PHONE = "+12025550123"; // Bypass phone with code 000000
const DEMO_COMMUNITY_NAME = "Demo Community";
const DEMO_COMMUNITY_SLUG = "demo-community";

// Standard group types used across communities
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

// Sample groups to create
const SAMPLE_GROUPS = [
  {
    name: "Young Adults",
    description: "A community for young professionals in their 20s and 30s",
    groupTypeSlug: "small-groups",
    isPublic: true,
    defaultDay: 3, // Wednesday
    defaultStartTime: "19:00",
    defaultEndTime: "21:00",
    defaultMeetingType: 1, // In-Person
  },
  {
    name: "Small Group Alpha",
    description: "Weekly study and fellowship group meeting in downtown area",
    groupTypeSlug: "small-groups",
    isPublic: true,
    defaultDay: 2, // Tuesday
    defaultStartTime: "18:30",
    defaultEndTime: "20:30",
    defaultMeetingType: 1, // In-Person
  },
  {
    name: "Worship Team",
    description: "Musicians and vocalists serving in weekend services",
    groupTypeSlug: "teams",
    isPublic: false,
    defaultDay: 4, // Thursday
    defaultStartTime: "19:00",
    defaultEndTime: "21:00",
    defaultMeetingType: 1, // In-Person
  },
  {
    name: "Tech Team",
    description: "Audio, video, and streaming volunteers",
    groupTypeSlug: "teams",
    isPublic: false,
    defaultDay: 6, // Saturday
    defaultStartTime: "14:00",
    defaultEndTime: "16:00",
    defaultMeetingType: 1, // In-Person
  },
  {
    name: "New Members Class",
    description: "Introduction to our community for new attendees",
    groupTypeSlug: "classes",
    isPublic: true,
    defaultDay: 0, // Sunday
    defaultStartTime: "12:00",
    defaultEndTime: "13:30",
    defaultMeetingType: 1, // In-Person
  },
];

// Sample users to create. The mix covers every permission bucket the product
// has so reviewers can simulate each flow with a single seed run:
//   - Primary admin (Test User) — the default login for most paths.
//   - Community admin (Alice) — admin-gated flows like CWE creation.
//   - Group leader (Bob) — leader-only flows within a single group.
//   - Plain member (Mia) — non-leader, non-admin. Used to exercise the
//     ADR-022 member-created-events flow, the 1-future-event cap, and the
//     report flow. Reviewers should add Mia's phone to
//     `OTP_TEST_PHONE_NUMBERS` to log in as her with the 000000 bypass.
//   - Filler users (Carol, David, Emma) — populate member lists.
const SAMPLE_USERS = [
  {
    phone: TEST_PHONE,
    firstName: "Test",
    lastName: "User",
    email: "test@example.com",
    isPrimaryAdmin: true,
  },
  {
    phone: "+12025550124",
    firstName: "Alice",
    lastName: "Johnson",
    email: "alice@example.com",
    isAdmin: true,
  },
  {
    phone: "+12025550125",
    firstName: "Bob",
    lastName: "Smith",
    email: "bob@example.com",
    isLeader: true, // Will be a group leader
  },
  {
    phone: "+12025550126",
    firstName: "Carol",
    lastName: "Williams",
    email: "carol@example.com",
  },
  {
    phone: "+12025550127",
    firstName: "David",
    lastName: "Brown",
    email: "david@example.com",
  },
  {
    phone: "+12025550128",
    firstName: "Emma",
    lastName: "Davis",
    email: "emma@example.com",
  },
  {
    // Dedicated "plain member" for ADR-022 reviewer testing. Not a leader of
    // any seeded group, just an announcement-group member via ADR-008.
    phone: "+12025550130",
    firstName: "Mia",
    lastName: "Member",
    email: "mia@example.com",
  },
];

// ============================================================================
// Internal Mutations (called by the action)
// ============================================================================

/**
 * Check if Demo Community already exists
 */
export const checkDemoCommunityExists = internalMutation({
  args: {},
  handler: async (ctx): Promise<Id<"communities"> | null> => {
    const existing = await ctx.db
      .query("communities")
      .withIndex("by_slug", (q) => q.eq("slug", DEMO_COMMUNITY_SLUG))
      .first();

    return existing?._id ?? null;
  },
});

/**
 * Create the Demo Community
 */
export const createDemoCommunity = internalMutation({
  args: {},
  handler: async (ctx): Promise<Id<"communities">> => {
    const timestamp = now();

    const communityId = await ctx.db.insert("communities", {
      name: DEMO_COMMUNITY_NAME,
      slug: DEMO_COMMUNITY_SLUG,
      isPublic: true,
      timezone: "America/New_York",
      city: "New York",
      state: "NY",
      country: "USA",
      primaryColor: "#1E8449",
      secondaryColor: "#2E86C1",
      searchText: `${DEMO_COMMUNITY_NAME} ${DEMO_COMMUNITY_SLUG}`.toLowerCase(),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    console.log(`[seed] Created Demo Community: ${communityId}`);
    return communityId;
  },
});

/**
 * Create group types for the community
 */
export const createGroupTypes = internalMutation({
  args: {
    communityId: v.id("communities"),
  },
  handler: async (ctx, args): Promise<Record<string, Id<"groupTypes">>> => {
    const timestamp = now();
    const groupTypeMap: Record<string, Id<"groupTypes">> = {};

    for (const groupType of GROUP_TYPES) {
      // Check if already exists
      const existing = await ctx.db
        .query("groupTypes")
        .withIndex("by_community_slug", (q) =>
          q.eq("communityId", args.communityId).eq("slug", groupType.slug)
        )
        .first();

      if (existing) {
        console.log(`[seed] Group type already exists: ${groupType.name}`);
        groupTypeMap[groupType.slug] = existing._id;
        continue;
      }

      const groupTypeId = await ctx.db.insert("groupTypes", {
        communityId: args.communityId,
        name: groupType.name,
        slug: groupType.slug,
        description: groupType.description,
        icon: groupType.icon,
        displayOrder: groupType.displayOrder,
        isActive: true,
        createdAt: timestamp,
      });

      console.log(`[seed] Created group type: ${groupType.name}`);
      groupTypeMap[groupType.slug] = groupTypeId;
    }

    return groupTypeMap;
  },
});

/**
 * Create a single user
 */
export const createUser = internalMutation({
  args: {
    phone: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"users">> => {
    const timestamp = now();

    // Check if user already exists by phone
    const existing = await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .first();

    if (existing) {
      console.log(`[seed] User already exists: ${args.firstName} ${args.lastName}`);
      return existing._id;
    }

    const userId = await ctx.db.insert("users", {
      phone: args.phone,
      phoneVerified: true,
      firstName: args.firstName,
      lastName: args.lastName,
      email: args.email.toLowerCase(),
      searchText: buildSearchText({
        firstName: args.firstName,
        lastName: args.lastName,
        email: args.email,
        phone: args.phone,
      }),
      isActive: true,
      isStaff: false,
      isSuperuser: false,
      pushNotificationsEnabled: true,
      emailNotificationsEnabled: true,
      smsNotificationsEnabled: true,
      timezone: "America/New_York",
      dateJoined: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    console.log(`[seed] Created user: ${args.firstName} ${args.lastName}`);
    return userId;
  },
});

/**
 * Create community membership for a user
 */
export const createCommunityMembership = internalMutation({
  args: {
    userId: v.id("users"),
    communityId: v.id("communities"),
    role: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"userCommunities">> => {
    const timestamp = now();

    // Check if membership already exists
    const existing = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.userId).eq("communityId", args.communityId)
      )
      .first();

    if (existing) {
      console.log(`[seed] Membership already exists for user ${args.userId}`);
      return existing._id;
    }

    const membershipId = await ctx.db.insert("userCommunities", {
      userId: args.userId,
      communityId: args.communityId,
      roles: args.role,
      status: 1, // Active
      createdAt: timestamp,
      updatedAt: timestamp,
      lastLogin: timestamp,
    });

    // Set active community for user
    await ctx.db.patch(args.userId, {
      activeCommunityId: args.communityId,
      updatedAt: timestamp,
    });

    console.log(`[seed] Created community membership with role ${args.role}`);
    return membershipId;
  },
});

/**
 * Create a group
 */
export const createGroup = internalMutation({
  args: {
    communityId: v.id("communities"),
    groupTypeId: v.id("groupTypes"),
    name: v.string(),
    description: v.optional(v.string()),
    isPublic: v.boolean(),
    defaultDay: v.optional(v.number()),
    defaultStartTime: v.optional(v.string()),
    defaultEndTime: v.optional(v.string()),
    defaultMeetingType: v.optional(v.number()),
    isAnnouncementGroup: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Id<"groups">> => {
    const timestamp = now();

    // Check if group already exists by name in community
    const existingGroups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    const existing = existingGroups.find((g) => g.name === args.name);
    if (existing) {
      console.log(`[seed] Group already exists: ${args.name}`);
      return existing._id;
    }

    const groupId = await ctx.db.insert("groups", {
      communityId: args.communityId,
      groupTypeId: args.groupTypeId,
      name: args.name,
      description: args.description,
      isPublic: args.isPublic,
      isArchived: false,
      shortId: generateShortId(),
      defaultDay: args.defaultDay,
      defaultStartTime: args.defaultStartTime,
      defaultEndTime: args.defaultEndTime,
      defaultMeetingType: args.defaultMeetingType,
      isAnnouncementGroup: args.isAnnouncementGroup,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    console.log(`[seed] Created group: ${args.name}`);
    return groupId;
  },
});

/**
 * Create a group membership
 */
export const createGroupMembership = internalMutation({
  args: {
    groupId: v.id("groups"),
    userId: v.id("users"),
    role: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"groupMembers">> => {
    const timestamp = now();

    // Check if membership already exists
    const existing = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", args.userId)
      )
      .first();

    if (existing) {
      console.log(`[seed] Group membership already exists`);
      return existing._id;
    }

    const membershipId = await ctx.db.insert("groupMembers", {
      groupId: args.groupId,
      userId: args.userId,
      role: args.role,
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    console.log(`[seed] Created group membership with role ${args.role}`);
    return membershipId;
  },
});

/**
 * Create a meeting
 */
export const createMeeting = internalMutation({
  args: {
    groupId: v.id("groups"),
    createdById: v.id("users"),
    title: v.string(),
    scheduledAt: v.number(),
    meetingType: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"meetings">> => {
    const timestamp = now();

    const meetingId = await ctx.db.insert("meetings", {
      groupId: args.groupId,
      createdById: args.createdById,
      title: args.title,
      scheduledAt: args.scheduledAt,
      meetingType: args.meetingType,
      note: args.note,
      status: "scheduled",
      shortId: generateShortId(),
      rsvpEnabled: true,
      rsvpOptions: [
        { id: 1, label: "Attending", enabled: true },
        { id: 2, label: "Maybe", enabled: true },
        { id: 3, label: "Not Attending", enabled: true },
      ],
      visibility: "group",
      createdAt: timestamp,
      reminderSent: false,
      attendanceConfirmationSent: false,
    });

    console.log(`[seed] Created meeting: ${args.title}`);
    return meetingId;
  },
});

/**
 * Create chat channels for a group
 */
export const createChatChannels = internalMutation({
  args: {
    groupId: v.id("groups"),
    groupName: v.string(),
    createdById: v.id("users"),
  },
  handler: async (ctx, args): Promise<{ mainChannelId: Id<"chatChannels">; leadersChannelId: Id<"chatChannels"> }> => {
    const timestamp = now();

    // Check if channels already exist
    const existingMain = await ctx.db
      .query("chatChannels")
      .withIndex("by_group_type", (q) =>
        q.eq("groupId", args.groupId).eq("channelType", "main")
      )
      .first();

    const existingLeaders = await ctx.db
      .query("chatChannels")
      .withIndex("by_group_type", (q) =>
        q.eq("groupId", args.groupId).eq("channelType", "leaders")
      )
      .first();

    let mainChannelId: Id<"chatChannels">;
    let leadersChannelId: Id<"chatChannels">;

    if (existingMain) {
      mainChannelId = existingMain._id;
      console.log(`[seed] Main channel already exists for ${args.groupName}`);
    } else {
      mainChannelId = await ctx.db.insert("chatChannels", {
        groupId: args.groupId,
        slug: "general",
        channelType: "main",
        name: args.groupName,
        createdById: args.createdById,
        createdAt: timestamp,
        updatedAt: timestamp,
        isArchived: false,
        memberCount: 0,
      });
      console.log(`[seed] Created main channel for ${args.groupName}`);
    }

    if (existingLeaders) {
      leadersChannelId = existingLeaders._id;
      console.log(`[seed] Leaders channel already exists for ${args.groupName}`);
    } else {
      leadersChannelId = await ctx.db.insert("chatChannels", {
        groupId: args.groupId,
        slug: "leaders",
        channelType: "leaders",
        name: `${args.groupName} Leaders`,
        createdById: args.createdById,
        createdAt: timestamp,
        updatedAt: timestamp,
        isArchived: false,
        memberCount: 0,
      });
      console.log(`[seed] Created leaders channel for ${args.groupName}`);
    }

    return { mainChannelId, leadersChannelId };
  },
});

/**
 * Create channel membership
 */
export const createChannelMembership = internalMutation({
  args: {
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
    role: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"chatChannelMembers">> => {
    const timestamp = now();

    // Check if membership already exists
    const existing = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", args.userId)
      )
      .first();

    if (existing) {
      return existing._id;
    }

    const membershipId = await ctx.db.insert("chatChannelMembers", {
      channelId: args.channelId,
      userId: args.userId,
      role: args.role,
      joinedAt: timestamp,
      isMuted: false,
      displayName: args.displayName,
    });

    // Update member count
    const channel = await ctx.db.get(args.channelId);
    if (channel) {
      await ctx.db.patch(args.channelId, {
        memberCount: (channel.memberCount || 0) + 1,
        updatedAt: timestamp,
      });
    }

    return membershipId;
  },
});

// ============================================================================
// Main Seed Action
// ============================================================================

/**
 * Main seed function - creates all demo data
 *
 * Run with: npx convex run functions/seed:seedDemoData
 */
export const seedDemoData = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    success: boolean;
    message: string;
    summary: {
      community: string;
      groupTypesCreated: number;
      usersCreated: number;
      groupsCreated: number;
      meetingsCreated: number;
    };
  }> => {
    console.log("[seed] Starting seed process...");

    // Check if Demo Community already exists
    const existingCommunityId = await ctx.runMutation(
      internal.functions.seed.checkDemoCommunityExists,
      {}
    );

    if (existingCommunityId) {
      console.log("[seed] Demo Community already exists, checking for missing data...");
    }

    // Create or get the Demo Community
    const communityId = existingCommunityId ?? await ctx.runMutation(
      internal.functions.seed.createDemoCommunity,
      {}
    );

    console.log(`[seed] Using community: ${communityId}`);

    // Create group types
    const groupTypeMapResult = await ctx.runMutation(
      internal.functions.seed.createGroupTypes,
      { communityId }
    );

    // groupTypeMapResult is already a Record
    const groupTypeMap = groupTypeMapResult;

    console.log(`[seed] Group types ready: ${Object.keys(groupTypeMap).length}`);

    // Create users
    const userIds: Id<"users">[] = [];
    const userRoles: Map<Id<"users">, { isAdmin?: boolean; isPrimaryAdmin?: boolean; isLeader?: boolean }> = new Map();

    for (const userData of SAMPLE_USERS) {
      const userId = await ctx.runMutation(
        internal.functions.seed.createUser,
        {
          phone: userData.phone,
          firstName: userData.firstName,
          lastName: userData.lastName,
          email: userData.email,
        }
      );
      userIds.push(userId);
      userRoles.set(userId, {
        isAdmin: userData.isAdmin,
        isPrimaryAdmin: userData.isPrimaryAdmin,
        isLeader: userData.isLeader,
      });
    }

    console.log(`[seed] Users ready: ${userIds.length}`);

    // Create community memberships
    for (const userId of userIds) {
      const roles = userRoles.get(userId);
      let role: number = COMMUNITY_ROLES.MEMBER;

      if (roles?.isPrimaryAdmin) {
        role = COMMUNITY_ROLES.PRIMARY_ADMIN;
      } else if (roles?.isAdmin) {
        role = COMMUNITY_ROLES.ADMIN;
      }

      await ctx.runMutation(
        internal.functions.seed.createCommunityMembership,
        { userId, communityId, role }
      );
    }

    console.log("[seed] Community memberships created");

    // Create announcement group first
    const announcementGroupTypeId = groupTypeMap["announcements"];
    if (announcementGroupTypeId) {
      const announcementGroupId = await ctx.runMutation(
        internal.functions.seed.createGroup,
        {
          communityId,
          groupTypeId: announcementGroupTypeId,
          name: DEMO_COMMUNITY_NAME,
          description: "Official community announcements",
          isPublic: true,
          isAnnouncementGroup: true,
        }
      );

      // Add all users to announcement group
      // Admins become leaders, members stay members
      for (const userId of userIds) {
        const roles = userRoles.get(userId);
        const groupRole = roles?.isPrimaryAdmin || roles?.isAdmin ? "leader" : "member";

        await ctx.runMutation(
          internal.functions.seed.createGroupMembership,
          { groupId: announcementGroupId, userId, role: groupRole }
        );
      }

      // Create channels for announcement group
      const testUserId = userIds[0]; // Primary admin
      await ctx.runMutation(
        internal.functions.seed.createChatChannels,
        {
          groupId: announcementGroupId,
          groupName: DEMO_COMMUNITY_NAME,
          createdById: testUserId,
        }
      );
    }

    // Create sample groups
    const groupIds: Id<"groups">[] = [];

    for (const groupData of SAMPLE_GROUPS) {
      const groupTypeId = groupTypeMap[groupData.groupTypeSlug];
      if (!groupTypeId) {
        console.log(`[seed] Skipping group ${groupData.name} - group type not found`);
        continue;
      }

      const groupId = await ctx.runMutation(
        internal.functions.seed.createGroup,
        {
          communityId,
          groupTypeId,
          name: groupData.name,
          description: groupData.description,
          isPublic: groupData.isPublic,
          defaultDay: groupData.defaultDay,
          defaultStartTime: groupData.defaultStartTime,
          defaultEndTime: groupData.defaultEndTime,
          defaultMeetingType: groupData.defaultMeetingType,
        }
      );
      groupIds.push(groupId);

      // Create channels for this group
      const testUserId = userIds[0];
      const channels = await ctx.runMutation(
        internal.functions.seed.createChatChannels,
        {
          groupId,
          groupName: groupData.name,
          createdById: testUserId,
        }
      );

      // Add members to this group
      // First user (primary admin) is always a leader
      // Users marked as leaders also become leaders
      // Others are members
      for (let i = 0; i < Math.min(4, userIds.length); i++) {
        const userId = userIds[i];
        const roles = userRoles.get(userId);
        const isGroupLeader = i === 0 || roles?.isLeader || roles?.isPrimaryAdmin;
        const groupRole = isGroupLeader ? "leader" : "member";

        await ctx.runMutation(
          internal.functions.seed.createGroupMembership,
          { groupId, userId, role: groupRole }
        );

        // Add to channels
        const user = SAMPLE_USERS[i];
        const displayName = `${user.firstName} ${user.lastName}`;

        // Everyone gets main channel
        await ctx.runMutation(
          internal.functions.seed.createChannelMembership,
          {
            channelId: channels.mainChannelId,
            userId,
            role: isGroupLeader ? "admin" : "member",
            displayName,
          }
        );

        // Only leaders get leaders channel
        if (isGroupLeader) {
          await ctx.runMutation(
            internal.functions.seed.createChannelMembership,
            {
              channelId: channels.leadersChannelId,
              userId,
              role: "admin",
              displayName,
            }
          );
        }
      }
    }

    console.log(`[seed] Groups created: ${groupIds.length}`);

    // Create sample meetings
    const meetingsCreated: Id<"meetings">[] = [];
    const testUserId = userIds[0];
    const baseTime = now();

    // Create 2 meetings per group
    for (let i = 0; i < groupIds.length; i++) {
      const groupId = groupIds[i];
      const groupName = SAMPLE_GROUPS[i].name;

      // Upcoming meeting (1 week from now)
      const upcomingMeetingId = await ctx.runMutation(
        internal.functions.seed.createMeeting,
        {
          groupId,
          createdById: testUserId,
          title: `${groupName} Weekly Meeting`,
          scheduledAt: baseTime + 7 * 24 * 60 * 60 * 1000, // 1 week from now
          meetingType: 1, // In-Person
          note: "Regular weekly gathering",
        }
      );
      meetingsCreated.push(upcomingMeetingId);

      // Another meeting (2 weeks from now)
      const futureMeetingId = await ctx.runMutation(
        internal.functions.seed.createMeeting,
        {
          groupId,
          createdById: testUserId,
          title: `${groupName} Special Event`,
          scheduledAt: baseTime + 14 * 24 * 60 * 60 * 1000, // 2 weeks from now
          meetingType: 1, // In-Person
          note: "Special gathering - mark your calendars!",
        }
      );
      meetingsCreated.push(futureMeetingId);
    }

    console.log(`[seed] Meetings created: ${meetingsCreated.length}`);

    const summary = {
      community: DEMO_COMMUNITY_NAME,
      groupTypesCreated: Object.keys(groupTypeMap).length,
      usersCreated: userIds.length,
      groupsCreated: groupIds.length + 1, // +1 for announcement group
      meetingsCreated: meetingsCreated.length,
    };

    console.log("[seed] Seed completed successfully!");
    console.log("[seed] Summary:", JSON.stringify(summary, null, 2));
    console.log(`[seed] Test user phone: ${TEST_PHONE} (use code 000000)`);

    return {
      success: true,
      message: `Seed completed! Use phone ${TEST_PHONE} with code 000000 to log in.`,
      summary,
    };
  },
});

// ============================================================================
// Seed People Data (cross-group followup scores)
// ============================================================================

const FAKE_PEOPLE = [
  { firstName: "Sarah", lastName: "Johnson", email: "sarah.j@example.com", phone: "+12025551001" },
  { firstName: "Michael", lastName: "Chen", email: "michael.c@example.com", phone: "+12025551002" },
  { firstName: "Emily", lastName: "Rodriguez", email: "emily.r@example.com", phone: "+12025551003" },
  { firstName: "James", lastName: "Williams", email: "james.w@example.com", phone: "+12025551004" },
  { firstName: "Olivia", lastName: "Martinez", email: "olivia.m@example.com", phone: "+12025551005" },
  { firstName: "David", lastName: "Kim", email: "david.k@example.com", phone: "+12025551006" },
  { firstName: "Rachel", lastName: "Brown", email: "rachel.b@example.com", phone: "+12025551007" },
  { firstName: "Daniel", lastName: "Taylor", email: "daniel.t@example.com", phone: "+12025551008" },
  { firstName: "Jessica", lastName: "Lee", email: "jessica.l@example.com", phone: "+12025551009" },
  { firstName: "Andrew", lastName: "Garcia", email: "andrew.g@example.com", phone: "+12025551010" },
  { firstName: "Amanda", lastName: "Wilson", email: "amanda.w@example.com", phone: "+12025551011" },
  { firstName: "Brian", lastName: "Thomas", email: "brian.t@example.com", phone: "+12025551012" },
];

export const seedPeopleData = action({
  args: {},
  handler: async (ctx): Promise<{ success: boolean; message: string }> => {
    return await ctx.runMutation(internal.functions.seed._seedPeopleDataMutation, {});
  },
});

export const _seedPeopleDataMutation = internalMutation({
  args: {},
  returns: v.object({ success: v.boolean(), message: v.string() }),
  handler: async (ctx) => {
    // Find the test user
    const testUser = await ctx.db
      .query("users")
      .withIndex("by_phone", (q: any) => q.eq("phone", TEST_PHONE))
      .first();
    if (!testUser) throw new Error("Test user not found — run seedDemoData first");

    // Find Demo Community
    const community = await ctx.db
      .query("communities")
      .withIndex("by_slug", (q: any) => q.eq("slug", DEMO_COMMUNITY_SLUG))
      .first();
    if (!community) throw new Error("Demo Community not found — run seedDemoData first");

    // Find leader groups for the test user
    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q: any) => q.eq("userId", testUser._id))
      .collect();
    const leaderMemberships = memberships.filter(
      (m) => m.leftAt === undefined && isLeaderRole(m.role)
    );

    console.log(`[seedPeople] Found ${leaderMemberships.length} leader groups`);

    let created = 0;
    const timestamp = now();

    for (let gi = 0; gi < leaderMemberships.length; gi++) {
      const gm = leaderMemberships[gi];
      const group = await ctx.db.get(gm.groupId);
      if (!group) continue;

      // Skip large groups (Demo Community Announcements) to avoid doc read limits
      if ((group as any).isAnnouncementGroup) {
        console.log(`[seedPeople] Skipping announcement group "${group.name}"`);
        continue;
      }

      // Assign 2-3 people per group from our fake list
      const startIdx = (gi * 3) % FAKE_PEOPLE.length;
      const count = gi % 2 === 0 ? 3 : 2;

      for (let pi = 0; pi < count; pi++) {
        const person = FAKE_PEOPLE[(startIdx + pi) % FAKE_PEOPLE.length];

        // Create a user for this person (or find existing)
        let personUser = await ctx.db
          .query("users")
          .withIndex("by_phone", (q: any) => q.eq("phone", normalizePhone(person.phone)))
          .first();

        if (!personUser) {
          const personUserId = await ctx.db.insert("users", {
            firstName: person.firstName,
            lastName: person.lastName,
            email: person.email,
            phone: normalizePhone(person.phone),
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          personUser = await ctx.db.get(personUserId);
        }

        // Create group membership
        let personGm = await ctx.db
          .query("groupMembers")
          .withIndex("by_group_user", (q: any) =>
            q.eq("groupId", gm.groupId).eq("userId", personUser!._id)
          )
          .first();

        if (!personGm) {
          const gmId = await ctx.db.insert("groupMembers", {
            groupId: gm.groupId,
            userId: personUser!._id,
            role: "member",
            joinedAt: timestamp,
            notificationsEnabled: true,
          });
          personGm = await ctx.db.get(gmId);
        }

        // Create memberFollowupScores entry assigned to test user
        const attendanceScore = Math.floor(Math.random() * 80) + 20;
        const connectionScore = Math.floor(Math.random() * 70) + 15;
        const searchText = buildSearchText({
          firstName: person.firstName,
          lastName: person.lastName,
          email: person.email,
          phone: person.phone,
        });

        await ctx.db.insert("memberFollowupScores", {
          groupId: gm.groupId,
          groupMemberId: personGm!._id,
          userId: personUser!._id,
          firstName: person.firstName,
          lastName: person.lastName,
          email: person.email,
          phone: person.phone,
          score1: attendanceScore / 100,
          score2: connectionScore / 100,
          scoreIds: ["attendance", "connection"],
          alerts: attendanceScore < 30 ? ["Low Attendance"] : [],
          isSnoozed: false,
          attendanceScore,
          connectionScore,
          followupScore: 0,
          missedMeetings: Math.floor(Math.random() * 5),
          consecutiveMissed: Math.floor(Math.random() * 3),
          assigneeId: testUser._id,
          assigneeIds: [testUser._id],
          status: ["new", "active", "needs-followup"][pi % 3],
          searchText,
          updatedAt: timestamp,
          addedAt: timestamp - (pi * 7 * 24 * 60 * 60 * 1000), // staggered dates
        });

        created++;
        console.log(
          `[seedPeople] Created ${person.firstName} ${person.lastName} in "${group.name}"`
        );
      }
    }

    return {
      success: true,
      message: `Created ${created} people across ${leaderMemberships.length} leader groups`,
    };
  },
});

/**
 * Dev helper: Set superuser/staff flags on a user by phone number.
 * Internal-only to prevent unauthorized privilege escalation.
 * Run with: npx convex run functions/seed:makeSuperuser '{"phone": "+12025550123"}'
 */
export const makeSuperuser = internalMutation({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .first();
    if (!user) throw new Error(`No user found with phone ${args.phone}`);
    await ctx.db.patch(user._id, { isSuperuser: true, isStaff: true });
    return { userId: user._id, name: `${user.firstName} ${user.lastName}` };
  },
});

/**
 * Dev helper: Clear Stripe customer ID from a proposal (e.g. after switching from live to test keys).
 * Internal-only to prevent unauthorized data modification.
 * Run with: npx convex run functions/seed:clearProposalStripeData '{"proposalId": "..."}'
 */
export const clearProposalStripeData = internalMutation({
  args: { proposalId: v.id("communityProposals") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.proposalId, {
      stripeCustomerId: undefined,
      stripePriceId: undefined,
      stripeSubscriptionId: undefined,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});
