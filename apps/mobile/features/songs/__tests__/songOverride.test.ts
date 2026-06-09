import { resolveSongKey, resolveSongBpm } from "../utils/songOverride";

describe("song per-service override resolution (ADR-027)", () => {
  it("prefers the per-item override key over the library default", () => {
    expect(
      resolveSongKey({ key: "A" }, { defaultKey: "G" } as any),
    ).toBe("A");
  });

  it("falls back to the library default key when no override", () => {
    expect(resolveSongKey(null, { defaultKey: "G" } as any)).toBe("G");
    expect(resolveSongKey({}, { defaultKey: "G" } as any)).toBe("G");
  });

  it("returns undefined when neither override nor song default is set", () => {
    expect(resolveSongKey(null, null)).toBeUndefined();
    expect(resolveSongKey({}, {} as any)).toBeUndefined();
  });

  it("prefers the per-item override bpm over the library default", () => {
    expect(resolveSongBpm({ bpm: 80 }, { bpm: 72 } as any)).toBe(80);
  });

  it("falls back to the library default bpm when no override", () => {
    expect(resolveSongBpm(null, { bpm: 72 } as any)).toBe(72);
    expect(resolveSongBpm({}, { bpm: 72 } as any)).toBe(72);
  });
});
