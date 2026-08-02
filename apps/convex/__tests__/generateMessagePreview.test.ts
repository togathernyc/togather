/**
 * Unit tests for `generateMessagePreview` — the stored `lastMessagePreview`
 * that feeds the inbox / group-list rows.
 *
 * Verifies the "show more of the message" behavior: text previews now carry up
 * to ~200 chars (so a 2-line row has content) while non-text messages keep
 * their fixed canned labels ("Sent a photo", "Shared an event", …).
 *
 * Run with: cd apps/convex && pnpm test __tests__/generateMessagePreview.test.ts
 */

import { describe, expect, test } from "vitest";
import { generateMessagePreview } from "../functions/messaging/messages";
import { LIST_PREVIEW_MAX } from "../lib/text";

describe("generateMessagePreview", () => {
  test("returns full short text unchanged", () => {
    expect(generateMessagePreview({ content: "hello world" })).toBe(
      "hello world",
    );
  });

  test("keeps more than the old 100-char cut for long text", () => {
    const content = "x".repeat(300);
    const preview = generateMessagePreview({ content });
    expect([...preview].length).toBe(LIST_PREVIEW_MAX);
    expect([...preview].length).toBeGreaterThan(100);
  });

  test("emoji at the cut boundary is not split", () => {
    const content = "🙏".repeat(300);
    const preview = generateMessagePreview({ content });
    // Every kept character is a whole emoji — no lone surrogate.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(preview)).toBe(false);
    expect([...preview].length).toBe(LIST_PREVIEW_MAX);
  });

  test("photo-only message keeps its canned label", () => {
    expect(
      generateMessagePreview({
        content: "",
        attachments: [{ type: "image", url: "x" }],
      }),
    ).toBe("Sent a photo");
  });

  test("photo with a caption shows the caption text", () => {
    expect(
      generateMessagePreview({
        content: "look at this",
        attachments: [{ type: "image", url: "x" }],
      }),
    ).toBe("look at this");
  });
});
