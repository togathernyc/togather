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
 *      alternative kept for ADR-032's still-open question.
 *   2. The Stripe webhook layer (functions/finance/webhooks.ts) calls
 *      `recordDonationSucceeded` on `payment_intent.succeeded` — Checkout's
 *      `payment_intent_data.metadata` lands on that PaymentIntent exactly
 *      like `createDonationIntent`'s own metadata does, so this webhook path
 *      is unchanged by which donation-creation action ran — which writes the
 *      `donations` row, posts the ledger credit, and schedules the receipt
 *      email.
 *   3. `getFundOverview` powers the member-facing transparency screen.
 *
 * Every query here first authorizes the caller, then (for `getFundOverview`)
 * separately decides how MUCH detail they see — active members get
 * aggregates and anonymized activity, manager+ finance roles (or a
 * community admin) also see donor names. See `viewerCanSeeDonorNames`.
 *
 * Nothing in this file talks to Increase — that's the allocation/reconcile
 * layer in `functions/finance/jobs.ts`.
 */

import { v } from "convex/values";
import {
  query,
  action,
  internalQuery,
  internalMutation,
  internalAction,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { isActiveMember, hasFundRole } from "../../lib/helpers";
import { isCommunityAdmin } from "../../lib/permissions";
import { postLedgerEntry } from "../../lib/finance/ledger";
import { logFinanceAudit } from "../../lib/finance/audit";
import { buildDonationReceiptEmail } from "../../lib/finance/receipts";
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
 * Throws unless `userId` may view `fund` — an active member of the fund's
 * group (or, for the community-wide general fund, any active community
 * member), or a community admin. Mirrors the "Give; see transparency
 * summary" row of the ADR-032 §4 permission table, which every role from
 * plain member up satisfies.
 */
async function assertCanViewFund(
  ctx: { db: any },
  fund: Doc<"funds">,
  userId: Id<"users">,
): Promise<void> {
  if (await isCommunityAdmin(ctx, fund.communityId, userId)) {
    return;
  }
  if (fund.groupId) {
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q: any) =>
        q.eq("groupId", fund.groupId).eq("userId", userId),
      )
      .first();
    if (isActiveMember(membership)) {
      return;
    }
  } else if (await isActiveCommunityMember(ctx, fund.communityId, userId)) {
    return;
  }
  throw new Error("You don't have access to this fund");
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
  donationCount: number;
}

/** Sums a set of ledger entries into the aggregates the transparency screen shows. */
function summarizePeriod(
  entries: Array<Pick<Doc<"ledgerEntries">, "direction" | "amountCents" | "kind">>,
): ActivityPeriodTotals {
  let donationsCents = 0;
  let spentCents = 0;
  let donationCount = 0;
  for (const entry of entries) {
    if (entry.direction === "credit" && entry.kind === "donation") {
      donationsCents += entry.amountCents;
      donationCount += 1;
    } else if (entry.direction === "debit") {
      spentCents += entry.amountCents;
    }
  }
  return { donationsCents, spentCents, donationCount };
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

    await assertCanViewFund(ctx, fund, userId);

    const communityFinance = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", fund.communityId))
      .first();
    const community = await ctx.db.get(fund.communityId);

    const givingLive =
      fund.status === "active" && communityFinance?.onboardingStatus === "live";

    return {
      fundId: fund._id,
      fundName: fund.name,
      communityLegalName: communityFinance?.legalName ?? community?.name ?? "",
      suggestedAmountsCents: SUGGESTED_AMOUNTS_CENTS,
      givingLive,
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
 * Validates the donor-chosen amount is within Stripe/our own bounds and
 * normalizes `coverFeesCents` to a non-negative integer. Pure (no `ctx`) so
 * it's trivial to unit test directly, but only called from
 * `prepareDonationIntent` — the ONE place that gates every donation-creating
 * action, per the ADR-032 rule that money-initiating actions share one
 * validation path rather than duplicating checks per Stripe surface.
 */
function validateDonationAmount(
  amountCents: number,
  coverFeesCents: number | undefined,
): { feeCoverCents: number } {
  if (
    !Number.isInteger(amountCents) ||
    amountCents < MIN_DONATION_CENTS ||
    amountCents > MAX_DONATION_CENTS
  ) {
    throw new Error(
      `Donation amount must be between $${MIN_DONATION_CENTS / 100} and $${MAX_DONATION_CENTS / 100}`,
    );
  }
  const feeCoverCents = coverFeesCents ?? 0;
  if (!Number.isInteger(feeCoverCents) || feeCoverCents < 0) {
    throw new Error("Invalid fee-cover amount");
  }
  return { feeCoverCents };
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

    const { feeCoverCents } = validateDonationAmount(args.amountCents, args.coverFeesCents);

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

    return {
      userId,
      communityId: fund.communityId,
      groupId: fund.groupId,
      fundName: fund.name,
      stripeConnectedAccountId: communityFinance.stripeConnectedAccountId,
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
        amount: args.amountCents + context.feeCoverCents,
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
 * The https universal link the Checkout session redirects back to on
 * completion/cancellation — NOT the custom "togather://" scheme, mirroring
 * FinanceOnboardingStatusScreen's FINANCE_SETUP_DEEP_LINK: Stripe Checkout
 * requires https success/cancel URLs, and the app registers applinks for
 * togather.nyc (app.config.js associatedDomains) so this re-opens the app
 * when installed. Convex reactivity — not the redirect itself — is what
 * actually refreshes the fund screen once the donation lands.
 */
const GIVING_CHECKOUT_BASE_URL = "https://togather.nyc";

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
  handler: async (ctx, args): Promise<{ url: string; sessionId: string }> => {
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
      // The success/cancel universal links land on a group's fund screen
      // (`/groups/[group_id]/fund`) — a community-wide general fund has no
      // such screen yet, so hosted Checkout isn't wired for it.
      throw new Error("Checkout isn't available for this fund yet");
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-02-25.clover",
    });

    const totalCents = args.amountCents + context.feeCoverCents;
    const fundUrl = `${GIVING_CHECKOUT_BASE_URL}/groups/${context.groupId}/fund`;

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
        success_url: `${fundUrl}?giving=success`,
        cancel_url: `${fundUrl}?giving=cancelled`,
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

    return { url: session.url, sessionId: session.id };
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
      },
    });

    await ctx.scheduler.runAfter(
      0,
      internal.functions.finance.giving.sendDonationReceipt,
      { donationId },
    );

    return donationId;
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

    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      action: "donation.refunded",
      details: {
        paymentIntentId: args.paymentIntentId,
        chargeId: args.chargeId,
        deltaCents,
        cumulativeCents: args.amountRefundedCents,
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
