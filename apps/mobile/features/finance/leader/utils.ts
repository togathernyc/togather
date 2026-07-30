import type { FinanceUserSummary } from "./types";

/** Best-effort display name for a finance user summary. */
export function financeDisplayName(user: FinanceUserSummary | null | undefined): string {
  if (!user) return "Unknown";
  if (user.displayName) return user.displayName;
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return full || "Unknown";
}

const EIN_PATTERN = /^\d{2}-\d{7}$/;

/** ADR-032 §2 intake form: EIN must be NN-NNNNNNN. */
export function isValidEin(value: string): boolean {
  return EIN_PATTERN.test(value.trim());
}

/** Auto-inserts the EIN's hyphen as the admin types digits. */
export function formatEinInput(text: string): string {
  const digits = text.replace(/\D/g, "").slice(0, 9);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}
