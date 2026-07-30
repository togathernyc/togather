/**
 * Group giving ledger core (ADR-032).
 *
 * `ledgerEntries` is append-only: every donation, allocation, card capture,
 * refund, reimbursement, transfer, sweep, and fee is written once and never
 * mutated or deleted. A fund's balance is always a *derivation* of its
 * entries (`deriveBalance`); `funds.balanceCents` is only a cache of that
 * derivation, refreshed on every write by `postLedgerEntry`, so reads stay
 * O(1) without ever becoming the source of truth.
 *
 * The ledger itself is also NOT the source of truth for real money — Increase
 * (the bank) is. ADR-032 defines the invariant we reconcile nightly and alarm
 * on drift:
 *
 *   funds.balanceCents === Increase Account balance + pending allocations
 *
 * `checkInvariant` below is the pure comparison the nightly reconcile job
 * runs per fund. Keeping the ledger honest (idempotent writes, no in-place
 * edits) is what caps the blast radius of a bookkeeping bug: a wrong ledger
 * entry can only ever misattribute money the bank still actually holds.
 */

import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { now } from "../utils";

// ============================================================================
// Kinds / directions
// ============================================================================

/** Every reason money moves through a fund (ADR-032 §5). */
export const LEDGER_KINDS = [
  "donation",
  "allocation",
  "card_capture",
  "refund",
  "reimbursement",
  "transfer",
  "sweep",
  "fee",
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const LEDGER_DIRECTIONS = ["credit", "debit"] as const;
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];

/**
 * Entry kinds still allowed while a fund is "frozen" (e.g. mid group-archive
 * or a manager-initiated freeze). A frozen fund blocks new spend/give
 * activity but must still be able to sweep its remainder out and settle any
 * transfer/refund already in flight — see ADR-032 §3 "Group archive".
 */
const FROZEN_ALLOWED_KINDS: ReadonlySet<LedgerKind> = new Set([
  "sweep",
  "transfer",
  "refund",
]);

// ============================================================================
// postLedgerEntry
// ============================================================================

export interface PostLedgerEntryArgs {
  fundId: Id<"funds">;
  direction: LedgerDirection;
  amountCents: number;
  kind: LedgerKind;
  /** Dedupe key — every external write (webhook, scheduler retry) carries one. */
  idempotencyKey: string;
  stripeObjectId?: string;
  increaseObjectId?: string;
  counterpartFundId?: Id<"funds">;
  actorUserId?: Id<"users">;
}

/**
 * Write one ledger entry and update the fund's cached balance.
 *
 * Idempotent: if an entry with the same `idempotencyKey` already exists, this
 * returns its id WITHOUT inserting a second row or touching the balance
 * again — the append-only dedupe that makes it safe to retry a webhook or
 * scheduled job. Throws if the fund doesn't exist, is closed, or is frozen
 * for a kind other than sweep/transfer/refund.
 */
export async function postLedgerEntry(
  ctx: MutationCtx,
  entry: PostLedgerEntryArgs,
): Promise<Id<"ledgerEntries">> {
  const existing = await ctx.db
    .query("ledgerEntries")
    .withIndex("by_idempotencyKey", (q) =>
      q.eq("idempotencyKey", entry.idempotencyKey),
    )
    .first();
  if (existing) {
    return existing._id;
  }

  if (!Number.isInteger(entry.amountCents) || entry.amountCents <= 0) {
    throw new Error(
      `postLedgerEntry: amountCents must be a positive integer, got ${entry.amountCents} — direction, not sign, encodes debit vs credit`,
    );
  }

  const fund = await ctx.db.get(entry.fundId);
  if (!fund) {
    throw new Error(`postLedgerEntry: fund ${entry.fundId} not found`);
  }
  if (fund.status === "closed") {
    throw new Error(`postLedgerEntry: fund ${entry.fundId} is closed`);
  }
  if (fund.status === "frozen" && !FROZEN_ALLOWED_KINDS.has(entry.kind)) {
    throw new Error(
      `postLedgerEntry: fund ${entry.fundId} is frozen — "${entry.kind}" entries are not allowed while frozen`,
    );
  }

  const ledgerEntryId = await ctx.db.insert("ledgerEntries", {
    fundId: entry.fundId,
    communityId: fund.communityId,
    direction: entry.direction,
    amountCents: entry.amountCents,
    kind: entry.kind,
    stripeObjectId: entry.stripeObjectId,
    increaseObjectId: entry.increaseObjectId,
    counterpartFundId: entry.counterpartFundId,
    idempotencyKey: entry.idempotencyKey,
    actorUserId: entry.actorUserId,
    createdAt: now(),
  });

  const delta =
    entry.direction === "credit" ? entry.amountCents : -entry.amountCents;
  await ctx.db.patch(entry.fundId, { balanceCents: fund.balanceCents + delta });

  return ledgerEntryId;
}

// ============================================================================
// postPairedTransfer
// ============================================================================

export interface PostPairedTransferArgs {
  fromFundId: Id<"funds">;
  toFundId: Id<"funds">;
  amountCents: number;
  kind: "transfer" | "sweep";
  /** Base idempotency key — the debit/credit legs suffix ":debit"/":credit". */
  idempotencyKey: string;
  actorUserId?: Id<"users">;
  increaseObjectId?: string;
}

/**
 * Move money between two funds (a leader-initiated transfer, or the sweep
 * that drains a fund on group archive — ADR-032 §3). Writes a debit on
 * `fromFundId` and a matching credit on `toFundId`, sharing a common
 * idempotency base so a retry re-dedupes both legs together rather than
 * risking one leg posting twice while the other is skipped.
 */
export async function postPairedTransfer(
  ctx: MutationCtx,
  args: PostPairedTransferArgs,
): Promise<{ debitId: Id<"ledgerEntries">; creditId: Id<"ledgerEntries"> }> {
  const debitId = await postLedgerEntry(ctx, {
    fundId: args.fromFundId,
    direction: "debit",
    amountCents: args.amountCents,
    kind: args.kind,
    idempotencyKey: `${args.idempotencyKey}:debit`,
    counterpartFundId: args.toFundId,
    actorUserId: args.actorUserId,
    increaseObjectId: args.increaseObjectId,
  });
  const creditId = await postLedgerEntry(ctx, {
    fundId: args.toFundId,
    direction: "credit",
    amountCents: args.amountCents,
    kind: args.kind,
    idempotencyKey: `${args.idempotencyKey}:credit`,
    counterpartFundId: args.fromFundId,
    actorUserId: args.actorUserId,
    increaseObjectId: args.increaseObjectId,
  });

  return { debitId, creditId };
}

// ============================================================================
// Pure helpers (no ctx — unit-testable in isolation)
// ============================================================================

/**
 * Sum a set of ledger entries into a balance: credits add, debits subtract.
 * This is the derivation `funds.balanceCents` caches — never the reverse.
 */
export function deriveBalance(
  entries: Array<Pick<Doc<"ledgerEntries">, "direction" | "amountCents">>,
): number {
  return entries.reduce(
    (sum, entry) =>
      sum + (entry.direction === "credit" ? entry.amountCents : -entry.amountCents),
    0,
  );
}

export interface InvariantCheck {
  ok: boolean;
  driftCents: number;
}

/**
 * The ADR-032 nightly-reconcile invariant for a single fund:
 *
 *   ledgerBalanceCents === increaseBalanceCents + pendingAllocationCents
 *
 * Returns the signed drift (positive = our ledger thinks there's more money
 * than the bank + in-flight allocations account for) so the alarm can report
 * direction, not just "mismatch".
 */
export function checkInvariant(
  ledgerBalanceCents: number,
  increaseBalanceCents: number,
  pendingAllocationCents: number,
): InvariantCheck {
  const driftCents =
    ledgerBalanceCents - (increaseBalanceCents + pendingAllocationCents);
  return { ok: driftCents === 0, driftCents };
}
