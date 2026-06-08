/**
 * Public availability — the standalone, app-optional link flow.
 *
 * A leader generates a shareable link (`/a/<publicToken>`) for an availability
 * request. Anyone with the link can open a public web page (no app, no login),
 * enter their name + phone, and mark which upcoming events they can serve.
 *
 * Matching, the RSVP way: a submission find-or-creates a **placeholder user**
 * keyed by the normalized phone (exactly like `inviteAndAssign`). Their
 * availability is written against that placeholder's stable `_id`. When the
 * person later signs up and **verifies that phone**, the existing placeholder-
 * claim path (`claimPlaceholderByPhoneInternal`) activates that same account —
 * so their availability (and any role assignments) transparently become theirs.
 * No separate reconciliation step is needed.
 *
 * The two write functions here are intentionally token-free (public): the
 * unguessable `publicToken` is the capability. They are rate-limited and only
 * ever touch the events snapshotted on the request.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import {
  buildSearchText,
  generateShortId,
  getDisplayName,
  normalizePhone,
} from "../../lib/utils";
import { COMMUNITY_ROLES } from "../../lib/permissions";
import { checkRateLimit } from "../../lib/rateLimit";
import { requireGroupScheduler } from "./permissions";

const AVAILABILITY_STATUSES = new Set(["available", "unavailable"]);
const MAX_MESSAGE_LENGTH = 280;
const MAX_EVENTS = 12;
const MAX_NAME_LENGTH = 80;

/** Midnight (local server time) at the start of today, in ms. */
function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * A phone is acceptable for matching if it normalizes to E.164 with at least
 * 10 national digits. We don't verify ownership here — verification happens
 * when the person signs up and confirms the number via OTP.
 */
function normalizeSubmittablePhone(raw: string): string {
  const normalized = normalizePhone(raw);
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 10) {
    throw new ConvexError("Enter a valid phone number");
  }
  return normalized;
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
// Public (no auth): read + submit
// ============================================================================

/**
 * Public read for the `/a/<token>` web page. Returns enough to render the form
 * — group + community display info and the snapshotted events. No per-viewer
 * status (the visitor is anonymous until they submit).
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

/**
 * Public submission from the `/a/<token>` web page. Find-or-creates a
 * placeholder user by phone, ensures they're in the request's group, and
 * upserts their availability for each event in the submission.
 *
 * Returns `{ matched }` — true when the phone already belonged to a real
 * (claimed) account, so the web UI can nudge them to open/install the app.
 *
 * Unauthenticated by design; rate-limited per token to blunt abuse. Only the
 * events snapshotted on the request are accepted.
 */
export const submitPublicAvailability = mutation({
  args: {
    publicToken: v.string(),
    firstName: v.string(),
    lastName: v.optional(v.string()),
    phone: v.string(),
    responses: v.array(
      v.object({
        planId: v.id("eventPlans"),
        status: v.union(v.literal("available"), v.literal("unavailable")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("availabilityRequests")
      .withIndex("by_public_token", (q) =>
        q.eq("publicToken", args.publicToken),
      )
      .first();
    if (!request) {
      throw new ConvexError("This availability link is no longer valid");
    }

    // Rate limit per link: a public endpoint that creates users + memberships.
    await checkRateLimit(ctx, `availSubmit:${args.publicToken}`, 30, 60_000);

    const firstName = args.firstName.trim();
    if (!firstName) {
      throw new ConvexError("Enter your name");
    }
    if (firstName.length > MAX_NAME_LENGTH) {
      throw new ConvexError("That name is too long");
    }
    const lastName = args.lastName?.trim() || undefined;
    const normalizedPhone = normalizeSubmittablePhone(args.phone);

    // Only the events this request actually asked about are writable.
    const allowed = new Set(request.planIds.map((id) => id as string));
    const responses = args.responses.filter((r) =>
      allowed.has(r.planId as string),
    );
    for (const r of responses) {
      if (!AVAILABILITY_STATUSES.has(r.status)) {
        throw new ConvexError("Invalid availability status");
      }
    }

    const now = Date.now();

    // --- Find or create the (placeholder) user by phone. ---
    const existing = await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", normalizedPhone))
      .first();

    let userId: Id<"users">;
    let matched = false;
    if (existing) {
      userId = existing._id;
      // A claimed (real) account → don't downgrade anything; just attribute.
      matched = existing.isPlaceholder !== true;
      // Backfill a name on a bare placeholder so the leader grid reads well.
      if (existing.isPlaceholder === true && !existing.firstName) {
        await ctx.db.patch(existing._id, {
          firstName,
          lastName: existing.lastName ?? lastName,
          updatedAt: now,
          searchText: buildSearchText({ firstName, lastName, phone: normalizedPhone }),
        });
      }
    } else {
      // New placeholder — mirrors inviteAndAssign so the phone-OTP signup
      // claim path activates this same account later.
      userId = await ctx.db.insert("users", {
        firstName,
        lastName,
        phone: normalizedPhone,
        phoneVerified: false,
        isActive: false,
        isPlaceholder: true,
        isStaff: false,
        isSuperuser: false,
        dateJoined: now,
        createdAt: now,
        updatedAt: now,
        searchText: buildSearchText({ firstName, lastName, phone: normalizedPhone }),
      });
      await ctx.db.insert("userCommunities", {
        userId,
        communityId: request.communityId,
        roles: COMMUNITY_ROLES.MEMBER,
        status: 1,
        createdAt: now,
        updatedAt: now,
      });
    }

    // --- Ensure group membership so the response shows in the leader grid. ---
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
    }

    // --- Upsert availability for each submitted event. ---
    for (const r of responses) {
      const plan = await ctx.db.get(r.planId);
      if (!plan || plan.groupId !== request.groupId) continue;
      const prior = await ctx.db
        .query("eventAvailability")
        .withIndex("by_plan_user", (q) =>
          q.eq("planId", r.planId).eq("userId", userId),
        )
        .first();
      if (prior) {
        await ctx.db.patch(prior._id, { status: r.status, updatedAt: now });
      } else {
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
    }

    return { matched, savedCount: responses.length };
  },
});

/** Display helper re-exported for callers that want a consistent name. */
export { getDisplayName };
