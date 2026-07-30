import { validateReimbursement } from "../validateReimbursement";
import { parseDollarsToCents, resolveGiveAmountCents, estimateCoverFeesCents } from "../amount";

describe("validateReimbursement", () => {
  it("requires a valid amount", () => {
    const result = validateReimbursement({
      amountText: "",
      description: "Snacks",
      receiptReady: true,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Enter an amount");
    expect(result.amountCents).toBeNull();
  });

  it("rejects a zero or negative amount", () => {
    expect(
      validateReimbursement({ amountText: "0", description: "Snacks", receiptReady: true })
        .valid,
    ).toBe(false);
  });

  it("requires a description once the amount is valid", () => {
    const result = validateReimbursement({
      amountText: "12.50",
      description: "   ",
      receiptReady: true,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Add a short description");
    expect(result.amountCents).toBe(1250);
  });

  it("requires a receipt once amount and description are valid", () => {
    const result = validateReimbursement({
      amountText: "12.50",
      description: "Snacks for small group",
      receiptReady: false,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Attach a receipt photo");
  });

  it("is valid once amount, description, and receipt are all present", () => {
    const result = validateReimbursement({
      amountText: "12.50",
      description: "Snacks for small group",
      receiptReady: true,
    });
    expect(result.valid).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.amountCents).toBe(1250);
  });
});

describe("parseDollarsToCents", () => {
  it("parses whole and decimal dollar amounts", () => {
    expect(parseDollarsToCents("25")).toBe(2500);
    expect(parseDollarsToCents("25.5")).toBe(2550);
    expect(parseDollarsToCents("25.50")).toBe(2550);
    expect(parseDollarsToCents("$25.00")).toBe(2500);
  });

  it("rejects a decimal amount when allowCents is false", () => {
    expect(parseDollarsToCents("25.50", { allowCents: false })).toBeNull();
    expect(parseDollarsToCents("25", { allowCents: false })).toBe(2500);
  });

  it("rejects empty, zero, negative, and non-numeric input", () => {
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("0")).toBeNull();
    expect(parseDollarsToCents("-5")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
  });
});

describe("resolveGiveAmountCents", () => {
  it("prefers a selected preset over the custom amount field", () => {
    expect(resolveGiveAmountCents(5000, "10")).toBe(5000);
  });

  it("falls back to the parsed custom amount when no preset is selected", () => {
    expect(resolveGiveAmountCents(null, "25")).toBe(2500);
  });

  it("returns null when neither is a valid amount", () => {
    expect(resolveGiveAmountCents(null, "")).toBeNull();
  });
});

describe("estimateCoverFeesCents", () => {
  it("computes ~2.9% + 30 cents", () => {
    // 5000 * 0.029 = 145, + 30 = 175
    expect(estimateCoverFeesCents(5000)).toBe(175);
  });

  it("returns 0 for a non-positive amount", () => {
    expect(estimateCoverFeesCents(0)).toBe(0);
    expect(estimateCoverFeesCents(-100)).toBe(0);
  });
});
