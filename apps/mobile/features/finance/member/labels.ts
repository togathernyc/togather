/**
 * Display labels for group-giving member surfaces (ADR-032).
 *
 * Pure string/lookup helpers only — no Convex, no React — so they're cheap
 * to unit test and safe to import from presentational View components.
 */

/** Mirrors `ledgerEntries.kind` in apps/convex/schema.ts. */
export type LedgerKind =
  | "donation"
  | "allocation"
  | "card_capture"
  | "refund"
  | "reimbursement"
  | "transfer"
  | "sweep"
  | "fee";

/** Mirrors `expenses.status` in apps/convex/schema.ts. */
export type ExpenseStatus = "pending" | "approved" | "denied" | "paid";

const LEDGER_KIND_LABELS: Record<LedgerKind, string> = {
  donation: "Donation",
  allocation: "Allocation",
  card_capture: "Card purchase",
  refund: "Refund",
  reimbursement: "Reimbursement",
  transfer: "Transfer",
  sweep: "Sweep",
  fee: "Fee",
};

/** "Donation" / "Card purchase" / "Reimbursement" / "Transfer" / ... for activity rows. */
export function formatLedgerKind(kind: string): string {
  return LEDGER_KIND_LABELS[kind as LedgerKind] ?? kind;
}

const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  pending: "Pending",
  // NOT "Approved". Approval only clears the request for payment — it moves no
  // money. The automated ACH payout is still a stub (`getPayoutDestination` in
  // functions/finance/expenses.ts always returns null, so `payReimbursement`
  // short-circuits), which means an approved row NEVER advances on its own: a
  // treasurer has to send the money out of band and have it recorded as paid.
  // A bare "Approved" badge reads as "settled, money on the way", so the badge
  // itself has to name the state the submitter is actually in.
  approved: "Awaiting payout",
  denied: "Denied",
  paid: "Paid",
};

/** "Pending" / "Awaiting payout" / "Denied" / "Paid" for the my-reimbursements list. */
export function formatExpenseStatus(status: string): string {
  return EXPENSE_STATUS_LABELS[status as ExpenseStatus] ?? status;
}

/**
 * Plain-language sub-line for a reimbursement row, or `undefined` when the
 * badge already says everything true about the state.
 *
 * Only the approved-but-unpaid state needs one: it's the one status a member
 * can misread as "I've been paid". Deliberately promises no date — there is no
 * payout schedule to promise (see `EXPENSE_STATUS_LABELS.approved`).
 */
export function expenseStatusNote(status: string): string | undefined {
  if ((status as ExpenseStatus) === "approved") {
    return "Approved — a treasurer still needs to send you the money. It'll say Paid here once they have.";
  }
  return undefined;
}

/** Badge `variant` per status — mirrors components/ui/Badge.tsx's variant union. */
export function expenseStatusBadgeVariant(
  status: string,
): "warning" | "info" | "danger" | "success" | "secondary" {
  switch (status as ExpenseStatus) {
    case "pending":
      return "warning";
    case "approved":
      return "info";
    case "denied":
      return "danger";
    case "paid":
      return "success";
    default:
      return "secondary";
  }
}
