/**
 * Automation rule condition evaluation.
 *
 * Pure function extracted for testability — determines whether a
 * landing-page automation rule's condition is met by submitted custom
 * field values.
 */

export interface AutomationCondition {
  field: string;
  operator: string;
  value?: string;
}

export interface CustomFieldEntry {
  slot?: string;
  label: string;
  value: any;
  includeInNotes?: boolean;
}

/**
 * Evaluate a condition against submitted custom field values.
 */
export function evaluateCondition(
  condition: AutomationCondition,
  customFields: CustomFieldEntry[]
): boolean {
  const field = customFields.find(
    (f) => f.slot === condition.field || f.label === condition.field
  );

  if (!field) {
    // Field not submitted — only is_false should match (missing = not set = falsy)
    return condition.operator === "is_false";
  }

  const fieldValue = field.value;

  switch (condition.operator) {
    case "equals":
      return String(fieldValue) === condition.value;
    case "not_equals":
      if (condition.value === undefined || condition.value === "") return false;
      return String(fieldValue) !== condition.value;
    case "contains":
      if (condition.value === undefined || condition.value === "") return false;
      return String(fieldValue)
        .toLowerCase()
        .includes(condition.value.toLowerCase());
    case "is_true":
      return fieldValue === true;
    case "is_false":
      return (
        fieldValue === false ||
        fieldValue === undefined ||
        fieldValue === null
      );
    default:
      return false;
  }
}
