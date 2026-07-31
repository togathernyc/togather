/**
 * Group-fund virtual cards (ADR-032 §3 Phase 3).
 *
 * A card is an Increase virtual card bound to a fund's Increase Account and
 * assigned to one holder (a member who holds `cardholder`+ on the fund). The
 * bank enforces spend segregation at the account level (a card can never
 * overdraw its fund or touch another fund's balance), so this module is
 * attribution + lifecycle control, not an authorization decisioner:
 *
 * - `listFundCards` / `getCardDetail` — read the fund's card roster and a
 *   single card's recent activity (its `card_charge` expenses).
 * - `createFundCard` — finance_admin issues a card to a cardholder+ member.
 *   Inserts a "pending" row synchronously, then schedules `provisionCard`
 *   (an internalAction — Increase is called outside the mutation, same
 *   pattern as onboarding.ts's `provisionProviders`) to actually create the
 *   card at Increase and record the result.
 * - `setCardLimit` — finance_admin changes (or removes) a live card's limit.
 * - `setCardFrozen` / `cancelCard` — lifecycle control. Both patch the local
 *   row via a scheduled internalAction + internalMutation pair (same
 *   provider-write-then-record shape as `createFundCard`), so a card's
 *   `status` only ever reflects what Increase actually confirmed, never an
 *   optimistic guess.
 *
 * `spendLimitCents` / `limitPeriod` are ENFORCED BY THE BANK, not advisory:
 * they're translated (lib/finance/cardPolicy.ts) into Increase's
 * `authorization_controls.usage.multi_use.spending_limits` and applied at
 * card creation and on every limit change, so Increase declines an
 * authorization that would breach them without ever calling us. Our stored
 * copy is a mirror for display; the bank's copy is the control. Everything
 * beyond an amount-per-interval cap (merchant-category rules, per-swipe
 * custom logic) would still need Increase's real-time authorization webhook
 * and remains out of scope — see ARCHITECTURE.md's Known Seams.
 *
 * Card-settlement transaction sync (turning a card swipe into a `card_charge`
 * expense) lives in functions/finance/webhooks.ts's `transaction.created`
 * handler — this file only manages the card object itself.
 */

import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  internalAction,
} from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { requireAuth } from "../../lib/auth";
import { now, getDisplayName, getMediaUrl } from "../../lib/utils";
import { requireGroupGivingEnabled } from "../../lib/finance/flag";
import { logFinanceAudit } from "../../lib/finance/audit";
import {
  LIMIT_PERIOD_TO_INCREASE_INTERVAL,
  validateCardLimit,
  type CardLimitPeriod,
} from "../../lib/finance/cardPolicy";
import {
  requireFundRole,
  requireFundRoleOrGroupLeader,
  hasFundRole,
} from "../../lib/helpers";

const limitPeriodValidator = v.union(
  v.literal("week"),
  v.literal("month"),
  v.literal("charge"),
);

/**
 * Our stored limit pair -> the provider shape `lib/finance/increase.ts`
 * sends. `null` means "no limit", which Increase must be told explicitly
 * (see `buildAuthorizationControls`), so this never returns `undefined`.
 */
function toIncreaseSpendingLimit(
  spendLimitCents: number | undefined,
  limitPeriod: CardLimitPeriod | undefined,
) {
  if (spendLimitCents === undefined || limitPeriod === undefined) return null;
  return {
    interval: LIMIT_PERIOD_TO_INCREASE_INTERVAL[limitPeriod],
    settlementAmountCents: spendLimitCents,
  };
}

/** Find a user's currently-active (non-revoked) fundRoles row, if any. */
async function getActiveRoleRow(
  ctx: { db: any },
  fundId: Id<"funds">,
  userId: Id<"users">,
): Promise<Doc<"fundRoles"> | null> {
  const rows = await ctx.db
    .query("fundRoles")
    .withIndex("by_user_fund", (q: any) =>
      q.eq("userId", userId).eq("fundId", fundId),
    )
    .collect();
  return rows.find((r: Doc<"fundRoles">) => r.revokedAt === undefined) ?? null;
}

/** True if `userId` currently passes a `requireFundRole(..., "finance_admin")` check (community-admin override included) without throwing. */
async function isFundFinanceAdmin(
  ctx: { db: any },
  fundId: Id<"funds">,
  userId: Id<"users">,
): Promise<boolean> {
  try {
    await requireFundRole(ctx, fundId, userId, "finance_admin");
    return true;
  } catch {
    return false;
  }
}

function toCardSummary(card: Doc<"cards">, holderName: string) {
  return {
    id: card._id,
    name: card.name ?? null,
    holderUserId: card.holderUserId,
    holderName,
    last4: card.last4 ?? null,
    status: card.status,
    spendLimitCents: card.spendLimitCents ?? null,
    limitPeriod: card.limitPeriod ?? null,
    createdAt: card.createdAt,
  };
}

// ============================================================================
// listFundCards
// ============================================================================

/**
 * Every card on a fund, with holder display info. Any active fund role
 * (cardholder+) or an active group leader/community admin can view — same
 * viewer gate as the fund's other management surfaces.
 */
export const listFundCards = query({
  args: { token: v.string(), fundId: v.id("funds") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGroupGivingEnabled(ctx);
    await requireFundRoleOrGroupLeader(ctx, args.fundId, userId, "cardholder");

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_fund", (q) => q.eq("fundId", args.fundId))
      .collect();

    const holders = await Promise.all(cards.map((c) => ctx.db.get(c.holderUserId)));

    return {
      cards: cards.map((card, i) =>
        toCardSummary(card, getDisplayName(holders[i]?.firstName, holders[i]?.lastName)),
      ),
      // The UI must gate "New card" on the SAME check createFundCard enforces
      // (finance_admin, incl. the community-admin override) — a group leader
      // without a finance role can view this list but not issue cards, and
      // must not be shown an affordance that can only error on submit.
      viewerCanManageCards: await isFundFinanceAdmin(ctx, args.fundId, userId),
    };
  },
});

// ============================================================================
// createFundCard
// ============================================================================

export const createFundCard = mutation({
  args: {
    token: v.string(),
    fundId: v.id("funds"),
    holderUserId: v.id("users"),
    name: v.string(),
    spendLimitCents: v.optional(v.number()),
    limitPeriod: v.optional(limitPeriodValidator),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGroupGivingEnabled(ctx);
    // finance_admin (or a community admin, per requireFundRole's built-in
    // override) issues cards — mirrors expenses.ts's approver gate.
    await requireFundRole(ctx, args.fundId, userId, "finance_admin");

    // The limit is a bank-enforced control, so it must be a number Increase
    // will accept BEFORE the row exists — a card row carrying a bogus limit
    // would provision with no cap at all when the provider call rejects it.
    validateCardLimit(args.spendLimitCents, args.limitPeriod);

    const fund = await ctx.db.get(args.fundId);
    if (!fund) {
      throw new Error("Fund not found");
    }
    if (fund.status !== "active") {
      throw new Error("This fund isn't active — cards can't be issued");
    }
    if (!fund.increaseAccountId) {
      throw new Error("This fund's bank account isn't ready yet");
    }

    // The holder must ACTUALLY hold cardholder+ on the fund's own fundRoles
    // grant — deliberately not `requireFundRole`'s community-admin override,
    // since the holder is the card's target, not the caller: an admin with
    // no explicit grant shouldn't silently qualify as a valid holder.
    const holderRole = await getActiveRoleRow(ctx, args.fundId, args.holderUserId);
    if (!hasFundRole(holderRole, "cardholder")) {
      throw new Error(
        "The card holder must have at least cardholder access on this fund",
      );
    }

    const community = await ctx.db.get(fund.communityId);
    if (!community) {
      throw new Error("Community not found");
    }
    const communityFinance = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", fund.communityId))
      .first();
    if (communityFinance?.onboardingStatus !== "live") {
      throw new Error(
        "This community's finance onboarding isn't live yet — cards can't be issued",
      );
    }

    const timestamp = now();
    const cardId = await ctx.db.insert("cards", {
      fundId: args.fundId,
      holderUserId: args.holderUserId,
      name: args.name,
      status: "pending",
      spendLimitCents: args.spendLimitCents,
      limitPeriod: args.limitPeriod,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      actorUserId: userId,
      action: "card.created",
      details: {
        cardId,
        holderUserId: args.holderUserId,
        name: args.name,
        spendLimitCents: args.spendLimitCents,
        limitPeriod: args.limitPeriod,
      },
    });

    await ctx.scheduler.runAfter(0, internal.functions.finance.cards.provisionCard, {
      cardId,
    });

    return cardId;
  },
});

// ============================================================================
// provisionCard — creates the Increase card, then records the result.
// ============================================================================

export const getCardForProvisioning = internalQuery({
  args: { cardId: v.id("cards") },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) return null;
    const fund = await ctx.db.get(card.fundId);
    if (!fund) return null;
    // The onboarding status is re-read here (not just at createFundCard) so
    // provisionCard can re-check it against the state at provider-call time
    // — see the refusal block in provisionCard for why.
    const finance = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", fund.communityId))
      .first();
    return { card, fund, onboardingStatus: finance?.onboardingStatus ?? null };
  },
});

/**
 * Provisioning was refused because the fund/community stopped qualifying
 * between `createFundCard` and the provider call. Distinct from
 * `recordCardProvisionFailed` (Increase itself errored) because the two need
 * different responses: a refusal means someone froze the fund and the card
 * should stay unissued, not be retried.
 */
export const recordCardProvisionRefused = internalMutation({
  args: { cardId: v.id("cards"), reason: v.string() },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) return;
    const fund = await ctx.db.get(card.fundId);
    await ctx.db.patch(args.cardId, { status: "failed", updatedAt: now() });
    if (fund) {
      await logFinanceAudit(ctx, {
        communityId: fund.communityId,
        fundId: fund._id,
        action: "card.provision_refused",
        details: { cardId: args.cardId, reason: args.reason },
      });
    }
  },
});

export const recordCardProvisioned = internalMutation({
  args: {
    cardId: v.id("cards"),
    increaseCardId: v.string(),
    last4: v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) return; // deleted mid-provisioning — nothing to record
    await ctx.db.patch(args.cardId, {
      increaseCardId: args.increaseCardId,
      last4: args.last4,
      status: args.status,
      updatedAt: now(),
    });
  },
});

export const recordCardProvisionFailed = internalMutation({
  args: { cardId: v.id("cards"), message: v.string() },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) return;
    const fund = await ctx.db.get(card.fundId);
    await ctx.db.patch(args.cardId, { status: "failed", updatedAt: now() });
    if (fund) {
      await logFinanceAudit(ctx, {
        communityId: fund.communityId,
        fundId: fund._id,
        action: "card.provision_failed",
        details: { cardId: args.cardId, message: args.message },
      });
    }
  },
});

export const provisionCard = internalAction({
  args: { cardId: v.id("cards") },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(
      internal.functions.finance.cards.getCardForProvisioning,
      { cardId: args.cardId },
    );
    if (!loaded) {
      // Shouldn't happen — createFundCard always writes the row before
      // scheduling this — but a stray/duplicate scheduled run should log,
      // not throw (mirrors onboarding.ts's provisionProviders).
      console.error(
        `[finance] provisionCard: no card/fund found for card ${args.cardId}`,
      );
      return;
    }
    const { card, fund, onboardingStatus } = loaded;

    // Re-check every gate createFundCard checked, immediately before the
    // provider call. createFundCard's checks ran in a DIFFERENT transaction,
    // however long ago; a fund frozen (e.g. its group was archived) or a
    // community knocked out of "live" in the gap would otherwise still get a
    // live card at the bank — an app-side freeze that quietly issues spending
    // power is worse than no freeze at all. Refuse loudly and audit; do not
    // retry, because the state that changed is a deliberate one.
    const accountId = fund.increaseAccountId;
    const refusal = !accountId
      ? "fund has no Increase Account"
      : fund.status !== "active"
        ? `fund status is "${fund.status}"`
        : onboardingStatus !== "live"
          ? `community onboarding status is "${onboardingStatus ?? "missing"}"`
          : null;
    // `!accountId` is re-tested only so TypeScript can narrow it below —
    // the `refusal` chain above already covers that case.
    if (refusal !== null || !accountId) {
      console.error(
        `[finance] provisionCard: refusing to provision card ${args.cardId} — ${refusal}`,
      );
      await ctx.runMutation(
        internal.functions.finance.cards.recordCardProvisionRefused,
        { cardId: args.cardId, reason: refusal ?? "unknown" },
      );
      return;
    }

    try {
      const { createCard } = await import("../../lib/finance/increase");
      const increaseCard = await createCard(
        accountId,
        `${fund.name} — ${card.name ?? "Card"}`,
        `finance:card:${args.cardId}`,
        // The spend limit the finance_admin picked, translated into
        // Increase's own interval vocabulary. Sent AT CREATION so there is
        // never a window where the card is live and uncapped.
        toIncreaseSpendingLimit(card.spendLimitCents, card.limitPeriod),
      );
      await ctx.runMutation(internal.functions.finance.cards.recordCardProvisioned, {
        cardId: args.cardId,
        increaseCardId: increaseCard.id,
        last4: increaseCard.last4,
        status: increaseCard.status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[finance] provisionCard failed for card ${args.cardId}: ${message}`,
      );
      await ctx.runMutation(internal.functions.finance.cards.recordCardProvisionFailed, {
        cardId: args.cardId,
        message: message.slice(0, 500),
      });
    }
  },
});

// ============================================================================
// setCardFrozen — freeze/unfreeze. Self-freeze is allowed (a holder who
// suspects their own card is compromised shouldn't have to wait on a
// finance_admin); self-UNfreeze is NOT — a frozen card must not be
// unfreezable by a possibly-compromised holder acting alone, so unfreezing
// always requires finance_admin (or community admin, via requireFundRole's
// override).
//
// NOT gated on `requireGroupGivingEnabled`, unlike every other mutation
// here. A card is a BANK object: flipping the `group-giving` flag off stops
// the app, not the card — the plastic keeps authorizing. Gating freeze on
// the flag would mean the one switch meant to contain an incident is also
// the switch that disables the only tool for containing it. De-escalation is
// never flag-gated (see lib/finance/flag.ts). Role checks are unchanged.
// ============================================================================

export const setCardFrozen = mutation({
  args: { token: v.string(), cardId: v.id("cards"), frozen: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const card = await ctx.db.get(args.cardId);
    if (!card) {
      throw new Error("Card not found");
    }
    const fund = await ctx.db.get(card.fundId);
    if (!fund) {
      throw new Error("Fund not found");
    }

    const isFinanceAdmin = await isFundFinanceAdmin(ctx, fund._id, userId);
    const isHolder = card.holderUserId === userId;

    if (args.frozen) {
      if (!isFinanceAdmin && !isHolder) {
        throw new Error(
          "Only a finance_admin or this card's holder can freeze it",
        );
      }
    } else if (!isFinanceAdmin) {
      throw new Error(
        "Only a finance_admin can unfreeze a card — a holder can't self-unfreeze",
      );
    }

    if (!card.increaseCardId) {
      throw new Error("This card hasn't finished provisioning yet");
    }

    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      actorUserId: userId,
      action: args.frozen ? "card.frozen" : "card.unfrozen",
      details: { cardId: args.cardId },
    });

    await ctx.scheduler.runAfter(
      0,
      internal.functions.finance.cards.applyCardStatus,
      { cardId: args.cardId, status: args.frozen ? "disabled" : "active" },
    );

    return { status: args.frozen ? "disabled" : "active" };
  },
});

// ============================================================================
// cancelCard — irreversible; finance_admin only. Also exempt from
// `requireGroupGivingEnabled`, for the same reason setCardFrozen is: killing
// a card is the strongest de-escalation there is, and it must stay reachable
// with the feature flag off.
// ============================================================================

export const cancelCard = mutation({
  args: { token: v.string(), cardId: v.id("cards") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const card = await ctx.db.get(args.cardId);
    if (!card) {
      throw new Error("Card not found");
    }
    const fund = await ctx.db.get(card.fundId);
    if (!fund) {
      throw new Error("Fund not found");
    }
    await requireFundRole(ctx, fund._id, userId, "finance_admin");

    if (!card.increaseCardId) {
      throw new Error("This card hasn't finished provisioning yet");
    }

    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      actorUserId: userId,
      action: "card.canceled",
      details: { cardId: args.cardId },
    });

    await ctx.scheduler.runAfter(
      0,
      internal.functions.finance.cards.applyCardStatus,
      { cardId: args.cardId, status: "canceled" },
    );

    return { status: "canceled" as const };
  },
});

// ============================================================================
// applyCardStatus — shared internalAction/internalMutation pair backing
// setCardFrozen and cancelCard: calls Increase, then persists whatever
// Increase actually confirmed.
// ============================================================================

export const getCardInternal = internalQuery({
  args: { cardId: v.id("cards") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.cardId);
  },
});

export const recordCardStatus = internalMutation({
  args: { cardId: v.id("cards"), status: v.string() },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) return;
    await ctx.db.patch(args.cardId, { status: args.status, updatedAt: now() });
  },
});

export const applyCardStatus = internalAction({
  args: {
    cardId: v.id("cards"),
    status: v.union(v.literal("active"), v.literal("disabled"), v.literal("canceled")),
  },
  handler: async (ctx, args) => {
    const card = await ctx.runQuery(internal.functions.finance.cards.getCardInternal, {
      cardId: args.cardId,
    });
    if (!card?.increaseCardId) {
      console.error(
        `[finance] applyCardStatus: card ${args.cardId} has no increaseCardId — cannot update status at Increase`,
      );
      return;
    }

    const { updateCardStatus } = await import("../../lib/finance/increase");
    const result = await updateCardStatus(card.increaseCardId, args.status);
    await ctx.runMutation(internal.functions.finance.cards.recordCardStatus, {
      cardId: args.cardId,
      status: result.status,
    });
  },
});

// ============================================================================
// setCardLimit — change (or clear) a live card's bank-enforced spend limit.
// Same provider-write-then-record shape as the status mutations: the local
// mirror is only patched once Increase has actually accepted the new limit,
// so the roster can never show a cap the bank isn't enforcing.
// ============================================================================

export const setCardLimit = mutation({
  args: {
    token: v.string(),
    cardId: v.id("cards"),
    /** Omit BOTH to remove the limit entirely. */
    spendLimitCents: v.optional(v.number()),
    limitPeriod: v.optional(limitPeriodValidator),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGroupGivingEnabled(ctx);

    const card = await ctx.db.get(args.cardId);
    if (!card) {
      throw new Error("Card not found");
    }
    const fund = await ctx.db.get(card.fundId);
    if (!fund) {
      throw new Error("Fund not found");
    }
    // Raising a cap is a spending-power grant, so it's finance_admin-only
    // (ADR-032 §4: "Issue/freeze cards; set spend limits"). Lowering one is
    // held to the same bar rather than split out — a holder who wants less
    // rope can freeze the card, which they already can.
    await requireFundRole(ctx, fund._id, userId, "finance_admin");

    validateCardLimit(args.spendLimitCents, args.limitPeriod);

    if (!card.increaseCardId) {
      throw new Error("This card hasn't finished provisioning yet");
    }

    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      actorUserId: userId,
      action: "card.limit_updated",
      details: {
        cardId: args.cardId,
        fromSpendLimitCents: card.spendLimitCents ?? null,
        fromLimitPeriod: card.limitPeriod ?? null,
        toSpendLimitCents: args.spendLimitCents ?? null,
        toLimitPeriod: args.limitPeriod ?? null,
      },
    });

    await ctx.scheduler.runAfter(
      0,
      internal.functions.finance.cards.applyCardLimit,
      {
        cardId: args.cardId,
        spendLimitCents: args.spendLimitCents,
        limitPeriod: args.limitPeriod,
      },
    );

    return {
      spendLimitCents: args.spendLimitCents ?? null,
      limitPeriod: args.limitPeriod ?? null,
    };
  },
});

export const recordCardLimit = internalMutation({
  args: {
    cardId: v.id("cards"),
    spendLimitCents: v.optional(v.number()),
    limitPeriod: v.optional(limitPeriodValidator),
  },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) return;
    await ctx.db.patch(args.cardId, {
      spendLimitCents: args.spendLimitCents,
      limitPeriod: args.limitPeriod,
      updatedAt: now(),
    });
  },
});

export const applyCardLimit = internalAction({
  args: {
    cardId: v.id("cards"),
    spendLimitCents: v.optional(v.number()),
    limitPeriod: v.optional(limitPeriodValidator),
  },
  handler: async (ctx, args) => {
    const card = await ctx.runQuery(internal.functions.finance.cards.getCardInternal, {
      cardId: args.cardId,
    });
    if (!card?.increaseCardId) {
      console.error(
        `[finance] applyCardLimit: card ${args.cardId} has no increaseCardId — cannot update its limit at Increase`,
      );
      return;
    }

    const { updateCardSpendingLimit } = await import("../../lib/finance/increase");
    await updateCardSpendingLimit(
      card.increaseCardId,
      toIncreaseSpendingLimit(args.spendLimitCents, args.limitPeriod),
    );
    await ctx.runMutation(internal.functions.finance.cards.recordCardLimit, {
      cardId: args.cardId,
      spendLimitCents: args.spendLimitCents,
      limitPeriod: args.limitPeriod,
    });
  },
});

// ============================================================================
// getCardDetail
// ============================================================================

const ACTIVITY_LIMIT = 20;

/**
 * A single card's detail plus its recent `card_charge` activity. Same viewer
 * gate as `listFundCards`, resolved via the card's fund.
 */
export const getCardDetail = query({
  args: { token: v.string(), cardId: v.id("cards") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGroupGivingEnabled(ctx);

    const card = await ctx.db.get(args.cardId);
    if (!card) {
      throw new Error("Card not found");
    }
    await requireFundRoleOrGroupLeader(ctx, card.fundId, userId, "cardholder");

    const holder = await ctx.db.get(card.holderUserId);

    const expenses = await ctx.db
      .query("expenses")
      .withIndex("by_card", (q) => q.eq("cardId", args.cardId))
      .collect();
    expenses.sort((a, b) => b.createdAt - a.createdAt);

    const activity = expenses.slice(0, ACTIVITY_LIMIT).map((e) => ({
      id: e._id,
      amountCents: e.amountCents,
      description: e.description ?? null,
      status: e.status,
      receiptAttached: !!e.receiptKey,
      createdAt: e.createdAt,
    }));

    // Per-action capabilities mirroring the mutations' own gates, so the UI
    // never renders a control whose mutation would reject this viewer:
    // freeze = finance_admin OR the holder; unfreeze/cancel = finance_admin
    // only (a possibly-compromised holder must not re-enable their card).
    const viewerIsFinanceAdmin = await isFundFinanceAdmin(ctx, card.fundId, userId);
    const viewerIsHolder = card.holderUserId === userId;

    return {
      ...toCardSummary(card, getDisplayName(holder?.firstName, holder?.lastName)),
      holderProfileImage: getMediaUrl(holder?.profilePhoto),
      activity,
      viewerCanFreeze: viewerIsFinanceAdmin || viewerIsHolder,
      viewerCanUnfreeze: viewerIsFinanceAdmin,
      viewerCanCancel: viewerIsFinanceAdmin,
    };
  },
});
