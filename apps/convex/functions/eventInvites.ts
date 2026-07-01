/**
 * Event Invite functions
 *
 * Lets event hosts and group leaders invite group members to an event via
 * SMS + push. One row per (meetingId, recipientUserId) so re-invites dedupe
 * cleanly and the UI can show per-recipient status. Mirrors eventBlasts.ts
 * for SMS/push dispatch; differs in recipient pool (group members vs. RSVPs)
 * and in tracking per-recipient state.
 */

import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  internalAction,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { canEditMeeting } from "../lib/meetingPermissions";
import { now, getMediaUrl } from "../lib/utils";
import { getCurrentEnvironment } from "../lib/notifications/send";
import { DOMAIN_CONFIG } from "@togather/shared/config";

// 24h cooldown between sends to the same recipient for a given meeting.
const REINVITE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// Twilio SMS hard cap.
const SMS_MAX_LEN = 1600;

// Max recipients accepted by a single initiate/reinvite call. Keeps Twilio
// spend bounded and — together with the bounded picker query below — prevents
// the "too many reads in a single function execution" failures that large
// groups used to trigger. Keep in sync with MAX_INVITE_RECIPIENTS in
// apps/mobile/features/leader-tools/components/InviteGroupMembersSheet.tsx.
const MAX_INVITE_RECIPIENTS = 20;

// The invite picker returns at most this many members per query. A search hits
// the users full-text index (O(matches)); the empty default view reads a
// single bounded page off the group index — neither fans reads out across the
// whole group the way the old collect-everything implementation did.
const MEMBER_PICKER_LIMIT = 50;
// How many raw group-member rows to read for the empty (default) picker view
// before filtering to active members in memory. A DB `.filter()` would still
// read (and count against the limit) every leftAt-set row it scans past, so a
// high-churn group could re-trip the read limit; this caps the read instead.
const DEFAULT_MEMBER_SCAN_LIMIT = 300;
// How many full-text matches to scan before narrowing to group members. The
// users search index is global (not group-scoped), so we over-fetch and then
// filter to members. 500 matches the cap used by admin People search and
// lib/memberSearch.ts; leaders narrow the query further to reach a member who
// ranks past it. Bounded so the membership checks below stay well under the
// per-execution read limit.
const USER_SEARCH_SCAN_LIMIT = 500;

/** An active, fully-joined group membership (not left, not a pending request). */
function isActiveMembership(m: Doc<"groupMembers">): boolean {
  return (
    m.leftAt === undefined &&
    (!m.requestStatus ||
      m.requestStatus === "accepted" ||
      m.requestStatus === "approved")
  );
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Per-recipient invite log for the event detail "Invites" section.
 * Visible to anyone who can edit the meeting (host, group leaders, community admins).
 */
export const list = query({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return [];
    if (!(await canEditMeeting(ctx, userId, meeting))) return [];

    const invites = await ctx.db
      .query("eventInvites")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();

    invites.sort((a, b) => b.lastSentAt - a.lastSentAt);

    const userIds = [
      ...new Set([
        ...invites.map((i) => i.recipientUserId),
        ...invites.map((i) => i.sentById),
      ]),
    ];
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map<string, Doc<"users"> | null>();
    users.forEach((u, i) => userMap.set(userIds[i], u ?? null));

    const fmtName = (u: Doc<"users"> | null | undefined) =>
      u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() || "Someone" : "Unknown";

    return invites.map((inv) => {
      const recipient = userMap.get(inv.recipientUserId);
      const sender = userMap.get(inv.sentById);
      return {
        _id: inv._id,
        recipientUserId: inv.recipientUserId,
        recipientName: fmtName(recipient),
        recipientPhoto: recipient ? getMediaUrl(recipient.profilePhoto) ?? null : null,
        status: inv.status,
        smsStatus: inv.smsStatus ?? null,
        pushStatus: inv.pushStatus ?? null,
        failureReason: inv.failureReason ?? null,
        inviteRound: inv.inviteRound,
        lastSentAt: inv.lastSentAt,
        sentById: inv.sentById,
        sentByName: fmtName(sender),
        personalNote: inv.personalNote ?? null,
      };
    });
  },
});

/**
 * Group member roster for the invite recipient picker.
 *
 * Returns members of the meeting's parent group, annotated with:
 *   - hasPhone: whether the user has a phone we can SMS
 *   - alreadyInvited: existing eventInvites row for this meeting+user
 *   - alreadyRsvped: existing RSVP for this meeting+user (any option)
 *
 * The result is bounded to `limit` (<= MEMBER_PICKER_LIMIT) members so the
 * query stays well under Convex's per-execution read limit no matter how big
 * the group is — the old implementation fetched a user row and a push-token
 * query for *every* member, which blew past the 4096-read cap in large groups.
 *
 * Search is performed server-side against the users full-text index so the
 * picker can find any member by name/phone, not just those on the first page.
 * When there is no search term the caller is always included so a host can
 * send a test invite to themselves.
 */
export const listGroupMembersForInvite = query({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return [];
    if (!(await canEditMeeting(ctx, userId, meeting))) return [];

    const groupId = meeting.groupId;
    const search = args.search?.trim();
    const limit = Math.min(
      Math.max(args.limit ?? MEMBER_PICKER_LIMIT, 1),
      MEMBER_PICKER_LIMIT,
    );

    // --- Resolve a BOUNDED set of candidate member userIds -------------------
    // Never touch more than ~limit members. A search hits the users full-text
    // index (O(matches)) and confirms membership per hit; the empty default
    // view reads a single bounded page off the group index.
    const memberIds = new Set<Id<"users">>();

    if (search) {
      const matches = await ctx.db
        .query("users")
        .withSearchIndex("search_users", (q) =>
          q.search("searchText", search),
        )
        .take(USER_SEARCH_SCAN_LIMIT);
      for (const user of matches) {
        if (memberIds.size >= limit) break;
        const membership = await ctx.db
          .query("groupMembers")
          .withIndex("by_group_user", (q) =>
            q.eq("groupId", groupId).eq("userId", user._id),
          )
          .first();
        if (membership && isActiveMembership(membership)) {
          memberIds.add(user._id);
        }
      }
    } else {
      // Empty search: read a BOUNDED page of raw rows off the index, then
      // filter to active members in memory. Filtering in the DB query would
      // still read every leftAt-set row it scans past (counting against the
      // read limit), so a group with lots of departed members could re-trip
      // the exact error this change prevents.
      const memberships = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .take(DEFAULT_MEMBER_SCAN_LIMIT);
      for (const m of memberships) {
        if (memberIds.size >= limit) break;
        if (isActiveMembership(m)) memberIds.add(m.userId);
      }
      // Always surface the caller (test-invite-to-self) even in a group large
      // enough that they fall outside the first page.
      if (!memberIds.has(userId)) {
        const selfMembership = await ctx.db
          .query("groupMembers")
          .withIndex("by_group_user", (q) =>
            q.eq("groupId", groupId).eq("userId", userId),
          )
          .first();
        if (selfMembership && isActiveMembership(selfMembership)) {
          memberIds.add(userId);
        }
      }
    }

    // --- Hydrate each candidate (bounded per-recipient reads) ----------------
    // `.first()` existence checks instead of collecting whole tables keeps this
    // to a handful of reads per member.
    const environment = getCurrentEnvironment();
    const rows = await Promise.all(
      [...memberIds].map(async (id) => {
        const user = await ctx.db.get(id);
        if (!user) return null;

        const pushToken = await ctx.db
          .query("pushTokens")
          .withIndex("by_user", (q) => q.eq("userId", id))
          .filter((q) => q.eq(q.field("environment"), environment))
          .first();
        const existing = await ctx.db
          .query("eventInvites")
          .withIndex("by_meeting_recipient", (q) =>
            q.eq("meetingId", args.meetingId).eq("recipientUserId", id),
          )
          .first();
        const rsvp = await ctx.db
          .query("meetingRsvps")
          .withIndex("by_meeting_user", (q) =>
            q.eq("meetingId", args.meetingId).eq("userId", id),
          )
          .first();

        return {
          userId: id,
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          profilePhoto: getMediaUrl(user.profilePhoto) ?? null,
          hasPhone: !!user.phone,
          hasPushTokens: !!pushToken,
          alreadyInvited: !!existing,
          inviteStatus: existing?.status ?? null,
          inviteRound: existing?.inviteRound ?? 0,
          lastSentAt: existing?.lastSentAt ?? null,
          alreadyRsvped: !!rsvp,
          isSelf: id === userId,
        };
      }),
    );

    return rows
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => {
        // Self first (for the "test invite to me" workflow), then
        // already-invited last, then unreachable last, then alphabetical.
        if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
        if (a.alreadyInvited !== b.alreadyInvited) return a.alreadyInvited ? 1 : -1;
        const aReachable = a.hasPhone || a.hasPushTokens;
        const bReachable = b.hasPhone || b.hasPushTokens;
        if (aReachable !== bReachable) return aReachable ? -1 : 1;
        const an = `${a.firstName || ""} ${a.lastName || ""}`.toLowerCase();
        const bn = `${b.firstName || ""} ${b.lastName || ""}`.toLowerCase();
        return an.localeCompare(bn);
      });
  },
});

// ============================================================================
// Mutations (client-facing)
// ============================================================================

/**
 * Create invite rows and schedule the send.
 *
 * - Validates auth + canEditMeeting
 * - Validates each recipient is an active member of the meeting's group
 * - Dedupes: skips recipients with an existing invite row
 * - Inserts pending rows, schedules the send action
 * - Returns counts so the UI can show "12 invited, 3 already sent"
 */
export const initiate = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
    recipientUserIds: v.array(v.id("users")),
    personalNote: v.optional(v.string()),
    channels: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error("Meeting not found");

    if (!(await canEditMeeting(ctx, userId, meeting))) {
      throw new Error(
        "Only the event creator, group leaders, or community admins can invite members",
      );
    }

    if (new Set(args.recipientUserIds).size > MAX_INVITE_RECIPIENTS) {
      throw new Error(
        `You can invite up to ${MAX_INVITE_RECIPIENTS} people at a time.`,
      );
    }

    const channels =
      args.channels && args.channels.length > 0 ? args.channels : ["push", "sms"];
    const personalNote = args.personalNote?.trim() || undefined;

    // Resolve communityId from the group — meeting.communityId is denormalized
    // and optional, but the eventInvites row requires it.
    const group = await ctx.db.get(meeting.groupId);
    if (!group) throw new Error("Group not found");
    const communityId = group.communityId;

    let invited = 0;
    let alreadyInvited = 0;
    let skippedNotMember = 0;
    let skippedRsvped = 0;
    const newInviteIds: Id<"eventInvites">[] = [];
    const ts = now();
    const seen = new Set<string>();

    // Validate each requested recipient with INDEXED point lookups instead of
    // materializing the whole group / all invites / all RSVPs. Recipients are
    // capped at MAX_INVITE_RECIPIENTS above, so this is a small, bounded number
    // of reads even in very large groups — collecting the whole group/meeting
    // state (the previous approach) could still blow Convex's per-execution
    // read limit when sending into a group with thousands of members.
    for (const recipientUserId of args.recipientUserIds) {
      if (seen.has(recipientUserId)) continue;
      seen.add(recipientUserId);

      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", meeting.groupId).eq("userId", recipientUserId),
        )
        .first();
      if (!membership || !isActiveMembership(membership)) {
        skippedNotMember++;
        continue;
      }

      // Server-side RSVP guard. The picker disables already-RSVP'd rows, but a
      // member can RSVP between sheet open and confirm, and direct API callers
      // bypass the UI entirely. The intended path for messaging attendees is
      // Text Blast, so skip them here rather than silently double-texting.
      const rsvp = await ctx.db
        .query("meetingRsvps")
        .withIndex("by_meeting_user", (q) =>
          q.eq("meetingId", args.meetingId).eq("userId", recipientUserId),
        )
        .first();
      if (rsvp) {
        skippedRsvped++;
        continue;
      }

      const existing = await ctx.db
        .query("eventInvites")
        .withIndex("by_meeting_recipient", (q) =>
          q.eq("meetingId", args.meetingId).eq("recipientUserId", recipientUserId),
        )
        .first();
      if (existing) {
        alreadyInvited++;
        continue;
      }

      const recipient = await ctx.db.get(recipientUserId);
      const id = await ctx.db.insert("eventInvites", {
        meetingId: args.meetingId,
        groupId: meeting.groupId,
        communityId,
        sentById: userId,
        recipientUserId,
        phone: recipient?.phone || undefined,
        personalNote,
        channels,
        status: "pending",
        inviteRound: 1,
        lastSentAt: ts,
        createdAt: ts,
      });
      newInviteIds.push(id);
      invited++;
    }

    if (newInviteIds.length > 0) {
      await ctx.scheduler.runAfter(0, internal.functions.eventInvites.send, {
        meetingId: args.meetingId,
        inviteIds: newInviteIds,
      });
    }

    return { invited, alreadyInvited, skippedNotMember, skippedRsvped };
  },
});

/**
 * Re-send invites to a subset of already-invited recipients.
 *
 * - canEditMeeting required
 * - Enforces REINVITE_COOLDOWN_MS per recipient
 * - Increments inviteRound, refreshes personalNote if provided, resets status
 * - Schedules the same send action
 */
export const reinvite = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
    recipientUserIds: v.array(v.id("users")),
    personalNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error("Meeting not found");

    if (!(await canEditMeeting(ctx, userId, meeting))) {
      throw new Error(
        "Only the event creator, group leaders, or community admins can re-invite members",
      );
    }

    if (new Set(args.recipientUserIds).size > MAX_INVITE_RECIPIENTS) {
      throw new Error(
        `You can re-invite up to ${MAX_INVITE_RECIPIENTS} people at a time.`,
      );
    }

    const personalNote = args.personalNote?.trim() || undefined;
    const ts = now();
    const cooldownThreshold = ts - REINVITE_COOLDOWN_MS;

    let reinvited = 0;
    let onCooldown = 0;
    let notFound = 0;
    const inviteIdsToSend: Id<"eventInvites">[] = [];
    // Dedupe so a direct caller passing the same id repeatedly (which slips
    // past the Set-based cap above) can't re-send to one recipient many times.
    const seen = new Set<string>();

    for (const recipientUserId of args.recipientUserIds) {
      if (seen.has(recipientUserId)) continue;
      seen.add(recipientUserId);

      const existing = await ctx.db
        .query("eventInvites")
        .withIndex("by_meeting_recipient", (q) =>
          q.eq("meetingId", args.meetingId).eq("recipientUserId", recipientUserId),
        )
        .first();

      if (!existing) {
        notFound++;
        continue;
      }
      if (existing.lastSentAt > cooldownThreshold) {
        onCooldown++;
        continue;
      }

      const recipient = await ctx.db.get(recipientUserId);
      // Always snapshot the current phone — never fall back to the old row's
      // value. If the user removed/changed their phone, we should respect
      // that and let SMS be skipped rather than texting the stale number.
      await ctx.db.patch(existing._id, {
        sentById: userId,
        personalNote: personalNote ?? existing.personalNote,
        phone: recipient?.phone || undefined,
        status: "pending",
        smsStatus: undefined,
        pushStatus: undefined,
        failureReason: undefined,
        inviteRound: existing.inviteRound + 1,
        lastSentAt: ts,
      });
      inviteIdsToSend.push(existing._id);
      reinvited++;
    }

    if (inviteIdsToSend.length > 0) {
      await ctx.scheduler.runAfter(0, internal.functions.eventInvites.send, {
        meetingId: args.meetingId,
        inviteIds: inviteIdsToSend,
      });
    }

    return { reinvited, onCooldown, notFound };
  },
});

// ============================================================================
// Internal action (does the actual sending)
// ============================================================================

export const send = internalAction({
  args: {
    meetingId: v.id("meetings"),
    inviteIds: v.array(v.id("eventInvites")),
  },
  handler: async (ctx, args) => {
    const invites: Doc<"eventInvites">[] = await ctx.runQuery(
      internal.functions.eventInvites.getInvitesByIds,
      { ids: args.inviteIds },
    );
    if (invites.length === 0) return { success: true, recipientCount: 0 };

    const meetingInfo = await ctx.runQuery(
      internal.functions.eventInvites.getMeetingForInvite,
      { meetingId: args.meetingId },
    );
    if (!meetingInfo) throw new Error("Meeting not found");

    const groupInfo = await ctx.runQuery(
      internal.functions.notifications.internal.getGroupInfo,
      { groupId: meetingInfo.groupId },
    );

    // All invites in a batch share a sender (initiate/reinvite set it before
    // scheduling), but read it off the first row to be safe.
    const senderInfo = await ctx.runQuery(
      internal.functions.eventInvites.getSenderInfo,
      { userId: invites[0].sentById },
    );

    const eventTitle = meetingInfo.title || "an event";
    const eventUrl = meetingInfo.shortId
      ? DOMAIN_CONFIG.eventShareUrl(meetingInfo.shortId)
      : "";
    const senderFirstName = senderInfo?.firstName || "Someone";

    // Push fan-out: one batch call across all recipients with active tokens.
    const recipientIds = invites.map((inv) => inv.recipientUserId);
    const tokenResults = await ctx.runQuery(
      internal.functions.notifications.tokens.getActiveTokensForUsers,
      { userIds: recipientIds },
    );
    const tokensByUser = new Map<string, string[]>();
    for (const { userId, tokens } of tokenResults) {
      tokensByUser.set(userId, tokens);
    }

    // Build per-invite push slices so we can map ticket outcomes back to each
    // recipient. Each invite contributes 0..N tokens; the slice [start, end)
    // indexes into the flattened payload array (and the returned tickets).
    type PushSlice = { start: number; end: number };
    const pushSliceByInvite = new Map<string, PushSlice>();
    const pushPayloads: Array<{
      token: string;
      title: string;
      body: string;
      data: Record<string, unknown>;
      imageUrl?: string;
    }> = [];

    for (const inv of invites) {
      if (!inv.channels.includes("push")) continue;
      const tokens = tokensByUser.get(inv.recipientUserId) ?? [];
      if (tokens.length === 0) continue;
      const start = pushPayloads.length;
      const title = `${senderFirstName} invited you to ${eventTitle}`;
      const body = inv.personalNote
        ? `"${inv.personalNote}"`
        : formatScheduledAt(meetingInfo.scheduledAt);
      for (const token of tokens) {
        pushPayloads.push({
          token,
          title,
          body,
          data: {
            type: "event_invite",
            groupId: meetingInfo.groupId,
            communityId: meetingInfo.communityId,
            shortId: meetingInfo.shortId,
            url: meetingInfo.shortId
              ? `/e/${meetingInfo.shortId}?source=app`
              : undefined,
          },
          imageUrl:
            senderInfo?.profilePhoto ||
            groupInfo?.groupPhotoUrl ||
            groupInfo?.communityLogoUrl ||
            groupInfo?.groupAvatarUrl,
        });
      }
      pushSliceByInvite.set(inv._id, { start, end: pushPayloads.length });
    }

    // tickets[i] aligns 1:1 with pushPayloads[i]; the action always returns a
    // tickets array of the same length (even on failure).
    let pushTickets: Array<{ ok: boolean; error?: string }> = [];
    if (pushPayloads.length > 0) {
      const pushResult = await ctx.runAction(
        internal.functions.notifications.internal.sendBatchPushNotifications,
        { notifications: pushPayloads },
      );
      pushTickets = pushResult.tickets ?? [];
    }

    // Per-recipient SMS so we can record granular status (and so a single bad
    // phone doesn't take down the batch).
    for (const inv of invites) {
      const wantsPush = inv.channels.includes("push");
      const wantsSms = inv.channels.includes("sms");

      let smsStatus: "succeeded" | "failed" | "skipped" | undefined;
      let pushStatus: "succeeded" | "failed" | "skipped" | undefined;
      let failureReason: string | undefined;

      if (wantsPush) {
        const slice = pushSliceByInvite.get(inv._id);
        if (!slice || slice.start === slice.end) {
          // User had no active tokens — not a failure, just nowhere to send.
          pushStatus = "skipped";
        } else {
          const sliceTickets = pushTickets.slice(slice.start, slice.end);
          const anyOk = sliceTickets.some((t) => t.ok);
          pushStatus = anyOk ? "succeeded" : "failed";
          if (!anyOk) {
            failureReason =
              sliceTickets.find((t) => t.error)?.error ?? "push delivery failed";
          }
        }
      }

      if (wantsSms) {
        if (!inv.phone) {
          smsStatus = "skipped";
          failureReason = "no phone on file";
        } else {
          const body = buildInviteSmsBody({
            senderFirstName,
            eventTitle,
            when: formatScheduledAt(meetingInfo.scheduledAt),
            personalNote: inv.personalNote ?? null,
            eventUrl,
          });
          try {
            const r = await ctx.runAction(
              internal.functions.auth.phoneOtp.sendSMS,
              { phone: inv.phone, message: body },
            );
            // sendSMS returns { success: false } without throwing for
            // misconfigured Twilio creds and for the OTP_TEST_PHONE_NUMBERS
            // bypass. Don't mark "succeeded" when the underlying action
            // explicitly said it didn't deliver.
            if (r?.success) {
              smsStatus = "succeeded";
            } else {
              smsStatus = "failed";
              failureReason = "sendSMS returned success: false";
            }
          } catch (err) {
            smsStatus = "failed";
            failureReason = err instanceof Error ? err.message : String(err);
          }
        }
      }

      // Aggregate status. "skipped" means we had nowhere to send (no phone /
      // no push token) — that's a non-failure for the channel; what matters
      // is whether the recipient got the invite via at least one channel and
      // no requested channel hard-failed.
      const smsDelivered = wantsSms && smsStatus === "succeeded";
      const pushDelivered = wantsPush && pushStatus === "succeeded";
      const smsFailed = wantsSms && smsStatus === "failed";
      const pushFailed = wantsPush && pushStatus === "failed";
      const anyDelivered = smsDelivered || pushDelivered;
      const anyFailed = smsFailed || pushFailed;

      const overall =
        anyDelivered && !anyFailed
          ? "sent"
          : anyDelivered
            ? "partial"
            : "failed";

      await ctx.runMutation(internal.functions.eventInvites.updateInviteStatus, {
        inviteId: inv._id,
        status: overall,
        smsStatus,
        pushStatus,
        failureReason,
      });
    }

    return { success: true, recipientCount: invites.length };
  },
});

// ============================================================================
// Internal helpers
// ============================================================================

export const getInvitesByIds = internalQuery({
  args: { ids: v.array(v.id("eventInvites")) },
  handler: async (ctx, args) => {
    const rows = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    return rows.filter((r): r is Doc<"eventInvites"> => r !== null);
  },
});

export const getMeetingForInvite = internalQuery({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return null;
    return {
      title: meeting.title,
      groupId: meeting.groupId,
      communityId: meeting.communityId,
      shortId: meeting.shortId,
      scheduledAt: meeting.scheduledAt,
    };
  },
});

export const getSenderInfo = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    return {
      firstName: user.firstName || "",
      name:
        `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Someone",
      profilePhoto: getMediaUrl(user.profilePhoto) ?? null,
    };
  },
});

export const updateInviteStatus = internalMutation({
  args: {
    inviteId: v.id("eventInvites"),
    status: v.string(),
    smsStatus: v.optional(v.string()),
    pushStatus: v.optional(v.string()),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.inviteId, {
      status: args.status,
      smsStatus: args.smsStatus,
      pushStatus: args.pushStatus,
      failureReason: args.failureReason,
    });
  },
});

// ============================================================================
// Body formatting
// ============================================================================

function formatScheduledAt(ts: number): string {
  // Eastern is the default community timezone; date formatting in SMS is
  // intentionally simple — we don't ship the recipient's timezone server-side.
  const d = new Date(ts);
  const day = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  return `${day} · ${time}`;
}

function buildInviteSmsBody(parts: {
  senderFirstName: string;
  eventTitle: string;
  when: string;
  personalNote: string | null;
  eventUrl: string;
}): string {
  const lead = `${parts.senderFirstName} invited you to ${parts.eventTitle}`;
  const note = parts.personalNote ? `\n\n"${parts.personalNote}"` : "";
  const link = parts.eventUrl ? `\n\n${parts.eventUrl}` : "";
  const body = `${lead}\n${parts.when}${note}${link}`;
  if (body.length <= SMS_MAX_LEN) return body;
  // Personal note is the most likely thing to push us over the limit — truncate it.
  const overage = body.length - SMS_MAX_LEN;
  if (parts.personalNote && parts.personalNote.length > overage + 1) {
    const truncated =
      parts.personalNote.slice(0, parts.personalNote.length - overage - 1) + "…";
    return buildInviteSmsBody({ ...parts, personalNote: truncated });
  }
  return body.slice(0, SMS_MAX_LEN - 1) + "…";
}
