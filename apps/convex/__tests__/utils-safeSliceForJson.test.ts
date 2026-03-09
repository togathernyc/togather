import { describe, expect, test } from "vitest";
import { safeSliceForJson } from "../lib/utils";

describe("safeSliceForJson", () => {
  test("returns string unchanged when under maxLen", () => {
    expect(safeSliceForJson("hello", 10)).toBe("hello");
    expect(safeSliceForJson("", 10)).toBe("");
  });

  test("slices ASCII string at maxLen", () => {
    expect(safeSliceForJson("hello world", 5)).toBe("hello");
  });

  test("avoids cutting surrogate pair - emoji at boundary", () => {
    // "Hello " + wave emoji (U+1F44B) = 7 code units (emoji is 2: high+low surrogate)
    // slice(0,7) would give "Hello " + high surrogate only - invalid JSON
    const withEmoji = "Hello 👋";
    const sliced = safeSliceForJson(withEmoji, 7);
    expect(sliced).toBe("Hello ");
    expect(JSON.stringify({ s: sliced })).toBe('{"s":"Hello "}');
  });

  test("keeps full emoji when slice ends after it", () => {
    const withEmoji = "Hello 👋 World";
    const sliced = safeSliceForJson(withEmoji, 8); // 6 + emoji(2) = 8
    expect(sliced).toBe("Hello 👋");
    expect(JSON.stringify({ s: sliced })).toBe('{"s":"Hello 👋"}');
  });

  test("handles multiple emojis", () => {
    const multi = "👍😀🎉";
    const sliced = safeSliceForJson(multi, 4);
    // 4 code units = 2 full emojis
    expect(sliced).toBe("👍😀");
    expect(JSON.stringify({ s: sliced })).toBe('{"s":"👍😀"}');
  });

  test("handles slice in middle of second emoji", () => {
    const multi = "A👍😀";
    const sliced = safeSliceForJson(multi, 4);
    // A=1, 👍=2, first half of 😀=1 -> would cut surrogate
    expect(sliced).toBe("A👍");
    expect(JSON.stringify({ s: sliced })).toBe('{"s":"A👍"}');
  });

  test("result parses as valid JSON (regression for 'unexpected end of hex escape')", () => {
    // User note with emoji - slice(0,200) would cut surrogate (199 A's + high surrogate)
    const longNoteWithEmoji = "A".repeat(199) + "👋";
    const sliced = safeSliceForJson(longNoteWithEmoji, 200);
    const json = JSON.stringify({ latestNoteContent: sliced });
    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json).latestNoteContent).toBe("A".repeat(199));
  });
});
