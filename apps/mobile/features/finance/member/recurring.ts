/**
 * Monthly-giving display helpers (ADR-032 recurring gifts).
 *
 * Pure functions — no Convex, no React — so the fund dashboard's monthly box,
 * the give sheet's frequency notice and the manage screen all phrase the same
 * gift the same way, and every phrasing rule is testable without rendering.
 *
 * The amount these format is the GIFT (`amountCents`), never the charge
 * (`amountCents + feeCoverCents`). A donor who turned fee-cover on chose to
 * give $25 and to pay Stripe's cut on top; a box that read "$25.79 monthly"
 * would quietly restate their gift as a number they never picked. The fee is
 * shown as its own line on the manage screen instead.
 */
import { formatCents } from "../format";

/** Lifecycle of a `recurringDonations` row, mirroring the Convex schema. */
export type RecurringStatus = "pending" | "active" | "past_due" | "canceled";

/**
 * Return shape of `getRecurringForFund` / `listMyRecurringDonations`.
 * Duplicated here (rather than imported from the generated Convex types) so
 * the presentational Views stay Convex-free — same contract as `types.ts`.
 */
export interface RecurringSummary {
  id: string;
  fundId: string;
  groupId: string | null;
  fundName: string;
  amountCents: number;
  feeCoverCents: number;
  status: RecurringStatus;
  /** Epoch ms the current period ends — i.e. when the next gift is charged. */
  currentPeriodEnd: number | null;
  createdAt: number;
}

/**
 * Whether a gift is actually collecting, and therefore worth a box on the
 * fund dashboard.
 *
 * `pending` means the donor is still inside Stripe Checkout and nothing has
 * been charged — telling them "you give $25 monthly" then would be a lie the
 * next screen contradicts. `canceled` has nothing left to manage. Matches the
 * backend's own `LIVE_RECURRING_STATUSES`.
 */
export function isLiveRecurring(
  recurring: RecurringSummary | null | undefined,
): recurring is RecurringSummary {
  return (
    !!recurring &&
    (recurring.status === "active" || recurring.status === "past_due")
  );
}

/** "You give $25.00 monthly" — the dashboard box's title. */
export function formatMonthlyTitle(amountCents: number): string {
  return `You give ${formatCents(amountCents)} monthly`;
}

/** "$25.00/month" — the give sheet's already-giving notice. */
export function formatMonthlyRate(amountCents: number): string {
  return `${formatCents(amountCents)}/month`;
}

/**
 * "Sep 1" — the same short, absolute date the fund's activity rows use. Never
 * a relative "in 12 days": a billing date is a fact, and a countdown drifts
 * the moment the screen is left open.
 *
 * `null` when Stripe hasn't reported a period yet (a gift bound seconds ago),
 * so callers can drop the line rather than print "Next gift Invalid Date".
 */
export function formatRecurringDate(timestamp: number | null): string | null {
  if (timestamp === null || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The dashboard box's sub-line.
 *
 * A `past_due` gift says what is wrong and what to do about it instead of the
 * next date: there IS no next date worth promising while the card is failing,
 * and "Next gift Sep 1" over a declined payment is the one sentence that would
 * stop a donor from fixing it.
 */
export function formatMonthlySubtitle(recurring: RecurringSummary): string {
  if (recurring.status === "past_due") {
    return "Payment issue — tap to fix";
  }
  const next = formatRecurringDate(recurring.currentPeriodEnd);
  return next ? `Next gift ${next} · Manage or cancel` : "Manage or cancel";
}

/** "On · +$1.05" / "Off" — the manage screen's fee-cover row value. */
export function formatFeeCoverValue(feeCoverCents: number): string {
  return feeCoverCents > 0 ? `On · +${formatCents(feeCoverCents)}` : "Off";
}
