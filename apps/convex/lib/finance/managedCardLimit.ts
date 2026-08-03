/**
 * The MANAGED card limit (ADR-033 Phase 3) — standing in for fund isolation at
 * a provider that has none.
 *
 * ## The problem
 *
 * At Increase a fund owns its own Account and the card is bound to it, so
 * "this card may spend the fund's balance" is enforced by the bank
 * (`capabilities.hardFundIsolation`). At Privacy every card draws the church's
 * ONE pooled funding source, so the same sentence is a promise nothing keeps:
 * a per-card, per-PERIOD cap is all the provider offers, and a monthly cap
 * hands the card the fund's balance again next month whether or not the fund
 * was ever credited that much.
 *
 * ## The mechanism
 *
 * Privacy has one window that does not reset: `FOREVER`. A lifetime cap is
 * cumulative — the provider counts every settled charge on that card against
 * it, forever — which means it can be used as an ACCUMULATOR rather than an
 * allowance. Set it to the fund's lifetime inflow minus its non-card outflow,
 * and what remains at the provider is, by construction, the fund's balance.
 *
 * ## The formula
 *
 *   C   = Σ  every CREDIT entry on the fund, all time
 *   Dn  = Σ  every DEBIT entry whose kind is NOT "card_capture"
 *   Dt  = Σ  every "card_capture" DEBIT on THIS card (what the provider counts)
 *   Do  = Σ  every "card_capture" DEBIT on the fund's OTHER cards
 *
 *   fundBalance          = C − Dn − Dt − Do     (ledger.ts's deriveBalance)
 *   ledgerDerivedLimit L = C − Dn − Do          ← what we send the provider
 *   remainingAtProvider  = L − Dt               (the provider's own arithmetic)
 *                        = C − Dn − Do − Dt
 *                        = fundBalance          ∎
 *
 * THIS card's `card_capture` debits are EXCLUDED from the subtraction precisely
 * because the provider already subtracts them: it is counting the same spend
 * against the lifetime cap. Subtracting them here too would charge every
 * purchase twice and walk the card's headroom to zero at double speed.
 *
 * Every OTHER card's are NOT excluded, and that asymmetry is the whole reason
 * the formula is per-CARD rather than per-fund. The provider's lifetime counter
 * belongs to one card id: a card that is closed and replaced hands its
 * successor a counter starting at zero, so a fund-wide `C − Dn` would give the
 * new card headroom the old card already spent. `assertFundCardSlotFree` stops
 * two cards being alive at once; only `Do` stops them being alive in sequence.
 *
 * Worked example (the one the tests pin): a fund takes $500 in donations, pays
 * out a $100 reimbursement, and the card spends $250.
 *   L = 500 − 100 − 0 = 400 → the number sent to Privacy
 *   remaining at Privacy = 400 − 250 = 150
 *   fund balance         = 500 − 100 − 250 = 150   ✓
 * Close that card and issue a replacement, and the replacement's Do is the
 * closed card's $250: L = 500 − 100 − 250 = 150, which is the fund's balance
 * and exactly what a card that has spent nothing yet may spend.
 *
 * ## The preconditions, both load-bearing
 *
 * 1. **ONE live card per fund** (`capabilities.maxCardsPerFund: 1`). The cap is
 *    per CARD. Two cards would each carry the fund's whole allowance and the
 *    pair could spend it twice. `createFundCard` enforces this. (A card that is
 *    closed and REPLACED is handled by `Do` above, not by this precondition.)
 * 2. **Every card charge reaches the ledger** as a `card_capture` debit. It
 *    does — functions/finance/webhooks.ts's `recordCardSettlement`, backstopped
 *    by the hourly poll — and if one were ever missed, the error is in the SAFE
 *    direction: the provider has still counted it, so the card is tighter than
 *    the ledger thinks, never looser.
 *
 * ## What it is NOT
 *
 * Not real-time authorization. A charge that arrives before its predecessor
 * settles is decided by Privacy against the cap it currently holds, which is
 * the right conservative answer but not a per-transaction fund check. And not a
 * substitute for `hardFundIsolation`: the money is still pooled, so a bug here
 * misattributes rather than being caught by the bank.
 *
 * Not exact across a MERCHANT REFUND, either, and that is a known gap rather
 * than an oversight. A credit transaction on the card reverses the provider's
 * own lifetime counter, but webhooks.ts skips it loudly instead of posting a
 * ledger entry ("refund reversal is not implemented yet" — ADR-033's TODO), so
 * `Dt` stays high while the provider's count drops. The identity then reads
 * `remainingAtProvider = fundBalance + refunded`: the card can re-spend the
 * refund. The money is genuinely back in the pooled account, so nothing is
 * overdrawn at the bank — it is the LEDGER that is understating the fund — but
 * the equality above does not hold again until refund reversal lands.
 */

import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import type { MutationCtx } from "../../_generated/server";
import type { LedgerKind } from "./ledger";

/**
 * Ledger kinds whose DEBIT is already counted by the provider's own lifetime
 * cap, and must therefore not be subtracted a second time.
 *
 * Exactly one today. A set rather than an `!== "card_capture"` so that adding a
 * second provider-side debit kind is a one-line change in the place that
 * explains why, rather than a comparison to find in three files.
 */
const PROVIDER_COUNTED_DEBIT_KINDS: ReadonlySet<LedgerKind> = new Set([
  "card_capture",
]);

export interface ManagedLimitInputs {
  /** Σ credits, all time. */
  lifetimeCreditsCents: number;
  /**
   * Σ debits the provider does NOT already count against THIS card's lifetime
   * cap — every non-`card_capture` debit (`Dn`), plus every `card_capture`
   * debit belonging to one of the fund's other cards (`Do`).
   */
  nonCardDebitsCents: number;
}

/**
 * `L = C − Dn`, floored at zero.
 *
 * The floor matters: a fund whose refunds and fees exceed its credits would
 * otherwise produce a negative cap, and no provider accepts one. Zero is the
 * honest translation — "this card may spend nothing more" — and it is what the
 * fund's own balance says too.
 */
export function ledgerDerivedLimitCents(inputs: ManagedLimitInputs): number {
  return Math.max(
    0,
    Math.round(inputs.lifetimeCreditsCents - inputs.nonCardDebitsCents),
  );
}

/**
 * THE SMALLEST CAP WE WILL EVER SEND A PROVIDER, and the reason it is not zero.
 *
 * At Privacy, `spend_limit: 0` with `FOREVER` is the wire value `toPrivacyLimit`
 * uses for "no limit at all" (privacy.ts flags that reading as an unverified
 * assumption). A fund with no headroom — brand new, or one whose fees and
 * refunds have eaten its credits — derives a cap of exactly 0, so sending the
 * honest number would hand a pooled-account card the ONE payload that might
 * mean unlimited, at the precise moment it should authorize nothing.
 *
 * One cent is unambiguous, and it is the safe side of the ambiguity: a card
 * capped at $0.01 declines everything a card capped at $0.00 was meant to. The
 * fund is over-authorized by a cent, which is not a number any merchant can
 * charge and not a number worth trading for that risk.
 */
export const MIN_PROVIDER_LIMIT_CENTS = 1;

/**
 * The number actually sent to the provider: the ledger-derived cap, optionally
 * pinned LOWER by a finance admin, and never below `MIN_PROVIDER_LIMIT_CENTS`.
 *
 * A manual cap can only ever tighten. Letting it raise would let an admin type
 * a number the fund does not have, which is the exact promise this whole
 * mechanism exists to keep — so `setCardLimit` refuses upward and this `min` is
 * the second line of that defence rather than its only one.
 */
export function effectiveManagedLimitCents(
  derivedCents: number,
  manualCapCents: number | undefined,
): number {
  const capped =
    manualCapCents === undefined
      ? derivedCents
      : Math.min(derivedCents, Math.max(0, manualCapCents));
  return Math.max(MIN_PROVIDER_LIMIT_CENTS, capped);
}

// ============================================================================
// Reading it off the ledger
// ============================================================================

interface LedgerReadCtx {
  db: { query: (table: "ledgerEntries" | "expenses") => any };
}

/**
 * Sum a fund's whole ledger into the two terms of the formula, FOR ONE CARD.
 *
 * A FULL read of the fund's entries, deliberately: the cap is cumulative, so
 * there is no window to bound it to — any bound would silently drop the oldest
 * donations and shrink the card's headroom for no stated reason. The read is
 * bounded in practice by what a single group fund accumulates (one entry per
 * gift, charge, reimbursement and fee), and it runs only when a managed card
 * exists on that fund.
 *
 * `cardId` is the card the cap is being computed FOR, and omitting it means "a
 * card that has spent nothing at the provider yet" — the case `createFundCard`
 * is in, where the row does not exist. Its own charges (`Dt`) are left out of
 * the subtraction because the provider counts them; every other card's (`Do`)
 * are subtracted, because that provider counter died with the card.
 *
 * Recomputed from scratch every time rather than incremented, which is what
 * makes `syncManagedCardLimit` idempotent: two runs of the same event, or a run
 * that lands out of order, converge on the same number instead of compounding.
 */
export async function readManagedLimitInputs(
  ctx: LedgerReadCtx,
  fundId: Id<"funds">,
  cardId?: Id<"cards">,
): Promise<ManagedLimitInputs> {
  const entries: Array<Doc<"ledgerEntries">> = await ctx.db
    .query("ledgerEntries")
    .withIndex("by_fund", (q: any) => q.eq("fundId", fundId))
    .collect();

  let lifetimeCreditsCents = 0;
  let nonCardDebitsCents = 0;
  let cardDebitsCents = 0;
  for (const entry of entries) {
    if (entry.direction === "credit") {
      lifetimeCreditsCents += entry.amountCents;
    } else if (PROVIDER_COUNTED_DEBIT_KINDS.has(entry.kind as LedgerKind)) {
      cardDebitsCents += entry.amountCents;
    } else {
      nonCardDebitsCents += entry.amountCents;
    }
  }

  return {
    lifetimeCreditsCents,
    // `Do` = every card_capture debit on the fund MINUS the ones this card is
    // responsible for. Read from the expense rows rather than the ledger
    // because a ledger entry carries no card id, and `recordCardSettlement`
    // writes the expense and the debit together from the same amount.
    //
    // Floored at zero: the two tables can only disagree through a bug, and the
    // safe direction for a spending cap is "assume this card spent all of it".
    nonCardDebitsCents:
      nonCardDebitsCents +
      Math.max(0, cardDebitsCents - (await sumCardCharges(ctx, cardId))),
  };
}

/** Σ settled `card_charge` expenses on one card — `Dt`, or 0 if there is no card yet. */
async function sumCardCharges(
  ctx: LedgerReadCtx,
  cardId: Id<"cards"> | undefined,
): Promise<number> {
  if (!cardId) return 0;
  const charges: Array<Doc<"expenses">> = await ctx.db
    .query("expenses")
    .withIndex("by_card", (q: any) => q.eq("cardId", cardId))
    .collect();
  return charges.reduce(
    (sum, expense) =>
      expense.kind === "card_charge" ? sum + expense.amountCents : sum,
    0,
  );
}

// ============================================================================
// The `cards.controls` bag
// ============================================================================

/**
 * What a managed card carries in `cards.controls` (schema: `v.any()`).
 *
 * `controls` is used rather than a new column because schema.ts is not being
 * widened for this phase and `controls` is already the provider-shaped
 * catch-all. Two fields, both meaningful:
 *
 * - `managedLimit: true` — the flag every other surface reads to know that
 *   `spendLimitCents` is COMPUTED and `limitPeriod` is deliberately absent
 *   (the window is lifetime, which `cards.limitPeriod` cannot express).
 * - `manualCapCents` — an optional admin-pinned ceiling, always ≤ the derived
 *   cap. Absent means "follow the fund exactly".
 */
export interface ManagedCardControls {
  managedLimit: true;
  manualCapCents?: number;
}

/** True when this card's limit is Togather-computed rather than admin-typed. */
export function isManagedCard(card: Pick<Doc<"cards">, "controls">): boolean {
  return (
    (card.controls as ManagedCardControls | undefined)?.managedLimit === true
  );
}

/** The admin-pinned ceiling on a managed card, if one was set. */
export function managedManualCapCents(
  card: Pick<Doc<"cards">, "controls">,
): number | undefined {
  const controls = card.controls as ManagedCardControls | undefined;
  return controls?.managedLimit === true ? controls.manualCapCents : undefined;
}

/**
 * Card statuses that mean "there is nothing at the provider to re-cap".
 *
 * Mirrors `cardProviderConnections.ts`'s `DEAD_CARD_STATUSES` and adds the
 * pre-provisioning states: a `pending` card has no provider id yet, and
 * `provisionCard` applies the limit at creation anyway.
 */
const UNSYNCABLE_CARD_STATUSES = new Set([
  "pending",
  "failed",
  "canceled",
  "closed",
  "CLOSED",
]);

export function managedCardIsSyncable(
  card: Pick<Doc<"cards">, "controls" | "status" | "providerCardId">,
): boolean {
  if (!isManagedCard(card)) return false;
  if (!card.providerCardId) return false;
  return !UNSYNCABLE_CARD_STATUSES.has(card.status);
}

// ============================================================================
// The ledger-post hook
// ============================================================================

/**
 * Schedule a managed-limit resync for every managed card on a fund whose ledger
 * just moved.
 *
 * ONE HOOK, at the seam every balance change already passes through
 * (`postLedgerEntry`), rather than a call scattered across `recordDonationCore`,
 * `recordReimbursementPaid`, `recordAllocation` and `recordDonationRefund`. The
 * scattered version is the one that goes wrong: the next path that posts a
 * ledger entry — and there will be one — silently doesn't sync, and the symptom
 * is a card that quietly under-spends a fund weeks later.
 *
 * SKIPPED for provider-counted debits (`card_capture`). Those do not change
 * `L = C − Dn` at all, so a sync would compute the same number and issue no
 * provider call — correct but pure churn on the single most frequent ledger
 * event there is.
 *
 * Best-effort and non-fatal by construction: the scheduler enqueues the action
 * in this transaction, and if the action later fails at the provider it logs
 * and leaves the old cap standing (tighter or looser by exactly one event) for
 * the hourly `finance-managed-limit-resync` backstop to correct.
 */
export async function scheduleManagedLimitSync(
  ctx: MutationCtx,
  fundId: Id<"funds">,
  kind: LedgerKind,
  direction: "credit" | "debit",
): Promise<void> {
  if (direction === "debit" && PROVIDER_COUNTED_DEBIT_KINDS.has(kind)) return;

  const cards = await ctx.db
    .query("cards")
    .withIndex("by_fund", (q) => q.eq("fundId", fundId))
    .collect();

  for (const card of cards) {
    if (!managedCardIsSyncable(card)) continue;
    await ctx.scheduler.runAfter(
      0,
      internal.functions.finance.cards.syncManagedCardLimit,
      { cardId: card._id },
    );
  }
}
