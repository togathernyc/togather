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
 * - `setCardFrozen` / `cancelCard` — lifecycle control. Both patch the local
 *   row via a scheduled internalAction + internalMutation pair (same
 *   provider-write-then-record shape as `createFundCard`), so a card's
 *   `status` only ever reflects what Increase actually confirmed, never an
 *   optimistic guess.
 *
 * `spendLimitCents` / `limitPeriod` are ADVISORY ONLY — display guidance for
 * the fund's roster and any spend-nudge UI. Increase itself enforces no
 * automatic period reset or hard cap tied to these fields; real per-swipe
 * enforcement would need Increase's real-time authorization webhook
 * (`real_time_decision`) making an accept/decline call against them, which is
 * out of scope here — Phase 2 follow-up, tracked alongside the other
 * Known Seams in ARCHITECTURE.md.
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
  requireFundRole,
  requireFundRoleOrGroupLeader,
  hasFundRole,
} from "../../lib/helpers";

const limitPeriodValidator = v.union(
  v.literal("week"),
  v.literal("month"),
  v.literal("charge"),
);

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

    return cards.map((card, i) =>
      toCardSummary(card, getDisplayName(holders[i]?.firstName, holders[i]?.lastName)),
    );
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
    return { card, fund };
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
    const { card, fund } = loaded;
    if (!fund.increaseAccountId) {
      console.error(
        `[finance] provisionCard: fund ${fund._id} has no Increase Account — cannot provision card ${args.cardId}`,
      );
      return;
    }

    try {
      const { createCard } = await import("../../lib/finance/increase");
      const increaseCard = await createCard(
        fund.increaseAccountId,
        `${fund.name} — ${card.name ?? "Card"}`,
        `finance:card:${args.cardId}`,
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
// ============================================================================

export const setCardFrozen = mutation({
  args: { token: v.string(), cardId: v.id("cards"), frozen: v.boolean() },
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
// cancelCard — irreversible; finance_admin only.
// ============================================================================

export const cancelCard = mutation({
  args: { token: v.string(), cardId: v.id("cards") },
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

    return {
      ...toCardSummary(card, getDisplayName(holder?.firstName, holder?.lastName)),
      holderProfileImage: getMediaUrl(holder?.profilePhoto),
      activity,
    };
  },
});
