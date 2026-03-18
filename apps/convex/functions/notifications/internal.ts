/**
 * Internal Notification Functions
 *
 * Helper queries and sending actions used internally by other notification functions.
 * Includes community admin lookups, group info, user info, and email/push sending.
 */

import { v } from "convex/values";
import { internalQuery, internalAction } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";
import { COMMUNITY_ADMIN_THRESHOLD } from "../../lib/permissions";
import { getMediaUrlWithTransform, ImagePresets } from "../../lib/utils";
import { DOMAIN_CONFIG } from "@togather/shared/config";

// ============================================================================
// Internal Helper Queries
// ============================================================================

const DEFAULT_INITIALS_AVATAR_BG = "007AFF";

function getInitials(name: string | undefined | null): string {
  if (!name) return "G";
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "G";
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

function getInitialsAvatarUrl(
  groupName: string | undefined,
  hexColor: string | undefined
): string {
  const normalizedColor =
    hexColor && /^#?[0-9A-Fa-f]{6}$/.test(hexColor)
      ? hexColor.replace("#", "")
      : DEFAULT_INITIALS_AVATAR_BG;
  const initials = getInitials(groupName);
  return `https://ui-avatars.com/api/?background=${normalizedColor}&color=fff&name=${encodeURIComponent(initials)}&size=128&format=png`;
}

/**
 * Get community admins (role >= 3)
 * Used to send notifications to community admins
 */
export const getCommunityAdmins = internalQuery({
  args: {
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const adminMemberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) =>
        q.and(
          q.gte(q.field("roles"), COMMUNITY_ADMIN_THRESHOLD),
          q.eq(q.field("status"), 1)
        )
      )
      .collect();

    return adminMemberships.map((m) => m.userId);
  },
});

/**
 * Get group info with community
 * Used by notification actions to get group name and community
 */
export const getGroupInfo = internalQuery({
  args: {
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (!group) return null;
    const community = await ctx.db.get(group.communityId);

    const groupPhotoUrl = getMediaUrlWithTransform(
      group.preview,
      ImagePresets.avatarSmall
    );
    const communityLogoUrl =
      getMediaUrlWithTransform(community?.appIcon, ImagePresets.avatarSmall) ||
      getMediaUrlWithTransform(community?.logo, ImagePresets.avatarSmall);
    const groupAvatarUrl =
      groupPhotoUrl || getInitialsAvatarUrl(group.name, community?.primaryColor);

    return {
      id: group._id,
      name: group.name || "Group",
      communityId: group.communityId,
      groupPhotoUrl,
      communityLogoUrl,
      groupAvatarUrl,
    };
  },
});

/**
 * Get community info for community-level notification avatars.
 */
export const getCommunityInfo = internalQuery({
  args: {
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const community = await ctx.db.get(args.communityId);
    if (!community) return null;

    const communityLogoUrl =
      getMediaUrlWithTransform(community.appIcon, ImagePresets.avatarSmall) ||
      getMediaUrlWithTransform(community.logo, ImagePresets.avatarSmall);

    return {
      id: community._id,
      name: community.name || "Community",
      communityLogoUrl,
    };
  },
});

/**
 * Get user display name
 */
export const getUserDisplayName = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return "Someone";

    const firstName = user.firstName || "";
    const lastName = user.lastName || "";
    return `${firstName} ${lastName}`.trim() || "Someone";
  },
});

/**
 * Get user details for email notifications
 * Returns email and notification preferences
 */
export const getUserEmailInfo = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    return {
      email: user.email,
      emailNotificationsEnabled: user.emailNotificationsEnabled ?? true,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  },
});

/**
 * Get user with notification preferences for the unified notification system
 * Used by convex/lib/notifications/send.ts
 */
export const getUserForNotification = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    return {
      id: user._id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      // Use optional chaining for defensive safety
      pushNotificationsEnabled: user?.pushNotificationsEnabled ?? true,
      emailNotificationsEnabled: user?.emailNotificationsEnabled ?? true,
    };
  },
});

/**
 * Get group members for notifications
 * Optionally filtered by role (all or leaders only)
 * Used by convex/lib/notifications/send.ts
 */
export const getGroupMembersForNotification = internalQuery({
  args: {
    groupId: v.id("groups"),
    filter: v.optional(v.union(v.literal("all"), v.literal("leaders"))),
  },
  handler: async (ctx, args) => {
    let members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    // Filter by role if specified
    if (args.filter === "leaders") {
      members = members.filter(
        (m) => m.role === "leader" || m.role === "admin"
      );
    }

    return members.map((m) => m.userId);
  },
});

/**
 * Get group member info (userId) from a groupMembers doc
 * Used by followup assignment notifications
 */
export const getGroupMemberInfo = internalQuery({
  args: {
    groupMemberId: v.id("groupMembers"),
  },
  handler: async (ctx, args) => {
    const member = await ctx.db.get(args.groupMemberId);
    if (!member) return null;
    return { userId: member.userId };
  },
});

/**
 * Get a chat channel for test notifications
 * Used by the dev notification tester
 */
export const getTestChatChannel = internalQuery({
  args: {
    userId: v.id("users"),
    groupId: v.optional(v.string()),
    chatTarget: v.string(), // "main" or "leaders"
  },
  handler: async (ctx, args) => {
    // If groupId provided, find channel in that group
    if (args.groupId) {
      // Parse the groupId - it might be a Convex ID string
      try {
        const groupIdParsed = args.groupId as Id<"groups">;
        const channel = await ctx.db
          .query("chatChannels")
          .withIndex("by_group_type", (q) =>
            q.eq("groupId", groupIdParsed).eq("channelType", args.chatTarget)
          )
          .first();

        if (channel) {
          return { channelId: channel._id, groupId: groupIdParsed };
        }
      } catch {
        // Invalid group ID format
      }
    }

    // Find first group the user is a member of
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!membership) {
      return null;
    }

    // Find channel in that group
    const channel = await ctx.db
      .query("chatChannels")
      .withIndex("by_group_type", (q) =>
        q.eq("groupId", membership.groupId).eq("channelType", args.chatTarget)
      )
      .first();

    if (!channel) {
      return null;
    }

    return { channelId: channel._id, groupId: membership.groupId };
  },
});

// ============================================================================
// Email Sending Functions
// ============================================================================

/**
 * Send a single email notification via Resend
 * Used by convex/lib/notifications/send.ts for the email channel
 */
export const sendEmailNotification = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    htmlBody: v.string(),
    notificationType: v.string(),
  },
  handler: async (_ctx, args): Promise<{ success: boolean; error?: string }> => {
    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
      console.warn("[Email] RESEND_API_KEY not configured");
      return { success: false, error: "RESEND_API_KEY not configured" };
    }

    const EMAIL_FROM = DOMAIN_CONFIG.emailFrom;

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: args.to,
          subject: args.subject,
          html: args.htmlBody,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("[Email] Resend API error:", response.status, error);
        return { success: false, error: `Resend API error: ${response.status}` };
      }

      const result = await response.json();
      console.log(`[Email] Successfully sent email for ${args.notificationType}:`, result.id);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[Email] Error sending email:", error);
      return { success: false, error: errorMessage };
    }
  },
});

/**
 * Send batch push notifications
 */
export const sendBatchPushNotifications = internalAction({
  args: {
    notifications: v.array(
      v.object({
        token: v.string(),
        title: v.string(),
        body: v.string(),
        data: v.optional(v.any()),
        imageUrl: v.optional(v.string()),
      })
    ),
  },
  handler: async (_ctx, args) => {
    if (args.notifications.length === 0) {
      return { success: true, ticketIds: [], errors: [] };
    }

    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          args.notifications.map((n) => {
            const message: {
              to: string;
              title: string;
              body: string;
              data: unknown;
              richContent?: { image: string };
              mutableContent?: boolean;
            } = {
              to: n.token,
              title: n.title,
              body: n.body,
              data: n.data || {},
              mutableContent: true,
            };

            if (n.imageUrl) {
              // Expo maps richContent.image to platform-specific rich media payloads.
              message.richContent = { image: n.imageUrl };
            }

            return message;
          })
        ),
      });

      interface PushTicket {
        id?: string;
        status: string;
        message?: string;
      }

      const result: { data?: PushTicket[] } = await response.json();
      const ticketIds = result.data
        ?.filter((t: PushTicket) => t.id)
        .map((t: PushTicket) => t.id as string) || [];
      const errors = result.data
        ?.filter((t: PushTicket) => t.status === "error")
        .map((t: PushTicket) => t.message || "Unknown error") || [];

      return {
        success: response.ok,
        ticketIds,
        errors,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        ticketIds: [],
        errors: [errorMessage],
      };
    }
  },
});

/**
 * Result type for individual email send
 */
interface EmailSendResult {
  success: boolean;
  error?: string;
}

/**
 * Send emails via Resend API
 * Similar to packages/notifications/src/channels/email.ts but for Convex
 *
 * Supports batching up to 100 emails per API request (Resend limit).
 */
export const sendEmails = internalAction({
  args: {
    emails: v.array(
      v.object({
        to: v.string(),
        subject: v.string(),
        htmlBody: v.string(),
      })
    ),
  },
  handler: async (_ctx, args): Promise<EmailSendResult[]> => {
    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
      console.warn("[Email] RESEND_API_KEY not configured");
      return args.emails.map(() => ({
        success: false,
        error: "RESEND_API_KEY not configured",
      }));
    }

    const results: EmailSendResult[] = [];
    const EMAIL_FROM = DOMAIN_CONFIG.emailFrom;

    // Batch emails (Resend supports up to 100 per request)
    for (let i = 0; i < args.emails.length; i += 100) {
      const batch = args.emails.slice(i, i + 100);

      try {
        const response = await fetch("https://api.resend.com/emails/batch", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            batch.map((email) => ({
              from: EMAIL_FROM,
              to: email.to,
              subject: email.subject,
              html: email.htmlBody,
            }))
          ),
        });

        if (!response.ok) {
          const error = await response.text();
          console.error("[Email] Resend API error:", response.status, error);
          results.push(...batch.map(() => ({ success: false, error })));
        } else {
          console.log(`[Email] Successfully sent ${batch.length} emails`);
          results.push(...batch.map(() => ({ success: true })));
        }
      } catch (error) {
        console.error("[Email] Error sending batch:", error);
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        results.push(...batch.map(() => ({ success: false, error: errorMessage })));
      }
    }

    return results;
  },
});
