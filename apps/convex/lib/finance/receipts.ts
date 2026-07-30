/**
 * Donation receipt content (ADR-032 §3, Phase 1).
 *
 * Pure string builder — no Convex ctx, no network calls — so the content
 * (amount formatting, the required charitable-receipt language, EIN/legal
 * name inclusion) is unit-testable in isolation from the send path. The
 * caller (functions/finance/giving.ts's `sendDonationReceipt` action) is
 * responsible for actually emailing this via Resend.
 *
 * IRS Publication 1771 requires a written acknowledgment for any single
 * contribution of $250+ to state the donor received no goods or services in
 * exchange (or describe what they did receive). Since Togather never gives
 * donors anything in return for a gift, we include the standard "no goods or
 * services" sentence on every receipt regardless of amount — simpler than
 * branching on a threshold, and it never hurts to over-disclose.
 */

export interface DonationReceiptInput {
  /** The community's legal name, as filed with the IRS — receipts issue from this, not the community's display name. */
  legalName: string;
  ein: string;
  /** Falls back to a generic salutation upstream for anonymous/guest gifts. */
  donorName: string;
  amountCents: number;
  /** Donor's voluntary fee-cover add-on (ADR-031) — called out as its own line when present. */
  feeCoverCents: number;
  fundName: string;
  dateMs: number;
}

export interface DonationReceiptEmail {
  subject: string;
  html: string;
  text: string;
}

const NO_GOODS_OR_SERVICES_SENTENCE =
  "No goods or services were provided in exchange for this contribution.";

/** Formats integer cents as "$X.XX". */
export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatReceiptDate(dateMs: number): string {
  return new Date(dateMs).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build the subject/html/text for a donation receipt. Totals `amountCents +
 * feeCoverCents` — the fee-cover add-on is still a charitable gift the donor
 * made and belongs in the receipted total, just called out as its own line
 * so the donor can see what they chose to add.
 */
export function buildDonationReceiptEmail(
  input: DonationReceiptInput,
): DonationReceiptEmail {
  const totalCents = input.amountCents + input.feeCoverCents;
  const formattedTotal = formatUsd(totalCents);
  const formattedDate = formatReceiptDate(input.dateMs);
  const subject = `Your donation receipt from ${input.legalName}`;

  const feeCoverLine =
    input.feeCoverCents > 0
      ? `This total includes a voluntary ${formatUsd(input.feeCoverCents)} contribution to help cover processing fees.`
      : undefined;

  const text = [
    input.legalName,
    `EIN: ${input.ein}`,
    "",
    `Thank you, ${input.donorName}, for your gift of ${formattedTotal} to ${input.fundName} on ${formattedDate}.`,
    feeCoverLine,
    "",
    NO_GOODS_OR_SERVICES_SENTENCE,
    "",
    "Please keep this receipt for your tax records.",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");

  const html = [
    "<div>",
    `  <p><strong>${escapeHtml(input.legalName)}</strong><br/>EIN: ${escapeHtml(input.ein)}</p>`,
    `  <p>Thank you, ${escapeHtml(input.donorName)}, for your gift of <strong>${formattedTotal}</strong> to <strong>${escapeHtml(input.fundName)}</strong> on ${formattedDate}.</p>`,
    feeCoverLine ? `  <p>${escapeHtml(feeCoverLine)}</p>` : "",
    `  <p>${NO_GOODS_OR_SERVICES_SENTENCE}</p>`,
    "  <p>Please keep this receipt for your tax records.</p>",
    "</div>",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { subject, html, text };
}
