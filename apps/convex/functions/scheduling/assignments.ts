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
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth, requireAuthFromTokenAction } from "../../lib/auth";
import {
  buildSearchText,
  isValidPhone,
  normalizePhone,
} from "../../lib/utils";
import { COMMUNITY_ROLES } from "../../lib/permissions";
import { DOMAIN_CONFIG } from "@togather/shared/config";
import { requireTeamGroupMember, requirePlanScheduler } from "./permissions";

/** Assignment statuses, for reference and validation. */
const ASSIGNMENT_STATUSES = ["unconfirmed", "confirmed", "declined"] as const;

/** Milliseconds in one day — used for calendar-day double-booking buckets. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Floor a timestamp to the start of its UTC calendar day. Two `eventDate`
 * values that share a bucket fall on the same calendar day, regardless of
 * the time of day — this is what the double-booking "same day" rule means.
 */
function utcDayBucket(eventDate: number): number {
  return Math.floor(eventDate / MS_PER_DAY) * MS_PER_DAY;
}

/**
 * Validate that a `teamId`/`roleId` pair is internally consistent and belongs
 * to the given group. Without this, a scheduler authorized for group A could
 * pass a team/role from an unrelated group B and have volunteers later synced
 * into B's team channel.
 *
 * Asserts:
 *   - the `teamRoles` row exists and its `teamId` equals `teamId`;
 *   - the `teams` row exists and its `groupId` equals `groupId` (the event
 *     plan's owning group).
 *
 * @throws ConvexError on any mismatch.
 */
async function requireTeamRolePair(
  ctx: QueryCtx | MutationCtx,
  teamId: Id<"teams">,
  roleId: Id<"teamRoles">,
  groupId: Id<"groups">,
): Promise<void> {
  const role = await ctx.db.get(roleId);
  if (!role) {
    throw new ConvexError("Role not found");
  }
  if (role.teamId !== teamId) {
    throw new ConvexError("Role does not belong to the specified team");
  }

  const team = await ctx.db.get(teamId);
  if (!team) {
    throw new ConvexError("Team not found");
  }
  if (team.groupId !== groupId) {
    throw new ConvexError("Team does not belong to this event's group");
  }
  // Archived teams are out of rotation — `archiveTeam` purges their synced
  // members and `reconcileTeamChannelImpl` short-circuits for them, so a new
  // assignment here would silently fail to mirror into the channel.
  if (team.isArchived === true) {
    throw new ConvexError("Cannot assign roles on an archived team");
  }
}

/**
 * Validate that `userId` is an active member of `groupId`. The assignee of a
 * role must belong to the event's group: `reconcileTeamChannel` derives
 * serving-team channel membership from non-declined assignments, so an
 * unchecked `userId` would let a crafted client add an arbitrary person into
 * the team channel and expose its roster to them.
 *
 * @throws ConvexError if the user is not an active group member.
 */
async function requireActiveGroupMember(
  ctx: QueryCtx | MutationCtx,
  groupId: Id<"groups">,
  userId: Id<"users">,
): Promise<void> {
  const membership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q) =>
      q.eq("groupId", groupId).eq("userId", userId),
    )
    .first();
  const active =
    !!membership &&
    !membership.leftAt &&
    (!membership.requestStatus || membership.requestStatus === "accepted");
  if (!active) {
    throw new ConvexError("This person is not a member of the event's group");
  }
}

/**
 * Shared assignment-write helper. Used by `assignRole`, `assignFromCommunity`,
 * and `inviteAndAssign` — they all converge on the same writes once auth and
 * any prerequisite group-membership work is done.
 *
 * Performs the role-pair guard, the active-group-member check, the
 * already-assigned guard, double-booking detection, the `roleAssignments`
 * insert, and the team-channel reconciliation schedules. Returns the new
 * assignment id and the advisory `doubleBooked` flag.
 *
 * Auth: the caller MUST already have been authorized by
 * `requirePlanScheduler` (or stricter) before this is invoked.
 */
async function performAssignment(
  ctx: MutationCtx,
  args: {
    plan: Doc<"eventPlans">;
    teamId: Id<"teams">;
    roleId: Id<"teamRoles">;
    userId: Id<"users">;
    timeLabel?: string;
    callerId: Id<"users">;
  },
): Promise<{ assignmentId: Id<"roleAssignments">; doubleBooked: boolean }> {
  const { plan, teamId, roleId, userId, timeLabel, callerId } = args;

  // Security: the teamId/roleId pair must be consistent and belong to this
  // event's group — otherwise a scheduler for one group could inject
  // volunteers into an unrelated group's team channel via the later sync.
  await requireTeamRolePair(ctx, teamId, roleId, plan.groupId);

  // The assignee must be an active member of the event's group — channel
  // membership is derived from assignments, so an unchecked userId would
  // expose the serving-team channel to an arbitrary person.
  await requireActiveGroupMember(ctx, plan.groupId, userId);

  // Guard against assigning the same person to the same role twice.
  const roleAssignments = await ctx.db
    .query("roleAssignments")
    .withIndex("by_plan_role", (q) =>
      q.eq("planId", plan._id).eq("roleId", roleId),
    )
    .collect();
  if (roleAssignments.some((a) => a.userId === userId)) {
    throw new ConvexError("This person is already assigned to this role");
  }

  // Double-booking detection: any other assignment for this user that
  // falls on the same calendar day (across all teams/events). We compare
  // by UTC day bucket — two events on the same day at 9 AM and 11 AM have
  // different `eventDate` values but still collide. Assignments on the
  // current plan are excluded so re-assigning within an event never warns.
  const targetDay = utcDayBucket(plan.eventDate);
  const userAssignments = await ctx.db
    .query("roleAssignments")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const doubleBooked = userAssignments.some(
    (a) =>
      a.planId !== plan._id && utcDayBucket(a.eventDate) === targetDay,
  );

  const assignmentId = await ctx.db.insert("roleAssignments", {
    planId: plan._id,
    teamId,
    roleId,
    userId,
    eventDate: plan.eventDate,
    status: "unconfirmed",
    timeLabel,
    assignedById: callerId,
    assignedAt: Date.now(),
  });

  // Auto-sync the team channel's membership off the new assignment, and any
  // cross-team channel that draws from this serving team.
  await ctx.scheduler.runAfter(
    0,
    internal.functions.scheduling.teamChannelSync.reconcileTeamChannel,
    { teamId },
  );
  await ctx.scheduler.runAfter(
    0,
    internal.functions.scheduling.teamChannelSync
      .reconcileCrossTeamChannelsForSource,
    { sourceTeamId: teamId },
  );

  return { assignmentId, doubleBooked };
}

/**
 * Ensure `userId` has an active `groupMembers` row in `groupId`. Returns
 * whether a new row was created (existing-but-archived rows are reactivated
 * by clearing `leftAt`; new rows are inserted as role:"member").
 *
 * Used by the assign-from-community / invite-new-person flows. Callers MUST
 * have passed `requirePlanScheduler` for the plan's group before invoking.
 */
async function ensureActiveGroupMembership(
  ctx: MutationCtx,
  groupId: Id<"groups">,
  userId: Id<"users">,
): Promise<{ addedToGroup: boolean }> {
  const existing = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q) =>
      q.eq("groupId", groupId).eq("userId", userId),
    )
    .first();

  const timestamp = Date.now();
  if (existing) {
    const active =
      !existing.leftAt &&
      (!existing.requestStatus || existing.requestStatus === "accepted");
    if (active) {
      return { addedToGroup: false };
    }
    // Reactivate an archived membership (leftAt set, or a stale "pending"
    // request) — the scheduler is implicitly approving them. The role is
    // reset to "member" so we don't silently restore historical leadership
    // (or other elevated roles) just because someone left and got assigned
    // back via the assign-from-community flow.
    await ctx.db.patch(existing._id, {
      role: "member",
      leftAt: undefined,
      requestStatus: "accepted",
      requestReviewedAt: timestamp,
    });
    return { addedToGroup: true };
  }

  await ctx.db.insert("groupMembers", {
    groupId,
    userId,
    role: "member",
    joinedAt: timestamp,
    notificationsEnabled: true,
  });
  return { addedToGroup: true };
}

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
    teamId: v.id("teams"),
    roleId: v.id("teamRoles"),
    userId: v.id("users"),
    timeLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);
    const { plan } = await requirePlanScheduler(ctx, args.planId, callerId);

    return performAssignment(ctx, {
      plan,
      teamId: args.teamId,
      roleId: args.roleId,
      userId: args.userId,
      timeLabel: args.timeLabel,
      callerId,
    });
  },
});

/**
 * Assign a community member who is *not yet in the plan's group* to a role:
 * adds them to the group as a "member" if needed, then performs the same
 * assignment writes as `assignRole` (including the same-day double-booking
 * advisory and the team/role-pair / archived-team guards).
 *
 * Powers the second leg of the AssignSheet community search — a one-tap
 * "add to group + assign" for an existing community member.
 *
 * Auth: group leader or community admin for the event's group
 * (`requirePlanScheduler`). The new group membership is implicitly
 * "scheduler-approved" — we do NOT require the assignee to pre-accept.
 */
export const assignFromCommunity = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
    teamId: v.id("teams"),
    roleId: v.id("teamRoles"),
    userId: v.id("users"),
    timeLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);
    const { plan } = await requirePlanScheduler(ctx, args.planId, callerId);

    // Verify the target is at least an active *community* member — a
    // scheduler must not be able to add an arbitrary cross-community user
    // into their group by id-guessing.
    const target = await ctx.db.get(args.userId);
    if (!target) {
      throw new ConvexError("Person not found");
    }
    // Truly deactivated accounts must not be re-introduced into scheduling.
    // Placeholder users (`isPlaceholder: true`) are intentionally
    // `isActive: false` until they sign up and claim their account; they're
    // valid scheduling targets and can be assigned to multiple roles like
    // any other community member.
    if (target.isActive === false && target.isPlaceholder !== true) {
      throw new ConvexError(
        "This person's account is deactivated and cannot be scheduled",
      );
    }
    const communityMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.userId).eq("communityId", plan.communityId),
      )
      .first();
    if (!communityMembership || communityMembership.status !== 1) {
      throw new ConvexError(
        "This person is not a member of the event's community",
      );
    }

    const { addedToGroup } = await ensureActiveGroupMembership(
      ctx,
      plan.groupId,
      args.userId,
    );

    const { assignmentId } = await performAssignment(ctx, {
      plan,
      teamId: args.teamId,
      roleId: args.roleId,
      userId: args.userId,
      timeLabel: args.timeLabel,
      callerId,
    });

    return { assignmentId, addedToGroup };
  },
});

// ============================================================================
// inviteAndAssign — placeholder user + SMS invite + immediate assignment
// ============================================================================

/**
 * Max name length we accept for the invitee's `firstName`. Anything beyond
 * this is almost certainly a paste accident; truncating silently would hide
 * it from the scheduler.
 */
const INVITE_FIRST_NAME_MAX = 50;

/**
 * Validate the invitee's first name. Must be 1–50 chars and contain at
 * least one alphanumeric character (so we reject pure-punctuation names
 * that would render as blanks in the UI).
 */
function validateInviteFirstName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ConvexError("First name is required");
  }
  if (trimmed.length > INVITE_FIRST_NAME_MAX) {
    throw new ConvexError(
      `First name must be ${INVITE_FIRST_NAME_MAX} characters or fewer`,
    );
  }
  if (!/[\p{L}\p{N}]/u.test(trimmed)) {
    throw new ConvexError("First name must contain at least one letter or digit");
  }
  return trimmed;
}

/**
 * Internal: create a placeholder `users` row + community/group memberships,
 * then run the same assignment writes as `assignRole`. Used by the
 * `inviteAndAssign` action so the writes happen in a single transaction —
 * an SMS send failure later does NOT leave half-formed rows.
 *
 * Auth: `requirePlanScheduler` on `planId`. Inputs are expected to be
 * pre-validated by the caller (normalized phone, validated first name).
 */
export const inviteAndAssignInternal = internalMutation({
  args: {
    planId: v.id("eventPlans"),
    teamId: v.id("teams"),
    roleId: v.id("teamRoles"),
    firstName: v.string(),
    normalizedPhone: v.string(),
    timeLabel: v.optional(v.string()),
    callerId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Authorize first — `requirePlanScheduler` must run *before* the
    // by-phone lookup so an unauthorized caller cannot probe whether
    // arbitrary phone numbers exist in `users` (codex review on PR #412).
    const { plan } = await requirePlanScheduler(
      ctx,
      args.planId,
      args.callerId,
    );

    // Pull display-context once — used by both the existing-user and the
    // new-placeholder branches below.
    const community = await ctx.db.get(plan.communityId);
    const team = await ctx.db.get(args.teamId);
    const caller = await ctx.db.get(args.callerId);

    // ------------------------------------------------------------------
    // Existing-user branch — phone matches a row in `users`.
    // ------------------------------------------------------------------
    // We do NOT refuse: instead we re-route through the same flow as
    // `assignFromCommunity` (add to the group if not already, then
    // assign). The action returns `existedAlready: true` so the
    // AssignSheet can pop a "matched this phone to {name}" alert
    // instead of treating the result like a fresh invite.
    //
    // A silent merge is safe because the existing account *owns* this
    // phone — assigning them to a role is the same thing the leader
    // would do if they had searched by name.
    const existing = await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", args.normalizedPhone))
      .first();
    if (existing) {
      // The matched user must already be an active member of this
      // community. Adding them to a different community by phone
      // alone would be a privacy / consent violation — the leader can
      // invite a fresh placeholder under a different phone if needed.
      const comm = await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", existing._id).eq("communityId", plan.communityId),
        )
        .first();
      if (!comm || comm.status !== 1) {
        throw new ConvexError(
          "That phone belongs to a Togather account in a different community.",
        );
      }
      // Truly deactivated accounts are not schedulable; placeholders are
      // (they're `isActive: false` by design until claim).
      if (existing.isActive === false && existing.isPlaceholder !== true) {
        throw new ConvexError(
          "That phone belongs to a deactivated account and can't be scheduled.",
        );
      }
      await ensureActiveGroupMembership(ctx, plan.groupId, existing._id);
      const { assignmentId } = await performAssignment(ctx, {
        plan,
        teamId: args.teamId,
        roleId: args.roleId,
        userId: existing._id,
        timeLabel: args.timeLabel,
        callerId: args.callerId,
      });
      return {
        assignmentId,
        invitedUserId: existing._id,
        communityName: community?.name ?? "Togather",
        teamName: team?.name ?? "your team",
        leaderFirstName: caller?.firstName?.trim() || "Someone",
        planStatus: plan.status,
        existedAlready: true,
        existingDisplayName:
          [existing.firstName, existing.lastName]
            .filter((v): v is string => Boolean(v?.trim()))
            .join(" ")
            .trim() || null,
      };
    }

    // ------------------------------------------------------------------
    // New placeholder branch — phone does NOT match any existing user.
    // ------------------------------------------------------------------
    const timestamp = Date.now();

    // 1. Placeholder user. `isActive: false` until claim — keeps them out
    //    of any "active users" filters and matches how a non-signed-up
    //    account *should* look. `isPlaceholder: true` is the signal that
    //    the phone-OTP signup flow uses to claim instead of insert.
    const newUserId = await ctx.db.insert("users", {
      firstName: args.firstName,
      phone: args.normalizedPhone,
      phoneVerified: false,
      isActive: false,
      isPlaceholder: true,
      isStaff: false,
      isSuperuser: false,
      dateJoined: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      searchText: buildSearchText({
        firstName: args.firstName,
        phone: args.normalizedPhone,
      }),
    });

    // 2. Community membership — they need to exist in the community for
    //    the assignment to be coherent with reconciliation. Status=1
    //    (active), role=MEMBER, matching `communityLandingPage` insert.
    await ctx.db.insert("userCommunities", {
      userId: newUserId,
      communityId: plan.communityId,
      roles: COMMUNITY_ROLES.MEMBER,
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // 3. Group membership — `requireActiveGroupMember` (inside
    //    `performAssignment`) will then succeed.
    await ctx.db.insert("groupMembers", {
      groupId: plan.groupId,
      userId: newUserId,
      role: "member",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    // 4. The actual assignment writes (same path as `assignRole`).
    const { assignmentId } = await performAssignment(ctx, {
      plan,
      teamId: args.teamId,
      roleId: args.roleId,
      userId: newUserId,
      timeLabel: args.timeLabel,
      callerId: args.callerId,
    });

    return {
      assignmentId,
      invitedUserId: newUserId,
      // Context the action needs to build the SMS body without re-querying.
      communityName: community?.name ?? "Togather",
      teamName: team?.name ?? "your team",
      leaderFirstName: caller?.firstName?.trim() || "Someone",
      // The action gates SMS send on whether the plan is already public —
      // a draft plan should not text the invitee until the leader publishes.
      planStatus: plan.status,
      existedAlready: false,
      existingDisplayName: null,
    };
  },
});

/**
 * Create a placeholder user for a person who is NOT yet in Togather, add
 * them to the plan's community + group, assign them to a role on the event,
 * and SMS-invite them to sign up. Their `_id` is stable across the eventual
 * phone-OTP signup claim, so the assignment is preserved.
 *
 * This is exposed as an `action` (not a plain mutation) because the SMS
 * send goes through Twilio inside a Node action — running it inline lets
 * us report actual delivery status via `sentInvite` rather than reporting
 * a scheduling success. The DB writes are batched into
 * `inviteAndAssignInternal` so we never leave half-formed rows.
 *
 * If the SMS send fails, the placeholder + memberships + assignment are
 * kept (we still have a record of the invite) and `sentInvite: false` is
 * returned with a `console.error` for the operator.
 *
 * Auth: group leader or community admin for the event's group
 * (re-asserted inside `inviteAndAssignInternal`).
 */
export const inviteAndAssign = action({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
    teamId: v.id("teams"),
    roleId: v.id("teamRoles"),
    firstName: v.string(),
    phone: v.string(),
    timeLabel: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    assignmentId: Id<"roleAssignments">;
    invitedUserId: Id<"users">;
    sentInvite: boolean;
    /** True when SMS was intentionally not sent because the plan is still a draft. */
    deferred: boolean;
    /** True when the phone matched an existing community user and we assigned them instead of creating a new placeholder. */
    existedAlready: boolean;
    /** Display name of the existing user when `existedAlready` is true, else null. */
    existingDisplayName: string | null;
  }> => {
    const callerId = await requireAuthFromTokenAction(ctx, args.token);

    // Validate inputs before any DB work — failing here is cheap and
    // produces clear errors for the client.
    const firstName = validateInviteFirstName(args.firstName);
    if (!isValidPhone(args.phone)) {
      throw new ConvexError("Enter a valid phone number");
    }
    const normalizedPhone = normalizePhone(args.phone);

    // Run all DB writes in a single internal mutation transaction. The
    // mutation gates on `requirePlanScheduler` *before* the by-phone lookup
    // so an unauthorized caller cannot probe whether arbitrary phone
    // numbers exist in `users`. When the phone *does* match an existing
    // community member, the mutation re-routes through the same
    // assign-from-community path used for known volunteers and surfaces
    // `existedAlready: true` so the AssignSheet can render "we matched
    // this phone to an existing person" instead of treating the result as
    // a fresh invite.
    const result: {
      assignmentId: Id<"roleAssignments">;
      invitedUserId: Id<"users">;
      communityName: string;
      teamName: string;
      leaderFirstName: string;
      planStatus: string;
      existedAlready: boolean;
      existingDisplayName: string | null;
    } = await ctx.runMutation(
      internal.functions.scheduling.assignments.inviteAndAssignInternal,
      {
        planId: args.planId,
        teamId: args.teamId,
        roleId: args.roleId,
        firstName,
        normalizedPhone,
        timeLabel: args.timeLabel,
        callerId: callerId as Id<"users">,
      },
    );

    // If the phone matched an existing community user, we re-used that
    // account — no invite SMS to send (they already have the app and will
    // get the standard "you're scheduled" SMS at publish time, just like
    // any other assignment).
    if (result.existedAlready) {
      return {
        assignmentId: result.assignmentId,
        invitedUserId: result.invitedUserId,
        sentInvite: false,
        deferred: false,
        existedAlready: true,
        existingDisplayName: result.existingDisplayName,
      };
    }

    // Defer the SMS until the leader hits publish when the plan is still a
    // draft — `publishEvent`'s fan-out (`sendAssignmentRequests`) re-sends
    // the placeholder-specific invite then. For a plan that is already
    // published, send immediately (the leader is making post-publish
    // additions and wants the invitee notified right away).
    if (result.planStatus !== "published") {
      return {
        assignmentId: result.assignmentId,
        invitedUserId: result.invitedUserId,
        sentInvite: false,
        deferred: true,
        existedAlready: false,
        existingDisplayName: null,
      };
    }

    // SMS the invite. Twilio config issues / network failures are captured
    // and reported via `sentInvite: false` — we do NOT roll back the DB
    // writes, because the leader still wants the role filled.
    //
    // The deeplink target is the app's normal phone-signup URL with the
    // phone prefilled. The phone-OTP flow's claim logic (see
    // `verifyPhoneOTP` / `registerNewUser`) takes over from there.
    const signupUrl = `${DOMAIN_CONFIG.appUrl}/signup?phone=${encodeURIComponent(
      normalizedPhone,
    )}`;
    const smsBody =
      `${result.leaderFirstName} added you to ${result.teamName} at ` +
      `${result.communityName}. Tap to join: ${signupUrl}`;

    let sentInvite = false;
    try {
      const smsResult = await ctx.runAction(
        internal.functions.auth.phoneOtp.sendSMS,
        { phone: normalizedPhone, message: smsBody },
      );
      sentInvite = smsResult?.success === true;
      if (!sentInvite) {
        console.error(
          "[inviteAndAssign] sendSMS returned success: false — Twilio likely not configured",
          { invitedUserId: result.invitedUserId },
        );
      }
    } catch (err) {
      console.error("[inviteAndAssign] SMS send threw", {
        invitedUserId: result.invitedUserId,
        error: err instanceof Error ? err.message : String(err),
      });
      sentInvite = false;
    }

    return {
      assignmentId: result.assignmentId,
      invitedUserId: result.invitedUserId,
      sentInvite,
      deferred: false,
      existedAlready: false,
      existingDisplayName: null,
    };
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

    // Auto-sync the team channel — the removed assignment may drop the user
    // out of the channel's derived membership — and any cross-team channel
    // that draws from this serving team.
    await ctx.scheduler.runAfter(
      0,
      internal.functions.scheduling.teamChannelSync.reconcileTeamChannel,
      { teamId: assignment.teamId },
    );
    await ctx.scheduler.runAfter(
      0,
      internal.functions.scheduling.teamChannelSync
        .reconcileCrossTeamChannelsForSource,
      { sourceTeamId: assignment.teamId },
    );

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

    // A decline drops the user from the channel's derived membership; a
    // confirm has no membership effect, but reconciling on both keeps the
    // sync trigger uniform and cheap. Also reconcile any cross-team channel
    // that draws from this serving team.
    await ctx.scheduler.runAfter(
      0,
      internal.functions.scheduling.teamChannelSync.reconcileTeamChannel,
      { teamId: assignment.teamId },
    );
    await ctx.scheduler.runAfter(
      0,
      internal.functions.scheduling.teamChannelSync
        .reconcileCrossTeamChannelsForSource,
      { sourceTeamId: assignment.teamId },
    );

    return { assignmentId: args.assignmentId, status: args.status };
  },
});

/**
 * Distinct users who have previously *confirmed* the given role, most
 * recent first. Powers the assign-UI "previously filled by" quicklink
 * (ADR-023 — a derived query in place of a qualification table).
 *
 * Auth: an active member of the role's campus group, or a community admin —
 * the response leaks volunteer names, so it is gated like other
 * group-scoped reads.
 */
export const previousFillers = query({
  args: {
    token: v.string(),
    roleId: v.id("teamRoles"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const role = await ctx.db.get(args.roleId);
    if (!role) {
      throw new ConvexError("Role not found");
    }
    await requireTeamGroupMember(ctx, role.teamId, userId);

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

    const result: { requestCount: number; teamIds: Id<"teams">[] } =
      await ctx.runMutation(
        internal.functions.scheduling.assignments.markPublished,
        { planId: args.planId, callerId: callerId as Id<"users"> },
      );

    if (result.requestCount > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.scheduling.assignments.sendAssignmentRequests,
        { planId: args.planId, publisherId: callerId as Id<"users"> },
      );
    }

    // Auto-sync every team channel that has assignments on this event so
    // publishing pulls confirmed/unconfirmed volunteers into their channels,
    // plus any cross-team channel that draws from those serving teams.
    for (const teamId of result.teamIds) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.scheduling.teamChannelSync.reconcileTeamChannel,
        { teamId },
      );
      await ctx.scheduler.runAfter(
        0,
        internal.functions.scheduling.teamChannelSync
          .reconcileCrossTeamChannelsForSource,
        { sourceTeamId: teamId },
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

    // Schedule the automatic 4-day / 1-day "still unconfirmed?" nudges.
    // Only worth scheduling if someone hasn't responded yet.
    if (requestCount > 0) {
      await scheduleUnconfirmedReminders(ctx, args.planId);
    }

    // Distinct serving teams touched by this event's assignments — the action
    // reconciles each one after publishing.
    const teamIds = [...new Set(assignments.map((a) => a.teamId))];

    return { requestCount, teamIds };
  },
});

/** The two reminder lead times, in days before `eventDate`. */
const REMINDER_KINDS = [
  { kind: "4d" as const, days: 4 },
  { kind: "1d" as const, days: 1 },
];

/**
 * (Re)schedule the unconfirmed-volunteer reminders for a plan. Cancels any
 * existing reminder jobs, resets the `*Sent` flags, then schedules a fresh
 * `sendUnconfirmedReminders` job for each lead time whose fire moment is
 * still in the future. Shared by publish (`markPublished`) and reschedule
 * (`events.updateEvent`), so the two paths can't drift.
 *
 * No-op-safe: if a stored job already ran or was cancelled, `scheduler.cancel`
 * is wrapped in try/catch.
 */
export async function scheduleUnconfirmedReminders(
  ctx: MutationCtx,
  planId: Id<"eventPlans">,
): Promise<void> {
  const plan = await ctx.db.get(planId);
  if (!plan) return;

  for (const jobId of [plan.reminder4dJobId, plan.reminder1dJobId]) {
    if (jobId) {
      try {
        await ctx.scheduler.cancel(jobId);
      } catch {
        // Job may have already run or been cancelled — ignore.
      }
    }
  }

  const now = Date.now();
  const patch: Partial<Doc<"eventPlans">> = {
    reminder4dJobId: undefined,
    reminder1dJobId: undefined,
    reminder4dSent: false,
    reminder1dSent: false,
  };

  for (const { kind, days } of REMINDER_KINDS) {
    const fireAt = plan.eventDate - days * MS_PER_DAY;
    if (fireAt <= now) continue;
    const jobId = await ctx.scheduler.runAt(
      fireAt,
      internal.functions.scheduling.assignments.sendUnconfirmedReminders,
      { planId, kind },
    );
    if (kind === "4d") patch.reminder4dJobId = jobId;
    else patch.reminder1dJobId = jobId;
  }

  await ctx.db.patch(planId, patch);
}

/**
 * Cancel both reminder jobs for a plan (used on delete). Best-effort —
 * a job that already ran or was cancelled is ignored.
 */
export async function cancelUnconfirmedReminders(
  ctx: MutationCtx,
  plan: Doc<"eventPlans">,
): Promise<void> {
  for (const jobId of [plan.reminder4dJobId, plan.reminder1dJobId]) {
    if (jobId) {
      try {
        await ctx.scheduler.cancel(jobId);
      } catch {
        // Already ran or cancelled — ignore.
      }
    }
  }
}

/**
 * Internal: flip the matching `reminder{kind}Sent` flag so the reminder is
 * idempotent (a re-run of the scheduled job won't re-send).
 */
export const markPlanReminderSent = internalMutation({
  args: {
    planId: v.id("eventPlans"),
    kind: v.union(v.literal("4d"), v.literal("1d")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.planId, {
      [args.kind === "4d" ? "reminder4dSent" : "reminder1dSent"]: true,
    });
  },
});

/**
 * Internal: fire the automatic reminder for a published event. Re-queries the
 * roster at fire time (via `getAssignmentRequestTargets`), so a volunteer who
 * has since declined or been unassigned gets nothing — the reminder auto-stops
 * with no proactive cancellation needed. Placeholder users are skipped (they
 * have no app to confirm in yet). Reuses the same push + SMS + inbox path as
 * `sendAssignmentRequests`, with distinct "reminder" copy.
 *
 * Audience by kind:
 *   - "4d" → only volunteers still `unconfirmed` ("please confirm or decline").
 *   - "1d" → everyone still rostered. Those still `unconfirmed` get the same
 *     confirm/decline nudge; those already `confirmed` get a "serving tomorrow"
 *     heads-up with no confirm/decline ask. Declined/removed get nothing.
 */
export const sendUnconfirmedReminders = internalAction({
  args: {
    planId: v.id("eventPlans"),
    kind: v.union(v.literal("4d"), v.literal("1d")),
  },
  handler: async (ctx, args) => {
    const plan = await ctx.runQuery(
      internal.functions.scheduling.assignments.getPlanReminderState,
      { planId: args.planId },
    );
    // Bail if the plan is gone, unpublished, or this reminder already sent.
    if (!plan || plan.status !== "published") return { pushSent: 0, smsSent: 0 };
    if (args.kind === "4d" && plan.reminder4dSent) {
      return { pushSent: 0, smsSent: 0 };
    }
    if (args.kind === "1d" && plan.reminder1dSent) {
      return { pushSent: 0, smsSent: 0 };
    }

    // 1-day reminders also go to confirmed volunteers (serving-tomorrow
    // heads-up); the 4-day pass stays unconfirmed-only.
    const targets = await ctx.runQuery(
      internal.functions.scheduling.assignments.getAssignmentRequestTargets,
      {
        planId: args.planId,
        publisherId: plan.createdById,
        includeConfirmed: args.kind === "1d",
      },
    );

    if (!targets) return { pushSent: 0, smsSent: 0 };

    // Reminders only go to real users who can actually confirm/decline.
    const recipients = targets.recipients.filter((r) => !r.isPlaceholder);
    if (recipients.length === 0) {
      // Nothing to deliver, but mark sent so an empty roster doesn't keep
      // re-firing on every cron pass.
      await ctx.runMutation(
        internal.functions.scheduling.assignments.markPlanReminderSent,
        { planId: args.planId, kind: args.kind },
      );
      return { pushSent: 0, smsSent: 0 };
    }

    const eventDate = new Date(targets.eventDate).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    // SMS needs an absolute web link; push/in-app navigation needs a RELATIVE
    // path. expo-router treats an absolute `https://…` URL as an external link
    // and opens it in the browser instead of routing in-app, so the inbox/push
    // `url` must stay relative (see resolveNotificationNavigation).
    const linkFor = (assignmentId: string) =>
      `${DOMAIN_CONFIG.appUrl}/scheduling/assignment/${assignmentId}`;
    const pathFor = (assignmentId: string) =>
      `/scheduling/assignment/${assignmentId}`;

    // Copy branches on the recipient's current status. A `confirmed`
    // volunteer (only present in the 1-day pass) gets a no-ask heads-up;
    // an `unconfirmed` one still gets the confirm/decline nudge.
    const copyFor = (recipient: (typeof recipients)[number]) => {
      if (recipient.status === "confirmed") {
        return {
          title: `Serving tomorrow: ${targets.title}`,
          body: `You're on for ${recipient.roleName} on ${eventDate}.`,
          sms:
            `Reminder — you're serving ${recipient.roleName} at ` +
            `${targets.title} on ${eventDate}. See you there!\n\n` +
            `Details: ${linkFor(recipient.assignmentId)}`,
        };
      }
      return {
        title: `Reminder: you're scheduled for ${targets.title}`,
        body: `${recipient.roleName} on ${eventDate} — please confirm or decline.`,
        sms:
          `Reminder — you're scheduled for ${recipient.roleName} at ` +
          `${targets.title} on ${eventDate}.\n\n` +
          `Confirm or decline: ${linkFor(recipient.assignmentId)}`,
      };
    };

    // --- Push -------------------------------------------------------------
    const tokenResults: Array<{ userId: string; tokens: string[] }> =
      await ctx.runQuery(
        internal.functions.notifications.tokens.getActiveTokensForUsers,
        { userIds: recipients.map((r) => r.userId) },
      );
    const tokensByUser = new Map(tokenResults.map((r) => [r.userId, r.tokens]));

    const pushNotifications = recipients.flatMap((recipient) => {
      const tokens = tokensByUser.get(recipient.userId) ?? [];
      const { title, body } = copyFor(recipient);
      const url = pathFor(recipient.assignmentId);
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

    // --- SMS — best-effort ------------------------------------------------
    let smsSent = 0;
    for (const recipient of recipients) {
      if (!recipient.phone) continue;
      try {
        await ctx.runAction(internal.functions.auth.phoneOtp.sendSMS, {
          phone: recipient.phone,
          message: copyFor(recipient).sms,
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
        notifications: recipients.map((recipient) => {
          const { title, body } = copyFor(recipient);
          return {
            userId: recipient.userId,
            communityId: targets.communityId,
            groupId: targets.groupId,
            title,
            body,
            url: pathFor(recipient.assignmentId),
          };
        }),
      },
    );

    // Mark sent only AFTER deliveries land. Push/SMS are best-effort
    // (swallowed), so a hard failure here is the inbox mutation throwing — in
    // which case the flag stays unset and the next cron pass retries rather
    // than silently dropping the reminder. The top-of-action guard prevents a
    // double-send if a prior run already succeeded. Mirrors the meetings
    // precedent (scheduledJobs.ts sends, then markMeetingReminderSent).
    await ctx.runMutation(
      internal.functions.scheduling.assignments.markPlanReminderSent,
      { planId: args.planId, kind: args.kind },
    );

    return { pushSent, smsSent };
  },
});

/**
 * Internal: minimal plan fields the reminder action needs to decide whether
 * to fire (status + idempotency flags + the original publisher for the
 * targets query).
 */
export const getPlanReminderState = internalQuery({
  args: { planId: v.id("eventPlans") },
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.planId);
    if (!plan) return null;
    return {
      status: plan.status,
      createdById: plan.createdById,
      reminder4dSent: plan.reminder4dSent === true,
      reminder1dSent: plan.reminder1dSent === true,
    };
  },
});

/**
 * Internal: gather everything `sendAssignmentRequests` needs — event display
 * info plus, per assignment volunteer, their phone number and status.
 *
 * By default only `unconfirmed` assignments are returned (the publish + 4-day
 * reminder audience). Pass `includeConfirmed: true` for the 1-day reminder,
 * which goes to everyone still rostered — both `confirmed` and `unconfirmed`,
 * never `declined`. Each recipient carries its `status` so callers can branch
 * the copy (a "serving tomorrow" heads-up vs the confirm/decline nudge).
 */
export const getAssignmentRequestTargets = internalQuery({
  args: {
    planId: v.id("eventPlans"),
    publisherId: v.id("users"),
    includeConfirmed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.planId);
    if (!plan) return null;

    const assignments = await ctx.db
      .query("roleAssignments")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .collect();
    // Always nudge the unconfirmed; for the 1-day pass also include those
    // who've already confirmed (a serving-tomorrow heads-up). Declined and
    // removed assignments are never notified.
    const targeted = assignments.filter((a) =>
      args.includeConfirmed
        ? a.status === "unconfirmed" || a.status === "confirmed"
        : a.status === "unconfirmed",
    );

    const [community, publisher] = await Promise.all([
      ctx.db.get(plan.communityId),
      ctx.db.get(args.publisherId),
    ]);

    const recipients = await Promise.all(
      targeted.map(async (assignment) => {
        const [user, role, team] = await Promise.all([
          ctx.db.get(assignment.userId),
          ctx.db.get(assignment.roleId),
          ctx.db.get(assignment.teamId),
        ]);
        return {
          assignmentId: assignment._id,
          userId: assignment.userId,
          status: assignment.status,
          phone: user?.phone ?? null,
          roleName: role?.name ?? "a role",
          // Placeholder context — these recipients get the join-the-app SMS
          // instead of the accept/decline SMS, since they don't have the
          // app yet (`inviteAndAssign` created them on a draft plan).
          isPlaceholder: user?.isPlaceholder === true,
          firstName: user?.firstName?.trim() || "you",
          teamName: team?.name ?? "the team",
        };
      }),
    );

    return {
      title: plan.title,
      eventDate: plan.eventDate,
      groupId: plan.groupId,
      communityId: plan.communityId,
      communityName: community?.name ?? "Togather",
      publisherFirstName: publisher?.firstName?.trim() || "Someone",
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
  args: {
    planId: v.id("eventPlans"),
    publisherId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const targets = await ctx.runQuery(
      internal.functions.scheduling.assignments.getAssignmentRequestTargets,
      { planId: args.planId, publisherId: args.publisherId },
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
    // the volunteer's accept/decline screen. SMS needs the absolute web link;
    // push/in-app navigation needs a RELATIVE path, because expo-router opens
    // an absolute `https://…` URL in the browser instead of routing in-app
    // (see resolveNotificationNavigation).
    const linkFor = (assignmentId: string) =>
      `${DOMAIN_CONFIG.appUrl}/scheduling/assignment/${assignmentId}`;
    const pathFor = (assignmentId: string) =>
      `/scheduling/assignment/${assignmentId}`;
    // Placeholder users don't have the app yet — point them at the signup
    // deeplink with phone prefilled. The phone-OTP claim logic takes over
    // and the assignment is inherited via the placeholder's stable `_id`.
    const signupLinkFor = (phone: string) =>
      `${DOMAIN_CONFIG.appUrl}/signup?phone=${encodeURIComponent(phone)}`;

    // Real users get push + the accept/decline SMS. Placeholder recipients
    // can't receive in-app push (no tokens), so we only SMS them — and we
    // SMS them differently (signup + context, not accept/decline).
    const realRecipients = targets.recipients.filter((r) => !r.isPlaceholder);
    const placeholderRecipients = targets.recipients.filter(
      (r) => r.isPlaceholder,
    );

    // --- Push -------------------------------------------------------------
    const userIds = realRecipients.map((r) => r.userId);
    const tokenResults: Array<{ userId: string; tokens: string[] }> =
      await ctx.runQuery(
        internal.functions.notifications.tokens.getActiveTokensForUsers,
        { userIds },
      );
    const tokensByUser = new Map(
      tokenResults.map((r) => [r.userId, r.tokens]),
    );

    const pushNotifications = realRecipients.flatMap((recipient) => {
      const tokens = tokensByUser.get(recipient.userId) ?? [];
      const title = `You're scheduled: ${targets.title}`;
      const body = `${recipient.roleName} on ${eventDate}. Tap to accept or decline.`;
      const url = pathFor(recipient.assignmentId);
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

    // --- SMS — real users: accept/decline -------------------------------
    let smsSent = 0;
    for (const recipient of realRecipients) {
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

    // --- SMS — placeholder users: join-the-app invite -------------------
    // Different copy + a signup deeplink instead of the accept/decline link
    // (they don't have the app yet). Phone-OTP claim path links the
    // placeholder to the new account on signup so the assignment is preserved.
    let invitesSent = 0;
    for (const recipient of placeholderRecipients) {
      if (!recipient.phone) continue;
      const smsBody =
        `${targets.publisherFirstName} added you to ${recipient.teamName} ` +
        `at ${targets.communityName} as ${recipient.roleName} for ` +
        `${targets.title} on ${eventDate}.\n\n` +
        `Join Togather to confirm: ${signupLinkFor(recipient.phone)}`;
      try {
        await ctx.runAction(internal.functions.auth.phoneOtp.sendSMS, {
          phone: recipient.phone,
          message: smsBody,
        });
        invitesSent += 1;
      } catch {
        // Best-effort.
      }
    }
    smsSent += invitesSent;

    // --- In-app inbox records --------------------------------------------
    // Only for real users — placeholder users have no app to read the
    // inbox in yet. Their notification arrives via SMS only; once they
    // sign up and the placeholder is claimed, future updates flow normally.
    await ctx.runMutation(
      internal.functions.scheduling.assignments.recordAssignmentNotifications,
      {
        notifications: realRecipients.map((recipient) => ({
          userId: recipient.userId,
          communityId: targets.communityId,
          groupId: targets.groupId,
          title: `You're scheduled: ${targets.title}`,
          body: `${recipient.roleName} on ${eventDate}.`,
          url: pathFor(recipient.assignmentId),
        })),
      },
    );

    return { pushSent, smsSent };
  },
});

export { ASSIGNMENT_STATUSES };
