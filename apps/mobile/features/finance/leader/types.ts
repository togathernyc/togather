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

/**
 * Group-fund virtual cards (ADR-032 cards phase). Mirrors
 * `apps/convex/functions/finance/cards.ts`'s `listFundCards`/`getCardDetail`
 * return shapes — loosely typed (string ids) per this file's Convex-free
 * contract for presentational Views.
 */
export type CardStatus = "pending" | "active" | "disabled" | "canceled" | "failed";
export type CardLimitPeriod = "week" | "month" | "charge";

export interface FundCard {
  id: string;
  name: string;
  holderUserId: string;
  holderName: string;
  last4: string;
  status: CardStatus;
  spendLimitCents: number | null;
  limitPeriod: CardLimitPeriod | null;
  createdAt: number;
}

export interface CardActivityEntry {
  id: string;
  amountCents: number;
  description: string;
  status: ExpenseStatus;
  receiptAttached: boolean;
  createdAt: number;
}

export interface CardDetail extends FundCard {
  activity: CardActivityEntry[];
  /** Per-action capability flags — mirror the mutations' own gates, so the UI
   * never renders a control whose mutation would reject this viewer. Freeze =
   * finance_admin OR the card's holder; unfreeze/cancel = finance_admin only. */
  viewerCanFreeze: boolean;
  viewerCanUnfreeze: boolean;
  viewerCanCancel: boolean;
}

/** `listFundCards`' return shape — a fund's card roster plus whether the
 * viewer can issue new cards (finance_admin, incl. the community-admin
 * override — same gate `createFundCard` enforces). */
export interface ListFundCardsResult {
  cards: FundCard[];
  viewerCanManageCards: boolean;
}

/** A fund member eligible to hold a card — cardholder role or higher. */
export interface CardholderCandidate {
  userId: string;
  name: string;
  role: FundRole;
}

export const CARD_LIMIT_PERIOD_LABELS: Record<CardLimitPeriod, string> = {
  week: "week",
  month: "month",
  charge: "charge",
};

/** "$250 / week" / "$500 / month" / "$40 / charge" / "No limit" for card rows. */
export function formatCardLimit(
  spendLimitCents: number | null,
  limitPeriod: CardLimitPeriod | null,
  formatCents: (cents: number) => string,
): string {
  if (spendLimitCents == null || limitPeriod == null) return "No limit";
  return `${formatCents(spendLimitCents)} / ${CARD_LIMIT_PERIOD_LABELS[limitPeriod]}`;
}

/**
 * What actually happens to a card charge, surfaced verbatim on the
 * create-card sheet and card detail.
 *
 * Deliberately describes review AFTER the fact, not authorization: a card
 * swipe settles straight from the fund's bank account, and the only thing
 * that can stop it is the card's own limit (which Increase enforces) or the
 * account balance. The app never gets a vote at swipe time, so this copy
 * must not imply it does — see `apps/convex/functions/finance/cards.ts`.
 */
export const CARD_CHARGE_REVIEW_NOTE =
  "Charges settle straight away, then land in the fund's activity for sign-off. Anything over $200 needs a second approver.";

/**
 * Giving hub balance header + month-to-date stat tiles. Mirrors the fields
 * of `getFundOverview`'s return (`fund.name`, `balanceCents`,
 * `monthToDate.*`) the hub actually renders — kept as a narrow local shape
 * rather than importing the member feature's `FundOverview` type, per this
 * file's Convex-free, cross-feature-import-free contract.
 */
export interface GivingHubBalanceSummary {
  fundName: string;
  balanceCents: number;
  monthDonationsCents: number;
  monthDonationCount: number;
  monthSpentCents: number;
  /**
   * Stripe's processing fees this month. Kept OUT of `monthSpentCents` — the
   * group didn't spend them — but shown, because a fee nobody can see is a
   * gap between "given" and "balance" that leaders can't explain.
   */
  monthFeesCents: number;
}

/** A single "Recent activity" row — mirrors `getFundOverview`'s `activity` entries. */
export interface GivingHubActivityEntry {
  id: string;
  kind: string;
  amountCents: number;
  direction: "credit" | "debit";
  createdAt: number;
  donorName?: string | null;
}
