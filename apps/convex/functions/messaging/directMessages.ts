/**
 * Direct Message + Ad-Hoc Group Chat Functions
 *
 * Backend for 1:1 DMs and small ad-hoc group chats. Channels live in
 * `chatChannels` alongside traditional group channels, distinguished by
 * `isAdHoc: true` and `channelType: "dm" | "group_dm"`. They have a
 * `communityId` (not `groupId`) since DMs are scoped to communities.
 *
 * Message Request flow: when user A creates a DM/group chat with user B,
 * B's `chatChannelMembers` row starts in `requestState: "pending"`. B must
 * Accept, Decline, or Block-and-Report before the chat is fully usable on
 * B's side.
 */

import { v, ConvexError } from "convex/values";
import { query, mutation, internalMutation } from "../../_generated/server";
import type { QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { checkRateLimit } from "../../lib/rateLimit";
import { getDisplayName, getMediaUrl } from "../../lib/utils";

// ============================================================================
// Constants
// ============================================================================

/** Max number of recipients in a `group_dm` (creator excluded). Total cap is 20. */
const MAX_GROUP_DM_RECIPIENTS = 19;
/** Cap on group chat name length. */
const MAX_GROUP_NAME_LENGTH = 100;
/** Cap on member-search result list length. */
const DEFAULT_SEARCH_LIMIT = 30;
const MAX_SEARCH_LIMIT = 50;
/** Max new pending DM requests a user can initiate per 24h. */
const NEW_REQUEST_LIMIT = 5;
const NEW_REQUEST_WINDOW_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Compute the deterministic dedup key for a 1:1 DM channel.
 * Sorted lexicographically so that (a, b) and (b, a) produce the same key.
 */
function computeDmPairKey(a: Id<"users">, b: Id<"users">): string {
  return [a, b].sort().join("::");
}

/**
 * Returns true if either user has blocked the other (any direction).
 * Use this before exposing the existence of either user to the other.
 */
async function isBlockedEitherDirection(
  ctx: QueryCtx,
  userIdA: Id<"users">,
  userIdB: Id<"users">,
): Promise<boolean> {
  const aBlockedB = await ctx.db
    .query("chatUserBlocks")
    .withIndex("by_blocker_blocked", (q) =>
      q.eq("blockerId", userIdA).eq("blockedId", userIdB),
    )
    .first();
  if (aBlockedB) return true;

  const bBlockedA = await ctx.db
    .query("chatUserBlocks")
    .withIndex("by_blocker_blocked", (q) =>
      q.eq("blockerId", userIdB).eq("blockedId", userIdA),
    )
    .first();
  return bBlockedA !== null;
}

/**
 * Return the set of community IDs that both users are members of.
 * Skips memberships with status === 3 (deactivated) — undefined status
 * is treated as active for legacy rows.
 */
async function getSharedCommunityIds(
  ctx: QueryCtx,
  userIdA: Id<"users">,
  userIdB: Id<"users">,
): Promise<Id<"communities">[]> {
  const [aMemberships, bMemberships] = await Promise.all([
    ctx.db
      .query("userCommunities")
      .withIndex("by_user", (q) => q.eq("userId", userIdA))
      .collect(),
    ctx.db
      .query("userCommunities")
      .withIndex("by_user", (q) => q.eq("userId", userIdB))
      .collect(),
  ]);

  const isActive = (status: number | undefined) => status !== 3;
  const aSet = new Set(
    aMemberships.filter((m) => isActive(m.status)).map((m) => m.communityId),
  );
  const shared: Id<"communities">[] = [];
  for (const m of bMemberships) {
    if (!isActive(m.status)) continue;
    if (aSet.has(m.communityId)) shared.push(m.communityId);
  }
  return shared;
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a 1:1 DM channel between the caller and `recipientUserId`, or return
 * the existing one. Returns `{ channelId, isNew }`. The recipient's membership
 * row starts in `requestState: "pending"` until they accept.
 *
 * Rejects if:
 *   - Caller is the recipient
 *   - The two users share no community
 *   - Either party has blocked the other
 *   - Caller has already initiated 5 new pending DMs in the last 24h
 */
export const createOrGetDirectChannel = mutation({
  args: {
    token: v.string(),
    recipientUserId: v.id("users"),
  },
  handler: async (ctx, args): Promise<{ channelId: Id<"chatChannels">; isNew: boolean }> => {
    const senderId = await requireAuth(ctx, args.token);

    if (senderId === args.recipientUserId) {
      throw new Error("Cannot DM yourself");
    }

    const dmPairKey = computeDmPairKey(senderId, args.recipientUserId);

    // Existing channel? Return it without rate-limit (already-known pair).
    const existing = await ctx.db
      .query("chatChannels")
      .withIndex("by_dmPairKey", (q) => q.eq("dmPairKey", dmPairKey))
      .first();
    if (existing) {
      return { channelId: existing._id, isNew: false };
    }

    // Verify shared community.
    const sharedCommunityIds = await getSharedCommunityIds(
      ctx,
      senderId,
      args.recipientUserId,
    );
    if (sharedCommunityIds.length === 0) {
      throw new Error("You can only message members of your communities");
    }
    const communityId = sharedCommunityIds[0]!;

    // Verify neither party has blocked the other (generic error — don't leak who).
    if (await isBlockedEitherDirection(ctx, senderId, args.recipientUserId)) {
      throw new Error("Cannot start chat");
    }

    // Rate-limit new pending DM requests.
    await checkRateLimit(
      ctx,
      `dm-init:${senderId}`,
      NEW_REQUEST_LIMIT,
      NEW_REQUEST_WINDOW_MS,
    );

    const recipient = await ctx.db.get(args.recipientUserId);
    if (!recipient) {
      throw new Error("Recipient not found");
    }
    const sender = await ctx.db.get(senderId);
    if (!sender) {
      throw new Error("Sender not found");
    }

    const now = Date.now();
    const channelId = await ctx.db.insert("chatChannels", {
      communityId,
      isAdHoc: true,
      dmPairKey,
      channelType: "dm",
      name: "",
      createdById: senderId,
      createdAt: now,
      updatedAt: now,
      isArchived: false,
      memberCount: 2,
    });

    await ctx.db.insert("chatChannelMembers", {
      channelId,
      userId: senderId,
      role: "admin",
      joinedAt: now,
      isMuted: false,
      requestState: "accepted",
      displayName: getDisplayName(sender.firstName, sender.lastName),
      profilePhoto: sender.profilePhoto,
    });

    await ctx.db.insert("chatChannelMembers", {
      channelId,
      userId: args.recipientUserId,
      role: "member",
      joinedAt: now,
      isMuted: false,
      requestState: "pending",
      invitedById: senderId,
      displayName: getDisplayName(recipient.firstName, recipient.lastName),
      profilePhoto: recipient.profilePhoto,
    });

    return { channelId, isNew: true };
  },
});

/**
 * Create an ad-hoc group chat with the caller plus 1-19 recipients (≤ 20 total).
 * Returns `{ channelId }`. All recipients start in `requestState: "pending"`.
 *
 * Channel `communityId` is the community most-shared between the creator and
 * recipients (mode of intersected memberships; ties broken arbitrarily).
 *
 * Group chats are NOT deduped — two calls with the same recipient set produce
 * two distinct channels.
 *
 * Rejects if:
 *   - Recipient list (after de-dupe) is empty or > 19
 *   - Any recipient shares no community with the creator
 *   - Any recipient is blocked-with or has blocked the creator
 *   - Caller has already initiated 5 new pending requests in the last 24h
 */
export const createGroupChat = mutation({
  args: {
    token: v.string(),
    recipientUserIds: v.array(v.id("users")),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ channelId: Id<"chatChannels"> }> => {
    const creatorId = await requireAuth(ctx, args.token);

    // De-dupe and exclude creator.
    const uniqueRecipients = Array.from(
      new Set(args.recipientUserIds.filter((id) => id !== creatorId)),
    );
    if (uniqueRecipients.length === 0) {
      throw new Error("Group chat requires at least one other recipient");
    }
    if (uniqueRecipients.length > MAX_GROUP_DM_RECIPIENTS) {
      throw new Error(
        `Group chat can include at most ${MAX_GROUP_DM_RECIPIENTS} other people`,
      );
    }

    // For each recipient, get their shared communities with the creator and
    // count community-IDs across the group. Recipients with no overlap fail
    // the request entirely.
    const sharedPerRecipient = await Promise.all(
      uniqueRecipients.map((id) => getSharedCommunityIds(ctx, creatorId, id)),
    );
    const missingShared: Id<"users">[] = [];
    const communityCounts = new Map<Id<"communities">, number>();
    for (let i = 0; i < uniqueRecipients.length; i++) {
      const shared = sharedPerRecipient[i]!;
      if (shared.length === 0) {
        missingShared.push(uniqueRecipients[i]!);
        continue;
      }
      for (const cId of shared) {
        communityCounts.set(cId, (communityCounts.get(cId) ?? 0) + 1);
      }
    }
    if (missingShared.length > 0) {
      throw new Error("You can only message members of your communities");
    }

    // Pick the most-shared community.
    let communityId: Id<"communities"> | null = null;
    let bestCount = 0;
    for (const [cId, count] of communityCounts) {
      if (count > bestCount) {
        bestCount = count;
        communityId = cId;
      }
    }
    if (!communityId) {
      throw new Error("You can only message members of your communities");
    }

    // Block-check every recipient. Generic message; do not enumerate.
    const blockedChecks = await Promise.all(
      uniqueRecipients.map((id) => isBlockedEitherDirection(ctx, creatorId, id)),
    );
    if (blockedChecks.some((b) => b)) {
      throw new Error("Cannot include some users in this chat");
    }

    // Rate-limit new pending requests.
    await checkRateLimit(
      ctx,
      `dm-init:${creatorId}`,
      NEW_REQUEST_LIMIT,
      NEW_REQUEST_WINDOW_MS,
    );

    const creator = await ctx.db.get(creatorId);
    if (!creator) {
      throw new Error("Sender not found");
    }
    const recipients = await Promise.all(
      uniqueRecipients.map((id) => ctx.db.get(id)),
    );

    const now = Date.now();
    const trimmedName = (args.name ?? "").trim().slice(0, MAX_GROUP_NAME_LENGTH);

    const channelId = await ctx.db.insert("chatChannels", {
      communityId,
      isAdHoc: true,
      channelType: "group_dm",
      name: trimmedName,
      createdById: creatorId,
      createdAt: now,
      updatedAt: now,
      isArchived: false,
      memberCount: 1 + uniqueRecipients.length,
    });

    await ctx.db.insert("chatChannelMembers", {
      channelId,
      userId: creatorId,
      role: "admin",
      joinedAt: now,
      isMuted: false,
      requestState: "accepted",
      displayName: getDisplayName(creator.firstName, creator.lastName),
      profilePhoto: creator.profilePhoto,
    });

    for (let i = 0; i < uniqueRecipients.length; i++) {
      const recipientId = uniqueRecipients[i]!;
      const recipient = recipients[i];
      if (!recipient) {
        throw new Error("Recipient not found");
      }
      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId: recipientId,
        role: "member",
        joinedAt: now,
        isMuted: false,
        requestState: "pending",
        invitedById: creatorId,
        displayName: getDisplayName(recipient.firstName, recipient.lastName),
        profilePhoto: recipient.profilePhoto,
      });
    }

    return { channelId };
  },
});

/**
 * Respond to a pending chat request as the recipient.
 *
 *   - "accept": flip requestState to "accepted"; chat is now fully usable for the responder
 *   - "decline": mark declined and set leftAt so existing membership filters exclude them.
 *     The inviter is NOT notified.
 *   - "block": same as decline, plus inserts a `chatUserBlocks` row (idempotent) and a
 *     `chatUserFlags` report so moderators can review the inviter.
 *
 * Throws if the row is not in pending state or the channel is not ad-hoc.
 */
export const respondToChatRequest = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    response: v.union(
      v.literal("accept"),
      v.literal("decline"),
      v.literal("block"),
    ),
    reportReason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const userId = await requireAuth(ctx, args.token);

    const membership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId),
      )
      .first();
    if (!membership) {
      throw new Error("Not a member of this channel");
    }
    if (membership.requestState !== "pending") {
      throw new Error("This chat is not pending response");
    }

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }
    if (!channel.isAdHoc) {
      throw new ConvexError({
        code: "INVALID_CHANNEL",
        message: "Only ad-hoc chat requests can be responded to",
      });
    }

    const now = Date.now();

    if (args.response === "accept") {
      await ctx.db.patch(membership._id, {
        requestState: "accepted",
        requestRespondedAt: now,
      });
      return { ok: true };
    }

    if (args.response === "decline") {
      await ctx.db.patch(membership._id, {
        requestState: "declined",
        requestRespondedAt: now,
        leftAt: now,
      });
      return { ok: true };
    }

    // response === "block"
    const inviterId = membership.invitedById;
    if (!inviterId) {
      throw new Error("Cannot block: inviter unknown");
    }

    await ctx.db.patch(membership._id, {
      requestState: "declined",
      requestRespondedAt: now,
      leftAt: now,
    });

    // Idempotent block insert.
    const existingBlock = await ctx.db
      .query("chatUserBlocks")
      .withIndex("by_blocker_blocked", (q) =>
        q.eq("blockerId", userId).eq("blockedId", inviterId),
      )
      .first();
    if (!existingBlock) {
      await ctx.db.insert("chatUserBlocks", {
        blockerId: userId,
        blockedId: inviterId,
        createdAt: now,
        reason: args.reportReason,
      });
    }

    await ctx.db.insert("chatUserFlags", {
      userId: inviterId,
      reportedById: userId,
      channelId: args.channelId,
      reason: args.reportReason ?? "other",
      status: "pending",
      createdAt: now,
    });

    return { ok: true };
  },
});

// ============================================================================
// Queries
// ============================================================================

/**
 * List the caller's pending chat requests (DMs and group_dms where the caller's
 * `requestState === "pending"`). Returns enough metadata to render an inbox row:
 * inviter info, shared-community attribution, member count, and a first-message
 * preview. Sorted most-recent-invite first. Returns an empty array when there
 * are no pending requests — never throws on empty.
 */
export const listChatRequests = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const pendingRows = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_user_requestState", (q) =>
        q.eq("userId", userId).eq("requestState", "pending"),
      )
      .collect();

    // Pre-fetch caller's communities for shared-community resolution.
    const callerMemberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const callerCommunityIds = new Set(
      callerMemberships
        .filter((m) => m.status !== 3)
        .map((m) => m.communityId),
    );

    const results: Array<{
      channelId: Id<"chatChannels">;
      channelType: "dm" | "group_dm";
      channelName: string;
      inviterUserId: Id<"users">;
      inviterDisplayName: string;
      inviterProfilePhoto: string | null;
      sharedCommunityNames: string[];
      memberCount: number;
      firstMessagePreview: string | null;
      firstMessageSenderName: string | null;
      invitedAt: number;
    }> = [];

    for (const row of pendingRows) {
      if (row.leftAt !== undefined) continue;
      const channel = await ctx.db.get(row.channelId);
      if (!channel || !channel.isAdHoc || channel.isArchived) continue;
      if (!row.invitedById) continue;
      const inviter = await ctx.db.get(row.invitedById);
      if (!inviter) continue;

      // Shared communities = (channel community ∪ inviter communities) ∩ caller communities.
      const inviterMemberships = await ctx.db
        .query("userCommunities")
        .withIndex("by_user", (q) => q.eq("userId", row.invitedById!))
        .collect();
      const inviterActive = inviterMemberships
        .filter((m) => m.status !== 3)
        .map((m) => m.communityId);
      const sharedIds: Id<"communities">[] = [];
      for (const cId of inviterActive) {
        if (callerCommunityIds.has(cId)) sharedIds.push(cId);
      }
      // Always surface the channel's community first if it's shared with the caller.
      if (channel.communityId && callerCommunityIds.has(channel.communityId)) {
        sharedIds.sort((a, b) => {
          if (a === channel.communityId) return -1;
          if (b === channel.communityId) return 1;
          return 0;
        });
      }
      const sharedCommunityNames: string[] = [];
      for (const cId of sharedIds.slice(0, 2)) {
        const community = await ctx.db.get(cId);
        if (community?.name) sharedCommunityNames.push(community.name);
      }

      // First non-deleted message preview.
      const firstMessage = await ctx.db
        .query("chatMessages")
        .withIndex("by_channel_createdAt", (q) =>
          q.eq("channelId", channel._id),
        )
        .order("asc")
        .filter((q) => q.eq(q.field("isDeleted"), false))
        .first();

      const channelType = channel.channelType as "dm" | "group_dm";
      results.push({
        channelId: channel._id,
        channelType,
        channelName: channel.name,
        inviterUserId: inviter._id,
        inviterDisplayName: getDisplayName(inviter.firstName, inviter.lastName),
        inviterProfilePhoto: getMediaUrl(inviter.profilePhoto) ?? null,
        sharedCommunityNames,
        memberCount: channel.memberCount,
        firstMessagePreview: firstMessage?.content ?? null,
        firstMessageSenderName: firstMessage?.senderName ?? null,
        invitedAt: row.joinedAt,
      });
    }

    // Most recent invites first.
    results.sort((a, b) => b.invitedAt - a.invitedAt);
    return results;
  },
});

/**
 * Search users the caller could start a DM/group chat with: members of any
 * community the caller belongs to. Filters out the caller, blocked users
 * (either direction), and any explicitly excluded IDs. Empty `query` returns
 * up to `limit` candidates from the caller's communities. Capped at 50.
 */
export const searchUsersInSharedCommunities = query({
  args: {
    token: v.string(),
    query: v.string(),
    excludeUserIds: v.optional(v.array(v.id("users"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);

    const limit = Math.min(
      Math.max(args.limit ?? DEFAULT_SEARCH_LIMIT, 1),
      MAX_SEARCH_LIMIT,
    );
    const excludeIds = new Set<Id<"users">>(args.excludeUserIds ?? []);
    excludeIds.add(callerId);
    const trimmedQuery = args.query.trim().toLowerCase();

    // Caller's communities.
    const callerMemberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_user", (q) => q.eq("userId", callerId))
      .collect();
    const callerCommunityIds = callerMemberships
      .filter((m) => m.status !== 3)
      .map((m) => m.communityId);
    if (callerCommunityIds.length === 0) {
      return [];
    }

    // Collect candidate user IDs and the community-IDs they share with the caller.
    const sharedByUser = new Map<Id<"users">, Set<Id<"communities">>>();
    for (const communityId of callerCommunityIds) {
      const memberships = await ctx.db
        .query("userCommunities")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .filter((q) => q.neq(q.field("status"), 3))
        .take(2000);
      for (const m of memberships) {
        if (excludeIds.has(m.userId)) continue;
        let set = sharedByUser.get(m.userId);
        if (!set) {
          set = new Set();
          sharedByUser.set(m.userId, set);
        }
        set.add(communityId);
      }
    }

    if (sharedByUser.size === 0) {
      return [];
    }

    // Resolve user docs, filter by name match, and filter out blocks.
    type Candidate = {
      user: NonNullable<Awaited<ReturnType<typeof ctx.db.get<"users">>>>;
      sharedCommunityIds: Id<"communities">[];
      isFullNameMatch: boolean;
    };
    const candidates: Candidate[] = [];
    for (const [candidateId, sharedSet] of sharedByUser) {
      if (candidates.length >= limit * 4) break; // bound work; we'll filter & cap later
      const user = await ctx.db.get(candidateId);
      if (!user) continue;

      const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`
        .trim()
        .toLowerCase();
      const searchText = (user.searchText ?? "").toLowerCase();

      let isFullNameMatch = false;
      if (trimmedQuery.length > 0) {
        if (fullName.includes(trimmedQuery)) {
          isFullNameMatch = true;
        } else if (!searchText.includes(trimmedQuery)) {
          continue;
        }
      }

      if (await isBlockedEitherDirection(ctx, callerId, user._id)) {
        continue;
      }

      candidates.push({
        user,
        sharedCommunityIds: Array.from(sharedSet),
        isFullNameMatch,
      });
    }

    // Sort: full-name matches first, then alphabetical by last/first.
    candidates.sort((a, b) => {
      if (a.isFullNameMatch !== b.isFullNameMatch) {
        return a.isFullNameMatch ? -1 : 1;
      }
      const aName = `${a.user.lastName ?? ""} ${a.user.firstName ?? ""}`
        .trim()
        .toLowerCase();
      const bName = `${b.user.lastName ?? ""} ${b.user.firstName ?? ""}`
        .trim()
        .toLowerCase();
      return aName.localeCompare(bName);
    });

    const capped = candidates.slice(0, limit);

    // Resolve shared community names.
    const allCommunityIds = new Set<Id<"communities">>();
    for (const c of capped) {
      for (const cId of c.sharedCommunityIds) allCommunityIds.add(cId);
    }
    const communityNameById = new Map<Id<"communities">, string>();
    for (const cId of allCommunityIds) {
      const community = await ctx.db.get(cId);
      if (community?.name) communityNameById.set(cId, community.name);
    }

    return capped.map((c) => ({
      userId: c.user._id,
      displayName: getDisplayName(c.user.firstName, c.user.lastName),
      profilePhoto: getMediaUrl(c.user.profilePhoto) ?? null,
      sharedCommunityNames: c.sharedCommunityIds
        .map((cId) => communityNameById.get(cId))
        .filter((n): n is string => Boolean(n)),
    }));
  },
});

/**
 * List the caller's accepted ad-hoc channels (DMs and group_dms). Powers the
 * "Direct messages" section of the inbox. Does NOT include pending requests —
 * those are surfaced separately by `listChatRequests`. Sorted most-recent
 * activity first.
 */
export const getDirectInbox = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const acceptedRows = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_user_requestState", (q) =>
        q.eq("userId", userId).eq("requestState", "accepted"),
      )
      .collect();

    const results: Array<{
      channelId: Id<"chatChannels">;
      channelType: "dm" | "group_dm";
      channelName: string;
      memberCount: number;
      otherMembers: Array<{
        userId: Id<"users">;
        displayName: string;
        profilePhoto: string | null;
      }>;
      lastMessageAt: number | null;
      lastMessagePreview: string | null;
      lastMessageSenderName: string | null;
      unreadCount: number;
      isMuted: boolean;
    }> = [];

    for (const row of acceptedRows) {
      if (row.leftAt !== undefined) continue;
      const channel = await ctx.db.get(row.channelId);
      if (!channel || !channel.isAdHoc || channel.isArchived) continue;

      const channelType = channel.channelType as "dm" | "group_dm";

      // Other accepted/pending members for display (creator may still be
      // surfacing the chat to a recipient who hasn't responded — that recipient
      // shows in the member list with their pending state, but for inbox
      // display we only need name+photo).
      const otherMemberRows = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .collect();
      const otherMembers = otherMemberRows
        .filter((m) => m.userId !== userId)
        .map((m) => ({
          userId: m.userId,
          displayName: m.displayName ?? "",
          profilePhoto: getMediaUrl(m.profilePhoto) ?? null,
        }));

      // Read state → unread count.
      const readState = await ctx.db
        .query("chatReadState")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channel._id).eq("userId", userId),
        )
        .first();
      const unreadCount = readState?.unreadCount ?? 0;

      results.push({
        channelId: channel._id,
        channelType,
        channelName: channel.name,
        memberCount: channel.memberCount,
        otherMembers,
        lastMessageAt: channel.lastMessageAt ?? null,
        lastMessagePreview: channel.lastMessagePreview ?? null,
        lastMessageSenderName: channel.lastMessageSenderName ?? null,
        unreadCount,
        isMuted: row.isMuted,
      });
    }

    results.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
    return results;
  },
});

// ============================================================================
// Cron handlers
// ============================================================================

/**
 * Daily cron: expire pending chat requests older than 30 days.
 *
 * Sets `requestState: "declined"` and `leftAt: now` on stale `pending` rows so
 * the recipient's inbox is cleaned up. The inviter is never notified (silent
 * decline matches the on-demand decline behavior). Bounded by an explicit
 * cutoff plus a `take()` cap so a backlog doesn't blow the per-mutation budget.
 */
export const expireOldChatRequests = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const PENDING_REQUEST_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const MAX_PER_RUN = 500;
    const cutoff = now - PENDING_REQUEST_TTL_MS;

    const candidates = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_requestState_joinedAt", (q) =>
        q.eq("requestState", "pending").lt("joinedAt", cutoff),
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .take(MAX_PER_RUN);

    let expired = 0;
    for (const row of candidates) {
      await ctx.db.patch(row._id, {
        requestState: "declined",
        requestRespondedAt: now,
        leftAt: now,
      });
      expired++;
    }
    return { expired };
  },
});

/**
 * Hourly cron: delete `directMessageRateLimits` rows older than 24h.
 *
 * Pending-pair rate-limit rows have a 24h window. Old rows have no further
 * effect, but accumulating them would waste storage and slow scans. Bounded
 * per-run for the same reasons as `expireOldChatRequests`.
 */
export const cleanupOldDmRateLimits = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const RATE_LIMIT_TTL_MS = 24 * 60 * 60 * 1000;
    const MAX_PER_RUN = 1000;
    const cutoff = now - RATE_LIMIT_TTL_MS;

    const stale = await ctx.db
      .query("directMessageRateLimits")
      .withIndex("by_windowStartedAt", (q) => q.lt("windowStartedAt", cutoff))
      .take(MAX_PER_RUN);

    let deleted = 0;
    for (const row of stale) {
      await ctx.db.delete(row._id);
      deleted++;
    }
    return { deleted };
  },
});
