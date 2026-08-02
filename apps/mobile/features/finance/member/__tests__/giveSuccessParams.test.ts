import { parseGiveSuccessParams, urlSafeName } from "../giveSuccessParams";

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

  // The amount above the fund line is ONE MONTH's charge. Without "every
  // month", the screen reads as a one-off for the same money.
  describe("a monthly gift", () => {
    it("says the gift repeats, and to where", () => {
      expect(
        parseGiveSuccessParams({ fund: "Young Adults", recurring: "1" }).fundLine,
      ).toBe("every month to Young Adults");
    });

    it("still says it repeats when the fund name is missing", () => {
      expect(parseGiveSuccessParams({ recurring: "1" }).fundLine).toBe("every month");
    });

    it("acknowledges the monthly commitment in the thank-you", () => {
      expect(
        parseGiveSuccessParams({ community: "First Church Inc.", recurring: "1" })
          .thankYouLine,
      ).toBe("First Church Inc. says thank you for giving monthly");
      expect(parseGiveSuccessParams({ recurring: "1" }).thankYouLine).toBe(
        "Thank you for giving monthly 🎉",
      );
    });

    // Only the flag the backend and the native watcher actually set counts —
    // anything else is a hand-typed URL and reads as a one-off.
    it.each(["0", "true", "yes", ""])("ignores recurring=%p", (recurring) => {
      expect(parseGiveSuccessParams({ fund: "Young Adults", recurring }).fundLine).toBe(
        "to Young Adults",
      );
    });
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

// The native auto-advance builds this query string itself (the backend's copy
// only covers Stripe's success_url), and it does so inside the effect that has
// already latched the navigate-once guard — a throw there costs the donor the
// thank-you with no retry.
describe("urlSafeName", () => {
  it("percent-encodes the way the query string needs", () => {
    expect(urlSafeName("Young Adults — Manhattan")).toBe(
      encodeURIComponent("Young Adults — Manhattan"),
    );
  });

  it("keeps emoji and other valid surrogate pairs intact", () => {
    expect(decodeURIComponent(urlSafeName("Kids 🎉"))).toBe("Kids 🎉");
  });

  it("drops an unpaired surrogate instead of throwing", () => {
    expect(() => encodeURIComponent("Fund \ud800")).toThrow(URIError);
    expect(decodeURIComponent(urlSafeName("Fund \ud800"))).toBe("Fund ");
  });

  it("caps the length, without leaving a half pair behind at the cut", () => {
    const name = "🎉".repeat(80);
    const out = decodeURIComponent(urlSafeName(name));
    expect(out).toBe("🎉".repeat(50));
  });
});
