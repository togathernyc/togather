/**
 * Unit tests for automation rule condition evaluation.
 *
 * Tests the `evaluateCondition` pure function which determines whether
 * a landing-page automation rule's condition is met by the submitted
 * custom field values.
 */

import { expect, test, describe } from "vitest";
import { evaluateCondition } from "../lib/automationRules";
import type { AutomationCondition, CustomFieldEntry } from "../lib/automationRules";

// ============================================================================
// Helpers
// ============================================================================

function makeCondition(
  field: string,
  operator: string,
  value?: string
): AutomationCondition {
  return { field, operator, value };
}

function makeField(
  label: string,
  value: any,
  slot?: string
): CustomFieldEntry {
  return { slot, label, value };
}

// ============================================================================
// Field matching
// ============================================================================

describe("evaluateCondition – field matching", () => {
  test("matches field by slot name", () => {
    const fields = [makeField("Where do you live?", "Brooklyn", "customText2")];
    const cond = makeCondition("customText2", "equals", "Brooklyn");
    expect(evaluateCondition(cond, fields)).toBe(true);
  });

  test("matches field by label when slot is undefined", () => {
    const fields = [makeField("Fount Kids/Youth", true)];
    const cond = makeCondition("Fount Kids/Youth", "is_true");
    expect(evaluateCondition(cond, fields)).toBe(true);
  });

  test("matches field by label when slot does not match", () => {
    const fields = [makeField("Interest Area", "Music", "customText1")];
    const cond = makeCondition("Interest Area", "equals", "Music");
    expect(evaluateCondition(cond, fields)).toBe(true);
  });

  test("returns false when neither slot nor label matches", () => {
    const fields = [makeField("Some Field", "value", "customText1")];
    const cond = makeCondition("nonexistent", "equals", "value");
    expect(evaluateCondition(cond, fields)).toBe(false);
  });

  test("returns false when customFields array is empty", () => {
    const cond = makeCondition("customText2", "equals", "test");
    expect(evaluateCondition(cond, [])).toBe(false);
  });
});

// ============================================================================
// "contains" operator
// ============================================================================

describe("evaluateCondition – contains operator", () => {
  test("returns true for exact case-insensitive match", () => {
    const fields = [makeField("Location", "long island city", "customText2")];
    const cond = makeCondition("customText2", "contains", "long island city");
    expect(evaluateCondition(cond, fields)).toBe(true);
  });

  test("returns true for case-insensitive partial match", () => {
    const fields = [
      makeField("Location", "I live in Long Island City", "customText2"),
    ];
    const cond = makeCondition("customText2", "contains", "long island city");
    expect(evaluateCondition(cond, fields)).toBe(true);
  });

  test("returns false when string does not contain value", () => {
    const fields = [makeField("Location", "Brooklyn", "customText2")];
    const cond = makeCondition("customText2", "contains", "long island city");
    expect(evaluateCondition(cond, fields)).toBe(false);
  });

  test("returns false when condition value is empty string", () => {
    const fields = [makeField("Location", "Brooklyn", "customText2")];
    const cond = makeCondition("customText2", "contains", "");
    expect(evaluateCondition(cond, fields)).toBe(false);
  });

  test("returns false when condition value is undefined", () => {
    const fields = [makeField("Location", "Brooklyn", "customText2")];
    const cond = makeCondition("customText2", "contains", undefined);
    expect(evaluateCondition(cond, fields)).toBe(false);
  });
});

// ============================================================================
// "equals" operator
// ============================================================================

describe("evaluateCondition – equals operator", () => {
  test("returns true for exact string match", () => {
    const fields = [makeField("Campus", "North", "customText1")];
    const cond = makeCondition("customText1", "equals", "North");
    expect(evaluateCondition(cond, fields)).toBe(true);
  });

  test("returns false for case-different match (equals is case-sensitive)", () => {
    const fields = [makeField("Campus", "north", "customText1")];
    const cond = makeCondition("customText1", "equals", "North");
    expect(evaluateCondition(cond, fields)).toBe(false);
  });

  test("converts non-string values via String() for comparison", () => {
    const fields = [makeField("Count", 42, "customNum1")];
    const cond = makeCondition("customNum1", "equals", "42");
    expect(evaluateCondition(cond, fields)).toBe(true);
  });
});

// ============================================================================
// "not_equals" operator
// ============================================================================

describe("evaluateCondition – not_equals operator", () => {
  test("returns true when values differ", () => {
    const fields = [makeField("Campus", "South", "customText1")];
    const cond = makeCondition("customText1", "not_equals", "North");
    expect(evaluateCondition(cond, fields)).toBe(true);
  });

  test("returns false when values are equal", () => {
    const fields = [makeField("Campus", "North", "customText1")];
    const cond = makeCondition("customText1", "not_equals", "North");
    expect(evaluateCondition(cond, fields)).toBe(false);
  });

  test("returns false when condition value is undefined", () => {
    const fields = [makeField("Campus", "North", "customText1")];
    const cond = makeCondition("customText1", "not_equals", undefined);
    expect(evaluateCondition(cond, fields)).toBe(false);
  });
});

// ============================================================================
// "is_true" operator
// ============================================================================

describe("evaluateCondition – is_true operator", () => {
  test("returns true when value is boolean true", () => {
    const fields = [makeField("Interested in Kids", true, "customBool1")];
    const cond = makeCondition("customBool1", "is_true");
    expect(evaluateCondition(cond, fields)).toBe(true);
  });

  test("returns false when value is string 'true' (strict boolean check)", () => {
    const fields = [makeField("Interested in Kids", "true", "customBool1")];
    const cond = makeCondition("customBool1", "is_true");
    expect(evaluateCondition(cond, fields)).toBe(false);
  });

  test("returns false when value is truthy non-boolean (1)", () => {
    const fields = [makeField("Count", 1, "customNum1")];
    const cond = makeCondition("customNum1", "is_true");
    expect(evaluateCondition(cond, fields)).toBe(false);
  });

  test("returns false when value is boolean false", () => {
    const fields = [makeField("Interested in Kids", false, "customBool1")];
    const cond = makeCondition("customBool1", "is_true");
    expect(evaluateCondition(cond, fields)).toBe(false);
  });

  test("returns false when value is undefined", () => {
    const fields = [makeField("Interested in Kids", undefined, "customBool1")];
    const cond = makeCondition("customBool1", "is_true");
    expect(evaluateCondition(cond, fields)).toBe(false);
  });

  test("returns false when field is not in array (unchecked optional boolean)", () => {
    const fields: CustomFieldEntry[] = [];
    const cond = makeCondition("customBool1", "is_true");
    expect(evaluateCondition(cond, fields)).toBe(false);
  });
});

// ============================================================================
// "is_false" operator
// ============================================================================

describe("evaluateCondition – is_false operator", () => {
  test("returns true when value is boolean false", () => {
    const fields = [makeField("Interested in Kids", false, "customBool1")];
    const cond = makeCondition("customBool1", "is_false");
    expect(evaluateCondition(cond, fields)).toBe(true);
  });

  test("returns true when value is undefined", () => {
    const fields = [
      makeField("Interested in Kids", undefined, "customBool1"),
    ];
    const cond = makeCondition("customBool1", "is_false");
    expect(evaluateCondition(cond, fields)).toBe(true);
  });

  test("returns true when value is null", () => {
    const fields = [makeField("Interested in Kids", null, "customBool1")];
    const cond = makeCondition("customBool1", "is_false");
    expect(evaluateCondition(cond, fields)).toBe(true);
  });

  test("returns true when field is not in array (unchecked optional boolean)", () => {
    // BUG FIX: Previously returned false because field not found → early return false.
    // Missing field = not set = falsy, so is_false should match.
    const fields: CustomFieldEntry[] = [];
    const cond = makeCondition("customBool1", "is_false");
    expect(evaluateCondition(cond, fields)).toBe(true);
  });

  test("returns false when value is boolean true", () => {
    const fields = [makeField("Interested in Kids", true, "customBool1")];
    const cond = makeCondition("customBool1", "is_false");
    expect(evaluateCondition(cond, fields)).toBe(false);
  });
});

// ============================================================================
// Unknown operator
// ============================================================================

describe("evaluateCondition – unknown operator", () => {
  test("returns false for unrecognized operator", () => {
    const fields = [makeField("Name", "Alice", "customText1")];
    const cond = makeCondition("customText1", "starts_with", "A");
    expect(evaluateCondition(cond, fields)).toBe(false);
  });
});

// ============================================================================
// Real-world rule scenarios (matching the user's actual rules)
// ============================================================================

describe("evaluateCondition – real-world rules", () => {
  test('Rule: "Assign to Seyi" – customText2 contains "long island city"', () => {
    const condition: AutomationCondition = {
      field: "customText2",
      operator: "contains",
      value: "long island city",
    };

    // User types "Long Island City" (different casing)
    const fields = [
      makeField("Where do you live?", "Long Island City", "customText2"),
    ];

    expect(evaluateCondition(condition, fields)).toBe(true);
  });

  test('Rule: "Interested in Kids Team" – Fount Kids/Youth is_true (by label)', () => {
    const condition: AutomationCondition = {
      field: "Fount Kids/Youth",
      operator: "is_true",
    };

    // Notes-only field (no slot), user checked the checkbox
    const fields = [makeField("Fount Kids/Youth", true)];

    expect(evaluateCondition(condition, fields)).toBe(true);
  });

  test('Rule: "Interested in Kids Team" – checkbox unchecked (field absent)', () => {
    const condition: AutomationCondition = {
      field: "Fount Kids/Youth",
      operator: "is_true",
    };

    // Optional boolean not checked → not included in customFields
    const fields: CustomFieldEntry[] = [
      makeField("Where do you live?", "Manhattan", "customText2"),
    ];

    expect(evaluateCondition(condition, fields)).toBe(false);
  });
});
