import { describe, expect, test } from "vitest";
import { generateMessagePreview } from "../../functions/messaging/messages";

/**
 * Regression: a paste that landed a non-BMP emoji's surrogate pair at the
 * 100-unit slice boundary used to produce a `lastMessagePreview` ending in a
 * lone high surrogate. Writing that string to the DB threw an unclassified
 * error, leaving the optimistic message stuck on "Tap to retry" in chat.
 */
describe("generateMessagePreview surrogate safety", () => {
  function hasLoneSurrogate(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = s.charCodeAt(i + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
        i++;
      } else if (c >= 0xdc00 && c <= 0xdfff) {
        return true;
      }
    }
    return false;
  }

  test("does not leave a lone surrogate when emoji straddles the 100-unit boundary", () => {
    const content =
      "🎉 Dinner Party May 27\n🚨Note: Location Change!\n📍Meeting Place: Prospect Park\n⏰Meeting Time: 7PM\n\n🍽️ MENU: Bring your own!";
    const preview = generateMessagePreview({ content });
    expect(hasLoneSurrogate(preview)).toBe(false);
    expect(() => JSON.parse(JSON.stringify({ preview }))).not.toThrow();
  });

  test("preview round-trips through JSON for emoji-at-boundary content", () => {
    const content = "A".repeat(99) + "🍽️ rest";
    const preview = generateMessagePreview({ content });
    const round = JSON.parse(JSON.stringify({ preview }));
    expect(round.preview).toBe(preview);
    expect(hasLoneSurrogate(preview)).toBe(false);
  });

  test("preview for image+text caption stays surrogate-safe", () => {
    const content = "A".repeat(99) + "🎂 cake";
    const preview = generateMessagePreview({
      content,
      attachments: [{ type: "image", url: "https://example.com/x.jpg" }],
    });
    expect(hasLoneSurrogate(preview)).toBe(false);
  });

  test("short text content passes through unchanged", () => {
    expect(generateMessagePreview({ content: "Hello!" })).toBe("Hello!");
  });

  test("attachment-only messages still use canned previews", () => {
    expect(
      generateMessagePreview({
        content: "",
        attachments: [{ type: "image", url: "https://example.com/x.jpg" }],
      }),
    ).toBe("Sent a photo");
  });
});
