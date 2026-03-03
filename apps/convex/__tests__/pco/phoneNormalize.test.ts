/**
 * Tests for phoneNormalize.ts
 *
 * Unit tests for phone number and email normalization utilities used in
 * Planning Center Services person matching.
 */

import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  phonesMatch,
  normalizeEmail,
  emailsMatch,
} from "../../lib/phoneNormalize";

describe("phoneNormalize", () => {
  describe("normalizePhone", () => {
    it("normalizes 10-digit US numbers by adding country code", () => {
      expect(normalizePhone("5551234567")).toBe("15551234567");
    });

    it("handles US numbers with formatting characters", () => {
      expect(normalizePhone("555-123-4567")).toBe("15551234567");
      expect(normalizePhone("(555) 123-4567")).toBe("15551234567");
      expect(normalizePhone("(555)123-4567")).toBe("15551234567");
      expect(normalizePhone("555.123.4567")).toBe("15551234567");
    });

    it("handles numbers with country code", () => {
      expect(normalizePhone("+1 555 123 4567")).toBe("15551234567");
      expect(normalizePhone("1-555-123-4567")).toBe("15551234567");
      expect(normalizePhone("+1-555-123-4567")).toBe("15551234567");
      expect(normalizePhone("1 555 123 4567")).toBe("15551234567");
    });

    it("handles international numbers by returning digits as-is", () => {
      // UK number
      expect(normalizePhone("+44 20 7123 4567")).toBe("442071234567");
      // Canadian number
      expect(normalizePhone("+1 416 555 1234")).toBe("14165551234");
      // Australian number
      expect(normalizePhone("+61 2 1234 5678")).toBe("61212345678");
    });

    it("strips all non-digit characters", () => {
      expect(normalizePhone("555#123#4567")).toBe("15551234567");
      expect(normalizePhone("555@123@4567")).toBe("15551234567");
      expect(normalizePhone("555(123)4567")).toBe("15551234567");
    });

    it("handles edge cases with minimal digits", () => {
      expect(normalizePhone("123")).toBe("123");
      expect(normalizePhone("12")).toBe("12");
      expect(normalizePhone("1")).toBe("1");
    });

    it("handles empty strings", () => {
      expect(normalizePhone("")).toBe("");
    });

    it("handles already normalized US numbers", () => {
      expect(normalizePhone("15551234567")).toBe("15551234567");
    });

    it("handles numbers with extra spaces", () => {
      expect(normalizePhone("  555  123  4567  ")).toBe("15551234567");
    });
  });

  describe("phonesMatch", () => {
    it("matches equivalent phone numbers with different formatting", () => {
      expect(phonesMatch("555-123-4567", "(555) 123-4567")).toBe(true);
      expect(phonesMatch("5551234567", "+1 555 123 4567")).toBe(true);
      expect(phonesMatch("(555)123-4567", "1-555-123-4567")).toBe(true);
    });

    it("returns false for non-matching phone numbers", () => {
      expect(phonesMatch("5551234567", "5551234568")).toBe(false);
      expect(phonesMatch("2025550123", "2025550124")).toBe(false);
    });

    it("handles null values", () => {
      expect(phonesMatch(null, "5551234567")).toBe(false);
      expect(phonesMatch("5551234567", null)).toBe(false);
      expect(phonesMatch(null, null)).toBe(false);
    });

    it("handles undefined values", () => {
      expect(phonesMatch(undefined, "5551234567")).toBe(false);
      expect(phonesMatch("5551234567", undefined)).toBe(false);
      expect(phonesMatch(undefined, undefined)).toBe(false);
    });

    it("handles mixed null and undefined", () => {
      expect(phonesMatch(null, undefined)).toBe(false);
      expect(phonesMatch(undefined, null)).toBe(false);
    });

    it("matches the testing phone number", () => {
      expect(phonesMatch("2025550123", "202-555-0123")).toBe(true);
      expect(phonesMatch("2025550123", "+1 202 555 0123")).toBe(true);
    });

    it("correctly distinguishes similar numbers", () => {
      expect(phonesMatch("2025550123", "2025550124")).toBe(false);
      expect(phonesMatch("2025550123", "2025550122")).toBe(false);
    });
  });

  describe("normalizeEmail", () => {
    it("converts emails to lowercase", () => {
      expect(normalizeEmail("Test@Example.com")).toBe("test@example.com");
      expect(normalizeEmail("TEST@EXAMPLE.COM")).toBe("test@example.com");
      expect(normalizeEmail("TeSt@ExAmPlE.cOm")).toBe("test@example.com");
    });

    it("trims whitespace", () => {
      expect(normalizeEmail(" test@example.com ")).toBe("test@example.com");
      expect(normalizeEmail("  test@example.com  ")).toBe("test@example.com");
      expect(normalizeEmail("\ttest@example.com\n")).toBe("test@example.com");
    });

    it("handles emails with multiple domains", () => {
      expect(normalizeEmail("User@Subdomain.Example.Com")).toBe(
        "user@subdomain.example.com"
      );
    });

    it("preserves email structure after normalization", () => {
      expect(normalizeEmail("John.Doe@Company.Co.Uk")).toBe(
        "john.doe@company.co.uk"
      );
    });

    it("handles various whitespace characters", () => {
      expect(normalizeEmail("  test@example.com\t")).toBe("test@example.com");
      expect(normalizeEmail("\n test@example.com \n")).toBe("test@example.com");
    });
  });

  describe("emailsMatch", () => {
    it("matches equivalent emails with different cases", () => {
      expect(emailsMatch("Test@Example.com", "test@example.com")).toBe(true);
      expect(emailsMatch("JOHN.DOE@COMPANY.COM", "john.doe@company.com")).toBe(
        true
      );
    });

    it("matches emails when one has whitespace", () => {
      expect(emailsMatch(" test@example.com ", "test@example.com")).toBe(true);
      expect(emailsMatch("test@example.com", " test@example.com ")).toBe(true);
      expect(emailsMatch(" test@example.com ", " test@example.com ")).toBe(
        true
      );
    });

    it("returns false for non-matching emails", () => {
      expect(emailsMatch("test1@example.com", "test2@example.com")).toBe(false);
      expect(emailsMatch("user@example.com", "user@different.com")).toBe(false);
    });

    it("handles null values", () => {
      expect(emailsMatch(null, "test@example.com")).toBe(false);
      expect(emailsMatch("test@example.com", null)).toBe(false);
      expect(emailsMatch(null, null)).toBe(false);
    });

    it("handles undefined values", () => {
      expect(emailsMatch(undefined, "test@example.com")).toBe(false);
      expect(emailsMatch("test@example.com", undefined)).toBe(false);
      expect(emailsMatch(undefined, undefined)).toBe(false);
    });

    it("handles mixed null and undefined", () => {
      expect(emailsMatch(null, undefined)).toBe(false);
      expect(emailsMatch(undefined, null)).toBe(false);
    });

    it("matches both case-insensitivity and whitespace trimming together", () => {
      expect(
        emailsMatch(" Test@Example.Com ", "  test@example.com  ")
      ).toBe(true);
      expect(
        emailsMatch("John.Doe@Company.Co.Uk", " JOHN.DOE@COMPANY.CO.UK ")
      ).toBe(true);
    });
  });
});
