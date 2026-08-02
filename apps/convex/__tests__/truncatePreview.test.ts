/**
 * Unit tests for the shared message-preview truncation helper.
 *
 * Covers the notification/inbox "show the full message" behavior:
 * - short text is returned unchanged (no spurious "…")
 * - long text is cut to the cap and ends in "…" when requested
 * - the cut never splits an emoji / surrogate pair into a broken glyph
 *
 * Run with: cd apps/convex && pnpm test __tests__/truncatePreview.test.ts
 */

import { describe, expect, test } from "vitest";
import {
  truncatePreview,
  EMAIL_PREVIEW_MAX,
  PUSH_PREVIEW_MAX,
  LIST_PREVIEW_MAX,
} from "../lib/text";

/** Count user-perceived characters (grapheme clusters), matching the helper. */
const countGraphemes = (s: string): number =>
  Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s),
  ).length;

describe("truncatePreview", () => {
  test("returns short text unchanged, with no ellipsis", () => {
    expect(truncatePreview("Hello there", 100)).toBe("Hello there");
    expect(truncatePreview("", 100)).toBe("");
  });

  test("returns text unchanged when exactly at the cap", () => {
    const text = "a".repeat(50);
    expect(truncatePreview(text, 50)).toBe(text);
  });

  test("truncates long text and appends an ellipsis (counted in the cap)", () => {
    const result = truncatePreview("a".repeat(200), 10);
    expect(result).toBe("a".repeat(9) + "…");
    expect([...result]).toHaveLength(10);
  });

  test("truncates without an ellipsis when ellipsis=false", () => {
    const result = truncatePreview("a".repeat(200), 10, false);
    expect(result).toBe("a".repeat(10));
    expect(result.endsWith("…")).toBe(false);
  });

  test("never leaves a broken glyph when cutting at an emoji boundary", () => {
    // "Please keep me in prayers 🙏" — cut right around the emoji.
    const text = "Please keep me in prayers 🙏 more text here";
    for (let cap = 24; cap <= 32; cap++) {
      const result = truncatePreview(text, cap);
      // No lone surrogate should survive — every code unit must pair up.
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(result)).toBe(false);
      expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(result)).toBe(false);
    }
  });

  test("keeps a trailing emoji whole rather than half-rendering it", () => {
    // 26 grapheme clusters up to and including the 🙏 (single astral code point).
    const text = "Please keep me in prayers🙏";
    const graphemeLen = [...text].length; // code-point count
    // Cut exactly where only half the emoji would fit if we sliced by code unit.
    const result = truncatePreview(text, graphemeLen, false);
    expect(result).toBe(text); // fits exactly, unchanged
    // One shorter: the emoji is dropped entirely, not split.
    const shorter = truncatePreview(text, graphemeLen - 1, false);
    expect(shorter).toBe("Please keep me in prayers");
  });

  test("caps content made of wide (ZWJ emoji) graphemes", () => {
    // 👨‍👩‍👧‍👦 is one grapheme cluster but 11 UTF-16 code units — wider than
    // the fast-path `max * 8` prefix budget per grapheme, so the bounded prefix
    // alone segments to fewer than `max` graphemes. The full body must still be
    // truncated, not returned whole.
    const family = "👨‍👩‍👧‍👦";
    const body = family.repeat(300); // 300 graphemes / 3300 code units
    const out = truncatePreview(body, PUSH_PREVIEW_MAX);
    // Grapheme count — NOT code-point count ([...out]) — is what the cap bounds.
    expect(countGraphemes(out)).toBeLessThanOrEqual(PUSH_PREVIEW_MAX);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThan(body.length);
  });

  test("caps content made of stacked combining marks (Zalgo)", () => {
    // A base char plus many combining marks is a single, arbitrarily long
    // grapheme; a run of them exceeds `max` graphemes while each grapheme is far
    // wider than 8 code units — the same fast-path escape hatch as ZWJ emoji.
    const zalgo = "a" + "́".repeat(20); // 1 grapheme, 21 code units
    const body = zalgo.repeat(300); // 300 graphemes
    const out = truncatePreview(body, LIST_PREVIEW_MAX, false);
    expect(out.endsWith("…")).toBe(false); // ellipsis=false for the list preview
    expect(out.length).toBeLessThan(body.length);
    // No lone surrogate and no leading combining mark left dangling at the cut.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false);
  });

  test("surface caps are ordered email >= push == list", () => {
    expect(EMAIL_PREVIEW_MAX).toBeGreaterThan(PUSH_PREVIEW_MAX);
    expect(PUSH_PREVIEW_MAX).toBe(LIST_PREVIEW_MAX);
    expect(EMAIL_PREVIEW_MAX).toBe(1000);
    expect(PUSH_PREVIEW_MAX).toBe(200);
  });
});
