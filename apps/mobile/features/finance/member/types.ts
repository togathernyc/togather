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
  spentCents: number;
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
  communityLegalName: string;
  suggestedAmountsCents: readonly number[];
  givingLive: boolean;
}

export interface DonationIntent {
  clientSecret: string;
  paymentIntentId: string;
}
