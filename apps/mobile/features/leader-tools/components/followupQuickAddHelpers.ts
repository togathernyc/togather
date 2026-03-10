import type { CustomFieldDef } from "./ColumnPickerModal";

export type QuickAddFieldState = {
  firstName: string;
  phone: string;
  lastName: string;
  email: string;
  zipCode: string;
  dateOfBirth: string;
  notes: string;
  status?: string;
  assigneeId?: string;
};

export function validateQuickAddRequiredFields(firstName: string, phone: string): string[] {
  const missing: string[] = [];
  if (!firstName.trim()) missing.push("first name");
  if (!phone.trim()) missing.push("phone number");
  return missing;
}

export function buildQuickAddCustomFieldValues(
  customFields: CustomFieldDef[],
  values: Record<string, string | string[] | boolean | undefined>
): Record<string, string> | undefined {
  const output: Record<string, string> = {};

  for (const field of customFields) {
    const rawValue = values[field.slot];
    if (rawValue === undefined) continue;

    if (field.type === "boolean") {
      if (typeof rawValue === "boolean") {
        output[field.slot] = rawValue ? "true" : "false";
      }
      continue;
    }

    if (field.type === "multiselect") {
      if (!Array.isArray(rawValue)) continue;
      const normalized = rawValue
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      if (normalized.length > 0) {
        output[field.slot] = normalized.join("; ");
      }
      continue;
    }

    if (Array.isArray(rawValue) || typeof rawValue === "boolean") continue;
    const value = String(rawValue).trim();
    if (value.length > 0) {
      output[field.slot] = value;
    }
  }

  return Object.keys(output).length > 0 ? output : undefined;
}
