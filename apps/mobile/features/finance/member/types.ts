/**
 * Plain data shapes for the member-facing group-giving screens (ADR-032).
 * Mirror the return shapes of `functions/finance/giving.ts` and
 * `functions/finance/expenses.ts` — kept here (rather than importing the
 * generated Convex `api` types) so presentational View components stay
 * Convex-free per the verification-harness contract.
 */

export interface FundActivityEntry {
  id: string;
  kind: string;
  amountCents: number;
  direction: "credit" | "debit";
  createdAt: number;
  donorName?: string;
}

export interface FundPeriodTotals {
  donationsCents: number;
  /**
   * What the group chose to spend — card swipes, reimbursements, transfers,
   * sweeps. Deliberately excludes processing fees and refunds; see
   * `summarizePeriod` in apps/convex/functions/finance/giving.ts.
   */
  spentCents: number;
  /** Stripe's processing fees, shown as their own line rather than as spend. */
  feesCents: number;
  refundedCents: number;
  donationCount: number;
}

export interface FundOverview {
  fund: { id: string; name: string; status: string };
  balanceCents: number;
  monthToDate: FundPeriodTotals;
  yearToDate: FundPeriodTotals;
  activity: FundActivityEntry[];
  viewerCanSeeDonorNames: boolean;
}

export interface MyExpense {
  id: string;
  amountCents: number;
  kind: "card_charge" | "reimbursement";
  // Optional server-side (a card-charge expense may start with no
  // description — see apps/convex/schema.ts `expenses.description`), though
  // member-submitted reimbursements always send one (`submitExpense` requires
  // it).
  description?: string;
  status: "pending" | "approved" | "denied" | "paid";
  receiptUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface GivingContext {
  fundId: string;
  fundName: string;
  communityLegalName: string;
  suggestedAmountsCents: readonly number[];
  givingLive: boolean;
}

/** Return shape of `createDonationCheckoutSession` — the hosted Stripe
 * Checkout page the give sheet launches (ADR-032 §3/§7 Phase 1). */
export interface CheckoutSession {
  url: string;
  sessionId: string;
}
