/**
 * PCO Serving History
 *
 * Fetches past service plans from PCO and returns serving counts per user.
 * Called on demand by the follow-up screen (same pattern as the run sheet).
 * Also persists counts on the group document so the server-side scoring
 * engine can use them.
 *
 * Strategy: Fetch all past plans + team members, then match ONLY the group's
 * members (not all 175+ PCO people). This keeps the action fast by avoiding
 * hundreds of contact-info API calls for people who aren't in the group.
 */

import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  getValidAccessToken,
  fetchServiceTypes,
  fetchPastPlans,
  fetchPlanTeamMembers,
  getPersonContactInfo,
} from "../../lib/pcoServicesApi";
import { normalizePhone } from "../../lib/utils";

const TWO_MONTHS_MS = 60 * 24 * 60 * 60 * 1000; // ~60 days
// Small batches + delay to stay well under PCO's 100 req / 20s limit.
// fetchPlanTeamMembers paginates internally so each call can be 2-3 requests.
const PLAN_BATCH_SIZE = 5;
const BATCH_DELAY_MS = 2000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Internal Helpers
// ============================================================================

export const saveServingCounts = internalMutation({
  args: {
    groupId: v.id("groups"),
    counts: v.array(v.object({ userId: v.id("users"), count: v.number() })),
    servingDetails: v.optional(v.array(v.object({
      userId: v.id("users"),
      date: v.string(),
      serviceTypeName: v.string(),
      teamName: v.string(),
      position: v.optional(v.string()),
    }))),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.groupId, {
      pcoServingCounts: {
        updatedAt: Date.now(),
        counts: args.counts,
        servingDetails: args.servingDetails,
      },
    });
  },
});

/**
 * Get group members with their PCO person IDs (paginated).
 * Reads per page: limit + 2*limit (userCommunities + users) ≈ 3*limit.
 * At limit=500: ~1,500 reads, well under the 4,096 limit.
 */
export const getGroupMemberPcoLinks = internalQuery({
  args: {
    groupId: v.id("groups"),
    communityId: v.id("communities"),
    cursor: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .paginate({ numItems: args.limit, cursor: args.cursor ?? null });

    // For each member in this page, look up their pcoPersonId + user info
    const members: Array<{
      userId: Id<"users">;
      pcoPersonId: string | null;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      email: string | null;
    }> = [];
    for (const member of result.page) {
      const [uc, user] = await Promise.all([
        ctx.db
          .query("userCommunities")
          .withIndex("by_user_community", (q) =>
            q.eq("userId", member.userId).eq("communityId", args.communityId)
          )
          .first(),
        ctx.db.get(member.userId),
      ]);
      members.push({
        userId: member.userId,
        pcoPersonId: uc?.pcoPersonId ?? null,
        firstName: user?.firstName ?? null,
        lastName: user?.lastName ?? null,
        phone: user?.phone ?? null,
        email: user?.email ?? null,
      });
    }
    return {
      members,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Get communityId from a group doc (for internal actions that don't have auth context).
 */
export const getGroupCommunityId = internalQuery({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    return group ? { communityId: group.communityId } : null;
  },
});

// ============================================================================
// Core PCO Refresh Logic
// ============================================================================

/**
 * Shared core logic for fetching PCO serving data and saving counts.
 * Used by both the public getServingCounts action and the internal cron action.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function refreshServingDataCore(
  ctx: any,
  groupId: Id<"groups">,
  communityId: Id<"communities">,
): Promise<Record<string, number>> {
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(ctx, communityId);
  } catch {
    return {};
  }

  // 1. Get group members + their PCO links (paginated to stay under read limits)
  const PCO_LINK_PAGE_SIZE = 500;
  const groupMembers: Array<{
    userId: Id<"users">;
    pcoPersonId: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    email: string | null;
  }> = [];
  {
    let pcoLinkCursor: string | undefined = undefined;
    let pcoLinksDone = false;
    while (!pcoLinksDone) {
      const page: {
        members: typeof groupMembers;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(
        internal.functions.pcoServices.servingHistory.getGroupMemberPcoLinks,
        { groupId, communityId, cursor: pcoLinkCursor, limit: PCO_LINK_PAGE_SIZE }
      );
      groupMembers.push(...page.members);
      pcoLinksDone = page.isDone;
      pcoLinkCursor = page.continueCursor;
    }
  }

  // Build lookup: pcoPersonId → userId (for members already linked)
  const pcoToUser = new Map<string, Id<"users">>();
  const unlinkedMembers: typeof groupMembers = [];
  for (const m of groupMembers) {
    if (m.pcoPersonId) {
      pcoToUser.set(m.pcoPersonId, m.userId);
    } else {
      unlinkedMembers.push(m);
    }
  }
  console.log(`[servingHistory] Group has ${groupMembers.length} members, ${pcoToUser.size} linked, ${unlinkedMembers.length} unlinked`);

  if (pcoToUser.size === 0 && unlinkedMembers.length === 0) {
    return {};
  }

  // 2. Fetch past plans from PCO
  const serviceTypes = await fetchServiceTypes(accessToken);
  const twoMonthsAgo = new Date(Date.now() - TWO_MONTHS_MS);
  const afterDate = twoMonthsAgo.toISOString().split("T")[0];

  const allPlans: Array<{ serviceTypeId: string; serviceTypeName: string; planId: string; sortDate: string }> = [];
  for (const st of serviceTypes) {
    const plans = await fetchPastPlans(accessToken, st.id, { limit: 25 });
    for (const plan of plans) {
      const planDate = plan.attributes.sort_date?.split("T")[0] ?? "";
      if (planDate >= afterDate) {
        allPlans.push({ serviceTypeId: st.id, serviceTypeName: st.attributes.name, planId: plan.id, sortDate: plan.attributes.sort_date ?? planDate });
      }
    }
  }
  console.log(`[servingHistory] Found ${allPlans.length} past plans (after ${afterDate})`);

  // 3. Fetch team members for each plan
  // pcoPersonId → set of planIds they served in
  const pcoPersonPlans = new Map<string, Set<string>>();
  // pcoPersonId → detail records (date, team, position, service type)
  type DetailRecord = { date: string; serviceTypeName: string; teamName: string; position: string | null };
  const pcoPersonDetails = new Map<string, DetailRecord[]>();

  for (let i = 0; i < allPlans.length; i += PLAN_BATCH_SIZE) {
    if (i > 0) await sleep(BATCH_DELAY_MS);

    const batch = allPlans.slice(i, i + PLAN_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(({ serviceTypeId, planId }) =>
        fetchPlanTeamMembers(accessToken, serviceTypeId, planId)
      )
    );

    for (let j = 0; j < results.length; j++) {
      const plan = batch[j];
      for (const member of results[j]) {
        if (member.status !== "C" || !member.pcoPersonId) continue;
        if (!pcoPersonPlans.has(member.pcoPersonId)) {
          pcoPersonPlans.set(member.pcoPersonId, new Set());
        }
        pcoPersonPlans.get(member.pcoPersonId)!.add(plan.planId);

        // Collect detail record
        if (!pcoPersonDetails.has(member.pcoPersonId)) {
          pcoPersonDetails.set(member.pcoPersonId, []);
        }
        pcoPersonDetails.get(member.pcoPersonId)!.push({
          date: plan.sortDate,
          serviceTypeName: plan.serviceTypeName,
          teamName: member.teamName ?? "",
          position: member.position ?? null,
        });
      }
    }
  }
  console.log(`[servingHistory] ${pcoPersonPlans.size} unique PCO people served`);

  // 4. Auto-link unlinked group members by phone number
  //    Fetch contact info for PCO people who served and match by phone.
  //    Cap at 30 lookups to stay fast and avoid rate limits.
  const MAX_CONTACT_LOOKUPS = 30;
  const unlinkedByPhone = new Map<string, typeof unlinkedMembers[number]>();
  for (const m of unlinkedMembers) {
    if (m.phone) {
      unlinkedByPhone.set(normalizePhone(m.phone), m);
    }
  }

  if (unlinkedByPhone.size > 0) {
    const pcoIdsToCheck = Array.from(pcoPersonPlans.keys())
      .filter((pid) => !pcoToUser.has(pid))
      .slice(0, MAX_CONTACT_LOOKUPS);

    console.log(`[servingHistory] Checking ${pcoIdsToCheck.length} PCO people for phone matches (${unlinkedByPhone.size} unlinked members)`);

    for (let i = 0; i < pcoIdsToCheck.length; i++) {
      if (unlinkedByPhone.size === 0) break; // All matched
      if (i > 0 && i % 3 === 0) await sleep(BATCH_DELAY_MS);

      try {
        const { phone } = await getPersonContactInfo(accessToken, pcoIdsToCheck[i]);
        if (!phone) continue;

        const normalizedPcoPhone = normalizePhone(phone);
        const matchedMember = unlinkedByPhone.get(normalizedPcoPhone);
        if (matchedMember) {
          await ctx.runMutation(
            internal.functions.pcoServices.matching.linkUserToPcoPerson,
            { communityId, userId: matchedMember.userId, pcoPersonId: pcoIdsToCheck[i] }
          );
          pcoToUser.set(pcoIdsToCheck[i], matchedMember.userId);
          unlinkedByPhone.delete(normalizedPcoPhone);
          console.log(`[servingHistory] Auto-linked ${matchedMember.firstName} ${matchedMember.lastName} by phone → PCO ${pcoIdsToCheck[i]}`);
        }
      } catch {
        console.log(`[servingHistory] Contact lookup stopped at ${i}/${pcoIdsToCheck.length}`);
        break;
      }
    }
  }

  // 5. Build counts + detail records for linked group members only
  const counts: Record<string, number> = {};
  const countsArray: Array<{ userId: Id<"users">; count: number }> = [];
  const servingDetails: Array<{
    userId: Id<"users">;
    date: string;
    serviceTypeName: string;
    teamName: string;
    position?: string;
  }> = [];

  for (const [pcoPersonId, planIds] of pcoPersonPlans) {
    const userId = pcoToUser.get(pcoPersonId);
    if (!userId) continue;
    const key = userId.toString();
    counts[key] = (counts[key] ?? 0) + planIds.size;

    // Collect detail records for this user
    const details = pcoPersonDetails.get(pcoPersonId) ?? [];
    for (const d of details) {
      servingDetails.push({
        userId,
        date: d.date,
        serviceTypeName: d.serviceTypeName,
        teamName: d.teamName,
        position: d.position ?? undefined,
      });
    }
  }

  for (const [userId, count] of Object.entries(counts)) {
    countsArray.push({ userId: userId as Id<"users">, count });
  }

  // Cap detail records to 500 most recent to prevent group doc size blowup
  const cappedDetails = servingDetails
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 500);

  console.log(`[servingHistory] Saving counts for ${countsArray.length} users, ${cappedDetails.length} detail records (${servingDetails.length} total)`);

  await ctx.runMutation(
    internal.functions.pcoServices.servingHistory.saveServingCounts,
    { groupId, counts: countsArray, servingDetails: cappedDetails }
  );

  return counts;
}

// ============================================================================
// Public Action
// ============================================================================

/**
 * Fetch PCO serving counts for group members.
 *
 * Instead of trying to match all PCO people to app users (slow — hundreds of
 * API calls), we flip the direction: get group members' PCO person IDs, fetch
 * the plan data, and count only for those members. Unlinked members get a
 * single contact-info lookup to try matching them.
 */
export const getServingCounts = action({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args): Promise<Record<string, number>> => {
    const { communityId } = await ctx.runMutation(
      internal.functions.pcoServices.actions.verifyGroupAccess,
      { token: args.token, groupId: args.groupId }
    );

    return refreshServingDataCore(ctx, args.groupId, communityId);
  },
});

// ============================================================================
// Internal Action (for cron/backfill — no auth required)
// ============================================================================

/**
 * Refresh PCO serving data for a group without user auth.
 * Called by the daily score pipeline when a group's score config uses pco_services_past_2mo.
 */
export const internalRefreshPcoServing = internalAction({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const groupInfo = await ctx.runQuery(
      internal.functions.pcoServices.servingHistory.getGroupCommunityId,
      { groupId: args.groupId }
    );
    if (!groupInfo) return;

    await refreshServingDataCore(ctx, args.groupId, groupInfo.communityId);
  },
});
