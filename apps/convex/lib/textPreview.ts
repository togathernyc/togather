/**
 * Character-safe truncation for message previews.
 *
 * JS strings are UTF-16, so a naive `slice(0, n)` can cut an emoji in half and
 * leave a lone surrogate that renders as "�" in an email, a push body, or an
 * inbox row. Every place we still shorten a message body goes through here.
 *
 * We deliberately avoid `Intl.Segmenter` (grapheme clusters): the Convex
 * runtime's Intl support is not something we want to depend on for the hot
 * notification path, and the issue's requirement is only that a cut never
 * leaves a broken character. Dropping a lone surrogate and a dangling
 * zero-width joiner covers that — cutting a 👨‍👩‍👧 family emoji short yields
 * 👨‍👩 (two people), which renders fine, not mojibake.
 */

/** UTF-16 high surrogate: the first half of an astral character (most emoji). */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Truncate to at most `max` UTF-16 units without splitting a character.
 * Adds no ellipsis — use {@link truncateWithEllipsis} when the cut should be
 * visible to the reader.
 */
export function truncateChars(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;

  let end = max;
  // A high surrogate at the cut point has lost its low surrogate.
  if (isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;

  let out = text.slice(0, end);
  // A trailing ZWJ is the glue of an emoji sequence whose tail we just dropped.
  while (out.length > 0 && out.charCodeAt(out.length - 1) === 0x200d) {
    out = out.slice(0, -1);
    // The joiner may itself have been preceded by a now-orphaned surrogate half.
    if (out.length > 0 && isHighSurrogate(out.charCodeAt(out.length - 1))) {
      out = out.slice(0, -1);
    }
  }
  return out;
}

/**
 * Truncate to at most `max` UTF-16 units (ellipsis included in the budget),
 * suffixing "…" only when the text was actually shortened.
 */
export function truncateWithEllipsis(text: string, max: number): string {
  if (text.length <= max) return text;
  return truncateChars(text, Math.max(0, max - 1)) + "…";
}
