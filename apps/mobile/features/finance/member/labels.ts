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
  approved: "Approved",
  denied: "Denied",
  paid: "Paid",
};

/** "Pending" / "Approved" / "Denied" / "Paid" for the my-reimbursements list. */
export function formatExpenseStatus(status: string): string {
  return EXPENSE_STATUS_LABELS[status as ExpenseStatus] ?? status;
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
