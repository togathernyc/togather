/**
 * Money formatting for group-giving screens (ADR-032).
 *
 * All backend amounts are integer cents; format at the edge, never store
 * floats. Shared by member (give/fund) and leader (roles/approvals) surfaces.
 */

export function formatCents(amountCents: number): string {
  const sign = amountCents < 0 ? "-" : "";
  const abs = Math.abs(amountCents);
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}

/** "+$50.00" / "−$42.18" for ledger activity rows. */
export function formatSignedCents(
  amountCents: number,
  direction: "credit" | "debit",
): string {
  return `${direction === "credit" ? "+" : "−"}${formatCents(amountCents)}`;
}
