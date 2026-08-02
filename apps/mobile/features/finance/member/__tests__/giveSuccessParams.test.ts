import { parseGiveSuccessParams } from "../giveSuccessParams";

describe("parseGiveSuccessParams", () => {
  it("formats the charged total from integer cents", () => {
    expect(
      parseGiveSuccessParams({ amount: "5000" }).amountLabel,
    ).toBe("$50.00");
  });

  it("keeps sub-dollar cents rather than rounding them away", () => {
    expect(parseGiveSuccessParams({ amount: "5175" }).amountLabel).toBe("$51.75");
    expect(parseGiveSuccessParams({ amount: "7" }).amountLabel).toBe("$0.07");
  });

  it("groups thousands", () => {
    expect(parseGiveSuccessParams({ amount: "123456" }).amountLabel).toBe("$1,234.56");
  });

  // The whole point of the null: a hand-typed or truncated URL must thank the
  // donor without ever rendering "$NaN".
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not a number", "abc"],
    ["a float", "50.5"],
    ["negative", "-100"],
    ["zero", "0"],
    ["padded with junk", "50abc"],
  ])("hides the amount line when the param is %s", (_label, amount) => {
    expect(parseGiveSuccessParams({ amount }).amountLabel).toBeNull();
  });

  it("names the community in the thank-you when it's present", () => {
    expect(
      parseGiveSuccessParams({ community: "First Church Inc." }).thankYouLine,
    ).toBe("First Church Inc. says thank you");
  });

  it("falls back to a community-agnostic thank-you when it isn't", () => {
    expect(parseGiveSuccessParams({}).thankYouLine).toBe("Thank you 🎉");
    expect(parseGiveSuccessParams({ community: "   " }).thankYouLine).toBe("Thank you 🎉");
  });

  it("names the fund when it's present, and omits the line when it isn't", () => {
    expect(parseGiveSuccessParams({ fund: "Young Adults" }).fundLine).toBe(
      "to Young Adults",
    );
    expect(parseGiveSuccessParams({}).fundLine).toBeNull();
  });

  // expo-router hands repeated query keys back as an array.
  it("takes the first value when a param repeats", () => {
    expect(
      parseGiveSuccessParams({
        amount: ["5000", "999999"],
        fund: ["Real Fund", "Fake"],
        community: ["Real Church", "Fake"],
      }),
    ).toEqual({
      amountLabel: "$50.00",
      thankYouLine: "Real Church says thank you",
      fundLine: "to Real Fund",
    });
  });

  it("still thanks when every param is garbage", () => {
    const result = parseGiveSuccessParams({ amount: "NaN" });
    expect(result.amountLabel).toBeNull();
    expect(result.thankYouLine).toBe("Thank you 🎉");
    expect(result.fundLine).toBeNull();
  });
});
