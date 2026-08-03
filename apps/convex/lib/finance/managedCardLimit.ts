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
 *   Dc  = Σ  every "card_capture" DEBIT (i.e. what the card has spent)
 *
 *   fundBalance          = C − Dn − Dc          (ledger.ts's deriveBalance)
 *   ledgerDerivedLimit L = C − Dn               ← what we send the provider
 *   remainingAtProvider  = L − Dc               (the provider's own arithmetic)
 *                        = C − Dn − Dc
 *                        = fundBalance          ∎
 *
 * `card_capture` debits are EXCLUDED from the subtraction precisely because the
 * provider already subtracts them: it is counting the same spend against the
 * lifetime cap. Subtracting them here too would charge every purchase twice and
 * walk the card's headroom to zero at double speed.
 *
 * Worked example (the one the tests pin): a fund takes $500 in donations, pays
 * out a $100 reimbursement, and the card spends $250.
 *   L = 500 − 100 = 400 → the number sent to Privacy
 *   remaining at Privacy = 400 − 250 = 150
 *   fund balance         = 500 − 100 − 250 = 150   ✓
 *
 * ## The preconditions, both load-bearing
 *
 * 1. **ONE live card per fund** (`capabilities.maxCardsPerFund: 1`). The cap is
 *    per CARD. Two cards would each carry the fund's whole allowance and the
 *    pair could spend it twice. `createFundCard` enforces this.
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
  /** Σ debits the provider does NOT already count against the lifetime cap. */
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
 * The number actually sent to the provider: the ledger-derived cap, optionally
 * pinned LOWER by a finance admin.
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
  if (manualCapCents === undefined) return derivedCents;
  return Math.min(derivedCents, Math.max(0, manualCapCents));
}

// ============================================================================
// Reading it off the ledger
// ============================================================================

interface LedgerReadCtx {
  db: { query: (table: "ledgerEntries") => any };
}

/**
 * Sum a fund's whole ledger into the two terms of the formula.
 *
 * A FULL read of the fund's entries, deliberately: the cap is cumulative, so
 * there is no window to bound it to — any bound would silently drop the oldest
 * donations and shrink the card's headroom for no stated reason. The read is
 * bounded in practice by what a single group fund accumulates (one entry per
 * gift, charge, reimbursement and fee), and it runs only when a managed card
 * exists on that fund.
 *
 * Recomputed from scratch every time rather than incremented, which is what
 * makes `syncManagedCardLimit` idempotent: two runs of the same event, or a run
 * that lands out of order, converge on the same number instead of compounding.
 */
export async function readManagedLimitInputs(
  ctx: LedgerReadCtx,
  fundId: Id<"funds">,
): Promise<ManagedLimitInputs> {
  const entries: Array<Doc<"ledgerEntries">> = await ctx.db
    .query("ledgerEntries")
    .withIndex("by_fund", (q: any) => q.eq("fundId", fundId))
    .collect();

  let lifetimeCreditsCents = 0;
  let nonCardDebitsCents = 0;
  for (const entry of entries) {
    if (entry.direction === "credit") {
      lifetimeCreditsCents += entry.amountCents;
    } else if (!PROVIDER_COUNTED_DEBIT_KINDS.has(entry.kind as LedgerKind)) {
      nonCardDebitsCents += entry.amountCents;
    }
  }
  return { lifetimeCreditsCents, nonCardDebitsCents };
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
  return (card.controls as ManagedCardControls | undefined)?.managedLimit === true;
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
