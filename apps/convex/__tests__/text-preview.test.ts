/**
 * Character-safe truncation (issue #661).
 *
 * Every surface that still shortens a message body (push, stored inbox preview,
 * the email safety cap) goes through these helpers, so a cut must never leave a
 * broken glyph.
 */

import { describe, it, expect } from "vitest";
import { truncateChars, truncateWithEllipsis } from "../lib/textPreview";

/** True when the string ends with (or contains) an unpaired surrogate. */
function hasLoneSurrogate(s: string): boolean {
  return (
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(s) ||
    /(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)
  );
}

describe("truncateChars", () => {
  it("returns short text untouched", () => {
    expect(truncateChars("hello", 200)).toBe("hello");
  });

  it("cuts at the limit when nothing straddles the boundary", () => {
    expect(truncateChars("A".repeat(300), 200)).toBe("A".repeat(200));
  });

  it("never splits a surrogate pair at the cut point", () => {
    // 🙏 occupies units 199 and 200, so a naive slice(0, 200) keeps half of it.
    const text = `${"A".repeat(199)}🙏 tail`;
    const out = truncateChars(text, 200);
    expect(out).toBe("A".repeat(199));
    expect(hasLoneSurrogate(out)).toBe(false);
  });

  it("keeps a whole emoji that fits", () => {
    const text = `${"A".repeat(198)}🙏 tail`;
    expect(truncateChars(text, 200)).toBe(`${"A".repeat(198)}🙏`);
  });

  it("drops a dangling zero-width joiner rather than orphaning it", () => {
    // 👨‍👩‍👧 = 👨 ZWJ 👩 ZWJ 👧 (8 UTF-16 units). Cutting after the second ZWJ
    // would leave the joiner with nothing to join.
    const family = "👨‍👩‍👧";
    const out = truncateChars(family, 5);
    expect(out).toBe("👨‍👩");
    expect(out.endsWith("‍")).toBe(false);
  });

  it("returns empty for a non-positive limit", () => {
    expect(truncateChars("anything", 0)).toBe("");
  });
});

describe("truncateWithEllipsis", () => {
  it("adds no ellipsis when the text fits", () => {
    expect(truncateWithEllipsis("hello", 200)).toBe("hello");
    expect(truncateWithEllipsis("A".repeat(200), 200)).toBe("A".repeat(200));
  });

  it("ellipsizes within the budget", () => {
    const out = truncateWithEllipsis("A".repeat(300), 200);
    expect(out).toBe(`${"A".repeat(199)}…`);
    expect(out.length).toBe(200);
  });

  it("ellipsizes without splitting an emoji at the boundary", () => {
    const out = truncateWithEllipsis(`${"A".repeat(198)}🙏${"B".repeat(50)}`, 200);
    expect(out).toBe(`${"A".repeat(198)}…`);
    expect(hasLoneSurrogate(out)).toBe(false);
  });

  it("backs up to the word boundary instead of chopping a word", () => {
    // The budget lands inside "prayers", which is exactly the mid-word cut
    // issue #661 reported — just at a later offset than the old 100-char one.
    expect(truncateWithEllipsis("Please keep me in prayers tonight", 22)).toBe(
      "Please keep me in…",
    );
  });

  it("does not back up when the cut already lands between words", () => {
    expect(truncateWithEllipsis("Please keep me in prayers", 19)).toBe(
      "Please keep me in…",
    );
  });

  it("hard-cuts a single token too long to back up out of", () => {
    // No space within the search window, so shortening to a word boundary
    // would throw away almost the whole preview.
    const url = `https://example.com/${"a".repeat(300)}`;
    const out = truncateWithEllipsis(url, 200);
    expect(out).toBe(`${url.slice(0, 199)}…`);
    expect(out.length).toBe(200);
  });

  it("keeps the word-boundary cut inside the budget", () => {
    const words = "lorem ipsum dolor sit amet ".repeat(20);
    const out = truncateWithEllipsis(words, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith("…")).toBe(true);
    expect(out.slice(0, -1).endsWith(" ")).toBe(false);
  });
});
