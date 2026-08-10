import { effectiveKey, effectiveBpm, songMetaLine } from "../songRehearsal";

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

describe("songMetaLine", () => {
  it("shows the song title with resolved key and BPM", () => {
    const item = {
      title: "New item",
      songDetails: { key: "G" },
      song: { _id: "s1", title: "Way Maker", defaultKey: "C", bpm: 68 },
    };
    expect(songMetaLine(item)).toBe("Way Maker · Key G · 68 BPM");
  });

  it("falls back to the library song's default key and BPM", () => {
    const item = {
      title: "New item",
      songDetails: null,
      song: { _id: "s1", title: "Way Maker", defaultKey: "E", bpm: 68 },
    };
    expect(songMetaLine(item)).toBe("Way Maker · Key E · 68 BPM");
  });

  it("omits the song title when the row title already matches it", () => {
    const item = {
      title: "Way Maker",
      songDetails: { key: "G", bpm: 70 },
      song: { _id: "s1", title: "Way Maker" },
    };
    expect(songMetaLine(item)).toBe("Key G · 70 BPM");
  });

  it("treats the title match case- and whitespace-insensitively", () => {
    const item = {
      title: "  way maker ",
      songDetails: { key: "G" },
      song: { _id: "s1", title: "Way Maker" },
    };
    expect(songMetaLine(item)).toBe("Key G");
  });

  it("shows only the song title when no key or BPM resolves", () => {
    const item = {
      title: "Worship set",
      songDetails: null,
      song: { _id: "s1", title: "Way Maker" },
    };
    expect(songMetaLine(item)).toBe("Way Maker");
  });

  it("keeps the legacy override-only line for items without a linked song", () => {
    const item = { title: "Opener", songDetails: { key: "A", bpm: 120 } };
    expect(songMetaLine(item)).toBe("Key A · 120 BPM");
  });

  it("returns null when there is nothing to show", () => {
    const item = { title: "Welcome", songDetails: null };
    expect(songMetaLine(item)).toBeNull();
  });
});
