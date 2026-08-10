import { hostDisplayName, formatHostLine } from "../utils/hostAttribution";

describe("hostDisplayName", () => {
  it("combines first name and last initial", () => {
    expect(hostDisplayName({ firstName: "Jane", lastName: "Doe" })).toBe("Jane D.");
  });

  it("uses first name only when last name is missing", () => {
    expect(hostDisplayName({ firstName: "Jane", lastName: null })).toBe("Jane");
  });

  it("uses last initial only when first name is missing", () => {
    expect(hostDisplayName({ firstName: null, lastName: "Doe" })).toBe("D.");
  });

  it("returns empty string when the host has no name", () => {
    expect(hostDisplayName({ firstName: null, lastName: null })).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(hostDisplayName({ firstName: "  Jane  ", lastName: "  Doe  " })).toBe("Jane D.");
  });
});

describe("formatHostLine", () => {
  it("returns a bare label when there are no hosts", () => {
    expect(formatHostLine([])).toBe("Hosted");
  });

  it("returns a bare label when no host has a usable name", () => {
    expect(formatHostLine([{ firstName: null, lastName: null }])).toBe("Hosted");
  });

  it("names a single host", () => {
    expect(formatHostLine([{ firstName: "Jane", lastName: "Doe" }])).toBe("Hosted by Jane D.");
  });

  it("names both hosts when there are exactly two (host + cohost)", () => {
    expect(
      formatHostLine([
        { firstName: "Jane", lastName: "Doe" },
        { firstName: "Mark", lastName: "King" },
      ])
    ).toBe("Hosted by Jane D. & Mark K.");
  });

  it("names the first two and collapses the rest with correct pluralization", () => {
    expect(
      formatHostLine([
        { firstName: "Jane", lastName: "Doe" },
        { firstName: "Mark", lastName: "King" },
        { firstName: "Rosa", lastName: "Smith" },
      ])
    ).toBe("Hosted by Jane D., Mark K. + 1 other");

    expect(
      formatHostLine([
        { firstName: "Jane", lastName: "Doe" },
        { firstName: "Mark", lastName: "King" },
        { firstName: "Rosa", lastName: "Smith" },
        { firstName: "Tom", lastName: "Lee" },
      ])
    ).toBe("Hosted by Jane D., Mark K. + 2 others");
  });

  it("ignores unnamed hosts when counting", () => {
    expect(
      formatHostLine([
        { firstName: "Jane", lastName: "Doe" },
        { firstName: null, lastName: null },
      ])
    ).toBe("Hosted by Jane D.");
  });
});
