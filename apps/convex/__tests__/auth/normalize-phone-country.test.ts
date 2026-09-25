import { describe, it, expect } from "vitest";
import { normalizePhone } from "../../lib/utils";

describe("normalizePhone with the picked country", () => {
  it("keeps the US default when no country is given", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("5551234567", "US")).toBe("+15551234567");
    expect(normalizePhone("+61 412 345 678")).toBe("+61412345678");
  });

  it("adds +61 to an Australian mobile typed with the trunk 0", () => {
    expect(normalizePhone("0412 345 678", "AU")).toBe("+61412345678");
  });

  it("adds +61 to an Australian mobile typed without the trunk 0", () => {
    expect(normalizePhone("412345678", "AU")).toBe("+61412345678");
  });

  it("does not double the country code when the user already typed it", () => {
    expect(normalizePhone("61 412 345 678", "AU")).toBe("+61412345678");
    expect(normalizePhone("+61 412 345 678", "AU")).toBe("+61412345678");
    // German numbers vary in length, so a short one can still carry +49
    expect(normalizePhone("49 30 1234567", "DE")).toBe("+49301234567");
    expect(normalizePhone("030 1234567", "DE")).toBe("+49301234567");
  });

  it("handles other picker countries", () => {
    expect(normalizePhone("07700 900123", "GB")).toBe("+447700900123");
    expect(normalizePhone("0803 123 4567", "NG")).toBe("+2348031234567");
    // Italian numbers keep their leading 0
    expect(normalizePhone("06 1234 5678", "IT")).toBe("+390612345678");
    // An Italian mobile starting 39 is not mistaken for +39
    expect(normalizePhone("339 123 4567", "IT")).toBe("+393391234567");
    expect(normalizePhone("39 339 123 4567", "IT")).toBe("+393391234567");
    // A Brazilian mobile in area code 55 is not mistaken for +55
    expect(normalizePhone("55 91234 5678", "BR")).toBe("+5555912345678");
  });
});
