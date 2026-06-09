import { effectiveKey, effectiveBpm } from "../songRehearsal";

describe("effectiveKey", () => {
  it("prefers the per-occurrence override over the song default", () => {
    const item = {
      songDetails: { key: "G" },
      song: { _id: "s1", title: "Song", defaultKey: "C" },
    };
    expect(effectiveKey(item)).toBe("G");
  });

  it("falls back to the song's default key when no override", () => {
    const item = {
      songDetails: { bpm: 72 },
      song: { _id: "s1", title: "Song", defaultKey: "C" },
    };
    expect(effectiveKey(item)).toBe("C");
  });

  it("falls back to the default when songDetails is null", () => {
    const item = {
      songDetails: null,
      song: { _id: "s1", title: "Song", defaultKey: "C" },
    };
    expect(effectiveKey(item)).toBe("C");
  });

  it("returns undefined when neither override nor default is present", () => {
    const item = {
      songDetails: { bpm: 72 },
      song: { _id: "s1", title: "Song" },
    };
    expect(effectiveKey(item)).toBeUndefined();
  });

  it("returns undefined for a free-typed item with no song", () => {
    const item = { songDetails: null };
    expect(effectiveKey(item)).toBeUndefined();
  });
});

describe("effectiveBpm", () => {
  it("prefers the per-occurrence override over the song default", () => {
    const item = {
      songDetails: { bpm: 80 },
      song: { _id: "s1", title: "Song", bpm: 72 },
    };
    expect(effectiveBpm(item)).toBe(80);
  });

  it("falls back to the song's default bpm when no override", () => {
    const item = {
      songDetails: { key: "G" },
      song: { _id: "s1", title: "Song", bpm: 72 },
    };
    expect(effectiveBpm(item)).toBe(72);
  });

  it("falls back to the default when songDetails is null", () => {
    const item = {
      songDetails: null,
      song: { _id: "s1", title: "Song", bpm: 72 },
    };
    expect(effectiveBpm(item)).toBe(72);
  });

  it("returns undefined when neither override nor default is present", () => {
    const item = {
      songDetails: { key: "G" },
      song: { _id: "s1", title: "Song" },
    };
    expect(effectiveBpm(item)).toBeUndefined();
  });

  it("returns undefined for a free-typed item with no song", () => {
    const item = { songDetails: null };
    expect(effectiveBpm(item)).toBeUndefined();
  });
});
