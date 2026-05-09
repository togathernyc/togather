/**
 * Polls
 *
 * Lightweight in-channel polling. Polls live in their own table and are
 * referenced by a host `chatMessages` row (`contentType: "poll"`,
 * `pollId`) so they flow through the existing chat list, push, and
 * notification pipelines for free.
 *
 * v1 capabilities: single + multi-select, author + leader can edit / close
 * / delete. No anonymous voting and no closing deadline (fields reserved).
 *
 * See `apps/convex/schema.ts` (`polls`, `pollVotes`) for the table shapes.
 */

import { v, ConvexError } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import {
  channelEffectiveEnabledForGroup,
  channelIsLeaderEnabled,
  isCustomChannel,
  isLeaderRole,
} from "../../lib/helpers";
import { getDisplayName, getMediaUrl } from "../../lib/utils";
import { canAccessEventChannel } from "./eventChat";
import { generateMessagePreview } from "./messages";
import { checkRateLimit } from "../../lib/rateLimit";

const MAX_QUESTION_LENGTH = 280;
const MAX_OPTION_TEXT_LENGTH = 120;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;

/**
 * Validate a poll's question + options for both create and edit paths.
 * Throws ConvexError on failure so the UI can surface a hint to the user.
 */
function validatePollContent(question: string, optionTexts: string[]): void {
  const trimmedQuestion = question.trim();
  if (trimmedQuestion.length === 0) {
    throw new ConvexError("Poll question is required");
  }
  if (trimmedQuestion.length > MAX_QUESTION_LENGTH) {
    throw new ConvexError(
      `Poll question must be ${MAX_QUESTION_LENGTH} characters or fewer`,
    );
  }
  const trimmed = optionTexts.map((t) => t.trim());
  if (trimmed.length < MIN_OPTIONS) {
    throw new ConvexError(`Poll must have at least ${MIN_OPTIONS} options`);
  }
  if (trimmed.length > MAX_OPTIONS) {
    throw new ConvexError(`Poll can have at most ${MAX_OPTIONS} options`);
  }
  for (const t of trimmed) {
    if (t.length === 0) {
      throw new ConvexError("Poll options cannot be empty");
    }
    if (t.length > MAX_OPTION_TEXT_LENGTH) {
      throw new ConvexError(
        `Poll options must be ${MAX_OPTION_TEXT_LENGTH} characters or fewer`,
      );
    }
  }
}

/**
 * Mirror of `sendMessage`'s post-permission flow, scoped to what polls need.
 * Throws on disallowed contexts. Used by createPoll so polls inherit message
 * channel-posting rules (e.g. announcements = leaders only) without a fragile
 * refactor of `sendMessage` itself.
 */
async function assertCanPostInChannel(
  ctx: MutationCtx,
  userId: Id<"users">,
  channel: Doc<"chatChannels">,
  viewingGroupId: Id<"groups"> | undefined,
): Promise<void> {
  if (channel.channelType === "event") {
    if (!(await canAccessEventChannel(ctx, userId, channel))) {
      throw new ConvexError("Not a member of this channel");
    }
    if (channel.isEnabled === false) {
      throw new ConvexError("Event chat is disabled");
    }
    return;
  }

  const membership = await ctx.db
    .query("chatChannelMembers")
    .withIndex("by_channel_user", (q) =>
      q.eq("channelId", channel._id).eq("userId", userId),
    )
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .first();
  if (!membership) {
    throw new ConvexError("Not a member of this channel");
  }

  if (
    isCustomChannel(channel.channelType) ||
    channel.channelType === "pco_services"
  ) {
    const enabled = viewingGroupId
      ? channelEffectiveEnabledForGroup(channel, viewingGroupId)
      : channelIsLeaderEnabled(channel);
    if (!enabled) {
      throw new ConvexError("This channel is disabled");
    }
  }

  if (channel.channelType === "announcements") {
    if (!channelIsLeaderEnabled(channel) || channel.isArchived) {
      throw new ConvexError("This channel is disabled");
    }
    if (!channel.groupId) {
      throw new ConvexError("Invalid announcements channel");
    }
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", channel.groupId!).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();
    if (!isLeaderRole(groupMembership?.role)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only group leaders can post in Announcements",
      });
    }
  }

  if (channel.isAdHoc) {
    // Ad-hoc DM/group_dm gating mirrors `sendMessage` (apps/convex/functions/
    // messaging/messages.ts ~755-825). Without these checks a user who can't
    // send a normal message — because a recipient blocked them, they removed
    // their profile photo, or the recipient hasn't accepted yet — could still
    // post a poll and fan it out through the chat/notification pipeline.
    if (membership.requestState !== "accepted") {
      throw new ConvexError("Accept the request before posting");
    }

    // Profile photo is a hard requirement on every send to an ad-hoc channel.
    const sender = await ctx.db.get(userId);
    if (!sender?.profilePhoto || sender.profilePhoto.trim() === "") {
      throw new ConvexError("PROFILE_PHOTO_REQUIRED");
    }

    // Block enforcement: any active recipient who's blocked the sender
    // rejects the send. Generic error keeps the block silent.
    const otherMembers = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();
    for (const m of otherMembers) {
      if (m.userId === userId) continue;
      const block = await ctx.db
        .query("chatUserBlocks")
        .withIndex("by_blocker_blocked", (q) =>
          q.eq("blockerId", m.userId).eq("blockedId", userId),
        )
        .first();
      if (block) {
        throw new ConvexError("Cannot send message in this chat");
      }
    }

    // Pending-recipient gate: until the other party accepts, sendMessage
    // restricts to plain text only. Polls aren't plain text — block them.
    const hasPendingOthers = otherMembers.some(
      (m) => m.userId !== userId && m.requestState === "pending",
    );
    if (hasPendingOthers) {
      throw new ConvexError(
        "Cannot send polls until the recipient accepts the request",
      );
    }
  }
}

/**
 * Whether `userId` is a leader of the group that owns `channel`.
 * Returns false for ad-hoc channels (no group) — author-only moderation.
 */
async function isChannelGroupLeader(
  ctx: QueryCtx | MutationCtx,
  channel: Doc<"chatChannels"> | null,
  userId: Id<"users">,
): Promise<boolean> {
  if (!channel?.groupId) return false;
  const m = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q) =>
      q.eq("groupId", channel.groupId!).eq("userId", userId),
    )
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .first();
  return isLeaderRole(m?.role);
}

/**
 * Generate a unique option id given the existing ids on the poll.
 * IDs look like `o0`, `o1`, ... — purely server-side, never user-supplied.
 */
function nextOptionId(existing: string[]): string {
  let max = -1;
  for (const id of existing) {
    if (id.startsWith("o")) {
      const n = Number(id.slice(1));
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `o${max + 1}`;
}

// =============================================================================
// Mutations
// =============================================================================

/**
 * Create a poll and post it as a message in the given channel.
 * Returns the poll's host messageId so the client can react / scroll to it.
 */
export const createPoll = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    question: v.string(),
    options: v.array(v.string()),
    allowMultiple: v.boolean(),
    viewingGroupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Share the same rate-limit bucket as `sendMessage` (`msg:${userId}`,
    // 20/min). Without this a member could fan polls out indefinitely
    // through the same notification path while ordinary text messages
    // are capped — and a poll fans out to every channel member just like
    // a normal send.
    await checkRateLimit(ctx, `msg:${userId}`, 20, 60_000);

    validatePollContent(args.question, args.options);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError("Channel not found");
    }
    await assertCanPostInChannel(ctx, userId, channel, args.viewingGroupId);

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new ConvexError("User not found");
    }
    const senderName = getDisplayName(user.firstName, user.lastName);
    const senderProfilePhoto = getMediaUrl(user.profilePhoto);

    const now = Date.now();
    const trimmedQuestion = args.question.trim();
    const optionDocs = args.options.map((text, idx) => ({
      id: `o${idx}`,
      text: text.trim(),
    }));

    // Insert the host message first so we have an id to back-pointer from
    // the poll. The message's pollId is patched in once the poll exists —
    // this all runs inside one mutation transaction so external readers
    // never observe an inconsistent state.
    const messageId = await ctx.db.insert("chatMessages", {
      channelId: args.channelId,
      senderId: userId,
      content: trimmedQuestion,
      contentType: "poll",
      createdAt: now,
      isDeleted: false,
      senderName,
      senderProfilePhoto,
      lastActivityAt: now,
    });

    const pollId = await ctx.db.insert("polls", {
      channelId: args.channelId,
      messageId,
      authorId: userId,
      question: trimmedQuestion,
      options: optionDocs,
      allowMultiple: args.allowMultiple,
      isAnonymous: false,
      status: "active",
      voteCount: 0,
      voterCount: 0,
      editCount: 0,
      createdAt: now,
    });

    await ctx.db.patch(messageId, { pollId });

    // Update channel-level last-message snapshot the same way sendMessage
    // does, so inbox previews and unread counts stay correct.
    const previewBase = `📊 ${trimmedQuestion}`;
    const preview =
      previewBase.length > 100
        ? previewBase.slice(0, 97) + "…"
        : previewBase;
    await ctx.db.patch(args.channelId, {
      lastMessageAt: now,
      lastMessagePreview: preview,
      lastMessageSenderId: userId,
      lastMessageSenderName: senderName,
      updatedAt: now,
    });

    // Same notification fan-out as a normal message.
    await ctx.scheduler.runAfter(
      0,
      internal.functions.messaging.events.onMessageSent,
      {
        messageId,
        channelId: args.channelId,
        senderId: userId,
      },
    );

    return { pollId, messageId };
  },
});

/**
 * Cast (or recast) a viewer's vote on a poll.
 *
 * `optionIds` is the COMPLETE set of options the voter has selected after
 * this call — the mutation reconciles the existing votes against this set.
 *  - single-select polls: must be empty or length 1
 *  - multi-select polls: any number from 0 to options.length
 *  - empty array clears the viewer's votes (toggle off)
 */
export const voteOnPoll = mutation({
  args: {
    token: v.string(),
    pollId: v.id("polls"),
    optionIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const poll = await ctx.db.get(args.pollId);
    if (!poll) throw new ConvexError("Poll not found");
    if (poll.status !== "active") {
      throw new ConvexError("This poll is closed");
    }

    const channel = await ctx.db.get(poll.channelId);
    if (!channel) throw new ConvexError("Channel not found");

    // Channel-membership check: same gate as reading the poll. Use a
    // light path that mirrors the message read rules.
    if (channel.channelType === "event") {
      if (!(await canAccessEventChannel(ctx, userId, channel))) {
        throw new ConvexError("Not a member of this channel");
      }
    } else {
      const m = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", poll.channelId).eq("userId", userId),
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();
      if (!m) throw new ConvexError("Not a member of this channel");

      // Disabled-channel gate. `getMessages` hides custom / pco_services /
      // announcements channels from non-leaders when they're disabled, so
      // a member with a stale-mounted poll card or direct pollId could
      // otherwise still mutate poll state. Leaders can still moderate
      // votes on disabled channels (closing the poll, etc), so we only
      // block non-leaders here.
      if (
        isCustomChannel(channel.channelType) ||
        channel.channelType === "pco_services" ||
        channel.channelType === "announcements"
      ) {
        const enabled = channelIsLeaderEnabled(channel);
        if (!enabled && !(await isChannelGroupLeader(ctx, channel, userId))) {
          throw new ConvexError("This channel is disabled");
        }
      }

      // Ad-hoc DM/group_dm: a pending recipient can READ the request but
      // can't take any send-shape action until they accept. Voting writes
      // a row that fans out via reactivity, so it falls under the same
      // gate as `sendMessage` does for ad-hoc channels.
      if (
        channel.isAdHoc &&
        m.requestState !== undefined &&
        m.requestState !== "accepted"
      ) {
        throw new ConvexError("Accept the request before voting");
      }
    }

    // Validate option ids belong to this poll.
    const validIds = new Set(poll.options.map((o) => o.id));
    const requestedIds = Array.from(new Set(args.optionIds));
    for (const id of requestedIds) {
      if (!validIds.has(id)) {
        throw new ConvexError("Invalid poll option");
      }
    }
    if (!poll.allowMultiple && requestedIds.length > 1) {
      throw new ConvexError("This poll allows only one selection");
    }

    const existing = await ctx.db
      .query("pollVotes")
      .withIndex("by_poll_voter", (q) =>
        q.eq("pollId", args.pollId).eq("voterId", userId),
      )
      .collect();

    const existingByOption = new Map(existing.map((v) => [v.optionId, v]));
    const desired = new Set(requestedIds);

    let inserted = 0;
    let removed = 0;
    const now = Date.now();

    // Remove votes for options no longer selected.
    for (const [optionId, row] of existingByOption) {
      if (!desired.has(optionId)) {
        await ctx.db.delete(row._id);
        removed += 1;
      }
    }
    // Insert votes for newly selected options.
    for (const optionId of desired) {
      if (!existingByOption.has(optionId)) {
        await ctx.db.insert("pollVotes", {
          pollId: args.pollId,
          optionId,
          voterId: userId,
          channelId: poll.channelId,
          createdAt: now,
        });
        inserted += 1;
      }
    }

    const hadAnyBefore = existing.length > 0;
    const hasAnyAfter = desired.size > 0;
    let voterDelta = 0;
    if (!hadAnyBefore && hasAnyAfter) voterDelta = 1;
    else if (hadAnyBefore && !hasAnyAfter) voterDelta = -1;

    await ctx.db.patch(args.pollId, {
      voteCount: poll.voteCount + inserted - removed,
      voterCount: poll.voterCount + voterDelta,
    });
  },
});

/**
 * Edit poll question / options / settings. Author or group leader.
 *
 * Behavior:
 *  - Question and option text edits are free (vote rows are tied to id).
 *  - Removing an option cascades pollVotes for that optionId.
 *  - Toggling allowMultiple from true → false is rejected when any voter
 *    currently has more than one vote (UI must prompt them to fix first).
 *  - Adding new options is always allowed (existing votes unaffected).
 */
export const editPoll = mutation({
  args: {
    token: v.string(),
    pollId: v.id("polls"),
    question: v.optional(v.string()),
    /**
     * Full replacement option list. Pass `id` for existing options to keep
     * their vote rows; omit `id` for newly-added options (server assigns one).
     * Any existing option whose id is absent here will have its vote rows
     * cascade-deleted.
     */
    options: v.optional(
      v.array(
        v.object({
          id: v.optional(v.string()),
          text: v.string(),
        }),
      ),
    ),
    allowMultiple: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const poll = await ctx.db.get(args.pollId);
    if (!poll) throw new ConvexError("Poll not found");

    const channel = await ctx.db.get(poll.channelId);
    const isAuthor = poll.authorId === userId;
    const isLeader = await isChannelGroupLeader(ctx, channel, userId);
    if (!isAuthor && !isLeader) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only the poll author or a leader can edit this poll",
      });
    }

    const newQuestion =
      args.question !== undefined ? args.question : poll.question;

    let newOptions = poll.options;
    let removedOptionIds: string[] = [];
    if (args.options) {
      const existingIds = poll.options.map((o) => o.id);
      const seenIds = new Set<string>();
      const next: Array<{ id: string; text: string }> = [];
      for (const o of args.options) {
        if (o.id && existingIds.includes(o.id)) {
          if (seenIds.has(o.id)) {
            throw new ConvexError("Duplicate option id");
          }
          seenIds.add(o.id);
          next.push({ id: o.id, text: o.text.trim() });
        } else {
          const id = nextOptionId([...existingIds, ...next.map((n) => n.id)]);
          next.push({ id, text: o.text.trim() });
        }
      }
      newOptions = next;
      removedOptionIds = existingIds.filter((id) => !seenIds.has(id));
    }

    validatePollContent(
      newQuestion,
      newOptions.map((o) => o.text),
    );

    const newAllowMultiple =
      args.allowMultiple !== undefined ? args.allowMultiple : poll.allowMultiple;

    // Multi → single guard: refuse if any voter would be "over budget".
    if (poll.allowMultiple && newAllowMultiple === false) {
      const allVotes = await ctx.db
        .query("pollVotes")
        .withIndex("by_poll", (q) => q.eq("pollId", args.pollId))
        .collect();
      const perVoter = new Map<string, number>();
      for (const v of allVotes) {
        perVoter.set(v.voterId, (perVoter.get(v.voterId) ?? 0) + 1);
      }
      for (const count of perVoter.values()) {
        if (count > 1) {
          throw new ConvexError({
            code: "INVALID_STATE",
            message:
              "Some voters have multiple selections. Remove their extras before switching to single-select.",
          });
        }
      }
    }

    // Cascade-delete vote rows for removed options + recompute denorms.
    let nextVoteCount = poll.voteCount;
    let nextVoterCount = poll.voterCount;
    if (removedOptionIds.length > 0) {
      // Pull every vote row for this poll once; cheaper than per-option index
      // scans when removedOptionIds is small but possibly multiple.
      const allVotes = await ctx.db
        .query("pollVotes")
        .withIndex("by_poll", (q) => q.eq("pollId", args.pollId))
        .collect();
      const removedSet = new Set(removedOptionIds);
      const survivingVotersByVoter = new Set<string>();
      for (const v of allVotes) {
        if (!removedSet.has(v.optionId)) {
          survivingVotersByVoter.add(v.voterId);
        }
      }
      let removed = 0;
      for (const v of allVotes) {
        if (removedSet.has(v.optionId)) {
          await ctx.db.delete(v._id);
          removed += 1;
        }
      }
      nextVoteCount = poll.voteCount - removed;
      nextVoterCount = survivingVotersByVoter.size;
    }

    const now = Date.now();
    await ctx.db.patch(args.pollId, {
      question: newQuestion.trim(),
      options: newOptions,
      allowMultiple: newAllowMultiple,
      voteCount: nextVoteCount,
      voterCount: nextVoterCount,
      editedAt: now,
      editCount: poll.editCount + 1,
    });

    // Mirror question edits on the host message so the inbox preview and
    // any text-search paths reflect the change. Also update the channel's
    // denormalized lastMessagePreview when the edited poll IS the channel's
    // current last message, otherwise the inbox row keeps showing the old
    // question until another message lands.
    if (poll.messageId && args.question !== undefined) {
      await ctx.db.patch(poll.messageId, {
        content: newQuestion.trim(),
        editedAt: now,
        updatedAt: now,
      });

      const hostMessage = await ctx.db.get(poll.messageId);
      const channel = await ctx.db.get(poll.channelId);
      if (
        hostMessage &&
        channel &&
        channel.lastMessageAt &&
        hostMessage.createdAt >= channel.lastMessageAt
      ) {
        const previewBase = `📊 ${newQuestion.trim()}`;
        const preview =
          previewBase.length > 100 ? previewBase.slice(0, 97) + "…" : previewBase;
        await ctx.db.patch(poll.channelId, {
          lastMessagePreview: preview,
          updatedAt: now,
        });
      }
    }
  },
});

/**
 * Manually close a poll. Author or leader. Idempotent.
 */
export const closePoll = mutation({
  args: {
    token: v.string(),
    pollId: v.id("polls"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const poll = await ctx.db.get(args.pollId);
    if (!poll) throw new ConvexError("Poll not found");
    if (poll.status === "closed") return;

    const channel = await ctx.db.get(poll.channelId);
    const isAuthor = poll.authorId === userId;
    const isLeader = await isChannelGroupLeader(ctx, channel, userId);
    if (!isAuthor && !isLeader) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only the poll author or a leader can close this poll",
      });
    }

    await ctx.db.patch(args.pollId, {
      status: "closed",
      closedAt: Date.now(),
    });
  },
});

/**
 * Delete a poll. Author or leader. Cascades all pollVotes and soft-deletes
 * the host message so it disappears from the chat list.
 */
export const deletePoll = mutation({
  args: {
    token: v.string(),
    pollId: v.id("polls"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const poll = await ctx.db.get(args.pollId);
    if (!poll) return; // already gone

    const channel = await ctx.db.get(poll.channelId);
    const isAuthor = poll.authorId === userId;
    const isLeader = await isChannelGroupLeader(ctx, channel, userId);
    if (!isAuthor && !isLeader) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only the poll author or a leader can delete this poll",
      });
    }

    const votes = await ctx.db
      .query("pollVotes")
      .withIndex("by_poll", (q) => q.eq("pollId", args.pollId))
      .collect();
    for (const v of votes) {
      await ctx.db.delete(v._id);
    }

    const now = Date.now();
    if (poll.messageId) {
      const message = await ctx.db.get(poll.messageId);
      if (message && !message.isDeleted) {
        await ctx.db.patch(poll.messageId, {
          isDeleted: true,
          deletedAt: now,
          deletedById: userId,
        });

        // If the deleted poll was the channel's most recent top-level
        // message, the inbox preview / sort key would otherwise stay
        // pointing at the now-removed poll. Mirror deleteMessage's
        // recompute path so the channel snaps to the previous message.
        const channel = await ctx.db.get(message.channelId);
        if (
          channel &&
          channel.lastMessageAt &&
          message.createdAt >= channel.lastMessageAt
        ) {
          const previousMessage = await ctx.db
            .query("chatMessages")
            .withIndex("by_channel_createdAt", (q) =>
              q.eq("channelId", message.channelId),
            )
            .order("desc")
            .filter((q) =>
              q.and(
                q.eq(q.field("isDeleted"), false),
                q.neq(q.field("_id"), poll.messageId!),
                q.eq(q.field("parentMessageId"), undefined),
              ),
            )
            .first();

          if (previousMessage) {
            const preview = generateMessagePreview({
              content: previousMessage.content,
              attachments: previousMessage.attachments,
            });
            await ctx.db.patch(message.channelId, {
              lastMessageAt: previousMessage.createdAt,
              lastMessagePreview: preview,
              lastMessageSenderId: previousMessage.senderId,
              lastMessageSenderName: previousMessage.senderName,
              updatedAt: now,
            });
          } else {
            await ctx.db.patch(message.channelId, {
              lastMessageAt: undefined,
              lastMessagePreview: undefined,
              lastMessageSenderId: undefined,
              lastMessageSenderName: undefined,
              updatedAt: now,
            });
          }
        }
      }
    }

    await ctx.db.delete(args.pollId);
  },
});

// =============================================================================
// Queries
// =============================================================================

/**
 * Read a poll for rendering in the chat. Returns:
 *  - poll metadata (question, settings, status, edit info)
 *  - per-option text + counts
 *  - the viewer's current vote selection
 *  - viewer permissions (canVote / canEdit / canClose / canDelete)
 *
 * Returns `null` when the viewer can't see the channel (matches the
 * empty-page approach used by getMessages — never throws into the UI).
 */
export const getPoll = query({
  args: {
    token: v.string(),
    pollId: v.id("polls"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const poll = await ctx.db.get(args.pollId);
    if (!poll) return null;

    const channel = await ctx.db.get(poll.channelId);
    if (!channel) return null;

    // Same channel-visibility gate as message reads.
    if (channel.channelType === "event") {
      if (!(await canAccessEventChannel(ctx, userId, channel))) return null;
    } else {
      const m = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", poll.channelId).eq("userId", userId),
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();
      if (!m) return null;
    }

    const allVotes = await ctx.db
      .query("pollVotes")
      .withIndex("by_poll", (q) => q.eq("pollId", args.pollId))
      .collect();

    const isAuthor = poll.authorId === userId;
    const isLeader = await isChannelGroupLeader(ctx, channel, userId);
    const canVote = poll.status === "active";
    const canModerate = isAuthor || isLeader;
    const canSeeIdentities = !poll.isAnonymous || isAuthor || isLeader;

    // Counts always include every vote (so a blocker doesn't see a
    // skewed total). Voter identity surfaces — preview avatars and the
    // voters sheet — strip blocked users so the blocker doesn't see the
    // person they explicitly hid from their feed reappear here. This
    // mirrors how `getMessages` filters blocked senders' messages.
    const blockedRows = await ctx.db
      .query("chatUserBlocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", userId))
      .collect();
    const blockedUserIds = new Set<string>(
      blockedRows.map((b) => b.blockedId),
    );

    // Build per-option counts AND a small voter-avatar preview (first
    // few voters per option, ordered earliest-first). Batch user
    // fetches by unique voter id so a multi-voter doesn't fan out.
    const countsByOption = new Map<string, number>();
    const myVoteIds: string[] = [];
    const votesByOption = new Map<string, Array<typeof allVotes[number]>>();
    for (const v of allVotes) {
      countsByOption.set(
        v.optionId,
        (countsByOption.get(v.optionId) ?? 0) + 1,
      );
      if (v.voterId === userId) myVoteIds.push(v.optionId);
      const arr = votesByOption.get(v.optionId) ?? [];
      arr.push(v);
      votesByOption.set(v.optionId, arr);
    }

    const PREVIEW_LIMIT = 4;
    let voterUserById = new Map<Id<"users">, Doc<"users">>();
    if (canSeeIdentities && allVotes.length > 0) {
      // Only fetch users actually needed for previews (top N earliest
      // voters per option, blocked users skipped) so very-large polls
      // don't fan out user reads.
      const idsNeeded = new Set<Id<"users">>();
      for (const [, votes] of votesByOption) {
        const top = [...votes]
          .filter((v) => !blockedUserIds.has(v.voterId))
          .sort((a, b) => a.createdAt - b.createdAt)
          .slice(0, PREVIEW_LIMIT);
        for (const v of top) idsNeeded.add(v.voterId);
      }
      const ids = Array.from(idsNeeded);
      const users = await Promise.all(ids.map((id) => ctx.db.get(id)));
      ids.forEach((id, i) => {
        const u = users[i];
        if (u) voterUserById.set(id, u);
      });
    }

    return {
      _id: poll._id,
      channelId: poll.channelId,
      messageId: poll.messageId,
      authorId: poll.authorId,
      question: poll.question,
      options: poll.options.map((o) => {
        const optionVotes = votesByOption.get(o.id) ?? [];
        const voterPreview = canSeeIdentities
          ? [...optionVotes]
              .filter((v) => !blockedUserIds.has(v.voterId))
              .sort((a, b) => a.createdAt - b.createdAt)
              .slice(0, PREVIEW_LIMIT)
              .map((v) => {
                const user = voterUserById.get(v.voterId);
                if (!user) return null;
                return {
                  userId: v.voterId,
                  displayName: getDisplayName(user.firstName, user.lastName),
                  profilePhoto: getMediaUrl(user.profilePhoto),
                };
              })
              .filter((x): x is NonNullable<typeof x> => x !== null)
          : [];
        return {
          id: o.id,
          text: o.text,
          count: countsByOption.get(o.id) ?? 0,
          voterPreview,
        };
      }),
      allowMultiple: poll.allowMultiple,
      isAnonymous: poll.isAnonymous,
      status: poll.status,
      closedAt: poll.closedAt,
      voteCount: poll.voteCount,
      voterCount: poll.voterCount,
      editedAt: poll.editedAt,
      editCount: poll.editCount,
      createdAt: poll.createdAt,
      myVoteOptionIds: myVoteIds,
      permissions: {
        canVote,
        canEdit: canModerate,
        canClose: canModerate && poll.status === "active",
        canDelete: canModerate,
      },
    };
  },
});

/**
 * Read the per-option voter list for a poll.
 *
 * Returned shape groups voters by option so the UI can render sections
 * directly. Each voter includes display name + profile photo for rendering
 * an avatar row.
 *
 * Visibility: same channel-member gate as `getPoll`. When `isAnonymous`
 * is true (reserved for v1, never set today), non-leaders see option
 * counts but no voter identities — leaders / poll author always see
 * full identities for moderation reasons.
 */
export const getPollVoters = query({
  args: {
    token: v.string(),
    pollId: v.id("polls"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const poll = await ctx.db.get(args.pollId);
    if (!poll) return null;

    const channel = await ctx.db.get(poll.channelId);
    if (!channel) return null;

    if (channel.channelType === "event") {
      if (!(await canAccessEventChannel(ctx, userId, channel))) return null;
    } else {
      const m = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", poll.channelId).eq("userId", userId),
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();
      if (!m) return null;
    }

    const isAuthor = poll.authorId === userId;
    const isLeader = await isChannelGroupLeader(ctx, channel, userId);
    const canSeeIdentities =
      !poll.isAnonymous || isAuthor || isLeader;

    // Cap how many vote rows we materialize. Convex queries have a
    // function-level read limit, and a poll with thousands of voters
    // would otherwise either hit it or fan out one users.get per voter.
    // For v1 community-app polls a few hundred is plenty; the UI shows
    // a "+N more" hint when truncated. Move to true pagination if a
    // real-world poll ever crosses this threshold.
    const VOTERS_QUERY_CAP = 500;
    const cappedVotes = await ctx.db
      .query("pollVotes")
      .withIndex("by_poll", (q) => q.eq("pollId", args.pollId))
      .take(VOTERS_QUERY_CAP + 1);
    const truncated = cappedVotes.length > VOTERS_QUERY_CAP;
    const allVotes = truncated
      ? cappedVotes.slice(0, VOTERS_QUERY_CAP)
      : cappedVotes;

    // Filter out users the viewer has blocked. Counts stay accurate
    // (blocker shouldn't see a skewed total) but identities of blocked
    // voters are stripped — same shape as `getMessages`'s blocker filter.
    const blockedRows = await ctx.db
      .query("chatUserBlocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", userId))
      .collect();
    const blockedUserIds = new Set<string>(
      blockedRows.map((b) => b.blockedId),
    );

    // Resolve voter identities. Batch a unique-id lookup so we hit `users`
    // once per voter regardless of how many options they ticked.
    const uniqueVoterIds = Array.from(
      new Set(
        allVotes
          .filter((v) => !blockedUserIds.has(v.voterId))
          .map((v) => v.voterId),
      ),
    );
    const voterUsers = await Promise.all(
      uniqueVoterIds.map((id) => ctx.db.get(id)),
    );
    const userById = new Map<Id<"users">, Doc<"users">>();
    uniqueVoterIds.forEach((id, i) => {
      const u = voterUsers[i];
      if (u) userById.set(id, u);
    });

    const votesByOption = new Map<string, Array<typeof allVotes[number]>>();
    for (const v of allVotes) {
      const arr = votesByOption.get(v.optionId) ?? [];
      arr.push(v);
      votesByOption.set(v.optionId, arr);
    }

    const options = poll.options.map((opt) => {
      const optionVotes = votesByOption.get(opt.id) ?? [];
      const voters = canSeeIdentities
        ? optionVotes
            .filter((v) => !blockedUserIds.has(v.voterId))
            .map((v) => {
              const user = userById.get(v.voterId);
              if (!user) return null;
              return {
                userId: v.voterId,
                displayName: getDisplayName(user.firstName, user.lastName),
                profilePhoto: getMediaUrl(user.profilePhoto),
                createdAt: v.createdAt,
              };
            })
            .filter(
              (v): v is NonNullable<typeof v> => v !== null,
            )
            // Stable order: earliest voter first per option
            .sort((a, b) => a.createdAt - b.createdAt)
        : [];
      return {
        id: opt.id,
        text: opt.text,
        count: optionVotes.length,
        voters,
      };
    });

    return {
      pollId: poll._id,
      isAnonymous: poll.isAnonymous,
      canSeeIdentities,
      voterCount: poll.voterCount,
      voteCount: poll.voteCount,
      options,
      // True when the poll has more vote rows than VOTERS_QUERY_CAP and
      // the returned `voters` arrays are a prefix of the full list. The
      // sheet UI surfaces this with a "Showing first N voters" hint.
      truncated,
    };
  },
});
