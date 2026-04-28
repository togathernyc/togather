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
import { getDisplayName, getMediaUrl, normalizePhone } from "../../lib/utils";

// ============================================================================
// Constants
// ============================================================================

/** Max number of recipients in a `group_dm` (creator excluded). Total cap is 20. */
const MAX_GROUP_DM_RECIPIENTS = 19;
/** Hard cap on total members in an ad-hoc group_dm (including creator). */
const MAX_GROUP_DM_TOTAL = 20;
/** Cap on group chat name length. */
const MAX_GROUP_NAME_LENGTH = 100;
/** Cap on rename length for ad-hoc group_dm channels (shorter than create cap to keep titles tight). */
const MAX_GROUP_DM_RENAME_LENGTH = 60;
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
 * Re-activate an ad-hoc channel member row that had previously left as
 * an accepted member (e.g. via `leaveAdHocChannel`). Used by
 * `createOrGetDirectChannel` so a user who left a 1:1 DM and then restarts
 * the conversation gets back into the channel — without this, their row
 * keeps `leftAt` set and downstream calls (`markAsRead`, `sendMessage`)
 * reject "Not a member of this channel".
 *
 * IMPORTANT — only reactivates rows whose previous `requestState` was
 * `"accepted"`. Declined rows (which `respondToChatRequest` stores as
 * `leftAt` + `requestState: "declined"`) and pending rows are NEVER
 * touched, because flipping them back to active would silently undo a
 * deliberate user choice (decline / block / pending awaiting accept) via a
 * normal "Message" entry point. Re-engaging after a decline must go
 * through the explicit accept path.
 *
 * Returns true when the row was reactivated so callers can adjust
 * memberCount.
 */
async function reactivateAdHocMembership(
  ctx: { db: { query: any; patch: any } },
  channelId: Id<"chatChannels">,
  userId: Id<"users">,
): Promise<boolean> {
  const row = await ctx.db
    .query("chatChannelMembers")
    .withIndex("by_channel_user", (q: any) =>
      q.eq("channelId", channelId).eq("userId", userId),
    )
    .first();
  if (!row) return false;
  // Only restore left-as-accepted rows. Declined / pending stay as-is.
  if (row.leftAt === undefined || row.requestState !== "accepted") return false;
  await ctx.db.patch(row._id, {
    leftAt: undefined,
    requestRespondedAt: Date.now(),
  });
  return true;
}

/**
 * Compute the deterministic dedup key for a 1:1 DM channel within a community.
 *
 * DMs are scoped per-community (Slack-workspace model): if Alice and Bob share
 * Community 1 and Community 2, they get a separate DM thread in each. The
 * communityId is folded into the dedup key so the lookup matches the visibility
 * boundary — without it, a DM created in Community 1 would surface to the same
 * user pair when one of them switches to Community 2's inbox.
 */
function computeDmPairKey(
  communityId: Id<"communities">,
  a: Id<"users">,
  b: Id<"users">,
): string {
  return `${communityId}::${[a, b].sort().join("::")}`;
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

const isActiveMembership = (status: number | undefined) => status !== 3;

/**
 * Hard requirement: chats are restricted to people who have a profile photo.
 *
 * Throws `PROFILE_PHOTO_REQUIRED` if `userId` lacks one. Caller-side; if the
 * gate needs to surface a specific recipient userId, the caller throws
 * `RECIPIENT_PROFILE_PHOTO_REQUIRED:<userId>` instead so the frontend can
 * format a per-user prompt.
 */
async function requireProfilePhoto(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<void> {
  const user = await ctx.db.get(userId);
  if (!user?.profilePhoto || user.profilePhoto.trim() === "") {
    throw new Error("PROFILE_PHOTO_REQUIRED");
  }
}

/**
 * Return true iff `userId` is an active member of `communityId`.
 * Active = `userCommunities.status !== 3` (3 means deactivated).
 */
async function isCommunityMember(
  ctx: QueryCtx,
  userId: Id<"users">,
  communityId: Id<"communities">,
): Promise<boolean> {
  const membership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q) =>
      q.eq("userId", userId).eq("communityId", communityId),
    )
    .first();
  return membership ? isActiveMembership(membership.status) : false;
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
 *   - Either user is not an active member of `communityId`
 *   - Either party has blocked the other
 *   - Caller has already initiated 5 new pending DMs in the last 24h
 *
 * DMs are scoped per-community. The same user pair sharing two communities
 * gets two distinct DM threads — one per community — by design (Slack-style
 * isolation). The channel's `communityId` is the boundary the inbox query
 * filters by, so a thread created in Community A never surfaces while the
 * caller is viewing Community B.
 */
export const createOrGetDirectChannel = mutation({
  args: {
    token: v.string(),
    recipientUserId: v.id("users"),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args): Promise<{ channelId: Id<"chatChannels">; isNew: boolean }> => {
    const senderId = await requireAuth(ctx, args.token);

    if (senderId === args.recipientUserId) {
      throw new Error("Cannot DM yourself");
    }

    const dmPairKey = computeDmPairKey(
      args.communityId,
      senderId,
      args.recipientUserId,
    );

    // Existing channel? Re-activate the caller's membership if they've left
    // and return the channelId. The caller has explicitly chosen to restart
    // the conversation, so a stale `leftAt` row would just produce a "Not a
    // member of this channel" error on every read/write. Re-activating is
    // idempotent for never-left rows.
    const existing = await ctx.db
      .query("chatChannels")
      .withIndex("by_dmPairKey", (q) => q.eq("dmPairKey", dmPairKey))
      .first();
    if (existing) {
      const reactivated = await reactivateAdHocMembership(
        ctx,
        existing._id,
        senderId,
      );
      // When reactivation actually flipped a `leftAt`-set row, also restore
      // memberCount (`leaveAdHocChannel` decrements it on departure). If we
      // skipped this, a 1:1 DM after leave→restart would persistently report
      // memberCount=1, drifting metadata in inbox surfaces.
      // If the channel was archived (e.g. via `leaveAdHocChannel` when the
      // caller was the last active member), unarchive it now that the
      // caller is rejoining — otherwise `getDirectInbox` would still hide
      // the thread and the user would only reach it via direct nav.
      const patches: Record<string, unknown> = {};
      if (reactivated) {
        patches.memberCount = (existing.memberCount ?? 0) + 1;
      }
      if (existing.isArchived) {
        patches.isArchived = false;
        patches.archivedAt = undefined;
      }
      if (Object.keys(patches).length > 0) {
        patches.updatedAt = Date.now();
        await ctx.db.patch(existing._id, patches);
      }
      return { channelId: existing._id, isNew: false };
    }

    // Both users must be active members of THIS specific community.
    const [senderIn, recipientIn] = await Promise.all([
      isCommunityMember(ctx, senderId, args.communityId),
      isCommunityMember(ctx, args.recipientUserId, args.communityId),
    ]);
    if (!senderIn || !recipientIn) {
      throw new Error("You can only message members of this community");
    }

    // Verify neither party has blocked the other (generic error — don't leak who).
    if (await isBlockedEitherDirection(ctx, senderId, args.recipientUserId)) {
      throw new Error("Cannot start chat");
    }

    // Profile photo gate: caller must have one. Recipients are NOT gated at
    // create time — they can be invited without a photo and the request flow
    // proceeds. The accept path in `respondToChatRequest` enforces the photo
    // requirement before the recipient can read messages or reply, which is
    // when it actually matters that everyone in the conversation has a face.
    await requireProfilePhoto(ctx, senderId);
    const recipientUser = await ctx.db.get(args.recipientUserId);
    if (!recipientUser) {
      throw new Error("Recipient not found");
    }

    // Rate-limit new pending DM requests.
    await checkRateLimit(
      ctx,
      `dm-init:${senderId}`,
      NEW_REQUEST_LIMIT,
      NEW_REQUEST_WINDOW_MS,
    );

    const recipient = recipientUser;
    const sender = await ctx.db.get(senderId);
    if (!sender) {
      throw new Error("Sender not found");
    }

    const now = Date.now();
    const channelId = await ctx.db.insert("chatChannels", {
      communityId: args.communityId,
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
 * Channel `communityId` is the community the caller is currently viewing —
 * the same community-scoping rule as 1:1 DMs (Slack-workspace model).
 *
 * Group chats are NOT deduped — two calls with the same recipient set produce
 * two distinct channels.
 *
 * Rejects if:
 *   - Recipient list (after de-dupe) is empty or > 19
 *   - Any recipient is not an active member of `communityId`
 *   - Any recipient is blocked-with or has blocked the creator
 *   - Caller has already initiated 5 new pending requests in the last 24h
 */
export const createGroupChat = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
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

    // Creator + every recipient must be an active member of this community.
    // Generic error message — we don't enumerate which recipients failed
    // (avoid leaking community-membership details).
    const creatorIn = await isCommunityMember(ctx, creatorId, args.communityId);
    if (!creatorIn) {
      throw new Error("You can only message members of this community");
    }
    const recipientMembershipChecks = await Promise.all(
      uniqueRecipients.map((id) =>
        isCommunityMember(ctx, id, args.communityId),
      ),
    );
    if (recipientMembershipChecks.some((ok) => !ok)) {
      throw new Error("You can only message members of this community");
    }

    // Block-check every recipient. Generic message; do not enumerate.
    const blockedChecks = await Promise.all(
      uniqueRecipients.map((id) => isBlockedEitherDirection(ctx, creatorId, id)),
    );
    if (blockedChecks.some((b) => b)) {
      throw new Error("Cannot include some users in this chat");
    }

    // Profile photo gate: creator must have one. Recipients are NOT gated at
    // create time — they can be invited without a photo and the request flow
    // proceeds. The accept path in `respondToChatRequest` enforces the photo
    // requirement before the recipient can read messages or reply.
    await requireProfilePhoto(ctx, creatorId);
    const recipientDocs = await Promise.all(
      uniqueRecipients.map((id) => ctx.db.get(id)),
    );
    if (recipientDocs.some((u) => !u)) {
      throw new Error("One or more recipients not found");
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
    const recipients = recipientDocs;

    const now = Date.now();
    const trimmedName = (args.name ?? "").trim().slice(0, MAX_GROUP_NAME_LENGTH);

    const channelId = await ctx.db.insert("chatChannels", {
      communityId: args.communityId,
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
      // Profile photo gate: accepting a chat is treated as opting in to the
      // DM/group surface. Require the responder to have a profile photo so
      // every accepted member of every ad-hoc channel has one.
      await requireProfilePhoto(ctx, userId);
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

/**
 * Rename an ad-hoc `group_dm` channel.
 *
 * Authorization: any accepted member can rename. 1:1 `dm` channels can NOT
 * be renamed (their display name is auto-derived from the other member);
 * a rename attempt on a `dm` is rejected. Trims whitespace and caps to
 * `MAX_GROUP_DM_RENAME_LENGTH`. Rejects blank names for `group_dm`.
 */
export const renameAdHocChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    name: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const userId = await requireAuth(ctx, args.token);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }
    if (!channel.isAdHoc) {
      throw new Error("Only ad-hoc chats can be renamed");
    }
    // 1:1 DMs derive their display label from the other member; renaming
    // would silently lie about who's on the other side.
    if (channel.channelType === "dm") {
      throw new Error("1:1 chats cannot be renamed");
    }
    if (channel.channelType !== "group_dm") {
      throw new Error("Only group chats can be renamed");
    }

    const membership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId),
      )
      .first();
    if (
      !membership ||
      membership.leftAt !== undefined ||
      membership.requestState !== "accepted"
    ) {
      throw new Error("Not a member of this channel");
    }

    const trimmed = args.name.trim().slice(0, MAX_GROUP_DM_RENAME_LENGTH);
    if (trimmed.length === 0) {
      throw new Error("Group chat name cannot be blank");
    }

    await ctx.db.patch(args.channelId, {
      name: trimmed,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Add new members to an existing ad-hoc channel.
 *
 * Only accepted members may add. New members start in `requestState: "pending"`
 * with `invitedById` = caller, mirroring `createGroupChat`. Existing members
 * (active or pending) are skipped silently — the call is idempotent. Caps the
 * total accepted+pending member count at `MAX_GROUP_DM_TOTAL` (20).
 *
 * Re-validates the per-community-member invariant for every new userId so
 * that ad-hoc channels can't grow to include strangers from other communities.
 * Profile-photo gate applies to each new invitee for parity with create.
 */
export const addAdHocMembers = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    userIds: v.array(v.id("users")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ added: number; skipped: number }> => {
    const callerId = await requireAuth(ctx, args.token);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }
    if (!channel.isAdHoc) {
      throw new Error("Only ad-hoc chats support adding members");
    }
    // Adding to a 1:1 DM would convert it to a group; require an explicit
    // group_dm channel for that flow.
    if (channel.channelType !== "group_dm") {
      throw new Error("Only group chats support adding members");
    }
    if (!channel.communityId) {
      throw new Error("Channel has no community context");
    }

    const callerMembership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", callerId),
      )
      .first();
    if (
      !callerMembership ||
      callerMembership.leftAt !== undefined ||
      callerMembership.requestState !== "accepted"
    ) {
      throw new Error("Not a member of this channel");
    }

    // De-dupe + drop the caller (can't re-invite yourself).
    const uniqueUserIds = Array.from(
      new Set(args.userIds.filter((id) => id !== callerId)),
    );
    if (uniqueUserIds.length === 0) {
      return { added: 0, skipped: 0 };
    }

    // Existing channel members (active rows). Used for idempotency + cap.
    const existingMembers = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();
    const existingUserIds = new Set(existingMembers.map((m) => m.userId));

    let skipped = 0;
    let added = 0;
    const now = Date.now();

    for (const newUserId of uniqueUserIds) {
      if (existingUserIds.has(newUserId)) {
        skipped++;
        continue;
      }

      // Cap total members (existing + freshly added so far) at 20.
      if (existingMembers.length + added + 1 > MAX_GROUP_DM_TOTAL) {
        throw new Error(
          `Group chat can include at most ${MAX_GROUP_DM_TOTAL} members`,
        );
      }

      // Per-community-member invariant: every new addition must be an active
      // member of the channel's community.
      const inCommunity = await isCommunityMember(
        ctx,
        newUserId,
        channel.communityId,
      );
      if (!inCommunity) {
        throw new Error("You can only add members of this community");
      }

      // Block-check both directions.
      if (await isBlockedEitherDirection(ctx, callerId, newUserId)) {
        throw new Error("Cannot add some users to this chat");
      }

      const newUser = await ctx.db.get(newUserId);
      if (!newUser) {
        throw new Error("User not found");
      }
      // Profile photo is enforced at accept-time (respondToChatRequest), not
      // at invite-time. New invitees can be added without a photo and will be
      // prompted to add one before they can read or reply in the chat.

      await ctx.db.insert("chatChannelMembers", {
        channelId: args.channelId,
        userId: newUserId,
        role: "member",
        joinedAt: now,
        isMuted: false,
        requestState: "pending",
        invitedById: callerId,
        displayName: getDisplayName(newUser.firstName, newUser.lastName),
        profilePhoto: newUser.profilePhoto,
      });
      added++;
    }

    if (added > 0) {
      await ctx.db.patch(args.channelId, {
        memberCount: (channel.memberCount ?? existingMembers.length) + added,
        updatedAt: now,
      });
    }

    return { added, skipped };
  },
});

/**
 * Find the original inviter of an ad-hoc channel: the earliest accepted member
 * by `joinedAt` who has no `invitedById` (i.e. the channel creator). Falls back
 * to the channel's `createdById` when the row can't be found.
 */
async function getAdHocInviter(
  ctx: QueryCtx,
  channelId: Id<"chatChannels">,
): Promise<Id<"users"> | null> {
  const members = await ctx.db
    .query("chatChannelMembers")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .collect();
  const accepted = members
    .filter((m) => m.requestState === "accepted" && !m.invitedById)
    .sort((a, b) => a.joinedAt - b.joinedAt);
  if (accepted.length > 0) return accepted[0]!.userId;

  const channel = await ctx.db.get(channelId);
  return channel?.createdById ?? null;
}

/**
 * Remove a member from an ad-hoc channel.
 *
 * Authorization:
 *   - A user can always pass their own `userId` to leave.
 *   - Otherwise, only the original inviter (channel creator) can remove others.
 *
 * Soft-deletes via `chatChannelMembers.leftAt` rather than deleting the row,
 * matching the same pattern used by `respondToChatRequest` decline + the
 * `expireOldChatRequests` cron.
 */
export const removeAdHocMember = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const callerId = await requireAuth(ctx, args.token);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }
    if (!channel.isAdHoc) {
      throw new Error("Only ad-hoc chats support removing members");
    }

    // Self-remove is always allowed; otherwise require inviter privileges
    // AND that the caller is still an active accepted member of the channel.
    // Without the active-membership gate, a creator who has already left
    // (leftAt set) could keep ejecting members from outside the chat.
    const isSelf = args.userId === callerId;
    if (!isSelf) {
      const inviterId = await getAdHocInviter(ctx, args.channelId);
      if (!inviterId || inviterId !== callerId) {
        throw new Error("Only the chat creator can remove other members");
      }
      const callerMembership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", args.channelId).eq("userId", callerId),
        )
        .first();
      if (
        !callerMembership ||
        callerMembership.leftAt !== undefined ||
        callerMembership.requestState !== "accepted"
      ) {
        throw new Error("Only an active member can remove other members");
      }
    }

    const target = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", args.userId),
      )
      .first();
    if (!target || target.leftAt !== undefined) {
      // Idempotent: already gone.
      return { ok: true };
    }

    const now = Date.now();
    await ctx.db.patch(target._id, { leftAt: now });

    // Decrement member count; cap at 0 to avoid negative due to drift.
    const newCount = Math.max(0, (channel.memberCount ?? 1) - 1);
    await ctx.db.patch(args.channelId, {
      memberCount: newCount,
      updatedAt: now,
    });

    return { ok: true };
  },
});

/**
 * Convenience wrapper: caller leaves the channel. If the caller is the last
 * accepted member, the channel is archived (soft-closed) so it stops surfacing
 * in anyone's inbox.
 */
export const leaveAdHocChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const callerId = await requireAuth(ctx, args.token);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }
    if (!channel.isAdHoc) {
      throw new Error("Only ad-hoc chats support leaving");
    }

    const membership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", callerId),
      )
      .first();
    if (!membership || membership.leftAt !== undefined) {
      // Idempotent: already gone.
      return { ok: true };
    }

    const now = Date.now();
    await ctx.db.patch(membership._id, { leftAt: now });

    const newCount = Math.max(0, (channel.memberCount ?? 1) - 1);
    await ctx.db.patch(args.channelId, {
      memberCount: newCount,
      updatedAt: now,
    });

    // If the leaver was the last active accepted member, archive the channel.
    const remainingAccepted = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();
    const stillAccepted = remainingAccepted.filter(
      (m) => m.requestState === "accepted",
    );
    if (stillAccepted.length === 0) {
      await ctx.db.patch(args.channelId, {
        isArchived: true,
        archivedAt: now,
      });
    }

    return { ok: true };
  },
});

// ============================================================================
// Queries
// ============================================================================

/**
 * List the caller's pending chat requests in a specific community (DMs and
 * group_dms where the caller's `requestState === "pending"` and the channel's
 * `communityId === args.communityId`). Returns enough metadata to render an
 * inbox row: inviter info, the channel's community name (single, since the
 * thread is community-scoped), member count, and a first-message preview.
 * Sorted most-recent-invite first. Returns an empty array when there are no
 * pending requests — never throws on empty.
 */
export const listChatRequests = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const pendingRows = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_user_requestState", (q) =>
        q.eq("userId", userId).eq("requestState", "pending"),
      )
      .collect();

    // Resolve the community name once — every request in this list belongs to
    // it (thread is community-scoped) so the attribution is identical per row.
    const community = await ctx.db.get(args.communityId);
    const communityName = community?.name ?? "";

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
      // Strict community-scoping: channels in other communities don't appear
      // in this community's request inbox even though the membership row
      // belongs to the caller (the very leak this fix addresses).
      if (channel.communityId !== args.communityId) continue;
      if (!row.invitedById) continue;
      const inviter = await ctx.db.get(row.invitedById);
      if (!inviter) continue;

      // First non-deleted message preview. Hide requests with no message
      // — a channel created via createOrGetDirectChannel where the sender
      // never typed a first message is clutter in the recipient's inbox.
      const firstMessage = await ctx.db
        .query("chatMessages")
        .withIndex("by_channel_createdAt", (q) =>
          q.eq("channelId", channel._id),
        )
        .order("asc")
        .filter((q) => q.eq(q.field("isDeleted"), false))
        .first();
      if (!firstMessage) continue;

      const channelType = channel.channelType as "dm" | "group_dm";
      const inviterName = getDisplayName(inviter.firstName, inviter.lastName);
      results.push({
        channelId: channel._id,
        channelType,
        channelName: channel.name,
        inviterUserId: inviter._id,
        inviterDisplayName: inviterName.trim().length > 0 ? inviterName : "Someone",
        inviterProfilePhoto: getMediaUrl(inviter.profilePhoto) ?? null,
        sharedCommunityNames: communityName ? [communityName] : [],
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
    /**
     * Community to search within. Search is strictly scoped — users in the
     * caller's other communities are NOT included even when the same caller
     * could DM them from those other communities. This keeps the picker
     * aligned with the inbox the caller is currently viewing.
     */
    communityId: v.id("communities"),
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
    const trimmedQuery = args.query.trim();

    // Caller must themselves be an active member of this community.
    const callerIn = await isCommunityMember(ctx, callerId, args.communityId);
    if (!callerIn) return [];

    if (trimmedQuery.length === 0) return [];

    const community = await ctx.db.get(args.communityId);
    const communityName = community?.name ?? "";

    // Use the `search_users` full-text index instead of scanning every
    // community member. The index is GLOBAL (not community-scoped), so we
    // pull a generous batch of top-ranked hits and post-filter to the
    // current community below. The cap mirrors the admin search (500) so
    // common terms don't get truncated by users outside the current
    // community dominating the top hits — without this, valid in-community
    // matches could be dropped and the picker would return too few
    // results in larger deployments.
    const searchHits = await ctx.db
      .query("users")
      .withSearchIndex("search_users", (q) =>
        q.search("searchText", trimmedQuery),
      )
      .take(500);

    // Phone-number match: full-text search struggles with formatted phone
    // numbers (parens, dashes), so do a separate phone scan over community
    // members when the query is digit-heavy. Mirrors the admin search.
    const normalizedPhone = normalizePhone(trimmedQuery).replace(/\D/g, "");
    let phoneHits: typeof searchHits = [];
    if (normalizedPhone.length >= 4) {
      const memberships = await ctx.db
        .query("userCommunities")
        .withIndex("by_community", (q) =>
          q.eq("communityId", args.communityId),
        )
        .filter((q) => q.neq(q.field("status"), 3))
        .take(2000);
      const phoneCandidates = await Promise.all(
        memberships.map((m) => ctx.db.get(m.userId)),
      );
      phoneHits = phoneCandidates.filter(
        (u): u is NonNullable<typeof u> =>
          !!u && !!u.phone && u.phone.includes(normalizedPhone),
      );
    }

    // Merge by userId.
    const seen = new Set<Id<"users">>();
    const merged = [...searchHits, ...phoneHits].filter((u) => {
      if (seen.has(u._id)) return false;
      seen.add(u._id);
      return true;
    });

    // Confirm community membership for each search hit (the search index is
    // global — restrict the returned set to this community).
    const membershipChecks = await Promise.all(
      merged.map((u) =>
        ctx.db
          .query("userCommunities")
          .withIndex("by_user_community", (q) =>
            q.eq("userId", u._id).eq("communityId", args.communityId),
          )
          .first(),
      ),
    );

    const blockChecks = await Promise.all(
      merged.map((u) => isBlockedEitherDirection(ctx, callerId, u._id)),
    );

    type Candidate = {
      user: NonNullable<Awaited<ReturnType<typeof ctx.db.get<"users">>>>;
      isFullNameMatch: boolean;
    };
    const candidates: Candidate[] = [];
    const lower = trimmedQuery.toLowerCase();
    for (let i = 0; i < merged.length; i++) {
      const user = merged[i]!;
      if (excludeIds.has(user._id)) continue;
      const membership = membershipChecks[i];
      if (!membership || membership.status === 3) continue;
      if (blockChecks[i]) continue;

      const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`
        .trim()
        .toLowerCase();
      const isFullNameMatch = lower.length > 0 && fullName.includes(lower);
      candidates.push({ user, isFullNameMatch });
    }

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

    return candidates.slice(0, limit).map((c) => ({
      userId: c.user._id,
      displayName: getDisplayName(c.user.firstName, c.user.lastName),
      profilePhoto: getMediaUrl(c.user.profilePhoto) ?? null,
      sharedCommunityNames: communityName ? [communityName] : [],
    }));
  },
});

/**
 * List the caller's accepted ad-hoc channels (DMs and group_dms) within a
 * specific community. Powers the "Direct messages" section of the inbox.
 *
 * Strictly community-scoped: a thread the caller has in another community
 * does not appear here. Switching the community context shows that
 * community's threads. Pending requests are surfaced separately by
 * `listChatRequests`. Sorted most-recent activity first.
 */
/**
 * Tight per-channel query that returns just the metadata the chat-room
 * header and chat-info screen need. Use this instead of `getDirectInbox`
 * when you only care about ONE channel — `getDirectInbox` re-fires on every
 * change to ANY of the caller's DM channels, which produces unnecessary
 * re-renders (and was implicated in a "Maximum update depth exceeded"
 * crash that fired right after sending a message in a DM).
 *
 * Returns null when the caller has no active membership in the channel,
 * so the UI can render the loading / not-found state cleanly.
 */
export const getAdHocChannelMembers = query({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    channelType: "dm" | "group_dm";
    channelName: string;
    memberCount: number;
    otherMembers: Array<{
      userId: Id<"users">;
      displayName: string;
      profilePhoto: string | null;
    }>;
  } | null> => {
    const userId = await requireAuth(ctx, args.token);
    const channel = await ctx.db.get(args.channelId);
    if (
      !channel ||
      !channel.isAdHoc ||
      (channel.channelType !== "dm" && channel.channelType !== "group_dm")
    ) {
      return null;
    }

    const callerRow = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId),
      )
      .first();
    if (!callerRow || callerRow.leftAt !== undefined) {
      return null;
    }

    const memberRows = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    const others = memberRows.filter((m) => m.userId !== userId);
    // Resolve profilePhoto + displayName from each user doc — denormalized
    // values on the member row may be stale when the user updates their
    // profile, so prefer the live user record.
    const otherUsers = await Promise.all(
      others.map((m) => ctx.db.get(m.userId)),
    );
    const otherMembers = others
      .map((m, i) => {
        const u = otherUsers[i];
        if (!u) return null;
        return {
          userId: m.userId,
          displayName:
            getDisplayName(u.firstName, u.lastName) ||
            m.displayName ||
            "Member",
          profilePhoto: getMediaUrl(u.profilePhoto ?? m.profilePhoto) ?? null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return {
      channelType: channel.channelType as "dm" | "group_dm",
      channelName: channel.name ?? "",
      memberCount: memberRows.length,
      otherMembers,
    };
  },
});

export const getDirectInbox = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
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
      // Strict community-scoping (Slack-workspace model): a thread in
      // another community does not surface in this community's inbox.
      if (channel.communityId !== args.communityId) continue;
      // Hide empty channels — a channel created via createOrGetDirectChannel
      // but never written to (no first message) is clutter in the inbox.
      // It reappears the moment anyone sends, since lastMessageAt updates.
      if (!channel.lastMessageAt) continue;

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
