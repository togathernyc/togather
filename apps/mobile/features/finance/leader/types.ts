/**
 * Shared types for the leader/community-admin group-giving surfaces
 * (ADR-032 §2 community onboarding, §4 permissions).
 *
 * These mirror the backend shapes in `apps/convex/functions/finance/*`
 * loosely typed (string ids) so the presentational Views stay framework-
 * agnostic — no `Id<"...">` branding here, that conversion happens in the
 * data-wrapper Screens.
 */

/** Fund-scoped permission role, separate from group leader/member roles. */
export type FundRole = "finance_admin" | "manager" | "cardholder";

export interface FinanceUserSummary {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  profileImage?: string | null;
}

export type ExpenseStatus = "pending" | "approved" | "denied" | "paid";
export type ExpenseKind = "card_charge" | "reimbursement";

export interface GivingExpense {
  id: string;
  amountCents: number;
  kind: ExpenseKind;
  description: string;
  status: ExpenseStatus;
  receiptUrl?: string | null;
  approverId?: string | null;
  secondApproverId?: string | null;
  increaseTransferId?: string | null;
  createdAt: number;
  updatedAt: number;
  submitter: FinanceUserSummary;
}

export interface FundRoleRow {
  id: string;
  userId: string;
  role: FundRole;
  grantedBy: string;
  grantedAt: number;
  revokedAt?: number | null;
  isActive: boolean;
  user: FinanceUserSummary;
}

export type OnboardingStatus =
  | "collecting"
  | "verifying"
  | "live"
  | "stripe_blocked"
  | "increase_blocked";

export interface FinanceOnboardingStatus {
  formSubmitted: boolean;
  paymentsVerified: boolean;
  bankAccountsReady: boolean;
  onboardingStatus: OnboardingStatus;
  blockedReason?: string | null;
}

export const FUND_ROLE_LABELS: Record<FundRole, string> = {
  finance_admin: "Finance admin",
  manager: "Manager",
  cardholder: "Cardholder",
};

/** Backend guardrails surfaced verbatim to admins granting/reviewing roles. */
export const GIVING_GUARDRAILS_NOTE =
  "Approvals over $200 need a second approver. You can't approve your own requests.";
