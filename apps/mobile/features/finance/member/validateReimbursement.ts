/**
 * Pure validation for the "Get reimbursed" sheet (ADR-032 §3). No Convex, no
 * React — safe to import from the presentational View and to unit test
 * directly.
 */
import { parseDollarsToCents } from "./amount";

export interface ReimbursementInput {
  amountText: string;
  description: string;
  /** True once the receipt photo has finished uploading to R2. */
  receiptReady: boolean;
}

export interface ReimbursementValidation {
  valid: boolean;
  /** Why submit is disabled, or `null` when `valid`. */
  reason: string | null;
  amountCents: number | null;
}

export function validateReimbursement({
  amountText,
  description,
  receiptReady,
}: ReimbursementInput): ReimbursementValidation {
  const amountCents = parseDollarsToCents(amountText);
  if (!amountCents) {
    return { valid: false, reason: "Enter an amount", amountCents: null };
  }
  if (!description.trim()) {
    return { valid: false, reason: "Add a short description", amountCents };
  }
  if (!receiptReady) {
    return { valid: false, reason: "Attach a receipt photo", amountCents };
  }
  return { valid: true, reason: null, amountCents };
}
