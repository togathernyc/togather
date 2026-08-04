/**
 * Group giving: donations, the transparency screen, and receipts (ADR-032
 * §3, Phase 1 — "Donations + ledger + receipts").
 *
 * Money flow implemented here:
 *   1. `getGivingContext` powers the give sheet's amount-entry step;
 *      `createDonationCheckoutSession` then creates a hosted Stripe Checkout
 *      Session ON the community's connected account (ADR-032 §3/§7 Phase 1
 *      decision — zero native dependencies, ships via OTA, Apple Pay works in
 *      the browser sheet) for the donor to complete in-browser.
 *      `createDonationIntent` is the not-yet-used native-payment-sheet
 *      alternative kept for ADR-032's still-open question. While the donor is
 *      in that browser sheet the app watches `getCheckoutSessionStatus` to
 *      know when to close it.
 *   2. The Stripe webhook layer (functions/finance/webhooks.ts) calls
 *      `recordDonationSucceeded` on `payment_intent.succeeded` — Checkout's
 *      `payment_intent_data.metadata` lands on that PaymentIntent exactly
 *      like `createDonationIntent`'s own metadata does, so this webhook path
 *      is unchanged by which donation-creation action ran — which writes the
 *      `donations` row, posts the ledger credit, and schedules the receipt
 *      email.
 *   3. `getFundOverview` powers the member-facing transparency screen.
 *   4. MONTHLY gifts are a Stripe Subscription on the same connected
 *      account (`createRecurringDonationCheckoutSession` and the donor
 *      management actions at the bottom of this file). Each charge is
 *      recorded as an ordinary `donations` row from `invoice.paid` — NOT
 *      `payment_intent.succeeded`, because subscription-mode Checkout
 *      forbids `payment_intent_data` and so the PaymentIntent carries none
 *      of our metadata. Both paths write through `recordDonationCore`, so a
 *      monthly gift and a one-off gift credit, audit and receipt identically.
 *
 * Every query here first authorizes the caller, then (for `getFundOverview`)
 * separately decides how MUCH detail they see — active members get
 * aggregates and anonymized activity, manager+ finance roles (or a
 * community admin) also see donor names. See `viewerCanSeeDonorNames`.
 *
 * Nothing in this file talks to Increase — that's the allocation/reconcile
 * layer in `functions/finance/jobs.ts`.
 */

import { v, ConvexError } from "convex/values";
import {
  query,
  action,
  internalQuery,
  internalMutation,
  internalAction,
} from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { getOptionalAuth, requireAuth } from "../../lib/auth";
import { isActiveMember, hasFundRole } from "../../lib/helpers";
import { isCommunityAdmin } from "../../lib/permissions";
import { postLedgerEntry } from "../../lib/finance/ledger";
import { logFinanceAudit } from "../../lib/finance/audit";
import { buildDonationReceiptEmail } from "../../lib/finance/receipts";
import { computeCoverFeesCents, COVER_FEE_TOLERANCE_CENTS } from "../../lib/finance/fees";
// Pure helper, no cycle: webhooks.ts reaches giving.ts through the generated
// `internal` API, never by importing this module.
import { splitDonationAmounts } from "./webhooks";
// Same story for these three: plain functions, and none of those modules
// imports this one back.
import { requireCommunityFinanceAccess } from "../../lib/finance/communityFinanceAccess";
import { loadConnectionRow } from "./cardProviderConnections";
import { isLiveCardStatus } from "./cards";
import { resolveCardProviderName } from "../../lib/finance/cardProviders";
import { getResendClient } from "../../lib/resend";
import { now, getDisplayName } from "../../lib/utils";
import {
  isGroupGivingEnabled,
  requireGroupGivingEnabled,
} from "../../lib/finance/flag";
import { DOMAIN_CONFIG } from "@togather/shared/config";

// ============================================================================
// Constants
// ============================================================================

/** Suggested one-tap amounts on the give sheet (ADR-032 §3): $10 / $50 / $100. */
const SUGGESTED_AMOUNTS_CENTS = [1000, 5000, 10000] as const;

/** Stripe's own minimum for a USD PaymentIntent. */
const MIN_DONATION_CENTS = 100;
/** A generous ceiling — anything larger almost certainly indicates a client bug. */
const MAX_DONATION_CENTS = 2_000_000;

/** How many recent ledger entries the transparency screen shows. */
const RECENT_ACTIVITY_LIMIT = 20;

/**
 * How long a `pending` recurringDonations row (row created, donor still on
 * Stripe's hosted Checkout page) keeps blocking a second attempt.
 *
 * "One monthly gift per donor per fund" has to hold, but a donor who opens
 * Checkout and closes the tab must not be locked out of ever setting one up.
 * Past this window the abandoned row is SUPERSEDED — its Stripe Checkout
 * Session is expired so it can never complete behind our back, and the row is
 * marked canceled — before the new attempt starts. 30 minutes is comfortably
 * longer than anyone spends entering a card and far shorter than Stripe's own
 * 24h session expiry, which would otherwise be the lockout.
 */
const PENDING_CHECKOUT_GRACE_MS = 30 * 60 * 1000;

/** Statuses that mean "this donor already gives monthly to this fund". */
const LIVE_RECURRING_STATUSES = ["active", "past_due"] as const;

// ============================================================================
// Access helpers (local — not exported from lib/helpers.ts, which this task
// does not own; these compose the exported `hasFundRole` / `isCommunityAdmin`
// / `isActiveMember` primitives that already live there)
// ============================================================================

/** True if `userId` belongs to `communityId` with an active membership row. */
async function isActiveCommunityMember(
  ctx: { db: any },
  communityId: Id<"communities">,
  userId: Id<"users">,
): Promise<boolean> {
  const membership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q: any) =>
      q.eq("userId", userId).eq("communityId", communityId),
    )
    .first();
  return !!(membership && membership.status === 1);
}

/**
 * Whether `userId` may view `fund` — an active member of the fund's group
 * (or, for the community-wide general fund, any active community member), or
 * a community admin. Mirrors the "Give; see transparency summary" row of the
 * ADR-032 §4 permission table, which every role from plain member up
 * satisfies.
 *
 * Non-throwing so `getGivingContext` — whose entire job is answering "does a
 * fund I can see exist here?" — can answer `null` instead of erroring. Use
 * `assertCanViewFund` wherever a caller has already committed to showing fund
 * detail and a refusal should be loud.
 */
async function canViewFund(
  ctx: { db: any },
  fund: Doc<"funds">,
  userId: Id<"users">,
): Promise<boolean> {
  if (await isCommunityAdmin(ctx, fund.communityId, userId)) {
    return true;
  }
  if (fund.groupId) {
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q: any) =>
        q.eq("groupId", fund.groupId).eq("userId", userId),
      )
      .first();
    return isActiveMember(membership);
  }
  return await isActiveCommunityMember(ctx, fund.communityId, userId);
}

/** Throwing form of {@link canViewFund}. */
async function assertCanViewFund(
  ctx: { db: any },
  fund: Doc<"funds">,
  userId: Id<"users">,
): Promise<void> {
  if (!(await canViewFund(ctx, fund, userId))) {
    throw new Error("You don't have access to this fund");
  }
}

/**
 * Non-throwing check for whether `userId` sees itemized/donor-identifying
 * detail on `fund` — manager+ fund role, or a community admin. This is the
 * "check via a non-throwing role lookup" the transparency screen needs: a
 * plain member is still allowed to VIEW the fund (see `assertCanViewFund`),
 * just not who gave what.
 */
async function viewerIsFundManagerPlus(
  ctx: { db: any },
  fund: Doc<"funds">,
  userId: Id<"users">,
): Promise<boolean> {
  if (await isCommunityAdmin(ctx, fund.communityId, userId)) {
    return true;
  }
  // Collect + filter (not .first()): a re-granted user has a revoked row
  // plus an active one, and .first() could return the revoked grant.
  const roleRows = await ctx.db
    .query("fundRoles")
    .withIndex("by_user_fund", (q: any) =>
      q.eq("userId", userId).eq("fundId", fund._id),
    )
    .collect();
  const roleDoc =
    roleRows.find((r: Doc<"fundRoles">) => r.revokedAt === undefined) ?? null;
  return hasFundRole(roleDoc, "manager");
}

function startOfMonthUTC(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function startOfYearUTC(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), 0, 1);
}

/**
 * The donor's currently-collecting monthly gift to `fundId`, or null.
 *
 * "Collecting" deliberately excludes `pending` (row created, donor still on
 * Stripe's Checkout page — no subscription exists yet) and `canceled`
 * (terminal). `past_due` counts: Stripe is still retrying it, the donor still
 * has a monthly gift, and offering to start a second one would double-charge
 * them the moment the first recovers.
 */
async function findLiveRecurring(
  ctx: { db: any },
  fundId: Id<"funds">,
  donorUserId: Id<"users">,
): Promise<Doc<"recurringDonations"> | null> {
  const rows = await ctx.db
    .query("recurringDonations")
    .withIndex("by_donor_fund", (q: any) =>
      q.eq("donorUserId", donorUserId).eq("fundId", fundId),
    )
    .collect();
  return (
    rows.find((r: Doc<"recurringDonations">) =>
      (LIVE_RECURRING_STATUSES as readonly string[]).includes(r.status),
    ) ?? null
  );
}

/**
 * Does this row stop the donor starting ANOTHER monthly gift to the same fund?
 *
 * Deliberately wider than `findLiveRecurring`: that one answers "is a gift
 * collecting?" (what the give screen renders), this one answers "would a
 * second Checkout risk double-charging them?" (what the create path must
 * refuse). A `pending` row blocks when either
 *
 *  - it already has a subscription — Checkout completed and `invoice.paid`
 *    simply hasn't landed yet, so the donor IS being billed however the row
 *    reads; or
 *  - it is younger than `PENDING_CHECKOUT_GRACE_MS` — a Checkout page that may
 *    still be open in another tab.
 *
 * Anything older with no subscription is an abandoned Checkout, which the
 * create path supersedes rather than letting it lock the donor out forever.
 */
function blocksNewRecurring(
  row: Doc<"recurringDonations">,
  nowMs: number,
): boolean {
  if ((LIVE_RECURRING_STATUSES as readonly string[]).includes(row.status)) {
    return true;
  }
  return (
    row.status === "pending" &&
    (!!row.stripeSubscriptionId ||
      nowMs - row.createdAt < PENDING_CHECKOUT_GRACE_MS)
  );
}

/** "Friend of the ministry" covers anonymous/guest gifts (no donorUserId) — getDisplayName's own "Anonymous" fallback is for a real user with no name set, a different case. */
function donorDisplayName(donor: Doc<"users"> | null): string {
  if (!donor) return "Friend of the ministry";
  return getDisplayName(donor.firstName, donor.lastName);
}

// ============================================================================
// getFundOverview — the transparency screen
// ============================================================================

interface ActivityPeriodTotals {
  donationsCents: number;
  spentCents: number;
  /** Stripe's processing fees, realised as "fee" ledger entries. */
  feesCents: number;
  /** Gifts handed back to donors, as "refund" ledger entries. */
  refundedCents: number;
  donationCount: number;
}

/**
 * Sums a set of ledger entries into the aggregates the transparency screen
 * shows.
 *
 * "Spent" means the group CHOSE to spend it — card swipes, reimbursements,
 * transfers, sweeps. Processing fees and refunds are debits too, but neither
 * is the group spending anything: allocation posts a `fee` debit for every
 * gift (jobs.ts recordAllocation), so bucketing fees into "spent" would have
 * a group that spent nothing report spending 2.9% + 30¢ of every gift on the
 * one screen whose entire purpose is telling members where their money went.
 * They get their own totals instead of disappearing — a fee that is invisible
 * is exactly as dishonest as a fee mislabelled as spend.
 *
 * TODO: Investigate — `refundedCents` is computed here and typed all the way
 * through to `member/types.ts`, but no surface renders it, so on a fund with
 * a refund "given" minus "spent" minus "fees" does not reconcile. That is the
 * same argument that put fees on their own line. Left as-is deliberately for
 * now: it is a copy/layout decision on the member transparency screen rather
 * than a correctness one, and this pass is scoped to money movement. Refunds
 * on group funds are rare enough that shipping the wrong words for them is
 * worse than shipping nothing yet.
 */
function summarizePeriod(
  entries: Array<Pick<Doc<"ledgerEntries">, "direction" | "amountCents" | "kind">>,
): ActivityPeriodTotals {
  let donationsCents = 0;
  let spentCents = 0;
  let feesCents = 0;
  let refundedCents = 0;
  let donationCount = 0;
  for (const entry of entries) {
    if (entry.direction === "credit" && entry.kind === "donation") {
      donationsCents += entry.amountCents;
      donationCount += 1;
    } else if (entry.kind === "fee") {
      // Signed: a fee reversal (a refunded gift's fee, see
      // recordDonationRefund) is a credit that cancels an earlier debit.
      feesCents += entry.direction === "debit" ? entry.amountCents : -entry.amountCents;
    } else if (entry.kind === "refund") {
      refundedCents += entry.direction === "debit" ? entry.amountCents : -entry.amountCents;
    } else if (entry.direction === "debit") {
      spentCents += entry.amountCents;
    }
  }
  return { donationsCents, spentCents, feesCents, refundedCents, donationCount };
}

export const getFundOverview = query({
  args: { token: v.string(), groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    if (!(await isGroupGivingEnabled(ctx))) {
      return null; // Flag off — hides the fund screen entirely.
    }

    const fund = await ctx.db
      .query("funds")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .first();
    if (!fund) {
      return null; // Giving isn't enabled for this group yet.
    }

    await assertCanViewFund(ctx, fund, userId);
    const viewerCanSeeDonorNames = await viewerIsFundManagerPlus(ctx, fund, userId);

    const nowMs = now();
    const yearEntries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_fund", (q) =>
        q.eq("fundId", fund._id).gte("createdAt", startOfYearUTC(nowMs)),
      )
      .collect();
    const monthStart = startOfMonthUTC(nowMs);
    const monthEntries = yearEntries.filter((e) => e.createdAt >= monthStart);

    const recentEntries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_fund", (q) => q.eq("fundId", fund._id))
      .order("desc")
      .take(RECENT_ACTIVITY_LIMIT);

    const activity = await Promise.all(
      recentEntries.map(async (entry) => {
        const base = {
          id: entry._id,
          kind: entry.kind,
          amountCents: entry.amountCents,
          direction: entry.direction,
          createdAt: entry.createdAt,
        };
        // Anonymize by default: only a manager+ viewer sees who gave.
        if (!viewerCanSeeDonorNames || entry.kind !== "donation" || !entry.actorUserId) {
          return base;
        }
        const donor = await ctx.db.get(entry.actorUserId);
        return { ...base, donorName: donorDisplayName(donor) };
      }),
    );

    return {
      fund: { id: fund._id, name: fund.name, status: fund.status },
      balanceCents: fund.balanceCents,
      monthToDate: summarizePeriod(monthEntries),
      yearToDate: summarizePeriod(yearEntries),
      activity,
      viewerCanSeeDonorNames,
    };
  },
});

// ============================================================================
// getCommunityFinanceOverview — the Finance home
// ============================================================================

/**
 * Everything the community-level Finance home renders in one round trip: each
 * fund's balance and month, the groups that have no fund yet, the card-provider
 * connection, and how many people hold financial controls.
 *
 * WHY ONE QUERY. The screen is a list of rows whose SUBTITLES are the data —
 * "«group» — $balance · $spent this month · N cards". Fetching those per row
 * would mean one subscription per group, each with its own auth round trip,
 * for a screen whose whole job is the overview.
 *
 * COST. Convex has no `["communityId", "createdAt"]` index on `ledgerEntries`
 * (only `by_community` on the id alone), so a single community-wide month
 * window is not expressible as one range scan. Rather than add an index for
 * one screen, this fans out over the community's funds and uses the SAME
 * `by_fund` range `getFundOverview` uses — an indexed read bounded by the
 * month, not by the fund's history. That is 2 indexed reads per fund (ledger
 * window + card list) plus 3 fixed ones, i.e. O(funds), and a fund only exists
 * where an admin turned giving on. If a community ever has enough funds for
 * that to hurt, the fix is the compound index and a single scan — not
 * pagination of a summary.
 *
 * The balance is `funds.balanceCents` — the ledger-maintained cache every
 * other surface reads, so this screen can't disagree with the fund screen.
 */
export const getCommunityFinanceOverview = query({
  args: { token: v.string(), communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityFinanceAccess(ctx, userId, args.communityId);
    await requireGroupGivingEnabled(ctx);

    const finance = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    const onboardingStatus = finance?.onboardingStatus ?? null;
    // The one precondition `enableGroupGiving` checks that this screen can
    // answer without attempting the mutation. Sent as a flag AND a reason so
    // the row can explain itself rather than just being disabled.
    const canEnableGiving = onboardingStatus === "live";

    const connection = await loadConnectionRow(ctx, args.communityId);
    const providerName = await resolveCardProviderName(ctx, args.communityId);

    const funds = await ctx.db
      .query("funds")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    const groupById = new Map(groups.map((group) => [group._id, group]));

    const monthStart = startOfMonthUTC(now());

    const fundRows = await Promise.all(
      funds.map(async (fund) => {
        const monthEntries = await ctx.db
          .query("ledgerEntries")
          .withIndex("by_fund", (q) =>
            q.eq("fundId", fund._id).gte("createdAt", monthStart),
          )
          .collect();
        const month = summarizePeriod(monthEntries);

        // Live cards only: a canceled or failed card is not a card this fund
        // has, and counting one would tell an admin their fund is covered
        // when it isn't. Same denylist `createFundCard` enforces the
        // one-card-per-fund rule with.
        const cards = await ctx.db
          .query("cards")
          .withIndex("by_fund", (q) => q.eq("fundId", fund._id))
          .collect();
        const cardCount = cards.filter((card) =>
          isLiveCardStatus(card.status),
        ).length;

        const group = fund.groupId ? (groupById.get(fund.groupId) ?? null) : null;

        return {
          fundId: fund._id,
          groupId: fund.groupId ?? null,
          // Null for the community's general fund, which belongs to no group.
          groupName: group?.name ?? null,
          fundName: fund.name,
          type: fund.type,
          status: fund.status,
          balanceCents: fund.balanceCents,
          monthDonatedCents: month.donationsCents,
          monthSpentCents: month.spentCents,
          cardCount,
        };
      }),
    );

    // General fund first (it's the community's own money), then group funds
    // by the name the admin will scan for.
    fundRows.sort((a, b) => {
      if (a.type !== b.type) return a.type === "general" ? -1 : 1;
      return (a.groupName ?? a.fundName).localeCompare(b.groupName ?? b.fundName);
    });

    const fundedGroupIds = new Set(
      funds.map((fund) => fund.groupId).filter(Boolean),
    );
    const groupsWithoutFunds = groups
      // Archived groups are excluded rather than shown disabled: enabling
      // giving on one would create a fund the archive job immediately freezes.
      .filter((group) => !group.isArchived && !fundedGroupIds.has(group._id))
      .map((group) => ({ groupId: group._id, groupName: group.name }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName));

    // Active grants only. The primary admin holds financial controls with no
    // row at all (see `canManageCommunityFinance`), so this is deliberately
    // "how many people it was GIVEN to" — the same population the Financial
    // controls screen lists, and the count has to agree with that screen.
    const financeRoles = await ctx.db
      .query("communityFinanceRoles")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    const financeGrantCount = financeRoles.filter(
      (role) => role.revokedAt === undefined,
    ).length;

    return {
      onboardingStatus,
      canEnableGiving,
      provider: {
        /** The community's effective issuer: "increase" | "privacy" | "bill" | "none". */
        name: providerName,
        connected: connection?.status === "active",
        // Provider-supplied display text — untrusted, escape at render.
        accountLabel: connection?.accountLabel ?? null,
        status: (connection?.status ?? null) as
          | "active"
          | "error"
          | "revoked"
          | null,
      },
      totals: {
        balanceCents: fundRows.reduce((sum, f) => sum + f.balanceCents, 0),
        monthDonatedCents: fundRows.reduce(
          (sum, f) => sum + f.monthDonatedCents,
          0,
        ),
        monthSpentCents: fundRows.reduce((sum, f) => sum + f.monthSpentCents, 0),
        cardCount: fundRows.reduce((sum, f) => sum + f.cardCount, 0),
        fundCount: fundRows.length,
      },
      funds: fundRows,
      groupsWithoutFunds,
      financeGrantCount,
    };
  },
});

// ============================================================================
// getGivingContext — the give sheet
// ============================================================================

export const getGivingContext = query({
  args: { token: v.string(), groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    if (!(await isGroupGivingEnabled(ctx))) {
      return null; // Flag off — hides the giving tile, give sheet, and hub.
    }

    const fund = await ctx.db
      .query("funds")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .first();
    if (!fund) {
      return null;
    }

    // Fail OPEN, not loud. This query's whole job is "should this surface
    // show a fund at all?", and it runs on `GroupInfoScreen` /
    // `GroupDetailScreen` — routes a NON-member legitimately reaches from a
    // share link or Explore. Convex re-throws a query's server error
    // synchronously during render, so throwing here put the root
    // ErrorBoundary in front of the join CTA for every non-member of any
    // group with a fund. Matching its sibling reads on those screens
    // (`countGroupJoinRequests`, `getGroupNotifications`), "you can't see it"
    // is the same answer as "there isn't one": null. Nothing about the fund
    // leaks, and every read that returns fund DETAIL still asserts.
    if (!(await canViewFund(ctx, fund, userId))) {
      return null;
    }

    const communityFinance = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", fund.communityId))
      .first();
    const community = await ctx.db.get(fund.communityId);

    const givingLive =
      fund.status === "active" && communityFinance?.onboardingStatus === "live";

    // The give screen switches its monthly toggle between "start a monthly
    // gift" and "you already give $X/month" from this one field, so it must
    // reflect only gifts that are actually collecting — a `pending` row (donor
    // still in Checkout) or a canceled one is not a monthly gift yet/anymore.
    const liveRecurring = await findLiveRecurring(ctx, fund._id, userId);

    return {
      fundId: fund._id,
      fundName: fund.name,
      communityLegalName: communityFinance?.legalName ?? community?.name ?? "",
      suggestedAmountsCents: SUGGESTED_AMOUNTS_CENTS,
      givingLive,
      existingRecurring: liveRecurring
        ? {
            amountCents: liveRecurring.amountCents,
            feeCoverCents: liveRecurring.feeCoverCents,
          }
        : null,
    };
  },
});

// ============================================================================
// prepareDonationIntent — shared validation seam for BOTH donation-creation
// actions below (createDonationIntent's native-payment-sheet path and
// createDonationCheckoutSession's hosted-Checkout path). Actions don't have
// `ctx.db`, so all the auth/authorization/eligibility/amount checks that
// need it live here — mirrors `verifyBillingAccess` in functions/ee/billing.ts.
// ============================================================================

/**
 * Validates the donor-chosen amount is within Stripe/our own bounds and that
 * `coverFeesCents` is a fee we'd actually have quoted for that amount. Pure (no
 * `ctx`) so it's trivial to unit test directly, but only called from
 * `prepareDonationIntent` — the ONE place that gates every donation-creating
 * action, per the ADR-032 rule that money-initiating actions share one
 * validation path rather than duplicating checks per Stripe surface.
 *
 * The fee check is a bound, not a nicety: the card is charged
 * `amountCents + feeCoverCents`, so a fee field that only had to be
 * non-negative made `MAX_DONATION_CENTS` a fiction — any total was reachable by
 * putting the money in the fee. Ceiling the fee at the server's own gross-up
 * caps the actual charge at
 * `MAX_DONATION_CENTS + computeCoverFeesCents(MAX_DONATION_CENTS) + COVER_FEE_TOLERANCE_CENTS`.
 */
function validateDonationAmount(
  amountCents: number,
  coverFeesCents: number | undefined,
): { amountCents: number; feeCoverCents: number } {
  if (
    !Number.isInteger(amountCents) ||
    amountCents < MIN_DONATION_CENTS ||
    amountCents > MAX_DONATION_CENTS
  ) {
    throw new ConvexError(
      `Donation amount must be between $${MIN_DONATION_CENTS / 100} and $${MAX_DONATION_CENTS / 100}`,
    );
  }
  const feeCoverCents = coverFeesCents ?? 0;
  if (!Number.isInteger(feeCoverCents) || feeCoverCents < 0) {
    throw new ConvexError("Invalid fee-cover amount");
  }
  // The bound is deliberately ONE-SIDED — a ceiling, not a match. Only an
  // over-large fee moves money it shouldn't: the card is charged
  // `amountCents + feeCoverCents`, so it's the upper edge that keeps
  // MAX_DONATION_CENTS honest. A fee *below* the quote just under-covers the
  // fund, which is what every client did before this gross-up landed and is
  // the donor's own money either way.
  //
  // That asymmetry is also what makes this safe to ship: the pre-gross-up
  // estimate diverges from this one by more than the tolerance from $12.93 up,
  // so a symmetric match would have rejected every fee-covered mid-size gift
  // from a donor still on the old JS bundle for the whole length of the OTA
  // rollout. The tolerance absorbs rounding drift on the high side only.
  const expectedFeeCents = computeCoverFeesCents(amountCents);
  if (feeCoverCents > expectedFeeCents + COVER_FEE_TOLERANCE_CENTS) {
    // Logged with the numbers because the donor-facing copy deliberately has
    // none: a spike here is how we'd notice the two fee implementations drifting.
    console.warn(
      `[finance] fee-cover above the quoted fee — amount=${amountCents} submitted=${feeCoverCents} expected=${expectedFeeCents}`,
    );
    throw new ConvexError(
      "We couldn't confirm the processing fee for this gift. Please reopen the give screen and try again.",
    );
  }
  return { amountCents, feeCoverCents };
}

/**
 * Shared validation for creating a donation on Stripe, however it's
 * collected: flag gate, amount bounds, fund-active, community-live. Both
 * `createDonationIntent` (native payment-sheet path) and
 * `createDonationCheckoutSession` (hosted Checkout path) call this FIRST and
 * build their respective Stripe object from its return value — this is the
 * "refactor shared logic rather than duplicate" seam the two donation
 * actions are built on.
 */
export const prepareDonationIntent = internalQuery({
  args: {
    token: v.string(),
    fundId: v.id("funds"),
    amountCents: v.number(),
    coverFeesCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGroupGivingEnabled(ctx); // Gate donation creation at the source.

    const { amountCents, feeCoverCents } = validateDonationAmount(
      args.amountCents,
      args.coverFeesCents,
    );

    const fund = await ctx.db.get(args.fundId);
    if (!fund) {
      throw new Error("Fund not found");
    }
    if (fund.status !== "active") {
      throw new Error("This fund isn't currently accepting gifts");
    }

    await assertCanViewFund(ctx, fund, userId);

    const communityFinance = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", fund.communityId))
      .first();
    if (
      !communityFinance ||
      communityFinance.onboardingStatus !== "live" ||
      !communityFinance.stripeConnectedAccountId
    ) {
      throw new Error("Giving isn't set up for this community yet");
    }

    // The donor-facing community name, resolved the same way the give sheet
    // resolves it (getGivingContext's `communityLegalName`): the legal name
    // the receipt is issued under, falling back to the community's display
    // name. It goes in the Checkout return URL so the give-success screen can
    // say who the gift went to without a round trip.
    const community = await ctx.db.get(fund.communityId);

    return {
      userId,
      communityId: fund.communityId,
      groupId: fund.groupId,
      communityName: communityFinance.legalName ?? community?.name ?? "",
      fundName: fund.name,
      stripeConnectedAccountId: communityFinance.stripeConnectedAccountId,
      // BOTH halves of the validated pair come back, and the actions build the
      // Stripe charge from these — never from their own `args`. Handing back
      // only the fee would leave the amount side of the cap resting on the
      // caller's discipline, which is the opposite of what a single
      // "everything money-initiating goes through here" seam is for.
      amountCents,
      feeCoverCents,
    };
  },
});

// ============================================================================
// createDonationIntent — the native payment-sheet path. NOT called by the
// mobile client today (GiveScreen uses createDonationCheckoutSession's
// hosted-Checkout flow per ADR-032's Phase-1 decision: zero native-dep risk,
// ships via OTA, Apple Pay works in the browser sheet). Kept exported and
// tested for ADR-032's still-open question of whether a later phase adopts
// `@stripe/stripe-react-native`'s native payment sheet for better Apple Pay
// conversion — see the ADR's "Open questions".
// ============================================================================

/**
 * Creates a Stripe PaymentIntent on the community's connected account for a
 * donation to `fundId`. The PaymentIntent's metadata is how the webhook
 * layer (payment_intent.succeeded → recordDonationSucceeded) attributes the
 * eventual charge back to this fund/donor — see ADR-032 §3.
 *
 * Stripe is dynamically imported (mirrors functions/ee/billing.ts) so this
 * module only loads the SDK when the action actually runs.
 */
export const createDonationIntent = action({
  args: {
    token: v.string(),
    fundId: v.id("funds"),
    coverFeesCents: v.optional(v.number()),
    amountCents: v.number(),
    // Client-generated once per give-sheet session (e.g. a UUID minted when
    // the sheet opens, reused across retries of the same tap). When present,
    // it becomes part of a Stripe request-level idempotency key so a
    // double-tap on "Give" (slow network, accidental double submit) resolves
    // to the SAME PaymentIntent instead of charging the donor twice.
    idempotencyNonce: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ clientSecret: string; paymentIntentId: string }> => {
    const context = await ctx.runQuery(
      internal.functions.finance.giving.prepareDonationIntent,
      {
        token: args.token,
        fundId: args.fundId,
        amountCents: args.amountCents,
        coverFeesCents: args.coverFeesCents,
      },
    );

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-02-25.clover",
    });

    // Created ON the community's connected account (`stripeAccount`) — the
    // donor's card is charged there directly, not on the platform account,
    // per the acquiring topology in ADR-032 §1.
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: context.amountCents + context.feeCoverCents,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        metadata: {
          fundId: args.fundId,
          donorUserId: context.userId,
          communityId: context.communityId,
          feeCoverCents: String(context.feeCoverCents),
        },
      },
      {
        stripeAccount: context.stripeConnectedAccountId,
        // Stripe's own request-level idempotency key (not our ledger's
        // idempotencyKey) — a retried/double-tapped request with the same
        // key returns the ORIGINAL PaymentIntent instead of creating a
        // second one, which is what actually prevents a double charge (the
        // ledger's own dedupe only kicks in later, once the PaymentIntent
        // has already succeeded).
        ...(args.idempotencyNonce
          ? {
              idempotencyKey: `donation-intent:${args.fundId}:${args.idempotencyNonce}`,
            }
          : {}),
      },
    );

    if (!paymentIntent.client_secret) {
      throw new Error("Stripe did not return a client secret");
    }

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    };
  },
});

// ============================================================================
// createDonationCheckoutSession — the hosted Stripe Checkout path (ADR-032
// §3/§6 Phase 1 decision: zero native dependencies, ships via OTA, Apple Pay
// works in the browser sheet). This is what GiveScreen actually calls.
// ============================================================================

/**
 * The https links the Checkout session redirects back to on completion /
 * cancellation — NOT the custom "togather://" scheme (Stripe requires
 * https).
 *
 * Both live on `DOMAIN_CONFIG.appUrl`, the origin the Expo web app is served
 * from (staging.togather.nyc on staging, togather.nyc in production). Unlike
 * a group's `shortId` — which the previous /g/<shortId> return URL depended
 * on and which not every group has — that origin is a constant, so there is
 * no degraded branch to reason about.
 *
 * Two consequences worth knowing:
 *  - `/groups/...` is NOT in the Android App Link intent filters
 *    (apps/mobile/app.config.js only claims /e/, /g/, /c/, /a/, /nearme,
 *    /onboarding/go-live), so an Android donor completing Checkout lands on
 *    the WEB give-success screen rather than being handed back to the app.
 *    That's exactly what `getCheckoutSessionStatus` is for: the native
 *    waiting screen watches for the donation and dismisses the in-app
 *    browser itself, independent of any deep link.
 *  - `{CHECKOUT_SESSION_ID}` is Stripe's own literal template placeholder —
 *    it must reach Stripe unencoded, which is why the query string is built
 *    by hand instead of with URLSearchParams (which would percent-encode the
 *    braces).
 *
 * Amount/fund/community ride along in the URL because the success screen is
 * reached by a plain browser redirect: it renders the confirmation from the
 * params alone, with no session and no query of its own.
 */
/**
 * A community-controlled name, made safe to carry in the return URL.
 *
 * Both names that ride along are typed as plain strings a community admin
 * set (`communityFinance.legalName`, and a fund name derived from a group
 * name), and this URL is handed to Stripe — so a bad value fails the CHARGE,
 * not just the redirect. Two ways that happens, both cheap to close here:
 *
 *  - Length: percent-encoding can roughly triple a string, and Stripe rejects
 *    an over-long `success_url`. An admin who pastes an essay into their legal
 *    name would take their own community's giving offline.
 *  - Lone surrogates: `encodeURIComponent` throws `URIError` on an unpaired
 *    surrogate, which would abort checkout with an opaque error instead of a
 *    handled one. Iterating with `for...of` walks whole code points, so a
 *    valid pair survives and only true orphans (including one the slice below
 *    may have just created) are dropped.
 */
function urlSafeName(value: string): string {
  let safe = "";
  for (const char of value.slice(0, 100)) {
    const code = char.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) continue;
    safe += char;
  }
  return encodeURIComponent(safe);
}

export function buildGiveReturnUrls(params: {
  groupId: string;
  /** Integer cents the Checkout session actually charges — gift + fee cover. */
  totalCents: number;
  fundName: string;
  communityName: string;
  /**
   * Monthly gift rather than a one-off. Adds `recurring=1` so the success
   * screen — which renders from these params alone, with no session of its
   * own — can say "$25 a month" instead of "$25". A flag rather than a
   * separate route because everything else on that screen is identical.
   */
  recurring?: boolean;
}): { successUrl: string; cancelUrl: string } {
  // groupId is a system-generated Convex id today, so encoding it is belt-and-
  // braces — but it is the one value here interpolated into the PATH, where an
  // unescaped character would retarget the redirect rather than garble a label.
  const groupUrl = `${DOMAIN_CONFIG.appUrl}/groups/${encodeURIComponent(params.groupId)}`;
  return {
    successUrl:
      `${groupUrl}/give-success?session_id={CHECKOUT_SESSION_ID}` +
      `&amount=${params.totalCents}` +
      `&fund=${urlSafeName(params.fundName)}` +
      `&community=${urlSafeName(params.communityName)}` +
      (params.recurring ? "&recurring=1" : ""),
    cancelUrl: `${groupUrl}/give?giving=cancelled`,
  };
}

/**
 * Creates a Stripe Checkout Session (hosted page) on the community's
 * connected account for a donation to `fundId`.
 *
 * CRITICAL: Checkout session-level `metadata` does NOT propagate to the
 * PaymentIntent Checkout creates under the hood — only `payment_intent_data.
 * metadata` does. The existing `payment_intent.succeeded` webhook path
 * (functions/finance/webhooks.ts's `handleFinanceStripeEvent`, including the
 * connected-account cross-check and `splitDonationAmounts`) reads metadata
 * off the PaymentIntent event object, so it MUST land there, unchanged from
 * what `createDonationIntent` sets directly.
 */
export const createDonationCheckoutSession = action({
  args: {
    token: v.string(),
    fundId: v.id("funds"),
    amountCents: v.number(),
    coverFeesCents: v.optional(v.number()),
    // Same contract as createDonationIntent's idempotencyNonce — see that
    // action's doc comment.
    idempotencyNonce: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    url: string;
    sessionId: string;
    paymentIntentId: string | null;
  }> => {
    const context = await ctx.runQuery(
      internal.functions.finance.giving.prepareDonationIntent,
      {
        token: args.token,
        fundId: args.fundId,
        amountCents: args.amountCents,
        coverFeesCents: args.coverFeesCents,
      },
    );
    if (!context.groupId) {
      // The success/cancel links are group-scoped routes
      // (`/groups/[group_id]/give-success` and `.../give`) — a community-wide
      // general fund has no such screen yet, so hosted Checkout isn't wired
      // for it.
      throw new Error("Checkout isn't available for this fund yet");
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-02-25.clover",
    });

    const totalCents = context.amountCents + context.feeCoverCents;
    const { successUrl, cancelUrl } = buildGiveReturnUrls({
      groupId: context.groupId,
      totalCents,
      fundName: context.fundName,
      communityName: context.communityName,
    });

    // Created ON the community's connected account (`stripeAccount`) — same
    // direct-charge topology as createDonationIntent, per ADR-032 §1.
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: totalCents,
              product_data: { name: `Gift to ${context.fundName}` },
            },
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        payment_intent_data: {
          description: `Donation — ${context.fundName}`,
          // Same shape recordDonationSucceeded/handleFinanceStripeEvent
          // already expect from createDonationIntent's direct PaymentIntent
          // metadata — see the file-level CRITICAL note above.
          metadata: {
            fundId: args.fundId,
            donorUserId: context.userId,
            communityId: context.communityId,
            feeCoverCents: String(context.feeCoverCents),
          },
        },
      },
      {
        stripeAccount: context.stripeConnectedAccountId,
        // Mirrors createDonationIntent's own idempotency handling (FIX 5) —
        // a double-tapped "Continue" resolves to the SAME Checkout Session
        // instead of creating a second one.
        ...(args.idempotencyNonce
          ? {
              idempotencyKey: `donation-checkout:${args.fundId}:${args.idempotencyNonce}`,
            }
          : {}),
      },
    );

    if (!session.url) {
      throw new Error("Stripe did not return a Checkout URL");
    }

    // The PaymentIntent id is the ONLY thing this checkout attempt and the
    // eventual `donations` row have in common (a donation stores
    // `stripePaymentIntentId`; nothing anywhere stores a Checkout Session
    // id). Handing it back is what lets the waiting screen poll
    // `getCheckoutSessionStatus` — see that query's doc comment.
    //
    // Checkout usually populates it at creation time for a `payment`-mode
    // session, but Stripe types it nullable and does not contract that, so
    // this is read defensively rather than asserted.
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);

    if (!paymentIntentId) {
      // Stripe types `payment_intent` as nullable, and newer API versions can
      // defer creating it until the donor actually engages with the Checkout
      // page. The gift itself is unaffected — the webhook still records it off
      // the PaymentIntent that eventually exists — but with no key to hand
      // back, `getCheckoutSessionStatus` can never resolve and the waiting
      // screen loses its auto-dismiss (the donor must close the sheet
      // themselves). Logged rather than thrown for exactly that reason: it
      // degrades the wait, it does not fail the payment. If this ever fires in
      // practice, the fix is a Checkout-Session→PaymentIntent lookup, which
      // needs an action rather than this query.
      console.warn(
        `[finance] createDonationCheckoutSession: session ${session.id} has no payment_intent yet — waiting screen cannot auto-dismiss`,
      );
    }

    return { url: session.url, sessionId: session.id, paymentIntentId };
  },
});

// ============================================================================
// getCheckoutSessionStatus — the native waiting screen's "did it land yet?"
// ============================================================================

/**
 * Whether the donation for a checkout attempt has been recorded yet, so the
 * mobile give flow can dismiss its in-app browser the moment the money lands
 * instead of waiting on a deep link that Android never delivers (see
 * `buildGiveReturnUrls`).
 *
 * The argument is named `paymentIntentId`, not `sessionId`, deliberately:
 * `createDonationCheckoutSession` returns BOTH a `sessionId` (`cs_...`) and a
 * `paymentIntentId` (`pi_...`), and only the latter resolves here. Since a
 * mismatch fails silently — permanently "pending", i.e. a spinner that never
 * ends — the parameter name has to be the thing that stops the wrong value
 * being passed, because nothing downstream will.
 *
 * LIMITATION (deliberate, no schema change): nothing in the database records
 * a Stripe *Checkout Session* id. The webhook path
 * (`webhooks.ts` payment_intent.succeeded → `recordDonationSucceeded`) keys a
 * donation solely by its PaymentIntent, so the PaymentIntent id is the only
 * available join key. A raw `cs_...` Checkout Session id — what Stripe
 * substitutes into the success URL's `session_id` param — will therefore
 * never match and always reads "pending". The web give-success screen doesn't
 * need it to: it renders from the URL params.
 *
 * Never throws and never reveals another donor's gift: no token, an
 * unrecognized id, or a donation belonging to someone else all return the
 * same `{ status: "pending" }`. A waiting screen that can't confirm is
 * indistinguishable from one that hasn't been confirmed yet, which is the
 * safe direction to fail.
 */
export const getCheckoutSessionStatus = query({
  args: {
    token: v.optional(v.string()),
    paymentIntentId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: "pending" | "complete";
    amountCents?: number;
    fundName?: string;
    communityName?: string;
  }> => {
    const userId = await getOptionalAuth(ctx, args.token);
    if (!userId) {
      return { status: "pending" };
    }

    const donation = await ctx.db
      .query("donations")
      .withIndex("by_stripePaymentIntentId", (q) =>
        q.eq("stripePaymentIntentId", args.paymentIntentId),
      )
      .first();
    if (!donation || donation.donorUserId !== userId) {
      return { status: "pending" };
    }

    const fund = await ctx.db.get(donation.fundId);
    const communityFinance = fund
      ? await ctx.db
          .query("communityFinance")
          .withIndex("by_community", (q) =>
            q.eq("communityId", fund.communityId),
          )
          .first()
      : null;
    const community = fund ? await ctx.db.get(fund.communityId) : null;

    return {
      status: "complete",
      // The total the donor was actually charged — the gift plus whatever
      // fee cover they opted into — matching the `amount` param the success
      // URL carries.
      amountCents: donation.amountCents + donation.feeCoverCents,
      fundName: fund?.name,
      // Same name the give sheet and the return URL use — see
      // prepareDonationIntent.
      communityName: communityFinance?.legalName ?? community?.name,
    };
  },
});

// ============================================================================
// recordDonationSucceeded — called by the Stripe webhook layer
// ============================================================================

/**
 * Records a succeeded donation PaymentIntent: writes the `donations` row,
 * posts the ledger credit, audit-logs it, and schedules the receipt email.
 *
 * Idempotent on `paymentIntentId` — Stripe redelivers webhooks, so a repeat
 * call (same PaymentIntent, delivered twice) is a pure no-op that returns
 * the existing donation id without touching the ledger or balance again.
 * This is a stronger guarantee than `postLedgerEntry`'s own idempotency key
 * dedupe alone: we bail out BEFORE any write, so a retry can't even insert a
 * second `donations` row (which `postLedgerEntry`'s dedupe wouldn't catch,
 * since it only guards the ledger table).
 */
// CONTRACT: `amountCents` is the BASE gift (what the donor chose), NOT the
// total Stripe charged. The ledger credit below adds `feeCoverCents` on top,
// so callers passing the charged total would double-count the cover — the
// webhook layer splits the intent amount via splitDonationAmounts() first.
/**
 * The one place a succeeded gift becomes a `donations` row + ledger credit +
 * audit row + scheduled receipt, shared by BOTH collection paths: a one-off
 * PaymentIntent (`recordDonationSucceeded`, from `payment_intent.succeeded`)
 * and a monthly subscription's invoice (`recordRecurringDonationPaid`, from
 * `invoice.paid`). Extracted rather than copied so a monthly gift can never
 * drift from a one-off one in what it credits, audits, or receipts — the two
 * webhook events differ only in how they FIND the fund/amounts.
 *
 * Idempotent on `paymentIntentId`: a redelivered webhook returns the existing
 * donation id without touching the ledger or the balance a second time.
 */
async function recordDonationCore(
  ctx: MutationCtx,
  args: {
    paymentIntentId: string;
    fundId: Id<"funds">;
    donorUserId?: Id<"users">;
    amountCents: number;
    feeCoverCents: number;
    communityId: Id<"communities">;
    /** Set for a monthly gift — the `recurringDonations` row it was billed under. */
    recurringId?: string;
  },
): Promise<Id<"donations">> {
  {
    const existing = await ctx.db
      .query("donations")
      .withIndex("by_stripePaymentIntentId", (q) =>
        q.eq("stripePaymentIntentId", args.paymentIntentId),
      )
      .first();
    if (existing) {
      return existing._id;
    }

    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
      throw new Error(
        `recordDonationSucceeded: amountCents must be a positive integer, got ${args.amountCents}`,
      );
    }
    if (!Number.isInteger(args.feeCoverCents) || args.feeCoverCents < 0) {
      throw new Error(
        `recordDonationSucceeded: feeCoverCents must be a non-negative integer, got ${args.feeCoverCents}`,
      );
    }

    const donationId = await ctx.db.insert("donations", {
      fundId: args.fundId,
      donorUserId: args.donorUserId,
      amountCents: args.amountCents,
      feeCoverCents: args.feeCoverCents,
      stripePaymentIntentId: args.paymentIntentId,
      recurringId: args.recurringId,
      allocationStatus: "pending",
      receiptEmailStatus: "pending",
      createdAt: now(),
    });

    // The fund is credited for the FULL amount collected — base gift plus
    // any voluntary fee-cover — since both are money the fund now holds.
    // actorUserId is the donor (not a system actor): even though this write
    // is webhook-triggered, the underlying action (the gift) was the
    // donor's, and the transparency screen needs it to attribute the entry.
    await postLedgerEntry(ctx, {
      fundId: args.fundId,
      direction: "credit",
      amountCents: args.amountCents + args.feeCoverCents,
      kind: "donation",
      idempotencyKey: `donation:${args.paymentIntentId}`,
      stripeObjectId: args.paymentIntentId,
      actorUserId: args.donorUserId,
    });

    await logFinanceAudit(ctx, {
      communityId: args.communityId,
      fundId: args.fundId,
      actorUserId: args.donorUserId,
      action: "donation.recorded",
      details: {
        donationId,
        paymentIntentId: args.paymentIntentId,
        amountCents: args.amountCents,
        feeCoverCents: args.feeCoverCents,
        recurringId: args.recurringId ?? null,
      },
    });

    await ctx.scheduler.runAfter(
      0,
      internal.functions.finance.giving.sendDonationReceipt,
      { donationId },
    );

    return donationId;
  }
}

export const recordDonationSucceeded = internalMutation({
  args: {
    paymentIntentId: v.string(),
    fundId: v.id("funds"),
    donorUserId: v.optional(v.id("users")),
    amountCents: v.number(),
    feeCoverCents: v.number(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    return await recordDonationCore(ctx, args);
  },
});

// ============================================================================
// recordDonationRefund — called by the Stripe webhook layer on charge.refunded
// ============================================================================

/**
 * Records a (possibly partial) refund against a donation's charge.
 *
 * `amountRefundedCents` is Stripe's CUMULATIVE `amount_refunded` for the
 * charge — Stripe redelivers `charge.refunded` with the running total on
 * every refund step (first partial, then a later top-up to full), never a
 * per-event delta. We recompute the delta ourselves by summing every prior
 * "refund" ledger entry posted for this `chargeId` and subtracting: a
 * repeat delivery of the SAME cumulative amount nets to a zero delta and is
 * a pure no-op (replay-safe), while a NEW partial/full refund posts only
 * the newly-refunded increment.
 *
 * Unknown `paymentIntentId` (shouldn't happen for a real donation charge,
 * but Stripe webhooks can in principle reference anything) logs and
 * returns rather than throwing — a throw would just retry forever against
 * data that will never resolve.
 *
 * No fund-status gate here: `postLedgerEntry` already allows "refund" kind
 * entries on a frozen fund (see lib/finance/ledger.ts's
 * FROZEN_ALLOWED_KINDS) — a fund frozen mid-flight (e.g. its group just
 * archived) must still be able to settle a refund already in progress at
 * Stripe.
 *
 * ALLOCATION CONSEQUENCES (ADR-032 §3; the refund states in jobs.ts's
 * invariant table). A refund is not just a ledger debit — it changes what
 * allocation is allowed to move:
 *
 *  - The cumulative refund is stamped on the donation (`refundedCents`), so
 *    the planner and the nightly pending sum only ever count what is left of
 *    the gift, and `recordAllocation` charges a fee on that remainder rather
 *    than on the original gross.
 *  - A FULLY refunded gift flips to `allocationStatus: "refunded"`, which is
 *    terminal. Every allocation query selects `"pending"`, so this is what
 *    guarantees a returned gift can never be transferred into a group's
 *    spendable Increase Account — belt and braces with the netting in
 *    `getPayoutComposition`, which already removes it from the payout's
 *    composition when the refund settles in the same payout.
 *  - Refunding a gift that was ALREADY allocated can leave the fund's ledger
 *    negative, because the allocation posted a `fee` debit and the refund
 *    now debits the full gross on top of it. Once the donor has been given
 *    back more than the fund ever received, that fee is not recoverable from
 *    this gift, so the entry is reversed with a compensating credit
 *    (`alloc-fee-reversal:{donationId}`) rather than driving a member-visible
 *    fund balance below zero. The ledger stays append-only; nothing is
 *    patched.
 */
export const recordDonationRefund = internalMutation({
  args: {
    paymentIntentId: v.string(),
    chargeId: v.string(),
    amountRefundedCents: v.number(),
  },
  handler: async (ctx, args) => {
    const donation = await ctx.db
      .query("donations")
      .withIndex("by_stripePaymentIntentId", (q) =>
        q.eq("stripePaymentIntentId", args.paymentIntentId),
      )
      .first();
    if (!donation) {
      console.error(
        `[finance] recordDonationRefund: no donation for paymentIntent ${args.paymentIntentId} (charge ${args.chargeId})`,
      );
      return;
    }

    const fund = await ctx.db.get(donation.fundId);
    if (!fund) {
      console.error(
        `[finance] recordDonationRefund: fund ${donation.fundId} not found for donation ${donation._id}`,
      );
      return;
    }

    // No index on (fundId, kind, stripeObjectId) — by_fund is fine at these
    // volumes (a single fund's ledger, filtered client-side), per the task's
    // own note that this is acceptable.
    const fundEntries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_fund", (q) => q.eq("fundId", fund._id))
      .collect();
    const alreadyRefundedCents = fundEntries
      .filter((e) => e.kind === "refund" && e.stripeObjectId === args.chargeId)
      .reduce((sum, e) => sum + e.amountCents, 0);

    const deltaCents = args.amountRefundedCents - alreadyRefundedCents;
    if (deltaCents <= 0) {
      // Already fully applied (a redelivery of the same, or an
      // out-of-order/smaller, cumulative amount) — nothing new to post.
      return;
    }

    await postLedgerEntry(ctx, {
      fundId: fund._id,
      direction: "debit",
      amountCents: deltaCents,
      kind: "refund",
      // The CUMULATIVE amount in the key (not just chargeId) means each
      // refund STEP on this charge gets its own idempotency key: a repeat
      // delivery of the same cumulative amount dedupes via postLedgerEntry's
      // own idempotencyKey check, while a later step (partial -> full) is a
      // distinct key and posts its own entry.
      idempotencyKey: `refund:${args.chargeId}:${args.amountRefundedCents}`,
      stripeObjectId: args.chargeId,
    });

    // --- Keep allocation from moving money the donor already got back. ---
    const grossCents = donation.amountCents + donation.feeCoverCents;
    const refundedCents = args.amountRefundedCents;
    const fullyRefunded = refundedCents >= grossCents;
    const donationPatch: {
      refundedCents: number;
      allocationStatus?: "refunded";
      allocationTransferStartedAt?: undefined;
    } = { refundedCents };
    if (fullyRefunded && donation.allocationStatus === "pending") {
      // Terminal: no payout will ever fund this gift. Releasing the lease too
      // means a pass that had claimed it doesn't hold a dead reservation.
      donationPatch.allocationStatus = "refunded";
      donationPatch.allocationTransferStartedAt = undefined;
    }
    await ctx.db.patch(donation._id, donationPatch);

    // --- Don't let an already-realised fee drive the fund below zero. ---
    // The `fee` debit exists only to reconcile the GROSS ledger credit
    // against the NET the bank actually holds. Once the refunds exceed that
    // net (gross − fee), the credit it was offsetting is gone and the debit
    // is pure overdraft, so reverse it. Below that line the arithmetic still
    // works out non-negative and the fee stays where it is: Stripe really did
    // keep it on the portion the fund retained.
    const allocationFeeEntry = fundEntries.find(
      (e) => e.idempotencyKey === `alloc-fee:${donation._id}`,
    );
    const allocationFeeCents = allocationFeeEntry?.amountCents ?? 0;
    const feeReversedCents =
      allocationFeeCents > 0 && refundedCents > grossCents - allocationFeeCents
        ? allocationFeeCents
        : 0;
    if (feeReversedCents > 0) {
      await postLedgerEntry(ctx, {
        fundId: fund._id,
        direction: "credit",
        amountCents: allocationFeeCents,
        kind: "fee",
        idempotencyKey: `alloc-fee-reversal:${donation._id}`,
        stripeObjectId: args.chargeId,
      });
    }

    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      action: "donation.refunded",
      details: {
        paymentIntentId: args.paymentIntentId,
        chargeId: args.chargeId,
        deltaCents,
        cumulativeCents: refundedCents,
        donationId: donation._id,
        // Spelled out so the audit row alone explains why (or why not) this
        // gift dropped out of the allocation queue.
        allocationStatus: donationPatch.allocationStatus ?? donation.allocationStatus,
        feeReversedCents,
      },
    });
  },
});

// ============================================================================
// recordDonationDisputed — called by the Stripe webhook layer on
// charge.dispute.created
// ============================================================================

/**
 * Audit-only for now: records a Stripe dispute (chargeback) filed against a
 * donation charge. ADR-032 doesn't yet define a dispute-lifecycle state
 * machine (provisional debit on dispute creation, reversal on win, final
 * debit + fund-balance impact on loss) — that's real money potentially
 * leaving a fund outside the normal ledger-entry flow, and needs its own
 * design pass. Until it ships, a dispute is surfaced purely for visibility
 * via `financeAuditEvents`; any actual withdrawal Stripe/Increase performs
 * behind the scenes will show up as ledger/bank drift and get caught (and
 * alarmed on) by the existing nightly reconcile job — see jobs.ts's
 * `runNightlyReconcile`.
 */
export const recordDonationDisputed = internalMutation({
  args: {
    paymentIntentId: v.optional(v.string()),
    disputeId: v.string(),
    amountCents: v.number(),
  },
  handler: async (ctx, args) => {
    if (!args.paymentIntentId) {
      console.error(
        `[finance] recordDonationDisputed: dispute ${args.disputeId} has no payment_intent`,
      );
      return;
    }

    const donation = await ctx.db
      .query("donations")
      .withIndex("by_stripePaymentIntentId", (q) =>
        q.eq("stripePaymentIntentId", args.paymentIntentId!),
      )
      .first();
    if (!donation) {
      console.error(
        `[finance] recordDonationDisputed: no donation for paymentIntent ${args.paymentIntentId} (dispute ${args.disputeId})`,
      );
      return;
    }

    const fund = await ctx.db.get(donation.fundId);
    if (!fund) {
      console.error(
        `[finance] recordDonationDisputed: fund ${donation.fundId} not found for donation ${donation._id}`,
      );
      return;
    }

    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      action: "donation.disputed",
      details: {
        paymentIntentId: args.paymentIntentId,
        disputeId: args.disputeId,
        amountCents: args.amountCents,
      },
    });
  },
});

// ============================================================================
// sendDonationReceipt
// ============================================================================

/**
 * Internal query backing `sendDonationReceipt` — gathers everything the
 * receipt template needs (church legal name/EIN, donor name/email, fund
 * name) in one round trip.
 */
export const getDonationReceiptContext = internalQuery({
  args: { donationId: v.id("donations") },
  handler: async (ctx, args) => {
    const donation = await ctx.db.get(args.donationId);
    if (!donation) return null;
    const fund = await ctx.db.get(donation.fundId);
    if (!fund) return null;
    const communityFinance = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", fund.communityId))
      .first();
    if (!communityFinance) return null;
    const donor = donation.donorUserId
      ? await ctx.db.get(donation.donorUserId)
      : null;

    return {
      legalName: communityFinance.legalName,
      ein: communityFinance.ein,
      donorName: donorDisplayName(donor),
      donorEmail: donor?.email,
      amountCents: donation.amountCents,
      feeCoverCents: donation.feeCoverCents,
      fundName: fund.name,
      dateMs: donation.createdAt,
    };
  },
});

export const markReceiptEmailStatus = internalMutation({
  args: {
    donationId: v.id("donations"),
    status: v.union(v.literal("sent"), v.literal("failed")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.donationId, { receiptEmailStatus: args.status });
  },
});

/**
 * Renders and sends the donation receipt via Resend, from the church's own
 * name/EIN (ADR-032 §3). Scheduled by `recordDonationSucceeded`.
 *
 * NOTE on runtime: unlike functions/auth/emailOtp.ts and
 * functions/support/sendErrorReport.ts, this file does NOT use the "use
 * node" directive, because it also exports queries/mutations/actions that
 * must run in Convex's isolate runtime (a "use node" file may only contain
 * actions — see docs.convex.dev/functions/runtimes#nodejs-runtime). The
 * `resend` package is plain fetch-based (no Node built-ins — verified by
 * inspecting its bundled dist), so it runs fine here without Node; if that
 * ever changes, split this action out into its own "use node" file.
 */
export const sendDonationReceipt = internalAction({
  args: { donationId: v.id("donations") },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(
      internal.functions.finance.giving.getDonationReceiptContext,
      { donationId: args.donationId },
    );
    if (!context) {
      console.error(
        `[finance] sendDonationReceipt: donation ${args.donationId} (or its fund/communityFinance) not found`,
      );
      return;
    }

    if (!context.donorEmail) {
      // Anonymous/guest gifts (no donorUserId) or a donor with no email on
      // file have nowhere to send a receipt. Not a failure of the send
      // path itself, but the donor never gets a receipt, so mark it failed
      // rather than a false "sent".
      await ctx.runMutation(
        internal.functions.finance.giving.markReceiptEmailStatus,
        { donationId: args.donationId, status: "failed" },
      );
      return;
    }

    const email = buildDonationReceiptEmail({
      legalName: context.legalName,
      ein: context.ein,
      donorName: context.donorName,
      amountCents: context.amountCents,
      feeCoverCents: context.feeCoverCents,
      fundName: context.fundName,
      dateMs: context.dateMs,
    });

    const resend = getResendClient();
    if (!resend) {
      console.error(
        "[finance] sendDonationReceipt: Resend not configured (missing RESEND_API_KEY)",
      );
      await ctx.runMutation(
        internal.functions.finance.giving.markReceiptEmailStatus,
        { donationId: args.donationId, status: "failed" },
      );
      return;
    }

    try {
      const response = await resend.emails.send({
        from: DOMAIN_CONFIG.emailFrom,
        to: context.donorEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      if (response.error) {
        console.error(
          "[finance] sendDonationReceipt: Resend API error",
          response.error,
        );
        await ctx.runMutation(
          internal.functions.finance.giving.markReceiptEmailStatus,
          { donationId: args.donationId, status: "failed" },
        );
        return;
      }
      await ctx.runMutation(
        internal.functions.finance.giving.markReceiptEmailStatus,
        { donationId: args.donationId, status: "sent" },
      );
    } catch (error) {
      console.error("[finance] sendDonationReceipt: failed to send", error);
      await ctx.runMutation(
        internal.functions.finance.giving.markReceiptEmailStatus,
        { donationId: args.donationId, status: "failed" },
      );
    }
  },
});

// ============================================================================
// Recurring (monthly) giving — ADR-032 §3 "standing gifts".
//
// A monthly gift is a Stripe SUBSCRIPTION on the community's connected
// account, and every charge it makes is recorded as an ordinary `donations`
// row so the ledger, receipts, allocation and transparency screens keep
// working unchanged (see the `recurringDonations` doc comment in schema.ts).
//
// Three things make this materially different from the one-off path, and
// each is the reason for a piece of machinery below:
//
//  1. Subscription-mode Checkout REQUIRES a Stripe Customer, and donors have
//     none — communities have a platform Customer for SaaS billing, donors
//     have nothing anywhere. So one is created (and thereafter reused) on the
//     CONNECTED account, and its id is stored on the row.
//  2. `payment_intent_data` is not allowed in subscription mode, so the
//     metadata that attributes a charge to a fund cannot ride on the
//     PaymentIntent. It goes on `subscription_data.metadata` instead — which
//     means a monthly charge is recorded from `invoice.paid`, NOT from
//     `payment_intent.succeeded`. That handler sees a PaymentIntent with no
//     `fundId` metadata and returns early, exactly as it does for billing's
//     own intents; there is a test asserting that non-interference.
//  3. The subscription does not exist while the donor is still on Stripe's
//     hosted page, so the row is inserted `pending` and bound to its
//     subscription later, by `checkout.session.completed`.
// ============================================================================

/** The dedicated manage screen for a monthly gift — where the Stripe Billing
 * Portal returns the donor after a card update.
 *
 * `portal_return=1` is not decoration. On native the portal opens in an
 * auth-less in-app browser, so this URL loads the WEB app with no session and
 * every authenticated query on the manage screen skips — a skeleton that never
 * fills. The flag is how that screen tells "came back from Stripe with no
 * session" (show a terminal "you can close this window" notice) apart from
 * "signed in, auth still restoring" (keep the skeleton). Same shape as
 * `?giving=cancelled` on the give sheet. */
function buildRecurringManageUrl(groupId: string): string {
  return `${DOMAIN_CONFIG.appUrl}/groups/${encodeURIComponent(groupId)}/monthly-giving?portal_return=1`;
}

/** Copy the donor actually reads when they already give monthly to this fund. */
const ALREADY_RECURRING_MESSAGE =
  "You already have a monthly gift to this fund. You can change the amount or stop it from your giving settings.";

/** Copy for the narrower case of a Checkout page still open in another tab. */
const RECURRING_CHECKOUT_IN_PROGRESS_MESSAGE =
  "You just started setting up a monthly gift to this fund. Finish that checkout, or try again in a few minutes.";

/**
 * Everything the recurring Checkout path needs that `prepareDonationIntent`
 * (the shared auth/amount/fund/live seam, which this path calls FIRST and
 * does not duplicate) doesn't already answer: is there already a monthly gift
 * here, is there a stale Checkout to supersede, and is there a Stripe
 * Customer for this donor we should reuse.
 */
export const prepareRecurringDonation = internalQuery({
  args: { token: v.string(), fundId: v.id("funds") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGroupGivingEnabled(ctx);

    const fund = await ctx.db.get(args.fundId);
    if (!fund) {
      throw new Error("Fund not found");
    }
    const communityFinance = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", fund.communityId))
      .first();
    const stripeConnectedAccountId = communityFinance?.stripeConnectedAccountId;
    if (!stripeConnectedAccountId) {
      throw new Error("Giving isn't set up for this community yet");
    }

    const rowsForFund = await ctx.db
      .query("recurringDonations")
      .withIndex("by_donor_fund", (q) =>
        q.eq("donorUserId", userId).eq("fundId", args.fundId),
      )
      .collect();

    const nowMs = now();
    const blockingRows = rowsForFund.filter((r) => blocksNewRecurring(r, nowMs));
    const blocking = blockingRows[0];
    // Every OTHER `pending` row is an abandoned Checkout — see
    // PENDING_CHECKOUT_GRACE_MS. They're superseded (session expired at
    // Stripe, row canceled) rather than left to lock the donor out forever.
    // Filtered against the whole blocking SET, not just the first one: with
    // two blocking rows, `r !== blocking` would have handed the second to the
    // supersede loop and canceled a row that is actively billing.
    const stalePending = rowsForFund.filter(
      (r) => r.status === "pending" && !blockingRows.includes(r),
    );

    // CUSTOMER REUSE RULE: one Stripe Customer per (donor, connected
    // account) — NOT per fund and NOT per subscription. A donor giving
    // monthly to two funds in the same community is one person with one card
    // on file at that community, so a second Customer would split their
    // payment methods across two billing-portal identities and make "update
    // my card" fix only half their gifts. Scanning the donor's OWN rows is
    // the whole search space (nothing else ever creates a donor Customer),
    // and the connected-account match is what keeps community A's Customer
    // out of community B's account, where the id would simply not exist.
    const donorRows = await ctx.db
      .query("recurringDonations")
      .withIndex("by_donor", (q) => q.eq("donorUserId", userId))
      .collect();
    const reusableCustomerId =
      donorRows.find(
        (r) =>
          r.stripeConnectedAccountId === stripeConnectedAccountId &&
          !!r.stripeCustomerId,
      )?.stripeCustomerId ?? null;

    const donor = await ctx.db.get(userId);

    return {
      donorUserId: userId,
      donorName: donorDisplayName(donor),
      donorEmail: donor?.email,
      stripeConnectedAccountId,
      blockingStatus: blocking?.status ?? null,
      stalePending: stalePending.map((r) => ({
        id: r._id,
        checkoutSessionId: r.checkoutSessionId,
      })),
      reusableCustomerId,
    };
  },
});

/**
 * Marks an abandoned Checkout's row canceled so it stops blocking a fresh
 * attempt. Never touches a row that has a subscription — by then it isn't a
 * stale Checkout, it's a real monthly gift.
 */
export const supersedePendingRecurringDonation = internalMutation({
  args: { recurringDonationId: v.id("recurringDonations") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.recurringDonationId);
    if (!row || row.status !== "pending" || row.stripeSubscriptionId) {
      return;
    }
    const timestamp = now();
    await ctx.db.patch(row._id, {
      status: "canceled",
      canceledAt: timestamp,
      updatedAt: timestamp,
    });
    await logFinanceAudit(ctx, {
      communityId: row.communityId,
      fundId: row.fundId,
      actorUserId: row.donorUserId,
      action: "recurring.checkout_abandoned",
      details: { recurringDonationId: row._id, reason: "superseded" },
    });
  },
});

/**
 * Inserts the `pending` row, re-checking the one-per-donor-per-fund rule
 * INSIDE the transaction. The check in `prepareRecurringDonation` is for the
 * error message; this one is the actual guarantee — two taps racing through
 * the action would both pass a read-only check and only this write can
 * serialize them.
 *
 * `checkoutSessionId` starts empty because the Stripe session doesn't exist
 * yet: the row id has to exist FIRST so it can go into the subscription
 * metadata (which is what every later invoice carries), and Convex ids are
 * only minted by the insert. `bindRecurringCheckoutSession` fills it in a
 * moment later; `abandonRecurringDonation` cancels the row if Stripe fails in
 * between, so a failed create can't leave a phantom blocking the retry.
 */
export const beginRecurringDonation = internalMutation({
  args: {
    token: v.string(),
    fundId: v.id("funds"),
    amountCents: v.number(),
    feeCoverCents: v.number(),
    stripeConnectedAccountId: v.string(),
    stripeCustomerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const fund = await ctx.db.get(args.fundId);
    if (!fund) {
      throw new Error("Fund not found");
    }

    // `blocksNewRecurring`, NOT `findLiveRecurring`: this check has to include
    // non-stale `pending` rows or it doesn't serialize anything. Two taps from
    // two tabs both pass the read-only check in `prepareRecurringDonation`,
    // and a live-only check here lets BOTH inserts land — two Checkouts, two
    // subscriptions, a donor billed twice a month for one gift. Reading the
    // same `by_donor_fund` range the insert writes to is what makes Convex's
    // OCC retry the loser, so the invariant actually holds under a race.
    const timestamp = now();
    const rowsForFund = await ctx.db
      .query("recurringDonations")
      .withIndex("by_donor_fund", (q) =>
        q.eq("donorUserId", userId).eq("fundId", args.fundId),
      )
      .collect();
    const blocking = rowsForFund.find((r) => blocksNewRecurring(r, timestamp));
    if (blocking) {
      throw new ConvexError(
        blocking.status === "pending"
          ? RECURRING_CHECKOUT_IN_PROGRESS_MESSAGE
          : ALREADY_RECURRING_MESSAGE,
      );
    }

    const recurringDonationId = await ctx.db.insert("recurringDonations", {
      fundId: args.fundId,
      communityId: fund.communityId,
      donorUserId: userId,
      amountCents: args.amountCents,
      feeCoverCents: args.feeCoverCents,
      stripeCustomerId: args.stripeCustomerId,
      stripeConnectedAccountId: args.stripeConnectedAccountId,
      checkoutSessionId: "",
      status: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: args.fundId,
      actorUserId: userId,
      action: "recurring.created",
      details: {
        recurringDonationId,
        amountCents: args.amountCents,
        feeCoverCents: args.feeCoverCents,
      },
    });

    return recurringDonationId;
  },
});

/** Stamps the real Checkout Session id (and Customer) onto a row created by
 * `beginRecurringDonation` — the handle `checkout.session.completed` resolves. */
export const bindRecurringCheckoutSession = internalMutation({
  args: {
    recurringDonationId: v.id("recurringDonations"),
    checkoutSessionId: v.string(),
    stripeCustomerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.recurringDonationId, {
      checkoutSessionId: args.checkoutSessionId,
      ...(args.stripeCustomerId
        ? { stripeCustomerId: args.stripeCustomerId }
        : {}),
      updatedAt: now(),
    });
  },
});

/** Cancels a row whose Stripe Checkout Session never got created, so the
 * failed attempt doesn't block the donor's retry. */
export const abandonRecurringDonation = internalMutation({
  args: { recurringDonationId: v.id("recurringDonations") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.recurringDonationId);
    if (!row || row.status !== "pending" || row.stripeSubscriptionId) {
      return;
    }
    const timestamp = now();
    await ctx.db.patch(row._id, {
      status: "canceled",
      canceledAt: timestamp,
      updatedAt: timestamp,
    });
    await logFinanceAudit(ctx, {
      communityId: row.communityId,
      fundId: row.fundId,
      actorUserId: row.donorUserId,
      action: "recurring.checkout_abandoned",
      details: { recurringDonationId: row._id, reason: "stripe_error" },
    });
  },
});

/**
 * Creates a subscription-mode Stripe Checkout Session on the community's
 * connected account for a MONTHLY gift to `fundId`.
 *
 * Everything the one-off path validates is validated here too, by calling the
 * same `prepareDonationIntent` seam rather than re-deriving any of it.
 */
export const createRecurringDonationCheckoutSession = action({
  args: {
    token: v.string(),
    fundId: v.id("funds"),
    amountCents: v.number(),
    coverFeesCents: v.optional(v.number()),
    /** Same contract as createDonationCheckoutSession's — see that action. */
    idempotencyNonce: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    url: string;
    sessionId: string;
    recurringDonationId: Id<"recurringDonations">;
  }> => {
    const context = await ctx.runQuery(
      internal.functions.finance.giving.prepareDonationIntent,
      {
        token: args.token,
        fundId: args.fundId,
        amountCents: args.amountCents,
        coverFeesCents: args.coverFeesCents,
      },
    );
    if (!context.groupId) {
      // Same limitation as one-off hosted Checkout: the success/cancel links
      // are group-scoped routes a community-wide general fund has no screen for.
      throw new Error("Checkout isn't available for this fund yet");
    }

    const recurring = await ctx.runQuery(
      internal.functions.finance.giving.prepareRecurringDonation,
      { token: args.token, fundId: args.fundId },
    );
    if (recurring.blockingStatus) {
      throw new ConvexError(
        recurring.blockingStatus === "pending"
          ? RECURRING_CHECKOUT_IN_PROGRESS_MESSAGE
          : ALREADY_RECURRING_MESSAGE,
      );
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-02-25.clover",
    });

    // Expire abandoned Checkout Sessions BEFORE starting a new one. Without
    // this, a donor who left one open in another tab could complete it after
    // the new one and end up with two subscriptions to the same fund — the
    // exact thing the one-per-fund rule exists to prevent.
    //
    // A row is only superseded once Stripe has CONFIRMED its session can never
    // complete. Superseding on an unverified guess is worse than refusing the
    // new attempt: a session that already completed has a live subscription
    // behind it, and canceling the row orphans that subscription — it goes on
    // billing the donor every month with no row for `invoice.paid` to find and
    // nothing in the app to stop it. So "expire failed" is never treated as
    // "expired".
    for (const stale of recurring.stalePending) {
      if (!stale.checkoutSessionId) {
        // Never reached Stripe at all — nothing to expire, safe to supersede.
        await ctx.runMutation(
          internal.functions.finance.giving.supersedePendingRecurringDonation,
          { recurringDonationId: stale.id },
        );
        continue;
      }

      let sessionStatus: string | null = null;
      try {
        const staleSession = await stripe.checkout.sessions.retrieve(
          stale.checkoutSessionId,
          { stripeAccount: recurring.stripeConnectedAccountId },
        );
        sessionStatus = staleSession.status ?? null;
      } catch (error) {
        console.warn(
          `[finance] createRecurringDonationCheckoutSession: could not read stale session ${stale.checkoutSessionId}`,
          error,
        );
      }

      if (sessionStatus === "complete") {
        // The donor DID finish this Checkout; the subscription exists at
        // Stripe even though `checkout.session.completed` hasn't bound it to
        // the row yet. They already give monthly to this fund.
        throw new ConvexError(ALREADY_RECURRING_MESSAGE);
      }
      if (sessionStatus === null) {
        // Stripe wouldn't tell us. Ask the donor to retry rather than gamble a
        // supersede that might orphan a live subscription.
        throw new ConvexError(RECURRING_CHECKOUT_IN_PROGRESS_MESSAGE);
      }
      if (sessionStatus === "open") {
        try {
          await stripe.checkout.sessions.expire(stale.checkoutSessionId, {
            stripeAccount: recurring.stripeConnectedAccountId,
          });
        } catch (error) {
          console.warn(
            `[finance] createRecurringDonationCheckoutSession: could not expire stale session ${stale.checkoutSessionId}`,
            error,
          );
          // Still open and we failed to close it — it can still complete.
          throw new ConvexError(RECURRING_CHECKOUT_IN_PROGRESS_MESSAGE);
        }
      }
      // Confirmed expired (or just expired by us): it can never complete.
      await ctx.runMutation(
        internal.functions.finance.giving.supersedePendingRecurringDonation,
        { recurringDonationId: stale.id },
      );
    }

    // See the CUSTOMER REUSE RULE in prepareRecurringDonation: one Customer
    // per (donor, connected account), created here the first time only.
    const stripeCustomerId =
      recurring.reusableCustomerId ??
      (
        await stripe.customers.create(
          {
            name: recurring.donorName,
            email: recurring.donorEmail,
            metadata: { donorUserId: recurring.donorUserId },
          },
          { stripeAccount: recurring.stripeConnectedAccountId },
        )
      ).id;

    const recurringDonationId = await ctx.runMutation(
      internal.functions.finance.giving.beginRecurringDonation,
      {
        token: args.token,
        fundId: args.fundId,
        // From the PREPARED context, not `args` — see prepareDonationIntent's
        // return comment. The row is what every future invoice is checked
        // against, so it has to hold the validated pair, not the submitted one.
        amountCents: context.amountCents,
        feeCoverCents: context.feeCoverCents,
        stripeConnectedAccountId: recurring.stripeConnectedAccountId,
        stripeCustomerId,
      },
    );

    const totalCents = context.amountCents + context.feeCoverCents;
    const { successUrl, cancelUrl } = buildGiveReturnUrls({
      groupId: context.groupId,
      totalCents,
      fundName: context.fundName,
      communityName: context.communityName,
      recurring: true,
    });

    let session;
    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer: stripeCustomerId,
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: totalCents,
                recurring: { interval: "month" },
                product_data: { name: `Monthly gift to ${context.fundName}` },
              },
              quantity: 1,
            },
          ],
          success_url: successUrl,
          cancel_url: cancelUrl,
          // NOT payment_intent_data — Stripe rejects it in subscription mode.
          // These land on the Subscription, and every invoice this
          // subscription ever raises carries them, which is how `invoice.paid`
          // attributes a monthly charge back to this fund and donor.
          subscription_data: {
            description: `Monthly gift — ${context.fundName}`,
            metadata: {
              recurringDonationId,
              fundId: args.fundId,
              donorUserId: context.userId,
              communityId: context.communityId,
              amountCents: String(context.amountCents),
              feeCoverCents: String(context.feeCoverCents),
            },
          },
        },
        {
          stripeAccount: recurring.stripeConnectedAccountId,
          // The AMOUNT is in the key, unlike the one-off path's: a donor who
          // backs out, changes $25 to $50, and re-submits reuses the same
          // client nonce, and a key without the amount would hand them back
          // the $25 session — silently ignoring the change they just made.
          ...(args.idempotencyNonce
            ? {
                idempotencyKey: `recurring-checkout:${args.fundId}:${args.idempotencyNonce}:${context.amountCents}:${context.feeCoverCents}`,
              }
            : {}),
        },
      );
    } catch (error) {
      await ctx.runMutation(
        internal.functions.finance.giving.abandonRecurringDonation,
        { recurringDonationId },
      );
      throw error;
    }

    if (!session.url) {
      await ctx.runMutation(
        internal.functions.finance.giving.abandonRecurringDonation,
        { recurringDonationId },
      );
      throw new Error("Stripe did not return a Checkout URL");
    }

    await ctx.runMutation(
      internal.functions.finance.giving.bindRecurringCheckoutSession,
      {
        recurringDonationId,
        checkoutSessionId: session.id,
        stripeCustomerId,
      },
    );

    return { url: session.url, sessionId: session.id, recurringDonationId };
  },
});

// ============================================================================
// Recurring webhook mutations — called by functions/finance/webhooks.ts.
// ============================================================================

/**
 * Binds a completed subscription-mode Checkout to its pending row
 * (`checkout.session.completed`). Status deliberately STAYS "pending": the
 * subscription existing is not the same as it having collected anything, and
 * `invoice.paid` — the event that actually records the money — is what flips
 * it to "active".
 *
 * Cross-checks `eventAccount` against the row's own connected account for the
 * same reason `payment_intent.succeeded` does (ADR-032 §6): nothing about the
 * event itself proves it came from the community this row belongs to.
 */
export const bindRecurringSubscription = internalMutation({
  args: {
    checkoutSessionId: v.string(),
    stripeSubscriptionId: v.string(),
    stripeCustomerId: v.optional(v.string()),
    eventAccount: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("recurringDonations")
      .withIndex("by_checkoutSessionId", (q) =>
        q.eq("checkoutSessionId", args.checkoutSessionId),
      )
      .first();
    if (!row) {
      // Not one of ours (a one-off donation Checkout, or another integration
      // on the same connected account) — nothing to do.
      return;
    }
    if (!args.eventAccount || args.eventAccount !== row.stripeConnectedAccountId) {
      console.error(
        `[finance] checkout.session.completed: account mismatch on recurring donation ${row._id} — event.account=${args.eventAccount ?? "missing"} expected=${row.stripeConnectedAccountId}`,
      );
      await logFinanceAudit(ctx, {
        communityId: row.communityId,
        fundId: row.fundId,
        action: "webhook.rejected_account_mismatch",
        details: {
          eventAccount: args.eventAccount ?? null,
          expectedAccount: row.stripeConnectedAccountId,
          recurringDonationId: row._id,
        },
      });
      return;
    }
    if (row.status === "canceled") {
      // Superseded/abandoned between creating the session and completing it.
      // Do NOT resurrect it — the subscription is real at Stripe, so log
      // loudly; the donor's live row (if any) is a different subscription.
      console.error(
        `[finance] checkout.session.completed: subscription ${args.stripeSubscriptionId} completed for canceled recurring donation ${row._id}`,
      );
      return;
    }

    await ctx.db.patch(row._id, {
      stripeSubscriptionId: args.stripeSubscriptionId,
      ...(args.stripeCustomerId
        ? { stripeCustomerId: args.stripeCustomerId }
        : {}),
      updatedAt: now(),
    });
    await logFinanceAudit(ctx, {
      communityId: row.communityId,
      fundId: row.fundId,
      actorUserId: row.donorUserId,
      action: "recurring.subscription_bound",
      details: {
        recurringDonationId: row._id,
        stripeSubscriptionId: args.stripeSubscriptionId,
      },
    });
  },
});

/**
 * Records a monthly charge (`invoice.paid`) as an ordinary donation and marks
 * the subscription active.
 *
 * The invoice's PaymentIntent id is the idempotency key, exactly as for a
 * one-off gift — `recordDonationCore` bails before any write if a donation
 * already exists for it, so a redelivered `invoice.paid` credits the ledger
 * exactly once.
 *
 * `amountPaidCents` (what Stripe actually collected) is the authority on the
 * TOTAL, with the row supplying the fee-cover split — a stale row can then
 * only ever mis-split a correct total, never credit money that wasn't
 * collected. `splitDonationAmounts` normalizes a cover that no longer fits.
 */
export const recordRecurringDonationPaid = internalMutation({
  args: {
    stripeSubscriptionId: v.string(),
    paymentIntentId: v.string(),
    amountPaidCents: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    eventAccount: v.optional(v.string()),
    /**
     * The row id the subscription's metadata claims, used ONLY when the
     * subscription id isn't bound to a row yet — see
     * `resolveInvoiceRecurringDonationId` in webhooks.ts.
     */
    recurringDonationIdHint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let row = await ctx.db
      .query("recurringDonations")
      .withIndex("by_stripeSubscriptionId", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId),
      )
      .first();

    // Webhook order is not guaranteed: the first month's `invoice.paid` can
    // beat `checkout.session.completed`, so the subscription id may not be on
    // any row yet. Falling back to the id we put in the subscription metadata
    // is what stops that race silently swallowing a real payment. The row is
    // only adopted when it is genuinely unbound — a row already pointing at a
    // DIFFERENT subscription is never re-pointed by an invoice.
    let boundHere = false;
    if (!row && args.recurringDonationIdHint) {
      const hintedId = ctx.db.normalizeId(
        "recurringDonations",
        args.recurringDonationIdHint,
      );
      const hinted = hintedId ? await ctx.db.get(hintedId) : null;
      if (hinted && !hinted.stripeSubscriptionId) {
        row = hinted;
        boundHere = true;
      }
    }

    if (!row) {
      return; // Not a Togather monthly gift.
    }
    if (!args.eventAccount || args.eventAccount !== row.stripeConnectedAccountId) {
      console.error(
        `[finance] invoice.paid: account mismatch on recurring donation ${row._id} — event.account=${args.eventAccount ?? "missing"} expected=${row.stripeConnectedAccountId}`,
      );
      await logFinanceAudit(ctx, {
        communityId: row.communityId,
        fundId: row.fundId,
        action: "webhook.rejected_account_mismatch",
        details: {
          eventAccount: args.eventAccount ?? null,
          expectedAccount: row.stripeConnectedAccountId,
          recurringDonationId: row._id,
        },
      });
      return;
    }

    const rowTotalCents = row.amountCents + row.feeCoverCents;
    const totalCents = args.amountPaidCents ?? rowTotalCents;
    if (totalCents <= 0) {
      // A $0 invoice (a full discount, or a $0 proration) collected nothing,
      // so there is nothing to credit. Returning beats falling through:
      // `recordDonationCore` THROWS on a non-positive amount, which would fail
      // the webhook and put Stripe into a permanent redelivery loop.
      console.warn(
        `[finance] invoice.paid: subscription ${args.stripeSubscriptionId} collected ${totalCents} — nothing to record`,
      );
      return;
    }
    if (totalCents !== rowTotalCents) {
      console.warn(
        `[finance] invoice.paid: subscription ${args.stripeSubscriptionId} collected ${totalCents} but recurring donation ${row._id} expects ${rowTotalCents} — crediting what Stripe collected`,
      );
    }
    const { baseCents, feeCoverCents } = splitDonationAmounts(
      totalCents,
      row.feeCoverCents,
    );

    const donationId = await recordDonationCore(ctx, {
      paymentIntentId: args.paymentIntentId,
      fundId: row.fundId,
      donorUserId: row.donorUserId,
      amountCents: baseCents,
      feeCoverCents,
      communityId: row.communityId,
      recurringId: row._id,
    });

    // A canceled row is terminal: Stripe can still settle an invoice raised
    // before the cancel landed (the money is real, and is recorded above),
    // but it must not come back to life.
    const patch: {
      status?: "active";
      currentPeriodEnd?: number;
      stripeSubscriptionId?: string;
      updatedAt: number;
    } = { updatedAt: now() };
    if (row.status !== "canceled") {
      patch.status = "active";
    }
    if (args.currentPeriodEnd !== undefined) {
      patch.currentPeriodEnd = args.currentPeriodEnd;
    }
    if (boundHere) {
      // We got here before `checkout.session.completed` did. Stamping the
      // subscription now means every LATER event for it resolves by the
      // ordinary index, and the metadata fallback is only ever used once.
      patch.stripeSubscriptionId = args.stripeSubscriptionId;
    }
    await ctx.db.patch(row._id, patch);

    return donationId;
  },
});

/**
 * Syncs a subscription's lifecycle onto its row —
 * `customer.subscription.updated` / `.deleted` and `invoice.payment_failed`
 * all land here.
 *
 * `amountCents`/`feeCoverCents` are only applied when the caller resolved
 * BOTH from the subscription's own metadata AND they add up to the price the
 * subscription now charges. Anything else (metadata missing, stale, or
 * inconsistent with the price) is ignored in favour of leaving the row alone
 * rather than writing a split that doesn't match what the donor is billed.
 */
export const applyRecurringSubscriptionState = internalMutation({
  args: {
    stripeSubscriptionId: v.string(),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("past_due"),
        v.literal("canceled"),
      ),
    ),
    currentPeriodEnd: v.optional(v.number()),
    amountCents: v.optional(v.number()),
    feeCoverCents: v.optional(v.number()),
    eventAccount: v.optional(v.string()),
    /** For the audit row — which Stripe event drove this. */
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("recurringDonations")
      .withIndex("by_stripeSubscriptionId", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId),
      )
      .first();
    if (!row) {
      return;
    }
    if (!args.eventAccount || args.eventAccount !== row.stripeConnectedAccountId) {
      console.error(
        `[finance] ${args.reason}: account mismatch on recurring donation ${row._id} — event.account=${args.eventAccount ?? "missing"} expected=${row.stripeConnectedAccountId}`,
      );
      await logFinanceAudit(ctx, {
        communityId: row.communityId,
        fundId: row.fundId,
        action: "webhook.rejected_account_mismatch",
        details: {
          eventAccount: args.eventAccount ?? null,
          expectedAccount: row.stripeConnectedAccountId,
          recurringDonationId: row._id,
        },
      });
      return;
    }

    const timestamp = now();
    const patch: Partial<Doc<"recurringDonations">> = { updatedAt: timestamp };

    // "canceled" is terminal — a late/reordered update event must never
    // reactivate a gift the donor already stopped.
    if (args.status && row.status !== "canceled" && args.status !== row.status) {
      patch.status = args.status;
      if (args.status === "canceled") {
        patch.canceledAt = timestamp;
      }
    }
    if (args.currentPeriodEnd !== undefined) {
      patch.currentPeriodEnd = args.currentPeriodEnd;
    }
    if (
      args.amountCents !== undefined &&
      args.feeCoverCents !== undefined &&
      (args.amountCents !== row.amountCents ||
        args.feeCoverCents !== row.feeCoverCents)
    ) {
      patch.amountCents = args.amountCents;
      patch.feeCoverCents = args.feeCoverCents;
    }

    await ctx.db.patch(row._id, patch);

    // No status/amount change means a redelivered or incidental event — keep
    // it out of the audit trail (same rule as applyIncreaseEntityStatus).
    if (patch.status === undefined && patch.amountCents === undefined) {
      return;
    }
    await logFinanceAudit(ctx, {
      communityId: row.communityId,
      fundId: row.fundId,
      actorUserId: row.donorUserId,
      action: "recurring.status_synced",
      details: {
        recurringDonationId: row._id,
        from: row.status,
        to: patch.status ?? row.status,
        amountCents: patch.amountCents ?? row.amountCents,
        feeCoverCents: patch.feeCoverCents ?? row.feeCoverCents,
        reason: args.reason,
      },
    });
  },
});

// ============================================================================
// Donor-facing management: list, read, change amount, cancel, update card.
// ============================================================================

/** Shape both donor-facing reads return. */
interface RecurringSummary {
  id: Id<"recurringDonations">;
  fundId: Id<"funds">;
  groupId: Id<"groups"> | null;
  fundName: string;
  amountCents: number;
  feeCoverCents: number;
  status: "pending" | "active" | "past_due" | "canceled";
  currentPeriodEnd: number | null;
  createdAt: number;
}

async function toRecurringSummary(
  ctx: { db: any },
  row: Doc<"recurringDonations">,
): Promise<RecurringSummary> {
  const fund = await ctx.db.get(row.fundId);
  return {
    id: row._id,
    fundId: row.fundId,
    groupId: fund?.groupId ?? null,
    fundName: fund?.name ?? "",
    amountCents: row.amountCents,
    feeCoverCents: row.feeCoverCents,
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd ?? null,
    createdAt: row.createdAt,
  };
}

/**
 * The signed-in donor's own monthly gifts, newest first.
 *
 * Scoped to the caller by construction — the `by_donor` index is keyed on the
 * authenticated user id and no argument can widen it, so there is no fund or
 * community a donor could ask about to see someone else's giving.
 *
 * Canceled gifts are excluded: this is the list you MANAGE, and a stopped
 * gift has nothing left to manage. The charges it made remain visible as
 * ordinary donations in giving history.
 */
export const listMyRecurringDonations = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<RecurringSummary[]> => {
    const userId = await requireAuth(ctx, args.token);
    if (!(await isGroupGivingEnabled(ctx))) {
      return [];
    }
    const rows = await ctx.db
      .query("recurringDonations")
      .withIndex("by_donor", (q) => q.eq("donorUserId", userId))
      .order("desc")
      .collect();
    return await Promise.all(
      rows
        .filter((r) => r.status !== "canceled")
        .map((r) => toRecurringSummary(ctx, r)),
    );
  },
});

/**
 * The caller's own monthly gift to one fund (the give screen's monthly toggle
 * and the fund dashboard's "you give $X/month" box), or null.
 *
 * Same donor scoping as `listMyRecurringDonations`: `fundId` narrows, it
 * never widens — the donor half of the index is always the caller.
 */
export const getRecurringForFund = query({
  args: { token: v.string(), fundId: v.id("funds") },
  handler: async (ctx, args): Promise<RecurringSummary | null> => {
    const userId = await requireAuth(ctx, args.token);
    if (!(await isGroupGivingEnabled(ctx))) {
      return null;
    }
    const row = await findLiveRecurring(ctx, args.fundId, userId);
    return row ? await toRecurringSummary(ctx, row) : null;
  },
});

/** Loads a recurring row the caller OWNS, for the management actions. */
export const getMyRecurringDonation = internalQuery({
  args: { token: v.string(), recurringDonationId: v.id("recurringDonations") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGroupGivingEnabled(ctx);
    const row = await ctx.db.get(args.recurringDonationId);
    if (!row || row.donorUserId !== userId) {
      // Same answer for "doesn't exist" and "isn't yours" — a donor must not
      // be able to probe for other people's giving by id.
      throw new Error("Monthly gift not found");
    }
    const fund = await ctx.db.get(row.fundId);
    return { row, groupId: fund?.groupId ?? null, fundName: fund?.name ?? "" };
  },
});

/** Applies a donor-initiated amount change once Stripe has accepted it. */
export const applyRecurringAmountUpdate = internalMutation({
  args: {
    recurringDonationId: v.id("recurringDonations"),
    amountCents: v.number(),
    feeCoverCents: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.recurringDonationId);
    if (!row) return;
    await ctx.db.patch(row._id, {
      amountCents: args.amountCents,
      feeCoverCents: args.feeCoverCents,
      updatedAt: now(),
    });
    await logFinanceAudit(ctx, {
      communityId: row.communityId,
      fundId: row.fundId,
      actorUserId: row.donorUserId,
      action: "recurring.amount_updated",
      details: {
        recurringDonationId: row._id,
        fromAmountCents: row.amountCents,
        fromFeeCoverCents: row.feeCoverCents,
        toAmountCents: args.amountCents,
        toFeeCoverCents: args.feeCoverCents,
      },
    });
  },
});

/**
 * Changes what a monthly gift charges from the NEXT invoice onward.
 *
 * Validation runs through `prepareDonationIntent` — the same seam the create
 * paths use — so the amount bounds, the one-sided fee-cover bound (a CEILING
 * at `computeCoverFeesCents` + tolerance, with no floor, since only an
 * over-large fee can move money past `MAX_DONATION_CENTS`), the fund-active
 * check and the community-live check are literally the same code, not a
 * re-implementation. There is no fee math in this action at all.
 *
 * `proration_behavior: "none"`: the donor already paid for the current period
 * at its start, and this is a gift, not a service they are getting more or
 * less of. Prorating would either bill them again mid-month or hand back part
 * of a gift they meant to give — both wrong. The new amount simply applies at
 * the next renewal.
 */
export const updateRecurringAmount = action({
  args: {
    token: v.string(),
    recurringDonationId: v.id("recurringDonations"),
    amountCents: v.number(),
    coverFeesCents: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ amountCents: number; feeCoverCents: number }> => {
    const { row } = await ctx.runQuery(
      internal.functions.finance.giving.getMyRecurringDonation,
      { token: args.token, recurringDonationId: args.recurringDonationId },
    );
    if (row.status === "canceled") {
      throw new ConvexError(
        "This monthly gift has been stopped. Start a new one to give monthly again.",
      );
    }
    if (!row.stripeSubscriptionId) {
      throw new ConvexError(
        "This monthly gift is still being set up. Try again in a moment.",
      );
    }

    // The shared seam: auth, flag, amount bounds, fee bound, fund active,
    // community live — all of it, for the fund this gift actually belongs to.
    const context = await ctx.runQuery(
      internal.functions.finance.giving.prepareDonationIntent,
      {
        token: args.token,
        fundId: row.fundId,
        amountCents: args.amountCents,
        coverFeesCents: args.coverFeesCents,
      },
    );

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-02-25.clover",
    });

    const subscription = await stripe.subscriptions.retrieve(
      row.stripeSubscriptionId,
      {},
      { stripeAccount: row.stripeConnectedAccountId },
    );
    const item = subscription.items.data[0];
    if (!item) {
      throw new Error(
        `updateRecurringAmount: subscription ${row.stripeSubscriptionId} has no items`,
      );
    }
    // A SubscriptionItem's inline `price_data` takes a product ID (unlike
    // Checkout's, which accepts `product_data`), so reuse the product the
    // Checkout session already created for this gift.
    const productId =
      typeof item.price.product === "string"
        ? item.price.product
        : item.price.product.id;

    const totalCents = context.amountCents + context.feeCoverCents;
    await stripe.subscriptions.update(
      row.stripeSubscriptionId,
      {
        items: [
          {
            id: item.id,
            price_data: {
              currency: "usd",
              product: productId,
              unit_amount: totalCents,
              recurring: { interval: "month" },
            },
          },
        ],
        proration_behavior: "none",
        // Kept in lockstep with the row: `customer.subscription.updated` reads
        // the split back out of here when the price changes, and an invoice
        // that arrives before our own patch commits must still describe the
        // gift correctly.
        metadata: {
          recurringDonationId: row._id,
          fundId: row.fundId,
          donorUserId: row.donorUserId,
          communityId: row.communityId,
          amountCents: String(context.amountCents),
          feeCoverCents: String(context.feeCoverCents),
        },
      },
      { stripeAccount: row.stripeConnectedAccountId },
    );

    await ctx.runMutation(
      internal.functions.finance.giving.applyRecurringAmountUpdate,
      {
        recurringDonationId: row._id,
        amountCents: context.amountCents,
        feeCoverCents: context.feeCoverCents,
      },
    );

    return {
      amountCents: context.amountCents,
      feeCoverCents: context.feeCoverCents,
    };
  },
});

/** Marks a monthly gift stopped. Separate from
 * `applyRecurringSubscriptionState` because this one is donor-initiated and
 * should say so in the audit trail. */
export const markRecurringCanceled = internalMutation({
  args: { recurringDonationId: v.id("recurringDonations") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.recurringDonationId);
    if (!row || row.status === "canceled") return;
    const timestamp = now();
    await ctx.db.patch(row._id, {
      status: "canceled",
      canceledAt: timestamp,
      updatedAt: timestamp,
    });
    await logFinanceAudit(ctx, {
      communityId: row.communityId,
      fundId: row.fundId,
      actorUserId: row.donorUserId,
      action: "recurring.canceled",
      details: { recurringDonationId: row._id, from: row.status },
    });
  },
});

/**
 * Stops a monthly gift.
 *
 * Cancels IMMEDIATELY (`subscriptions.cancel`, not `cancel_at_period_end`).
 * Stripe subscriptions charge in ADVANCE: the donor paid for the current
 * period at its START, so there is nothing left in it for them to "use up" —
 * `cancel_at_period_end` would only mean the gift keeps showing as active for
 * up to a month while collecting nothing. Cancelling now ends future invoices
 * and claws nothing back, which is exactly the approved promise: "Ends future
 * gifts. Past gifts stay."
 *
 * A gift still in Checkout (`pending`, no subscription yet) has its Checkout
 * Session expired instead, so it can't complete after the donor backed out.
 */
/**
 * Has this subscription genuinely stopped billing at Stripe?
 *
 * Asked only after a `subscriptions.cancel` threw, to tell "already canceled,
 * nothing to do" apart from "still live, the cancel really failed". Defaults
 * to FALSE whenever Stripe can't answer: claiming a gift is stopped when we
 * don't know is the one wrong answer here — it hides a card that keeps getting
 * charged. A 404 (`resource_missing`) is the exception, and only because a
 * subscription that doesn't exist cannot bill anyone.
 */
async function isSubscriptionGoneAtStripe(
  stripe: {
    subscriptions: {
      retrieve: (
        id: string,
        params?: Record<string, never>,
        options?: { stripeAccount: string },
      ) => Promise<{ status?: string }>;
    };
  },
  subscriptionId: string,
  stripeAccount: string,
): Promise<boolean> {
  try {
    const subscription = await stripe.subscriptions.retrieve(
      subscriptionId,
      {},
      { stripeAccount },
    );
    return (
      subscription.status === "canceled" ||
      subscription.status === "incomplete_expired"
    );
  } catch (error) {
    return (error as { code?: string })?.code === "resource_missing";
  }
}

export const cancelRecurringDonation = action({
  args: {
    token: v.string(),
    recurringDonationId: v.id("recurringDonations"),
  },
  handler: async (ctx, args): Promise<{ canceled: true }> => {
    const { row } = await ctx.runQuery(
      internal.functions.finance.giving.getMyRecurringDonation,
      { token: args.token, recurringDonationId: args.recurringDonationId },
    );
    if (row.status === "canceled") {
      return { canceled: true }; // Idempotent — a double tap is not an error.
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-02-25.clover",
    });

    if (row.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(row.stripeSubscriptionId, undefined, {
          stripeAccount: row.stripeConnectedAccountId,
        });
      } catch (error) {
        // A cancel that failed is only safe to ignore once Stripe CONFIRMS
        // the subscription is already gone (`customer.subscription.deleted`
        // landed first, or the donor cancelled twice) — then the end state the
        // donor asked for is already true. A transient network, rate-limit or
        // 5xx failure is a different thing entirely: the subscription is still
        // live and still charging, and marking the row canceled would both lie
        // to the donor and make the row terminal, so no later Stripe event can
        // ever put it back. Re-throw those and let them tap Stop again.
        console.warn(
          `[finance] cancelRecurringDonation: Stripe cancel failed for ${row.stripeSubscriptionId}`,
          error,
        );
        if (
          !(await isSubscriptionGoneAtStripe(
            stripe,
            row.stripeSubscriptionId,
            row.stripeConnectedAccountId,
          ))
        ) {
          throw error;
        }
      }
    } else if (row.checkoutSessionId) {
      try {
        await stripe.checkout.sessions.expire(row.checkoutSessionId, {
          stripeAccount: row.stripeConnectedAccountId,
        });
      } catch (error) {
        console.warn(
          `[finance] cancelRecurringDonation: could not expire session ${row.checkoutSessionId}`,
          error,
        );
      }
    }

    await ctx.runMutation(
      internal.functions.finance.giving.markRecurringCanceled,
      { recurringDonationId: row._id },
    );
    return { canceled: true };
  },
});

/**
 * A hosted page where the donor can replace the card behind their monthly
 * gift.
 *
 * SHIPPED: Stripe's Billing Portal, on the connected account, scoped to this
 * donor's Customer. The portal is what actually re-attaches a new payment
 * method to the live subscription — a Checkout `mode: "setup"` session would
 * only vault a PaymentMethod and leave us to attach it ourselves from another
 * webhook branch, which is more moving parts for a worse result.
 *
 * A connected account has no portal configuration by default and community
 * admins will never create one, so one is created on first use, with exactly
 * two features enabled: updating the payment method and viewing invoices.
 * `subscription_cancel`/`subscription_update` stay OFF deliberately — cancels
 * and amount changes go through this file so the `recurringDonations` row and
 * the audit trail stay the source of truth rather than drifting behind a
 * Stripe-hosted UI.
 */
export const createCardUpdateSession = action({
  args: {
    token: v.string(),
    recurringDonationId: v.id("recurringDonations"),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const { row, groupId } = await ctx.runQuery(
      internal.functions.finance.giving.getMyRecurringDonation,
      { token: args.token, recurringDonationId: args.recurringDonationId },
    );
    if (!row.stripeCustomerId) {
      throw new ConvexError(
        "This monthly gift is still being set up. Try again in a moment.",
      );
    }
    if (!groupId) {
      throw new Error("Card updates aren't available for this fund yet");
    }
    const returnUrl = buildRecurringManageUrl(groupId);

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-02-25.clover",
    });

    const existing = await stripe.billingPortal.configurations.list(
      { limit: 1, active: true },
      { stripeAccount: row.stripeConnectedAccountId },
    );
    const configurationId =
      existing.data[0]?.id ??
      (
        await stripe.billingPortal.configurations.create(
          {
            business_profile: { headline: "Manage your monthly gift" },
            features: {
              payment_method_update: { enabled: true },
              invoice_history: { enabled: true },
            },
            default_return_url: returnUrl,
          },
          { stripeAccount: row.stripeConnectedAccountId },
        )
      ).id;

    const session = await stripe.billingPortal.sessions.create(
      {
        customer: row.stripeCustomerId,
        return_url: returnUrl,
        configuration: configurationId,
      },
      { stripeAccount: row.stripeConnectedAccountId },
    );

    return { url: session.url };
  },
});
