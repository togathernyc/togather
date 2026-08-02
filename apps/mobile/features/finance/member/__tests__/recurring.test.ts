/**
 * The phrasing rules every monthly-giving surface shares. Pure functions, so
 * the copy contract ("never restate the gift as the charge", "never print a
 * date Stripe hasn't given us") is asserted once instead of per screen.
 */
import {
  isLiveRecurring,
  formatMonthlyTitle,
  formatMonthlyRate,
  formatMonthlySubtitle,
  formatRecurringDate,
  formatFeeCoverValue,
  type RecurringSummary,
} from "../recurring";

const base: RecurringSummary = {
  id: "rec1",
  fundId: "fund1",
  groupId: "group1",
  fundName: "Young Adults — Manhattan",
  amountCents: 2500,
  feeCoverCents: 0,
  status: "active",
  currentPeriodEnd: Date.UTC(2026, 8, 1, 12),
  createdAt: 1,
};

describe("isLiveRecurring", () => {
  it.each(["active", "past_due"] as const)("counts %s as live", (status) => {
    expect(isLiveRecurring({ ...base, status })).toBe(true);
  });

  // `pending` means the donor is still inside Stripe Checkout and nothing has
  // been charged; `canceled` has nothing left to manage.
  it.each(["pending", "canceled"] as const)("does not count %s", (status) => {
    expect(isLiveRecurring({ ...base, status })).toBe(false);
  });

  it("handles the loading and none cases", () => {
    expect(isLiveRecurring(undefined)).toBe(false);
    expect(isLiveRecurring(null)).toBe(false);
  });
});

describe("formatMonthlyTitle / formatMonthlyRate", () => {
  it("states the gift in the donor's own words", () => {
    expect(formatMonthlyTitle(2500)).toBe("You give $25.00 monthly");
    expect(formatMonthlyRate(2500)).toBe("$25.00/month");
  });

  // The card is charged gift + fee cover, but the GIFT is what the donor
  // chose. Restating it as the charge shows them a number they never picked.
  it("says nothing about the fee cover", () => {
    expect(formatMonthlyTitle(2500)).not.toContain("26");
    expect(formatMonthlyRate(2500)).not.toContain("26");
  });
});

describe("formatRecurringDate", () => {
  it("renders a short absolute date, never a countdown", () => {
    const label = formatRecurringDate(Date.UTC(2026, 8, 1, 12));
    expect(label).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
    expect(label).not.toMatch(/\bin\b|\bdays?\b/);
  });

  it("returns null rather than 'Invalid Date' for anything unusable", () => {
    expect(formatRecurringDate(null)).toBeNull();
    expect(formatRecurringDate(NaN)).toBeNull();
    expect(formatRecurringDate(Infinity)).toBeNull();
  });
});

describe("formatMonthlySubtitle", () => {
  it("leads with the next gift date", () => {
    expect(formatMonthlySubtitle(base)).toMatch(/^Next gift .+ · Manage or cancel$/);
  });

  it("drops the date when Stripe hasn't reported a period yet", () => {
    expect(formatMonthlySubtitle({ ...base, currentPeriodEnd: null })).toBe(
      "Manage or cancel",
    );
  });

  // A donor whose card is failing has no next date worth promising, and the
  // sub-line is the only place to tell them.
  it("replaces the whole line when the payment is failing", () => {
    const line = formatMonthlySubtitle({ ...base, status: "past_due" });
    expect(line).toBe("Payment issue — tap to fix");
    expect(line).not.toMatch(/Next gift/);
  });
});

describe("formatFeeCoverValue", () => {
  it("names the amount when the fee is covered", () => {
    expect(formatFeeCoverValue(105)).toBe("On · +$1.05");
  });

  it("says Off without a number when it isn't", () => {
    expect(formatFeeCoverValue(0)).toBe("Off");
  });
});
