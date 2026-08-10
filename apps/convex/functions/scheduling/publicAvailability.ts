/**
 * Public availability — the shareable, app-optional link flow.
 *
 * A leader shares a link (`/a/<publicToken>`) for an availability request. It
 * opens an Expo Router page that renders on the web (no install needed) and
 * deep-links into the app when installed — modeled on the public event page
 * (`/e/<shortId>`). A visitor marks which upcoming events they can serve and
 * **verifies their phone via SMS OTP** (the same phone → OTP → account flow as
 * guest event RSVPs). By the time availability is recorded they hold a real,
 * verified account, so `submitAvailabilityForRequest` is a normal
 * authenticated mutation — no placeholder/deferred-matching needed.
 *
 * `getPublicAvailabilityRequest` is the one unauthenticated read that powers
 * the page before sign-in; the unguessable token is the capability.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { generateShortId } from "../../lib/utils";
import { requireGroupScheduler } from "./permissions";
import { queueAvailabilityLeaderNotice } from "./availability";

const MAX_MESSAGE_LENGTH = 280;
const MAX_EVENTS = 12;

/** Midnight (local server time) at the start of today, in ms. */
function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ============================================================================
// Leader: create a standalone shareable link
// ============================================================================

/**
 * Create a standalone availability request (no chat message) and return its
 * public token so the leader can share `/a/<token>`. Snapshots the group's
 * upcoming events, same as the in-chat request.
 *
 * Auth: group leader or community admin.
 */
export const createAvailabilityLink = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    message: v.optional(v.string()),
    planIds: v.optional(v.array(v.id("eventPlans"))),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const group = await requireGroupScheduler(ctx, args.groupId, userId);

    const message = args.message?.trim();
    if (message && message.length > MAX_MESSAGE_LENGTH) {
      throw new ConvexError(
        `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer`,
      );
    }

    let planIds: Id<"eventPlans">[];
    if (args.planIds && args.planIds.length > 0) {
      const plans = await Promise.all(args.planIds.map((id) => ctx.db.get(id)));
      const valid = plans.filter(
        (p): p is NonNullable<typeof p> =>
          p !== null && p.groupId === args.groupId,
      );
      if (valid.length === 0) {
        throw new ConvexError("No valid events for this group");
      }
      planIds = valid
        .sort((a, b) => a.eventDate - b.eventDate)
        .slice(0, MAX_EVENTS)
        .map((p) => p._id);
    } else {
      const cutoff = startOfTodayMs();
      const upcoming = (
        await ctx.db
          .query("eventPlans")
          .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
          .collect()
      )
        .filter((p) => p.eventDate >= cutoff)
        .sort((a, b) => a.eventDate - b.eventDate)
        .slice(0, MAX_EVENTS);
      if (upcoming.length === 0) {
        throw new ConvexError(
          "There are no upcoming events to collect availability for",
        );
      }
      planIds = upcoming.map((p) => p._id);
    }

    const publicToken = generateShortId();
    const now = Date.now();
    const requestId = await ctx.db.insert("availabilityRequests", {
      groupId: args.groupId,
      communityId: group.communityId,
      authorId: userId,
      message: message || undefined,
      planIds,
      publicToken,
      createdAt: now,
    });

    return { requestId, publicToken };
  },
});

// ============================================================================
// Public read (no auth) — powers the page before sign-in
// ============================================================================

/**
 * Public read for the `/a/<token>` page. Returns enough to render the form —
 * group + community display info and the snapshotted events. No per-viewer
 * status (the visitor is anonymous until they verify and sign in).
 *
 * Unauthenticated by design; the unguessable token is the capability.
 */
export const getPublicAvailabilityRequest = query({
  args: { publicToken: v.string() },
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("availabilityRequests")
      .withIndex("by_public_token", (q) =>
        q.eq("publicToken", args.publicToken),
      )
      .first();
    if (!request) return null;

    const [group, community] = await Promise.all([
      ctx.db.get(request.groupId),
      ctx.db.get(request.communityId),
    ]);

    const events = (
      await Promise.all(
        request.planIds.map(async (planId) => {
          const plan = await ctx.db.get(planId);
          if (!plan) return null;
          return {
            _id: plan._id,
            title: plan.title,
            eventDate: plan.eventDate,
            times: plan.times,
          };
        }),
      )
    ).filter((e): e is NonNullable<typeof e> => e !== null);

    return {
      publicToken: args.publicToken,
      message: request.message,
      groupId: request.groupId,
      groupName: group?.name ?? "the team",
      communityName: community?.name ?? "Togather",
      events,
    };
  },
});

// ============================================================================
// Record (authenticated) — called after the visitor verifies via OTP
// ============================================================================

/**
 * Record availability for an authenticated user against a public request.
 * Called once the visitor has verified their phone and signed in (so the token
 * belongs to a real, phone-verified account). Ensures they're a member of the
 * request's group, then upserts their availability for each submitted event.
 *
 * Only the events snapshotted on the request are accepted.
 */
export const submitAvailabilityForRequest = mutation({
  args: {
    token: v.string(),
    publicToken: v.string(),
    responses: v.array(
      v.object({
        planId: v.id("eventPlans"),
        status: v.union(v.literal("available"), v.literal("unavailable")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const request = await ctx.db
      .query("availabilityRequests")
      .withIndex("by_public_token", (q) =>
        q.eq("publicToken", args.publicToken),
      )
      .first();
    if (!request) {
      throw new ConvexError("This availability link is no longer valid");
    }

    const now = Date.now();

    // Ensure ACCEPTED group membership so the response shows in the leader grid
    // (`availabilityForPlan` filters out non-accepted memberships) and the
    // person can manage their availability in-app afterwards. Responding to the
    // link is an explicit opt-in, so a stale pending/declined join request is
    // reactivated to accepted rather than left to hide the response.
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", request.groupId).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();
    if (!membership) {
      await ctx.db.insert("groupMembers", {
        groupId: request.groupId,
        userId,
        role: "member",
        joinedAt: now,
        notificationsEnabled: true,
      });
    } else if (
      membership.requestStatus &&
      membership.requestStatus !== "accepted"
    ) {
      await ctx.db.patch(membership._id, {
        requestStatus: "accepted",
        requestReviewedAt: now,
      });
    }

    // Only events this request asked about are writable.
    const allowed = new Set(request.planIds.map((id) => id as string));
    let savedCount = 0;
    let changed = false;
    for (const r of args.responses) {
      if (!allowed.has(r.planId as string)) continue;
      const prior = await ctx.db
        .query("eventAvailability")
        .withIndex("by_plan_user", (q) =>
          q.eq("planId", r.planId).eq("userId", userId),
        )
        .first();
      if (prior) {
        if (prior.status !== r.status) changed = true;
        await ctx.db.patch(prior._id, { status: r.status, updatedAt: now });
      } else {
        changed = true;
        await ctx.db.insert("eventAvailability", {
          planId: r.planId,
          groupId: request.groupId,
          communityId: request.communityId,
          userId,
          status: r.status,
          respondedAt: now,
          updatedAt: now,
        });
      }
      savedCount += 1;
    }

    // One debounced notification to the group's leaders for the whole batch —
    // submitting the public link writes many plans at once.
    if (changed) {
      await queueAvailabilityLeaderNotice(ctx, {
        groupId: request.groupId,
        userId,
        communityId: request.communityId,
      });
    }

    return { savedCount };
  },
});
