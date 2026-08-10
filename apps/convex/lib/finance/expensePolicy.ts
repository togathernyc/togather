/**
 * Expense / reimbursement approval policy (ADR-032 §3-4) — pure, no `ctx`.
 *
 * Every rule here is unit-tested in isolation (`__tests__/finance-expenses.test.ts`)
 * and then re-verified end-to-end through the actual mutations in
 * `functions/finance/expenses.ts`, so the guardrails the ADR calls out
 * ("no self-approval ever", "a configurable two-approver threshold") live in
 * exactly one place and can't drift between the pure check and the mutation
 * that enforces it.
 */

import type { Id } from "../../_generated/dataModel";
import { FUND_ROLE_ORDER, type FundRole } from "../helpers";

// ============================================================================
// Threshold
// ============================================================================

/**
 * Expenses at or above this amount require TWO distinct manager+ approvals
 * before they become "approved" (ADR-032 §4: "a configurable two-approver
 * threshold (default $200)"). This is the default for every fund today —
 * there is no per-fund override yet. When one is added (a `fundRoles`-
 * adjacent settings row, most likely), thread it through `canApprove` /
 * `nextStatusOnApproval` as an optional argument that falls back to this
 * constant, rather than replacing the constant outright.
 */
export const SECOND_APPROVAL_THRESHOLD_CENTS = 20_000;

/** Reimbursements must be at least $0.01 and at most $5,000. */
export const MIN_EXPENSE_AMOUNT_CENTS = 1;
export const MAX_EXPENSE_AMOUNT_CENTS = 500_000;

function fundRoleRank(role: FundRole): number {
  return FUND_ROLE_ORDER.indexOf(role);
}

export interface PolicyDecision {
  allowed: boolean;
  /** Present whenever `allowed` is false — safe to surface to the user. */
  reason?: string;
}

// ============================================================================
// canSubmit
// ============================================================================

export interface SubmitCheckArgs {
  amountCents: number;
  kind: "card_charge" | "reimbursement";
  receiptKey?: string;
}

/**
 * Whether a member can submit an expense with these fields. Reimbursements
 * always require a receipt at submission time (card charges get one later,
 * via the receipt-nudge flow — not this path, see submitExpense).
 */
export function canSubmit(args: SubmitCheckArgs): PolicyDecision {
  const { amountCents, kind, receiptKey } = args;

  if (
    !Number.isInteger(amountCents) ||
    amountCents < MIN_EXPENSE_AMOUNT_CENTS ||
    amountCents > MAX_EXPENSE_AMOUNT_CENTS
  ) {
    return {
      allowed: false,
      reason: `Amount must be between ${MIN_EXPENSE_AMOUNT_CENTS} and ${MAX_EXPENSE_AMOUNT_CENTS} cents`,
    };
  }

  if (kind === "reimbursement" && !receiptKey) {
    return {
      allowed: false,
      reason: "A receipt is required to submit a reimbursement",
    };
  }

  return { allowed: true };
}

// ============================================================================
// canApprove
// ============================================================================

export interface ExpenseForApproval {
  submitterId: Id<"users">;
  amountCents: number;
  status: "pending" | "approved" | "denied" | "paid";
  approverId?: Id<"users">;
  secondApproverId?: Id<"users">;
}

export interface CanApproveArgs {
  expense: ExpenseForApproval;
  approverUserId: Id<"users">;
  /**
   * The approver's effective fund role. Pass `null` for a caller with no
   * role at all — including a plain member. A community admin who has no
   * `fundRoles` row of their own should be passed as `"finance_admin"` (the
   * caller resolves that override before calling in; this function only
   * reasons about ranks, not about who counts as an admin).
   */
  approverRole: FundRole | null;
}

/**
 * Whether `approverUserId` may approve `expense` right now.
 *
 * The self-approval rule is absolute: a submitter can NEVER approve their
 * own expense, even as a finance_admin or (effectively) a community admin —
 * ADR-032 §4 "no self-approval ever" is a hard rule, not a permission you can
 * be senior enough to bypass.
 */
export function canApprove(args: CanApproveArgs): PolicyDecision {
  const { expense, approverUserId, approverRole } = args;

  if (expense.submitterId === approverUserId) {
    return { allowed: false, reason: "You cannot approve your own expense" };
  }

  if (expense.status !== "pending") {
    return {
      allowed: false,
      reason: `Expense is already ${expense.status}`,
    };
  }

  if (!approverRole || fundRoleRank(approverRole) < fundRoleRank("manager")) {
    return {
      allowed: false,
      reason: "Approving requires manager access or higher",
    };
  }

  const needsSecondApproval =
    expense.amountCents >= SECOND_APPROVAL_THRESHOLD_CENTS;
  if (needsSecondApproval && expense.approverId !== undefined) {
    // Second-approval step: the second approver must be a person distinct
    // from the first (distinctness from the submitter was already checked
    // above, since the submitter can never be the first approver either).
    if (expense.approverId === approverUserId) {
      return {
        allowed: false,
        reason: "A second, different approver is required for this amount",
      };
    }
  }

  return { allowed: true };
}

// ============================================================================
// nextStatusOnApproval
// ============================================================================

export interface ApprovalOutcome {
  status: "approved" | "pending";
  approverId: Id<"users">;
  secondApproverId?: Id<"users">;
}

/**
 * Compute the expense's next state once `approverUserId`'s approval has
 * already passed `canApprove`. Below the threshold, one approval is enough.
 * At/above the threshold, the first approval records `approverId` and holds
 * status at "pending"; the second, distinct approval fills `secondApproverId`
 * and flips status to "approved".
 */
export function nextStatusOnApproval(args: {
  expense: Pick<ExpenseForApproval, "amountCents" | "approverId">;
  approverUserId: Id<"users">;
}): ApprovalOutcome {
  const { expense, approverUserId } = args;
  const needsSecondApproval =
    expense.amountCents >= SECOND_APPROVAL_THRESHOLD_CENTS;

  if (!needsSecondApproval) {
    return { status: "approved", approverId: approverUserId };
  }

  if (expense.approverId === undefined) {
    // First approval recorded; still pending until a second, distinct
    // approver signs off.
    return { status: "pending", approverId: approverUserId };
  }

  // Second distinct approver completes the approval — keep the original
  // first approver on record.
  return {
    status: "approved",
    approverId: expense.approverId,
    secondApproverId: approverUserId,
  };
}

// ============================================================================
// canPay
// ============================================================================

export interface ExpenseForPayout {
  status: "pending" | "approved" | "denied" | "paid";
  kind: "card_charge" | "reimbursement";
  receiptKey?: string;
}

/**
 * Whether a reimbursement is ready for the ACH payout job. Card-charge
 * expenses never pay out this way (the money already left via the card), so
 * only "approved" reimbursements with a receipt on file qualify.
 */
export function canPay(expense: ExpenseForPayout): boolean {
  return (
    expense.status === "approved" &&
    expense.kind === "reimbursement" &&
    !!expense.receiptKey
  );
}
