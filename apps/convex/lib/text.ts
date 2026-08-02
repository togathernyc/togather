/**
 * Shared text helpers for notification/preview surfaces.
 */

/**
 * Maximum message-preview length (in grapheme clusters) for each surface.
 *
 * These are deliberately generous: emails have effectively unlimited room, so
 * the cap only exists to stop a pasted essay from producing a runaway email;
 * push bodies are additionally clipped by iOS/Android on the lock screen, so we
 * just stop being the thing that cuts mid-word; the stored inbox preview only
 * needs enough text to fill the ~2 lines a list row renders.
 */
export const EMAIL_PREVIEW_MAX = 1000;
export const PUSH_PREVIEW_MAX = 200;
export const LIST_PREVIEW_MAX = 200;

/**
 * Split a string into user-perceived characters (grapheme clusters).
 *
 * Prefers `Intl.Segmenter` so combining marks and ZWJ emoji sequences
 * (e.g. 👨‍👩‍👧) stay intact; falls back to code-point iteration
 * (`Array.from`) when the runtime lacks it, which still keeps surrogate pairs
 * (single emoji like 🙏) together. Either way we never cut in the middle of a
 * character, so a truncated preview can't render a broken glyph.
 */
function toGraphemes(text: string): string[] {
  try {
    // `Intl.Segmenter` isn't in the ES2021 lib types this package targets.
    const IntlAny = Intl as unknown as {
      Segmenter?: new (
        locales?: string | string[],
        options?: { granularity?: "grapheme" | "word" | "sentence" },
      ) => { segment: (input: string) => Iterable<{ segment: string }> };
    };
    if (typeof IntlAny.Segmenter === "function") {
      const seg = new IntlAny.Segmenter(undefined, { granularity: "grapheme" });
      return Array.from(seg.segment(text), (s) => s.segment);
    }
  } catch {
    // fall through to code-point splitting
  }
  return Array.from(text);
}

/**
 * Truncate `text` to at most `max` grapheme clusters without splitting a
 * character. When truncation happens and `ellipsis` is true (the default), the
 * result ends in "…" and the ellipsis counts toward `max`; when it's false the
 * text is simply cut (used for the stored inbox preview, where the list row's
 * own `numberOfLines` renders the visual ellipsis).
 *
 * Returns the original string unchanged when it's already within `max`.
 */
export function truncatePreview(
  text: string,
  max: number,
  ellipsis = true,
): string {
  // Fast path: segment only a bounded prefix so we don't run `Intl.Segmenter`
  // over a multi-megabyte body just to keep a couple hundred graphemes. If that
  // prefix alone already exceeds `max` graphemes, the truncation point lies
  // within it, so slicing from these graphemes is exact.
  const bound = max * 8;
  const prefixed = text.length > bound;
  let graphemes = toGraphemes(prefixed ? text.slice(0, bound) : text);
  if (graphemes.length <= max) {
    // The bounded prefix segmented to ≤ `max` graphemes. If we didn't pre-slice,
    // the whole text really is within the cap. If we did, wide graphemes (ZWJ
    // emoji, stacked combining marks) can hide more content past the window, so
    // segment the full body to get the true count — otherwise a runaway message
    // made of wide graphemes would slip through untruncated.
    if (!prefixed) return text;
    graphemes = toGraphemes(text);
    if (graphemes.length <= max) return text;
  }
  const keep = ellipsis ? Math.max(0, max - 1) : Math.max(0, max);
  return graphemes.slice(0, keep).join("") + (ellipsis ? "…" : "");
}
