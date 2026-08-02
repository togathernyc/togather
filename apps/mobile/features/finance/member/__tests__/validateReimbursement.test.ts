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

/** What Stripe actually takes off a charge of `totalCents` (2.9% + 30c). */
function stripeTakesCents(totalCents: number): number {
  return Math.round(totalCents * 0.029 + 30);
}

describe("estimateCoverFeesCents", () => {
  it("grosses up so the fund nets the full amount, not amount-minus-the-fee-on-the-fee", () => {
    // Naive (fee on the base only) would be round(5000 * 0.029 + 30) = 175,
    // which leaves the fund $49.95 on a $50 gift. The gross-up is
    // (5000 + 30) / (1 - 0.029) - 5000 = 180.2c.
    expect(estimateCoverFeesCents(5000)).toBe(180);
  });

  it.each([1000, 5000, 10000, 30000, 2_000_000])(
    "leaves the fund with at least %i cents after Stripe's cut",
    (amountCents) => {
      const total = amountCents + estimateCoverFeesCents(amountCents);
      const net = total - stripeTakesCents(total);
      expect(net).toBeGreaterThanOrEqual(amountCents);
      // …and never overshoots by more than a rounding cent.
      expect(net).toBeLessThanOrEqual(amountCents + 1);
    },
  );

  it("never decreases as the amount grows", () => {
    let previous = 0;
    for (let amountCents = 100; amountCents <= 2_000_000; amountCents += 997) {
      const fee = estimateCoverFeesCents(amountCents);
      expect(fee).toBeGreaterThanOrEqual(previous);
      previous = fee;
    }
  });

  it("returns 0 for a non-positive amount", () => {
    expect(estimateCoverFeesCents(0)).toBe(0);
    expect(estimateCoverFeesCents(-100)).toBe(0);
  });
});
