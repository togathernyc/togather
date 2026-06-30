/**
 * Tests for the connect-card OCR response parser.
 *
 * These cover the pure `parseExtractionResponse` normalizer (no network /
 * OpenAI). The vision call itself is exercised end-to-end manually; here we
 * lock down that we only surface clean, expected values to the form and never
 * leak unexpected or malformed data.
 *
 * Run with: cd apps/convex && pnpm test __tests__/landingFormVision.test.ts
 */

import { expect, test, describe } from "vitest";
import {
  parseExtractionResponse,
  buildSystemPrompt,
  type CustomFieldSpec,
} from "../lib/landingFormVision";

describe("parseExtractionResponse", () => {
  test("extracts built-in fields and trims whitespace", () => {
    const raw = JSON.stringify({
      firstName: "  Jane ",
      lastName: "Doe",
      phone: "(555) 123-4567",
      email: "jane@example.com",
      zipCode: "10001",
      dateOfBirth: "04/12/1990",
    });
    expect(parseExtractionResponse(raw, [])).toEqual({
      firstName: "Jane",
      lastName: "Doe",
      phone: "(555) 123-4567",
      email: "jane@example.com",
      zipCode: "10001",
      dateOfBirth: "04/12/1990",
    });
  });

  test("omits blank, whitespace-only, and non-string fields", () => {
    const raw = JSON.stringify({
      firstName: "Jane",
      lastName: "",
      phone: "   ",
      email: null,
      zipCode: 10001,
    });
    expect(parseExtractionResponse(raw, [])).toEqual({ firstName: "Jane" });
  });

  test("returns empty object for null, empty, or invalid JSON", () => {
    expect(parseExtractionResponse(null, [])).toEqual({});
    expect(parseExtractionResponse(undefined, [])).toEqual({});
    expect(parseExtractionResponse("", [])).toEqual({});
    expect(parseExtractionResponse("not json", [])).toEqual({});
    expect(parseExtractionResponse("[1,2,3]", [])).toEqual({});
  });

  test("keeps only custom fields matching a configured label", () => {
    const fields: CustomFieldSpec[] = [
      { label: "Neighborhood", type: "text" },
      { label: "How did you hear about us?", type: "text" },
    ];
    const raw = JSON.stringify({
      firstName: "Sam",
      customFields: [
        { label: "Neighborhood", value: "Bushwick" },
        { label: "Unknown Field", value: "should drop" },
        { label: "How did you hear about us?", value: "A friend" },
      ],
    });
    expect(parseExtractionResponse(raw, fields)).toEqual({
      firstName: "Sam",
      customFields: [
        { label: "Neighborhood", value: "Bushwick" },
        { label: "How did you hear about us?", value: "A friend" },
      ],
    });
  });

  test("drops custom fields with blank values and dedupes by label", () => {
    const fields: CustomFieldSpec[] = [{ label: "Neighborhood", type: "text" }];
    const raw = JSON.stringify({
      customFields: [
        { label: "Neighborhood", value: "  " },
        { label: "Neighborhood", value: "Harlem" },
        { label: "Neighborhood", value: "Chelsea" },
      ],
    });
    expect(parseExtractionResponse(raw, fields)).toEqual({
      customFields: [{ label: "Neighborhood", value: "Harlem" }],
    });
  });

  test("ignores customFields when none are configured", () => {
    const raw = JSON.stringify({
      firstName: "Sam",
      customFields: [{ label: "Neighborhood", value: "Bushwick" }],
    });
    expect(parseExtractionResponse(raw, [])).toEqual({ firstName: "Sam" });
  });
});

describe("buildSystemPrompt", () => {
  test("lists configured custom fields with dropdown options", () => {
    const fields: CustomFieldSpec[] = [
      { label: "Neighborhood", type: "text" },
      { label: "Campus", type: "dropdown", options: ["North", "South"] },
      { label: "Section", type: "section_header" },
    ];
    const prompt = buildSystemPrompt(fields);
    expect(prompt).toContain('"Neighborhood" (text)');
    expect(prompt).toContain('"Campus" (dropdown)');
    expect(prompt).toContain("North, South");
    // Decorative field types are not extractable and should be excluded.
    expect(prompt).not.toContain('"Section"');
    // Always describes the strict JSON contract.
    expect(prompt).toContain("strict JSON");
  });

  test("omits the custom-field section when there are no extractable fields", () => {
    const prompt = buildSystemPrompt([
      { label: "Header", type: "section_header" },
    ]);
    expect(prompt).not.toContain("Also extract these custom fields");
    expect(prompt).toContain("dateOfBirth");
  });
});
