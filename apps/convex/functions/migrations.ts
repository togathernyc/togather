/**
 * Migration utilities
 *
 * Functions to help with data migrations, including image migration from S3 to Cloudflare Images.
 * These are internal functions meant to be run via CLI or dashboard.
 * All functions are internal (not publicly callable) for security.
 */

import { internalQuery, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

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
