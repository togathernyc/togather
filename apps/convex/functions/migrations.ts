/**
 * Migration utilities
 *
 * Functions to help with data migrations, including image migration from S3 to Cloudflare Images.
 * These are internal functions meant to be run via CLI or dashboard.
 * All functions are internal (not publicly callable) for security.
 */

import { internalQuery, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";

const NYC_METRO_ZIP_CODES = [
  "10001", "10002", "10003", "10009", "10010", "10011", "10012", "10013",
  "10014", "10016", "10018", "10019", "10021", "10022", "10023", "10024",
  "10025", "10026", "10027", "10028", "10029", "10030", "10031", "10032",
  "10033", "10034", "10035", "10036", "10037", "10038", "10039", "10040",
  "10128", "10280", "10301", "10304", "10305", "10306", "10310", "10314",
  "10451", "10452", "10453", "10454", "10455", "10456", "10457", "10458",
  "10459", "10460", "10461", "10462", "10463", "10464", "10465", "10466",
  "10467", "10468", "10469", "10470", "10471", "10472", "10473", "10474",
  "10475", "11101", "11102", "11103", "11104", "11105", "11106", "11201",
  "11203", "11204", "11205", "11206", "11207", "11208", "11209", "11210",
  "11211", "11212", "11213", "11214", "11215", "11216", "11217", "11218",
  "11219", "11220", "11221", "11222", "11223", "11224", "11225", "11226",
  "11228", "11229", "11230", "11231", "11232", "11233", "11234", "11235",
  "11236", "11354", "11355", "11356", "11357", "11358", "11360", "11361",
  "11362", "11363", "11364", "11365", "11366", "11367", "11368", "11369",
  "11370", "11372", "11373", "11374", "11375", "11377", "11378", "11379",
  "11385", "11411", "11412", "11413", "11414", "11415", "11416", "11417",
  "11418", "11419", "11420", "11421", "11422", "11423", "11426", "11427",
  "11428", "11429", "11432", "11433", "11434", "11435", "11436", "11530",
  "11550", "11561", "11691", "11692", "11693", "11694", "11697", "07030",
  "07086", "07102", "07103", "07104", "07105", "07302", "07304", "07305",
  "07306", "07307", "07601", "07631", "07666",
] as const;

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function zipCodeForId(value: string): string {
  return NYC_METRO_ZIP_CODES[hashString(value) % NYC_METRO_ZIP_CODES.length];
}

/**
 * Count all images across all tables
 *
 * Run via: npx convex run functions/migrations:countImages --prod
 */
export const countImages = internalQuery({
  args: {},
  handler: async (ctx) => {
    const counts = {
      users: { total: 0, withProfilePhoto: 0 },
      communities: { total: 0, withLogo: 0, withAppIcon: 0 },
      groups: { total: 0, withPreview: 0 },
      groupTypes: { total: 0, withIcon: 0 },
      meetings: { total: 0, withCoverImage: 0 },
      groupCreationRequests: { total: 0, withPreview: 0 },
      chatChannelMembers: { total: 0, withProfilePhoto: 0 },
      chatMessages: { total: 0, withAttachments: 0, totalAttachments: 0, imageAttachments: 0 },
    };

    // Count users with profile photos
    const users = await ctx.db.query("users").collect();
    counts.users.total = users.length;
    counts.users.withProfilePhoto = users.filter((u) => u.profilePhoto).length;

    // Count communities with logo/appIcon
    const communities = await ctx.db.query("communities").collect();
    counts.communities.total = communities.length;
    counts.communities.withLogo = communities.filter((c) => c.logo).length;
    counts.communities.withAppIcon = communities.filter((c) => c.appIcon).length;

    // Count groups with preview images
    const groups = await ctx.db.query("groups").collect();
    counts.groups.total = groups.length;
    counts.groups.withPreview = groups.filter((g) => g.preview).length;

    // Count group types with icons
    const groupTypes = await ctx.db.query("groupTypes").collect();
    counts.groupTypes.total = groupTypes.length;
    counts.groupTypes.withIcon = groupTypes.filter((gt) => gt.icon).length;

    // Count meetings with cover images
    const meetings = await ctx.db.query("meetings").collect();
    counts.meetings.total = meetings.length;
    counts.meetings.withCoverImage = meetings.filter((m) => m.coverImage).length;

    // Count group creation requests with preview
    const groupCreationRequests = await ctx.db.query("groupCreationRequests").collect();
    counts.groupCreationRequests.total = groupCreationRequests.length;
    counts.groupCreationRequests.withPreview = groupCreationRequests.filter((r) => r.preview).length;

    // Count chat channel members with profile photos
    const chatChannelMembers = await ctx.db.query("chatChannelMembers").collect();
    counts.chatChannelMembers.total = chatChannelMembers.length;
    counts.chatChannelMembers.withProfilePhoto = chatChannelMembers.filter((m) => m.profilePhoto).length;

    // Count chat messages with attachments
    const chatMessages = await ctx.db.query("chatMessages").collect();
    counts.chatMessages.total = chatMessages.length;
    counts.chatMessages.withAttachments = chatMessages.filter(
      (m) => m.attachments && m.attachments.length > 0
    ).length;
    // Count total attachments and image attachments
    for (const msg of chatMessages) {
      if (msg.attachments) {
        counts.chatMessages.totalAttachments += msg.attachments.length;
        counts.chatMessages.imageAttachments += msg.attachments.filter(
          (a) => a.type === "image" || a.mimeType?.startsWith("image/")
        ).length;
      }
    }

    // Calculate totals
    const totalImages =
      counts.users.withProfilePhoto +
      counts.communities.withLogo +
      counts.communities.withAppIcon +
      counts.groups.withPreview +
      counts.groupTypes.withIcon +
      counts.meetings.withCoverImage +
      counts.groupCreationRequests.withPreview +
      counts.chatMessages.imageAttachments;

    // Note: chatChannelMembers.profilePhoto is denormalized from users, so we don't count it as unique

    return {
      counts,
      totalUniqueImages: totalImages,
      notes: [
        "chatChannelMembers.profilePhoto is denormalized from users table, not counted as unique",
        "groupTypes.icon stores icon names (e.g. 'people'), not image paths - may not need migration",
      ],
    };
  },
});

/**
 * Get sample image paths to understand URL formats
 *
 * Run via: npx convex run functions/migrations:sampleImagePaths --prod
 */
export const sampleImagePaths = internalQuery({
  args: {},
  handler: async (ctx) => {
    const samples: Record<string, string[]> = {
      userProfilePhotos: [],
      communityLogos: [],
      communityAppIcons: [],
      groupPreviews: [],
      groupTypeIcons: [],
      meetingCoverImages: [],
      chatAttachments: [],
    };

    // Sample up to 5 from each
    const users = await ctx.db.query("users").collect();
    samples.userProfilePhotos = users
      .filter((u) => u.profilePhoto)
      .slice(0, 5)
      .map((u) => u.profilePhoto!);

    const communities = await ctx.db.query("communities").collect();
    samples.communityLogos = communities
      .filter((c) => c.logo)
      .slice(0, 5)
      .map((c) => c.logo!);
    samples.communityAppIcons = communities
      .filter((c) => c.appIcon)
      .slice(0, 5)
      .map((c) => c.appIcon!);

    const groups = await ctx.db.query("groups").collect();
    samples.groupPreviews = groups
      .filter((g) => g.preview)
      .slice(0, 5)
      .map((g) => g.preview!);

    const groupTypes = await ctx.db.query("groupTypes").collect();
    samples.groupTypeIcons = groupTypes
      .filter((gt) => gt.icon)
      .slice(0, 5)
      .map((gt) => gt.icon!);

    const meetings = await ctx.db.query("meetings").collect();
    samples.meetingCoverImages = meetings
      .filter((m) => m.coverImage)
      .slice(0, 5)
      .map((m) => m.coverImage!);

    // Sample chat message attachments
    const chatMessages = await ctx.db.query("chatMessages").collect();
    const messagesWithAttachments = chatMessages.filter(
      (m) => m.attachments && m.attachments.length > 0
    );
    for (const msg of messagesWithAttachments.slice(0, 5)) {
      if (msg.attachments) {
        for (const att of msg.attachments) {
          samples.chatAttachments.push(att.url);
          if (att.thumbnailUrl) {
            samples.chatAttachments.push(`(thumbnail) ${att.thumbnailUrl}`);
          }
        }
      }
    }

    return samples;
  },
});

// =============================================================================
// IMAGE MIGRATION FUNCTIONS (Internal)
// =============================================================================

/**
 * Get all images that need to be migrated
 * Returns records with S3 paths (not already migrated to r2:)
 */
export const getImagesToMigrate = internalQuery({
  args: {},
  handler: async (ctx) => {
    const imagesToMigrate: Array<{
      table: string;
      field: string;
      id: string;
      currentPath: string;
    }> = [];

    // Users with profilePhoto
    const users = await ctx.db.query("users").collect();
    for (const u of users) {
      if (u.profilePhoto && !u.profilePhoto.startsWith("r2:") && !u.profilePhoto.startsWith("file://")) {
        imagesToMigrate.push({
          table: "users",
          field: "profilePhoto",
          id: u._id,
          currentPath: u.profilePhoto,
        });
      }
    }

    // Communities with logo
    const communities = await ctx.db.query("communities").collect();
    for (const c of communities) {
      if (c.logo && !c.logo.startsWith("r2:") && !c.logo.startsWith("file://")) {
        imagesToMigrate.push({
          table: "communities",
          field: "logo",
          id: c._id,
          currentPath: c.logo,
        });
      }
      if (c.appIcon && !c.appIcon.startsWith("r2:") && !c.appIcon.startsWith("file://")) {
        imagesToMigrate.push({
          table: "communities",
          field: "appIcon",
          id: c._id,
          currentPath: c.appIcon,
        });
      }
    }

    // Groups with preview
    const groups = await ctx.db.query("groups").collect();
    for (const g of groups) {
      if (g.preview && !g.preview.startsWith("r2:") && !g.preview.startsWith("file://")) {
        imagesToMigrate.push({
          table: "groups",
          field: "preview",
          id: g._id,
          currentPath: g.preview,
        });
      }
    }

    // Meetings with coverImage
    const meetings = await ctx.db.query("meetings").collect();
    for (const m of meetings) {
      if (m.coverImage && !m.coverImage.startsWith("r2:") && !m.coverImage.startsWith("file://")) {
        imagesToMigrate.push({
          table: "meetings",
          field: "coverImage",
          id: m._id,
          currentPath: m.coverImage,
        });
      }
    }

    return imagesToMigrate;
  },
});

/**
 * Seed missing ZIP codes for dev followup testing without overwriting existing values.
 *
 * Run via:
 *   CONVEX_DEPLOYMENT=dev:... npx convex run functions/migrations:seedDevZipCodes '{"count":1000}'
 */
export const seedDevZipCodes = internalMutation({
  args: {
    count: v.optional(v.number()),
    groupId: v.optional(v.id("groups")),
    groupShortId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const targetCount = Math.max(1, Math.min(args.count ?? 1000, 5000));
    const nowTs = Date.now();
    let targetGroupId = args.groupId;

    if (!targetGroupId && args.groupShortId) {
      const group = await ctx.db
        .query("groups")
        .withIndex("by_shortId", (q) => q.eq("shortId", args.groupShortId!))
        .first();
      if (!group) {
        throw new Error(`Group not found for shortId ${args.groupShortId}`);
      }
      targetGroupId = group._id;
    }

    if (!targetGroupId) {
      throw new Error("groupId or groupShortId is required");
    }

    const communityPeopleRows = await ctx.db
      .query("communityPeople")
      .withIndex("by_group", (q) => q.eq("groupId", targetGroupId!))
      .collect();
    const memberFollowupScoreRows = await ctx.db
      .query("memberFollowupScores")
      .withIndex("by_group", (q) => q.eq("groupId", targetGroupId!))
      .collect();

    const candidateUsers = new Map<string, Id<"users">>();
    for (const row of communityPeopleRows) {
      if (row.zipCode) continue;
      candidateUsers.set(row.userId.toString(), row.userId);
    }

    const selectedUserIds = Array.from(candidateUsers.entries())
      .sort(([a], [b]) => hashString(a) - hashString(b))
      .slice(0, targetCount)
      .map(([, userId]) => userId);

    let usersUpdated = 0;
    let communityPeopleUpdated = 0;
    let followupScoresUpdated = 0;

    for (const userId of selectedUserIds) {
      const zipCode = zipCodeForId(userId.toString());
      const user = await ctx.db.get(userId);

      if (user && !user.zipCode) {
        await ctx.db.patch(userId, { zipCode });
        usersUpdated += 1;
      }

      for (const row of communityPeopleRows) {
        if (row.userId.toString() !== userId.toString() || row.zipCode) continue;
        await ctx.db.patch(row._id, {
          zipCode,
          updatedAt: nowTs,
        });
        communityPeopleUpdated += 1;
      }

      for (const row of memberFollowupScoreRows) {
        if (row.userId.toString() !== userId.toString() || row.zipCode) continue;
        await ctx.db.patch(row._id, { zipCode });
        followupScoresUpdated += 1;
      }
    }

    return {
      requested: targetCount,
      groupId: targetGroupId,
      selectedUsers: selectedUserIds.length,
      usersUpdated,
      communityPeopleRowsUpdated: communityPeopleUpdated,
      memberFollowupScoresUpdated: followupScoresUpdated,
      zipPoolSize: NYC_METRO_ZIP_CODES.length,
    };
  },
});

/**
 * Update a user's profilePhoto
 */
export const updateUserProfilePhoto = internalMutation({
  args: {
    userId: v.id("users"),
    newPath: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { profilePhoto: args.newPath });

    // Sync profile photo to channel memberships
    await ctx.scheduler.runAfter(0, internal.functions.sync.memberships.syncUserProfileToChannels, {
      userId: args.userId,
    });
  },
});

/**
 * Update a community's logo
 */
export const updateCommunityLogo = internalMutation({
  args: {
    communityId: v.id("communities"),
    newPath: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.communityId, { logo: args.newPath });
  },
});

/**
 * Update a community's appIcon
 */
export const updateCommunityAppIcon = internalMutation({
  args: {
    communityId: v.id("communities"),
    newPath: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.communityId, { appIcon: args.newPath });
  },
});

/**
 * Update a group's preview
 */
export const updateGroupPreview = internalMutation({
  args: {
    groupId: v.id("groups"),
    newPath: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.groupId, { preview: args.newPath });
  },
});

/**
 * Update a meeting's coverImage
 */
export const updateMeetingCoverImage = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    newPath: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.meetingId, { coverImage: args.newPath });
  },
});
