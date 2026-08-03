/**
 * Group-fund virtual cards (ADR-032 §3 Phase 3; provider-neutral per ADR-033).
 *
 * A card is a virtual card bound to a fund's money at the community's card
 * PROVIDER, and assigned to one holder (a member who holds `cardholder`+ on
 * the fund). Which provider that is, is resolved once per action through
 * `getCardProvider` (lib/finance/cardProviders/) — this module never names
 * one. Increase, today's only adapter, enforces spend segregation at the
 * account level (a card can never overdraw its fund or touch another fund's
 * balance), which is why this module is attribution + lifecycle control and
 * not an authorization decisioner. A provider whose
 * `capabilities.hardFundIsolation` is false would need that guarantee
 * rebuilt here; none exists yet.
 *
 * STATUS VOCABULARY (ADR-033, deliberate). The adapter speaks a normalized
 * `CardState` — "pending" | "active" | "paused" | "closed" | "failed" — and
 * every provider maps onto it. `cards.status` in the DATABASE, however, still
 * stores the legacy Increase strings ("active" / "disabled" / "canceled"),
 * because mobile's `CardStatus` union
 * (apps/mobile/features/finance/leader/types.ts) is pinned to them and every
 * card row in production already holds them. Changing the stored vocabulary
 * means a data migration plus a mobile release, which is a bigger and
 * riskier change than the seam itself needs — so the adapter returns BOTH
 * `state` (normalized) and `providerStatus` (verbatim), and this module
 * persists the latter. ADR-033 Phase 1 migrates the column. New code should
 * read `ProviderCard.state`; nothing should add a new consumer of the raw
 * string.
 *
 * The lifecycle surface:
 *
 * - `listFundCards` / `getCardDetail` — read the fund's card roster and a
 *   single card's recent activity (its `card_charge` expenses).
 * - `createFundCard` — finance_admin issues a card to a cardholder+ member.
 *   Inserts a "pending" row synchronously, then schedules `provisionCard`
 *   (an internalAction — the provider is called outside the mutation, same
 *   pattern as onboarding.ts's `provisionProviders`) to actually create the
 *   card at the provider and record the result.
 * - `setCardLimit` — finance_admin changes (or removes) a live card's limit.
 * - `setCardFrozen` / `cancelCard` — lifecycle control. Both patch the local
 *   row via a scheduled internalAction + internalMutation pair (same
 *   provider-write-then-record shape as `createFundCard`), so a card's
 *   `status` only ever reflects what the provider actually confirmed, never
 *   an optimistic guess.
 *
 * `spendLimitCents` / `limitPeriod` are ENFORCED BY THE PROVIDER, not
 * advisory: the adapter translates them into the provider's own interval
 * vocabulary (for Increase, `authorization_controls.usage.multi_use.spending_limits`)
 * and applies them at card creation and on every limit change, so an
 * authorization that would breach them is declined without ever calling us.
 * Our stored copy is a mirror for display; the provider's copy is the
 * control. Everything beyond an amount-per-interval cap (merchant-category
 * rules, per-swipe custom logic) would still need a real-time authorization
 * webhook and remains out of scope — see ARCHITECTURE.md's Known Seams.
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
  validateCardLimit,
  type CardLimitPeriod,
} from "../../lib/finance/cardPolicy";
import {
  getCardProviderByName,
  isBringYourOwnProvider,
  loadActiveProviderConnection,
  requiresSpendLimit,
  resolveCardProviderName,
  supportsWeeklyLimits,
} from "../../lib/finance/cardProviders";
import type {
  CardState,
  NormalizedLimit,
} from "../../lib/finance/cardProviders/types";
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
 * Our stored limit pair -> the adapter's `NormalizedLimit` (ADR-033). `null`
 * means "no limit", which every provider must be told EXPLICITLY (Increase
 * replaces the whole controls object on PATCH — see `buildAuthorizationControls`),
 * so this never returns `undefined`.
 */
function toNormalizedLimit(
  spendLimitCents: number | undefined,
  limitPeriod: CardLimitPeriod | undefined,
): NormalizedLimit | null {
  if (spendLimitCents === undefined || limitPeriod === undefined) return null;
  return { limitCents: spendLimitCents, period: limitPeriod };
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

/**
 * Why this fund CAN'T have a card issued right now, or `null` if it can.
 *
 * Returns the sentence rather than a boolean because the two providers fail
 * for genuinely different reasons and a shared "not ready" would send an admin
 * looking in the wrong place — one of them needs to wait for Increase, the
 * other needs to go paste an API key.
 *
 * Called TWICE: once in `createFundCard`, and again inside
 * `getCardForProvisioning` right before the provider call. Not belt-and-braces
 * — those run in different transactions, however far apart, and a connection
 * revoked in the gap would otherwise still produce a live card.
 */
async function describeCardIssuingReadiness(
  ctx: { db: any },
  fund: Doc<"funds">,
  providerName: Awaited<ReturnType<typeof resolveCardProviderName>>,
): Promise<string | null> {
  if (providerName === "none") {
    return "This community hasn't set up a card provider yet — connect one in Community Settings → Finance";
  }
  if (isBringYourOwnProvider(providerName)) {
    const connection = await loadActiveProviderConnection(ctx, fund.communityId);
    return connection
      ? null
      : `This community's ${providerName} account isn't connected — reconnect it in Community Settings → Finance`;
  }
  // Increase: the fund's own Account is the card's boundary, so no Account
  // means no card that could be safely scoped to this fund.
  return fund.increaseAccountId ? null : "This fund's bank account isn't ready yet";
}

/**
 * Refuse a limit period the community's issuer cannot actually enforce.
 *
 * Privacy has no weekly window, and the adapter would quietly widen "$100 per
 * week" to "$100 per MONTH" — strictly tighter for the money, but the card
 * screen still reads "/ week" with a Monday reset, so the cardholder finds out
 * by being declined for the rest of the month. Refusing here, where the
 * finance admin is choosing, is the version of this that doesn't lie.
 */
function assertLimitPeriodSupported(
  providerName: Awaited<ReturnType<typeof resolveCardProviderName>>,
  limitPeriod: CardLimitPeriod | undefined,
): void {
  if (limitPeriod !== "week") return;
  if (supportsWeeklyLimits(providerName)) return;
  throw new Error(
    `${providerName} has no weekly spending limit — choose "Per month" or "Per transaction"`,
  );
}

/**
 * Refuse an UNCAPPED card at an issuer with no hard fund isolation.
 *
 * At Increase "no limit" means "up to this fund's balance", because the fund
 * owns the Account the card draws from and the bank enforces that. At Privacy
 * every card draws the community's single pooled funding source, so the same
 * choice means "up to the church's entire account" — another group's giving
 * included.
 *
 * BE PRECISE ABOUT WHAT THIS BUYS, because it is easy to over-read: a provider
 * spend limit is per CARD and per PERIOD. It is not an aggregate fund-balance
 * control, and it cannot be — Privacy has no notion of our funds. A `charge`
 * limit caps each purchase but not their number; a `month` limit can exceed
 * the fund's balance, and several cards can each carry one. What requiring it
 * does is turn unbounded exposure into a bounded, deliberately chosen number,
 * which is the strongest guarantee available at a pooled-account issuer.
 *
 * The real control — authorizing against the fund's own balance — is ADR-033
 * Phase 2, and `capabilities.hardFundIsolation: false` is the flag that says
 * so out loud. Until it lands, over-spend against a fund is an app-side
 * reconciliation concern (see recordCardSettlement's skipped account
 * cross-check), not something this gate should be read as preventing.
 */
function assertLimitRequired(
  providerName: Awaited<ReturnType<typeof resolveCardProviderName>>,
  spendLimitCents: number | undefined,
  limitPeriod: CardLimitPeriod | undefined,
): void {
  if (!requiresSpendLimit(providerName)) return;
  if (spendLimitCents !== undefined && limitPeriod !== undefined) return;
  throw new Error(
    `Cards at ${providerName} draw on this community's whole account, not a per-fund one — set a spending limit, because it's the only cap on what this card can reach`,
  );
}

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

    // "Is this community ready to issue a card?" has TWO answers since
    // ADR-033, and they are not variations of one check:
    //
    //   increase — the fund needs its own Increase Account, because the card
    //              is bound to it and the bank enforces the fund boundary.
    //   BYO      — there is no per-fund account to need; what must exist is a
    //              live connection to the church's own issuer.
    //
    // The old single `!fund.increaseAccountId` gate is why a BYO community
    // could not issue a card at all: it asked for an artifact their model
    // never produces.
    const providerName = await resolveCardProviderName(ctx, fund.communityId);
    const readiness = await describeCardIssuingReadiness(
      ctx,
      fund,
      providerName,
    );
    if (readiness) {
      throw new Error(readiness);
    }
    assertLimitPeriodSupported(providerName, args.limitPeriod);
    assertLimitRequired(providerName, args.spendLimitCents, args.limitPeriod);

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
      // Stamped NOW, not at `recordCardProvisioned`. Between this insert and
      // the scheduled provisioning action landing, the row is a card that is
      // about to exist at a named issuer — and `disconnectCardProvider`'s
      // "are any cards still live?" guard has to see it, or an admin can
      // disconnect in that window and the action still mints a real card with
      // the credential it already loaded. `recordCardProvisioned` writes the
      // same value again; this just makes it true earlier.
      provider: providerName,
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
    // Resolved here, in the query, because `provisionCard` is an ACTION and
    // has no `ctx.db` to resolve any of this with (ADR-033).
    const providerName = await resolveCardProviderName(ctx, fund.communityId);
    return {
      card,
      fund,
      onboardingStatus: finance?.onboardingStatus ?? null,
      providerName,
      /** Null when ready; otherwise the sentence explaining what's missing. */
      readiness: await describeCardIssuingReadiness(ctx, fund, providerName),
      /** Encrypted; the resolver decrypts it into the adapter. Null for Increase. */
      connection: isBringYourOwnProvider(providerName)
        ? await loadActiveProviderConnection(ctx, fund.communityId)
        : null,
    };
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

/**
 * Record a successfully provisioned card.
 *
 * `status` is the provider's OWN status string, not our normalized
 * `CardState` — see this module's header on the status vocabulary (ADR-033).
 *
 * Writes the provider-neutral pair (`provider` / `providerCardId`) AND, for
 * Increase only, the legacy `increaseCardId`. The legacy column is still the
 * lookup key for the live `transaction.created` settlement webhook
 * (`funds.by_increaseAccountId` / `cards.by_increaseCardId` in webhooks.ts)
 * and for every readiness guard in this file, so it keeps being written until
 * ADR-033 Phase 1 moves those readers over. A BYOC card writes only the pair,
 * which is why those guards must move rather than be duplicated.
 */
/**
 * The adapter's normalized state -> the word stored in `cards.status`.
 *
 * `cards.status` is read by the mobile UI (badge copy, whether a freeze button
 * appears) and by this module's own guards, and its vocabulary is Increase's:
 * `active` | `disabled` | `canceled` | `pending` | `failed`. Writing the
 * PROVIDER's raw word instead would put "OPEN"/"PAUSED"/"CLOSED" in there for
 * Privacy — a card that renders no badge, offers no freeze, and is refused by
 * `setCardLimit`'s own status check. That is a card nobody can control.
 *
 * Lossless for Increase, whose raw enum round-trips through
 * `increaseStatusToCardState` to exactly these five words — so this changes
 * nothing for the cards in production today. It is the BYO adapters it exists
 * for, and it is why `ProviderCard` carries a normalized `state` at all.
 *
 * TODO: when a finance migration next runs, rename these to the neutral
 * vocabulary (`paused`/`closed`) and migrate the column — the mapping is here
 * only because the stored words predate the adapter seam.
 */
function cardStateToStoredStatus(state: CardState): string {
  switch (state) {
    case "active":
      return "active";
    case "paused":
      return "disabled";
    case "closed":
      return "canceled";
    case "pending":
      return "pending";
    case "failed":
      return "failed";
  }
}

export const recordCardProvisioned = internalMutation({
  args: {
    cardId: v.id("cards"),
    provider: v.string(),
    providerCardId: v.string(),
    /** Optional: not every issuer returns the PAN's last 4 at creation time. */
    last4: v.optional(v.string()),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) return; // deleted mid-provisioning — nothing to record
    await ctx.db.patch(args.cardId, {
      provider: args.provider,
      providerCardId: args.providerCardId,
      ...(args.provider === "increase"
        ? { increaseCardId: args.providerCardId }
        : {}),
      // Left ABSENT rather than written as "" when the provider didn't give
      // one — the UI renders `last4 ?? null`, and an empty string would show
      // as "Groceries •••• " with nothing after it.
      ...(args.last4 ? { last4: args.last4 } : {}),
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
    const { card, fund, onboardingStatus, providerName, readiness, connection } =
      loaded;

    // Re-check every gate createFundCard checked, immediately before the
    // provider call. createFundCard's checks ran in a DIFFERENT transaction,
    // however long ago; a fund frozen (e.g. its group was archived), a
    // community knocked out of "live", or a card provider disconnected in the
    // gap would otherwise still get a live card at the issuer — an app-side
    // freeze that quietly issues spending power is worse than no freeze at
    // all. Refuse loudly and audit; do not retry, because the state that
    // changed is a deliberate one.
    const refusal =
      readiness ??
      (fund.status !== "active"
        ? `fund status is "${fund.status}"`
        : onboardingStatus !== "live"
          ? `community onboarding status is "${onboardingStatus ?? "missing"}"`
          : null);
    if (refusal !== null) {
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
      // ADR-033: the card module talks to an ADAPTER, never to a named
      // provider client. Resolution happened in getCardForProvisioning (an
      // action has no ctx.db); this only turns the name into the adapter.
      const provider = await getCardProviderByName(providerName, connection);
      const providerCard = await provider.createCard({
        // Empty string for a provider with no per-fund account — the adapter
        // ignores it, which is `capabilities.hardFundIsolation: false` made
        // literal. `readiness` above already proved this is non-empty for the
        // providers that DO bind a card to an account.
        fundAccountRef: fund.increaseAccountId ?? "",
        description: `${fund.name} — ${card.name ?? "Card"}`,
        idempotencyKey: `finance:card:${args.cardId}`,
        // The spend limit the finance_admin picked. Sent AT CREATION so there
        // is never a window where the card is live and uncapped; the adapter
        // translates the period into the provider's own interval vocabulary.
        limit: toNormalizedLimit(card.spendLimitCents, card.limitPeriod),
      });
      await ctx.runMutation(internal.functions.finance.cards.recordCardProvisioned, {
        cardId: args.cardId,
        provider: provider.name,
        providerCardId: providerCard.providerCardId,
        last4: providerCard.last4,
        status: cardStateToStoredStatus(providerCard.state),
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

    // Provider-NEUTRAL readiness. `recordCardProvisioned` writes
    // `increaseCardId` only when the provider is Increase, so asking for it
    // alone would read a perfectly live Privacy card as "never provisioned" —
    // the kill switch failing closed on exactly the path ADR-033 opens, and no
    // longer hypothetical now that `createFundCard` issues BYO cards. Same
    // `providerCardId ?? increaseCardId` order the action side already uses.
    if (!card.providerCardId && !card.increaseCardId) {
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
      { cardId: args.cardId, state: args.frozen ? "paused" : "active" },
    );

    // The RETURN stays in the legacy Increase vocabulary ("disabled") that
    // mobile's `CardStatus` union is pinned to — see the status-vocabulary
    // note in this module's header. Only the internal action speaks
    // normalized states.
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

    // Provider-NEUTRAL readiness. `recordCardProvisioned` writes
    // `increaseCardId` only when the provider is Increase, so asking for it
    // alone would read a perfectly live Privacy card as "never provisioned" —
    // the kill switch failing closed on exactly the path ADR-033 opens, and no
    // longer hypothetical now that `createFundCard` issues BYO cards. Same
    // `providerCardId ?? increaseCardId` order the action side already uses.
    if (!card.providerCardId && !card.increaseCardId) {
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
      { cardId: args.cardId, state: "closed" },
    );

    // Legacy vocabulary on the wire, normalized state internally — same
    // split as setCardFrozen.
    return { status: "canceled" as const };
  },
});

// ============================================================================
// applyCardStatus — shared internalAction/internalMutation pair backing
// setCardFrozen and cancelCard: calls Increase, then persists whatever
// Increase actually confirmed.
// ============================================================================

/**
 * A card plus the provider its fund's community is on — the pair every card
 * ACTION needs, fetched together because an action has no `ctx.db` of its own
 * to resolve the provider with (ADR-033).
 */
export const getCardInternal = internalQuery({
  args: { cardId: v.id("cards") },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) return null;
    const fund = await ctx.db.get(card.fundId);
    if (!fund) return null;
    const providerName = await resolveCardProviderName(ctx, fund.communityId);
    return {
      card,
      providerName,
      // Loaded here, alongside the name, for the same reason the name is:
      // the action has no `ctx.db`. Still ENCRYPTED — the resolver decrypts it
      // into the adapter and nothing in this module ever sees the key.
      connection: isBringYourOwnProvider(providerName)
        ? await loadActiveProviderConnection(ctx, fund.communityId)
        : null,
    };
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
    /**
     * The NORMALIZED state to move to (ADR-033's `CardStateRequest`), not a
     * provider status string — "paused"/"closed", never "disabled"/"canceled".
     * The adapter owns that translation.
     */
    state: v.union(v.literal("active"), v.literal("paused"), v.literal("closed")),
  },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(
      internal.functions.finance.cards.getCardInternal,
      { cardId: args.cardId },
    );
    // `providerCardId ?? increaseCardId`: cards provisioned before ADR-033
    // have only the legacy column, and a freeze must never be a no-op just
    // because a card predates the adapter.
    const providerCardId =
      loaded?.card.providerCardId ?? loaded?.card.increaseCardId;
    if (!loaded || !providerCardId) {
      console.error(
        `[finance] applyCardStatus: card ${args.cardId} has no provider card id — cannot update its status at the provider`,
      );
      return;
    }

    const provider = await getCardProviderByName(
      loaded.providerName,
      loaded.connection,
    );
    const result = await provider.setCardState(providerCardId, args.state);
    await ctx.runMutation(internal.functions.finance.cards.recordCardStatus, {
      cardId: args.cardId,
      status: cardStateToStoredStatus(result.state),
    });
  },
});

// ============================================================================
// setCardLimit — change (or clear) a live card's bank-enforced spend limit.
// Same provider-write-then-record shape as the status mutations: the local
// mirror is only patched once Increase has actually accepted the new limit,
// so the roster can never show a cap the bank isn't enforcing. The audit
// trail follows the same rule — this mutation records the REQUEST, and the
// applied `card.limit_updated` is written by `recordCardLimit`, i.e. only
// after Increase confirms. An audit log that asserts limit changes the bank
// never took is worse than no audit log.
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
    const limitProviderName = await resolveCardProviderName(
      ctx,
      fund.communityId,
    );
    assertLimitPeriodSupported(limitProviderName, args.limitPeriod);
    assertLimitRequired(
      limitProviderName,
      args.spendLimitCents,
      args.limitPeriod,
    );

    // The same fund/card readiness gates `createFundCard` applies. Changing a
    // limit is mostly a spending-power GRANT (that's why it's finance_admin
    // only), so it can't be the one card mutation that skips them: raising a
    // cap on a card whose fund was frozen — because its group got archived —
    // would contradict every other gate in the module. De-escalation is still
    // reachable on a frozen fund: `setCardFrozen`/`cancelCard` are ungated on
    // purpose, and freezing the card is the stronger move anyway.
    if (fund.status !== "active") {
      throw new Error("This fund isn't active — card limits can't be changed");
    }
    // Provider-NEUTRAL readiness. `recordCardProvisioned` writes
    // `increaseCardId` only when the provider is Increase, so asking for it
    // alone would read a perfectly live Privacy card as "never provisioned" —
    // the kill switch failing closed on exactly the path ADR-033 opens, and no
    // longer hypothetical now that `createFundCard` issues BYO cards. Same
    // `providerCardId ?? increaseCardId` order the action side already uses.
    if (!card.providerCardId && !card.increaseCardId) {
      throw new Error("This card hasn't finished provisioning yet");
    }
    // "canceled" is irreversible and "failed"/"pending" have no card at the
    // bank to PATCH; only a live or frozen card has a limit worth changing.
    if (card.status !== "active" && card.status !== "disabled") {
      throw new Error(`This card is ${card.status} — its limit can't be changed`);
    }

    // The REQUEST, not the change — see this section's header. The applied
    // `card.limit_updated` lands in `recordCardLimit`, once Increase agrees.
    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      actorUserId: userId,
      action: "card.limit_update_requested",
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
        actorUserId: userId,
      },
    );

    // The REQUESTED limit, explicitly labelled as not-yet-applied: the bank
    // hasn't been asked yet, so a caller that rendered this as the live limit
    // would be making exactly the claim this module exists to stop.
    return {
      status: "pending" as const,
      requestedSpendLimitCents: args.spendLimitCents ?? null,
      requestedLimitPeriod: args.limitPeriod ?? null,
    };
  },
});

/** Increase took the new limit: patch the mirror and audit it as APPLIED. */
export const recordCardLimit = internalMutation({
  args: {
    cardId: v.id("cards"),
    spendLimitCents: v.optional(v.number()),
    limitPeriod: v.optional(limitPeriodValidator),
    actorUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) return;
    const fund = await ctx.db.get(card.fundId);
    await ctx.db.patch(args.cardId, {
      spendLimitCents: args.spendLimitCents,
      limitPeriod: args.limitPeriod,
      updatedAt: now(),
    });
    if (fund) {
      await logFinanceAudit(ctx, {
        communityId: fund.communityId,
        fundId: fund._id,
        actorUserId: args.actorUserId,
        action: "card.limit_updated",
        details: {
          cardId: args.cardId,
          fromSpendLimitCents: card.spendLimitCents ?? null,
          fromLimitPeriod: card.limitPeriod ?? null,
          toSpendLimitCents: args.spendLimitCents ?? null,
          toLimitPeriod: args.limitPeriod ?? null,
        },
      });
    }
  },
});

/**
 * A limit change that didn't complete. `providerApplied` is the whole point
 * of the row: `false` means Increase refused and both sides still hold the
 * old limit (consistent, safe); `true` means Increase TOOK the change but we
 * failed to mirror it, so the bank and the app now disagree — and in the
 * raise/clear direction the card is looser than the app claims. Nothing
 * reconciles that automatically (there is no read-back cron), so it has to
 * be loud in the audit trail where a finance admin can act on it.
 */
export const recordCardLimitFailed = internalMutation({
  args: {
    cardId: v.id("cards"),
    message: v.string(),
    providerApplied: v.boolean(),
    spendLimitCents: v.optional(v.number()),
    limitPeriod: v.optional(limitPeriodValidator),
    actorUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) return;
    const fund = await ctx.db.get(card.fundId);
    if (!fund) return;
    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      actorUserId: args.actorUserId,
      action: "card.limit_update_failed",
      details: {
        cardId: args.cardId,
        providerApplied: args.providerApplied,
        message: args.message,
        toSpendLimitCents: args.spendLimitCents ?? null,
        toLimitPeriod: args.limitPeriod ?? null,
      },
    });
  },
});

export const applyCardLimit = internalAction({
  args: {
    cardId: v.id("cards"),
    spendLimitCents: v.optional(v.number()),
    limitPeriod: v.optional(limitPeriodValidator),
    actorUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const loaded = await ctx.runQuery(
      internal.functions.finance.cards.getCardInternal,
      { cardId: args.cardId },
    );
    // Legacy fallback, same as applyCardStatus: pre-ADR-033 cards carry only
    // `increaseCardId`.
    const providerCardId =
      loaded?.card.providerCardId ?? loaded?.card.increaseCardId;
    if (!loaded || !providerCardId) {
      console.error(
        `[finance] applyCardLimit: card ${args.cardId} has no provider card id — cannot update its limit at the provider`,
      );
      return;
    }

    // Two failure modes, deliberately caught separately, because they leave
    // the world in opposite states — see recordCardLimitFailed. Mirrors
    // provisionCard's catch-and-record shape; a limit change that silently
    // vanished is the one outcome nobody can detect from the app.
    const provider = await getCardProviderByName(
      loaded.providerName,
      loaded.connection,
    );
    try {
      await provider.setSpendLimit(
        providerCardId,
        toNormalizedLimit(args.spendLimitCents, args.limitPeriod),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[finance] applyCardLimit: the provider refused the new limit for card ${args.cardId}: ${message}`,
      );
      await ctx.runMutation(internal.functions.finance.cards.recordCardLimitFailed, {
        cardId: args.cardId,
        message: message.slice(0, 500),
        providerApplied: false,
        spendLimitCents: args.spendLimitCents,
        limitPeriod: args.limitPeriod,
        actorUserId: args.actorUserId,
      });
      return;
    }

    try {
      await ctx.runMutation(internal.functions.finance.cards.recordCardLimit, {
        cardId: args.cardId,
        spendLimitCents: args.spendLimitCents,
        limitPeriod: args.limitPeriod,
        actorUserId: args.actorUserId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[finance] applyCardLimit: the provider APPLIED the new limit for card ${args.cardId} but the mirror write failed — provider and app now disagree: ${message}`,
      );
      await ctx.runMutation(internal.functions.finance.cards.recordCardLimitFailed, {
        cardId: args.cardId,
        message: message.slice(0, 500),
        providerApplied: true,
        spendLimitCents: args.spendLimitCents,
        limitPeriod: args.limitPeriod,
        actorUserId: args.actorUserId,
      });
    }
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
