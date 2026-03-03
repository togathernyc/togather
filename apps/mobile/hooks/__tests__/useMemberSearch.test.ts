/**
 * Tests for useMemberSearch hook and parseSearchTerms utility.
 */
import { parseSearchTerms } from "../useMemberSearch";

describe("parseSearchTerms", () => {
  it("returns empty array for empty string", () => {
    expect(parseSearchTerms("")).toEqual([]);
  });

  it("returns empty array for whitespace only", () => {
    expect(parseSearchTerms("   ")).toEqual([]);
  });

  it("returns single term for query without commas", () => {
    expect(parseSearchTerms("john")).toEqual(["john"]);
  });

  it("trims whitespace from single term", () => {
    expect(parseSearchTerms("  john  ")).toEqual(["john"]);
  });

  it("splits comma-separated terms", () => {
    expect(parseSearchTerms("john, jane, bob")).toEqual([
      "john",
      "jane",
      "bob",
    ]);
  });

  it("trims whitespace from each term", () => {
    expect(parseSearchTerms("  john  ,  jane  ,  bob  ")).toEqual([
      "john",
      "jane",
      "bob",
    ]);
  });

  it("filters out empty terms after splitting", () => {
    expect(parseSearchTerms("john, , jane")).toEqual(["john", "jane"]);
  });

  it("handles terms with spaces (full names)", () => {
    expect(parseSearchTerms("john doe, jane smith")).toEqual([
      "john doe",
      "jane smith",
    ]);
  });

  it("handles email addresses", () => {
    expect(parseSearchTerms("john@email.com, jane@email.com")).toEqual([
      "john@email.com",
      "jane@email.com",
    ]);
  });

  it("handles phone numbers", () => {
    expect(parseSearchTerms("555-1234, 555-5678")).toEqual([
      "555-1234",
      "555-5678",
    ]);
  });

  it("handles mixed search types (email, name, phone)", () => {
    expect(
      parseSearchTerms("john@email.com, jane smith, 555-1234")
    ).toEqual(["john@email.com", "jane smith", "555-1234"]);
  });

  it("handles trailing comma", () => {
    expect(parseSearchTerms("john, jane,")).toEqual(["john", "jane"]);
  });

  it("handles leading comma", () => {
    expect(parseSearchTerms(",john, jane")).toEqual(["john", "jane"]);
  });

  it("handles multiple consecutive commas", () => {
    expect(parseSearchTerms("john,,,jane")).toEqual(["john", "jane"]);
  });
});
