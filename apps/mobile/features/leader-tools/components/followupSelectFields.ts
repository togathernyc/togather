export type SelectCustomFieldDef = {
  slot: string;
  type: string;
  options?: string[];
};

const MULTI_SELECT_DELIMITER = ";";

function normalizeOption(value: string): string {
  return value.trim();
}

export function normalizeSelectOptions(options?: string[]): string[] {
  if (!options) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const option of options) {
    const value = normalizeOption(option);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

export function parseMultiSelectValues(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const values: string[] = [];
  for (const part of raw.split(MULTI_SELECT_DELIMITER)) {
    const value = normalizeOption(part);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

export function serializeMultiSelectValues(values: string[]): string | undefined {
  const normalized = normalizeSelectOptions(values);
  return normalized.length > 0 ? normalized.join(`${MULTI_SELECT_DELIMITER} `) : undefined;
}

export function toggleMultiSelectValue(
  rawValue: string | null | undefined,
  toggledOption: string
): string | undefined {
  const option = normalizeOption(toggledOption);
  if (!option) return serializeMultiSelectValues(parseMultiSelectValues(rawValue));
  const selectedValues = parseMultiSelectValues(rawValue);
  const isSelected = selectedValues.includes(option);
  const nextValues = isSelected
    ? selectedValues.filter((value) => value !== option)
    : [...selectedValues, option];
  return serializeMultiSelectValues(nextValues);
}

export function buildSelectOptionsBySlot<T extends Record<string, unknown>>(
  customFields: SelectCustomFieldDef[],
  members: T[]
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const field of customFields) {
    if (field.type !== "multiselect" && field.type !== "dropdown") continue;

    const configuredOptions = normalizeSelectOptions(field.options);
    if (configuredOptions.length > 0) {
      map.set(field.slot, configuredOptions);
      continue;
    }

    if (field.type === "multiselect") {
      map.set(
        field.slot,
        normalizeSelectOptions(
          members.flatMap((member) =>
            parseMultiSelectValues(String(member[field.slot] ?? ""))
          )
        )
      );
      continue;
    }

    map.set(
      field.slot,
      normalizeSelectOptions(
        members.map((member) => String(member[field.slot] ?? ""))
      )
    );
  }
  return map;
}
