/**
 * Scheduling — assignments & lifecycle
 *
 * `roleAssignments` is the assignment state machine (ADR-023):
 *
 *   (none) --assign--> unconfirmed --respond--> confirmed | declined
 *
 * A declined assignment is left in place but its slot counts as open
 * (fill-summary counts `confirmed` + `unconfirmed` only).
 *
 * `publishEvent` reuses the existing notification infrastructure — Expo push
 * via `notifications.internal.sendBatchPushNotifications` and Twilio SMS via
 * `auth.phoneOtp.sendSMS` — fanned out through the job worker
 * (`ctx.scheduler`) rather than sent inline, exactly like `eventBlasts.send`.
 */

import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { requireAuth, requireAuthFromTokenAction } from "../../lib/auth";
import { DOMAIN_CONFIG } from "@togather/shared/config";
import { requirePlanScheduler } from "./permissions";

/** Assignment statuses, for reference and validation. */
const ASSIGNMENT_STATUSES = ["unconfirmed", "confirmed", "declined"] as const;

/**
 * Assign a channel member to a role on an event. Creates an `unconfirmed`
 * assignment and denormalizes the event's `eventDate` for double-booking
 * queries.
 *
 * Returns `doubleBooked: true` when the user already has another assignment
 * on the same calendar day (ADR-023 — a free derived warning, no blockout
 * table). The assignment is still created; the flag is advisory.
 *
 * Auth: group leader or community admin for the event's group.
 */
export const assignRole = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
    channelId: v.id("chatChannels"),
    roleId: v.id("teamRoles"),
    userId: v.id("users"),
    timeLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);
    const { plan } = await requirePlanScheduler(ctx, args.planId, callerId);

    // Guard against assigning the same person to the same role twice.
    const roleAssignments = await ctx.db
      .query("roleAssignments")
      .withIndex("by_plan_role", (q) =>
        q.eq("planId", args.planId).eq("roleId", args.roleId),
      )
      .collect();
    if (roleAssignments.some((a) => a.userId === args.userId)) {
      throw new ConvexError("This person is already assigned to this role");
    }

    // Double-booking detection: any other assignment for this user on the
    // same eventDate (across all teams/events).
    const sameDay = await ctx.db
      .query("roleAssignments")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("eventDate"), plan.eventDate))
      .collect();
    const doubleBooked = sameDay.length > 0;

    const assignmentId = await ctx.db.insert("roleAssignments", {
      planId: args.planId,
      channelId: args.channelId,
      roleId: args.roleId,
      userId: args.userId,
      eventDate: plan.eventDate,
      status: "unconfirmed",
      timeLabel: args.timeLabel,
      assignedById: callerId,
      assignedAt: Date.now(),
    });

    return { assignmentId, doubleBooked };
  },
});

/**
 * Remove an assignment entirely (the slot reopens for the scheduler).
 *
 * Auth: group leader or community admin for the event's group.
 */
export const unassign = mutation({
  args: {
    token: v.string(),
    assignmentId: v.id("roleAssignments"),
  },
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);

    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment) {
      throw new ConvexError("Assignment not found");
    }
    await requirePlanScheduler(ctx, assignment.planId, callerId);

    await ctx.db.delete(args.assignmentId);
    return { assignmentId: args.assignmentId };
  },
});

/**
 * Volunteer responds to their own assignment — `confirmed` or `declined`
 * (with an optional one-line decline note). Stamps `respondedAt`.
 *
 * Auth: the caller MUST own the assignment. Throws `ConvexError` otherwise.
 */
export const respondToAssignment = mutation({
  args: {
    token: v.string(),
    assignmentId: v.id("roleAssignments"),
    status: v.union(v.literal("confirmed"), v.literal("declined")),
    declineNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment) {
      throw new ConvexError("Assignment not found");
    }
    if (assignment.userId !== userId) {
      throw new ConvexError("You can only respond to your own assignments");
    }

    await ctx.db.patch(args.assignmentId, {
      status: args.status,
      declineNote:
        args.status === "declined" ? args.declineNote : undefined,
      respondedAt: Date.now(),
    });

    return { assignmentId: args.assignmentId, status: args.status };
  },
});

/**
 * Distinct users who have previously *confirmed* the given role, most
 * recent first. Powers the assign-UI "previously filled by" quicklink
 * (ADR-023 — a derived query in place of a qualification table).
 *
 * Auth: any authenticated user.
 */
export const previousFillers = query({
  args: {
    token: v.string(),
    roleId: v.id("teamRoles"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.token);

    const assignments = await ctx.db
      .query("roleAssignments")
      .withIndex("by_role", (q) => q.eq("roleId", args.roleId))
      .collect();

    // Confirmed only, newest event first.
    const confirmed = assignments
      .filter((a) => a.status === "confirmed")
      .sort((a, b) => b.eventDate - a.eventDate);

    // De-duplicate by user, keeping the most recent occurrence.
    const seen = new Set<string>();
    const distinct: Array<{ userId: Id<"users">; lastServedDate: number }> = [];
    for (const assignment of confirmed) {
      if (seen.has(assignment.userId)) continue;
      seen.add(assignment.userId);
      distinct.push({
        userId: assignment.userId,
        lastServedDate: assignment.eventDate,
      });
    }

    const limited =
      args.limit !== undefined ? distinct.slice(0, args.limit) : distinct;

    return Promise.all(
      limited.map(async (entry) => {
        const user = await ctx.db.get(entry.userId);
        return {
          userId: entry.userId,
          userName:
            `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() ||
            "Someone",
          lastServedDate: entry.lastServedDate,
        };
      }),
    );
  },
});

// ============================================================================
// publishEvent — action + internal fan-out
// ============================================================================

/**
 * Publish an event: flip its status to `published`, then fan out a request
 * notification (push + SMS) to every volunteer with an `unconfirmed`
 * assignment so they can accept or decline.
 *
 * Sending is delegated to an internal action via `ctx.scheduler` so a large
 * roster does not block the request — same pattern as `eventBlasts`.
 *
 * Auth: group leader or community admin for the event's group.
 */
export const publishEvent = action({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
  },
  handler: async (ctx, args): Promise<{ published: boolean; requestCount: number }> => {
    const callerId = await requireAuthFromTokenAction(ctx, args.token);

    const result: { requestCount: number } = await ctx.runMutation(
      internal.functions.scheduling.assignments.markPublished,
      { planId: args.planId, callerId: callerId as Id<"users"> },
    );

    if (result.requestCount > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.scheduling.assignments.sendAssignmentRequests,
        { planId: args.planId },
      );
    }

    return { published: true, requestCount: result.requestCount };
  },
});

/**
 * Internal: verify scheduler auth, set the plan to `published`, and report
 * how many unconfirmed assignments will receive a request notification.
 */
export const markPublished = internalMutation({
  args: {
    planId: v.id("eventPlans"),
    callerId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requirePlanScheduler(ctx, args.planId, args.callerId);

    await ctx.db.patch(args.planId, {
      status: "published",
      updatedAt: Date.now(),
    });

    const assignments = await ctx.db
      .query("roleAssignments")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .collect();
    const requestCount = assignments.filter(
      (a) => a.status === "unconfirmed",
    ).length;

    return { requestCount };
  },
});

/**
 * Internal: gather everything `sendAssignmentRequests` needs — event display
 * info plus, per unconfirmed-assignment volunteer, their phone number.
 */
export const getAssignmentRequestTargets = internalQuery({
  args: { planId: v.id("eventPlans") },
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.planId);
    if (!plan) return null;

    const assignments = await ctx.db
      .query("roleAssignments")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .collect();
    const unconfirmed = assignments.filter((a) => a.status === "unconfirmed");

    const recipients = await Promise.all(
      unconfirmed.map(async (assignment) => {
        const [user, role] = await Promise.all([
          ctx.db.get(assignment.userId),
          ctx.db.get(assignment.roleId),
        ]);
        return {
          assignmentId: assignment._id,
          userId: assignment.userId,
          phone: user?.phone ?? null,
          roleName: role?.name ?? "a role",
        };
      }),
    );

    return {
      title: plan.title,
      eventDate: plan.eventDate,
      groupId: plan.groupId,
      communityId: plan.communityId,
      recipients,
    };
  },
});

/**
 * Internal: record sent notifications in the `notifications` table so they
 * surface in the in-app inbox.
 */
export const recordAssignmentNotifications = internalMutation({
  args: {
    notifications: v.array(
      v.object({
        userId: v.id("users"),
        communityId: v.id("communities"),
        groupId: v.id("groups"),
        title: v.string(),
        body: v.string(),
        url: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const nowMs = Date.now();
    for (const n of args.notifications) {
      await ctx.db.insert("notifications", {
        userId: n.userId,
        communityId: n.communityId,
        groupId: n.groupId,
        notificationType: "scheduling_assignment_request",
        title: n.title,
        body: n.body,
        data: { url: n.url },
        status: "sent",
        isRead: false,
        createdAt: nowMs,
        sentAt: nowMs,
      });
    }
  },
});

/**
 * Internal: fan out push + SMS assignment requests for a published event.
 *
 * Reuses the shared notification path rather than building anything new:
 *   - push tokens   → `notifications.tokens.getActiveTokensForUsers`
 *   - push delivery → `notifications.internal.sendBatchPushNotifications`
 *   - SMS delivery  → `auth.phoneOtp.sendSMS`
 * Each request links to the assignment's accept/decline deep link.
 */
export const sendAssignmentRequests = internalAction({
  args: { planId: v.id("eventPlans") },
  handler: async (ctx, args) => {
    const targets = await ctx.runQuery(
      internal.functions.scheduling.assignments.getAssignmentRequestTargets,
      { planId: args.planId },
    );
    if (!targets || targets.recipients.length === 0) {
      return { pushSent: 0, smsSent: 0 };
    }

    const eventDate = new Date(targets.eventDate).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    // Build per-assignment deep links so a tapped request opens straight to
    // the volunteer's accept/decline screen.
    const linkFor = (assignmentId: string) =>
      `${DOMAIN_CONFIG.appUrl}/scheduling/assignment/${assignmentId}`;

    // --- Push -------------------------------------------------------------
    const userIds = targets.recipients.map((r) => r.userId);
    const tokenResults: Array<{ userId: string; tokens: string[] }> =
      await ctx.runQuery(
        internal.functions.notifications.tokens.getActiveTokensForUsers,
        { userIds },
      );
    const tokensByUser = new Map(
      tokenResults.map((r) => [r.userId, r.tokens]),
    );

    const pushNotifications = targets.recipients.flatMap((recipient) => {
      const tokens = tokensByUser.get(recipient.userId) ?? [];
      const title = `You're scheduled: ${targets.title}`;
      const body = `${recipient.roleName} on ${eventDate}. Tap to accept or decline.`;
      const url = linkFor(recipient.assignmentId);
      return tokens.map((token) => ({
        token,
        title,
        body,
        data: {
          type: "scheduling_assignment_request",
          assignmentId: recipient.assignmentId,
          planId: args.planId,
          url,
        },
      }));
    });

    let pushSent = 0;
    if (pushNotifications.length > 0) {
      const pushResult = await ctx.runAction(
        internal.functions.notifications.internal.sendBatchPushNotifications,
        { notifications: pushNotifications },
      );
      pushSent = pushResult.success ? pushNotifications.length : 0;
    }

    // --- SMS --------------------------------------------------------------
    let smsSent = 0;
    for (const recipient of targets.recipients) {
      if (!recipient.phone) continue;
      const smsBody =
        `You're scheduled for ${recipient.roleName} at ${targets.title} ` +
        `on ${eventDate}.\n\nAccept or decline: ${linkFor(recipient.assignmentId)}`;
      try {
        await ctx.runAction(internal.functions.auth.phoneOtp.sendSMS, {
          phone: recipient.phone,
          message: smsBody,
        });
        smsSent += 1;
      } catch {
        // Best-effort: a failed SMS should not abort the rest of the fan-out.
      }
    }

    // --- In-app inbox records --------------------------------------------
    await ctx.runMutation(
      internal.functions.scheduling.assignments.recordAssignmentNotifications,
      {
        notifications: targets.recipients.map((recipient) => ({
          userId: recipient.userId,
          communityId: targets.communityId,
          groupId: targets.groupId,
          title: `You're scheduled: ${targets.title}`,
          body: `${recipient.roleName} on ${eventDate}.`,
          url: linkFor(recipient.assignmentId),
        })),
      },
    );

    return { pushSent, smsSent };
  },
});

export { ASSIGNMENT_STATUSES };
