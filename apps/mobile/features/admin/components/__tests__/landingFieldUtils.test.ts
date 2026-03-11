import {
  isFieldVisibleOnLanding,
  parseSubtitleSegments,
  shouldCollectFieldResponse,
} from "../../../../app/c/[slug]/landingFieldUtils";

describe("landingFieldUtils", () => {
  test("parses markdown links and plain URLs in subtitle text", () => {
    const segments = parseSubtitleSegments(
      "Questions? [Read more](https://example.com/docs) or visit https://togather.app/help."
    );

    expect(segments).toEqual([
      { type: "text", text: "Questions? " },
      { type: "link", text: "Read more", url: "https://example.com/docs" },
      { type: "text", text: " or visit " },
      { type: "link", text: "https://togather.app/help", url: "https://togather.app/help" },
      { type: "text", text: "." },
    ]);
  });

  test("respects hidden fields for landing visibility and submission", () => {
    expect(isFieldVisibleOnLanding({ type: "text" })).toBe(true);
    expect(isFieldVisibleOnLanding({ type: "text", showOnLanding: false })).toBe(false);

    expect(shouldCollectFieldResponse({ type: "text" })).toBe(true);
    expect(shouldCollectFieldResponse({ type: "subtitle" })).toBe(false);
    expect(shouldCollectFieldResponse({ type: "button" })).toBe(false);
    expect(shouldCollectFieldResponse({ type: "text", showOnLanding: false })).toBe(false);
  });
});
