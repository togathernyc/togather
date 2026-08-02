/**
 * GiveScreen (container) — the wiring the view can't be asked about.
 *
 * Everything here is a regression guard on the post-Stripe return path, which
 * is unobservable in `GiveScreenView`'s tests because it lives entirely in the
 * container: which id the waiting step subscribes with, that it navigates
 * exactly once, and that the auth-less cancel return short-circuits before any
 * loading UI.
 */
import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import { useAuthenticatedQuery, useStoredAuthToken } from "@services/api/convex";
import { useLocalSearchParams } from "expo-router";
import { GiveScreen } from "../GiveScreen";

const GET_GIVING_CONTEXT = "api.functions.finance.giving.getGivingContext";
const GET_CHECKOUT_STATUS = "api.functions.finance.giving.getCheckoutSessionStatus";
const GET_RECURRING_FOR_FUND = "api.functions.finance.giving.getRecurringForFund";
const CREATE_ONE_OFF = "api.functions.finance.giving.createDonationCheckoutSession";
const CREATE_RECURRING =
  "api.functions.finance.giving.createRecurringDonationCheckoutSession";

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      finance: {
        giving: {
          getGivingContext: "api.functions.finance.giving.getGivingContext",
          getCheckoutSessionStatus:
            "api.functions.finance.giving.getCheckoutSessionStatus",
          getRecurringForFund: "api.functions.finance.giving.getRecurringForFund",
          createDonationCheckoutSession:
            "api.functions.finance.giving.createDonationCheckoutSession",
          createRecurringDonationCheckoutSession:
            "api.functions.finance.giving.createRecurringDonationCheckoutSession",
        },
      },
    },
  },
  useAuthenticatedQuery: jest.fn(),
  useAuthenticatedAction: jest.fn(),
  useStoredAuthToken: jest.fn(),
}));

jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: jest.fn(),
}));

jest.mock("expo-web-browser", () => ({
  openBrowserAsync: jest.fn().mockResolvedValue(undefined),
  dismissBrowser: jest.fn().mockResolvedValue(undefined),
}));

// The view is stubbed to the handful of affordances the container drives, so
// these tests fail for container reasons only.
jest.mock("../GiveScreenView", () => {
  const { Text, Pressable } = require("react-native");
  return {
    GiveScreenView: ({
      step,
      frequency,
      error,
      onContinue,
      onBack,
      onSelectPreset,
      onSelectFrequency,
      canAutoAdvance,
    }: any) => (
      <>
        <Text testID="give-step">{step}</Text>
        <Text testID="give-frequency">{frequency}</Text>
        <Text testID="give-error">{error ?? ""}</Text>
        <Text testID="give-can-auto-advance">{String(canAutoAdvance)}</Text>
        <Pressable testID="give-monthly" onPress={() => onSelectFrequency("monthly")}>
          <Text>Monthly</Text>
        </Pressable>
        <Pressable testID="give-preset" onPress={() => onSelectPreset(5000)}>
          <Text>$50</Text>
        </Pressable>
        <Pressable testID="give-continue" onPress={onContinue}>
          <Text>Give</Text>
        </Pressable>
        <Pressable testID="give-back" onPress={onBack}>
          <Text>Back</Text>
        </Pressable>
      </>
    ),
    GiveCancelledNotice: () => <Text testID="give-cancelled-notice">Gift cancelled</Text>,
  };
});

const { useAuthenticatedAction } = jest.requireMock("@services/api/convex");
const { useRouter } = jest.requireMock("expo-router");

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockCreateSession = jest.fn();
const mockCreateRecurringSession = jest.fn();

let liveContext: Record<string, unknown> = {
  fundId: "fund_1",
  fundName: "Young Adults — Manhattan",
  communityLegalName: "First Church Inc.",
  givingLive: true,
  suggestedAmountsCents: [2500, 5000],
  existingRecurring: null,
};

/** Convex hands back a fresh object per update; identity churn is what the
 * navigate-once guard has to survive. */
let checkoutStatus: Record<string, unknown> | undefined;
/** What `getRecurringForFund` reports while the monthly gift is being set up. */
let recurringStatus: Record<string, unknown> | null | undefined;

function mockQueries() {
  (useAuthenticatedQuery as jest.Mock).mockImplementation(
    (fn: string, args: unknown) => {
      if (fn === GET_GIVING_CONTEXT) return liveContext;
      if (fn === GET_CHECKOUT_STATUS) {
        return args === "skip" || !checkoutStatus ? undefined : { ...checkoutStatus };
      }
      if (fn === GET_RECURRING_FOR_FUND) {
        if (args === "skip") return undefined;
        return recurringStatus ? { ...recurringStatus } : recurringStatus;
      }
      return undefined;
    },
  );
}

/** The args the waiting step passed to `getCheckoutSessionStatus`, last call. */
function lastStatusArgs() {
  const calls = (useAuthenticatedQuery as jest.Mock).mock.calls.filter(
    ([fn]) => fn === GET_CHECKOUT_STATUS,
  );
  return calls[calls.length - 1]?.[1];
}

/** The args the monthly waiting step passed to `getRecurringForFund`. */
function lastRecurringArgs() {
  const calls = (useAuthenticatedQuery as jest.Mock).mock.calls.filter(
    ([fn]) => fn === GET_RECURRING_FOR_FUND,
  );
  return calls[calls.length - 1]?.[1];
}

/** Picks an amount, then submits — `handleContinue` no-ops without one. */
async function pressGive(getByTestId: (id: string) => unknown) {
  await act(async () => {
    fireEvent.press(getByTestId("give-preset") as never);
  });
  await act(async () => {
    fireEvent.press(getByTestId("give-continue") as never);
  });
}

/** Switches to Monthly, picks an amount, then submits. */
async function pressGiveMonthly(getByTestId: (id: string) => unknown) {
  await act(async () => {
    fireEvent.press(getByTestId("give-monthly") as never);
  });
  await pressGive(getByTestId);
}

describe("GiveScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checkoutStatus = undefined;
    recurringStatus = null;
    liveContext = {
      fundId: "fund_1",
      fundName: "Young Adults — Manhattan",
      communityLegalName: "First Church Inc.",
      givingLive: true,
      suggestedAmountsCents: [2500, 5000],
      existingRecurring: null,
    };
    (useLocalSearchParams as jest.Mock).mockReturnValue({ group_id: "group_1" });
    (useStoredAuthToken as jest.Mock).mockReturnValue("token_abc");
    (useRouter as jest.Mock).mockReturnValue({
      replace: mockReplace,
      push: mockPush,
      back: jest.fn(),
      canGoBack: () => true,
    });
    (useAuthenticatedAction as jest.Mock).mockImplementation((fn: string) =>
      fn === CREATE_RECURRING ? mockCreateRecurringSession : mockCreateSession,
    );
    mockCreateSession.mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
      sessionId: "cs_test_123",
      paymentIntentId: "pi_test_123",
    });
    // Subscription-mode Checkout returns no PaymentIntent — the recurring row
    // id is the only join key this path has.
    mockCreateRecurringSession.mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/cs_sub_123",
      sessionId: "cs_sub_123",
      recurringDonationId: "rec_1",
    });
    mockQueries();
  });

  it("does not watch anything until the donor is actually waiting", () => {
    render(<GiveScreen />);
    expect(lastStatusArgs()).toBe("skip");
  });

  // The Checkout Session id (`cs_...`) is not stored anywhere — subscribing
  // with it would report "pending" forever and the donor would never advance.
  it("watches the PaymentIntent id, never the Checkout Session id", async () => {
    const { getByTestId } = render(<GiveScreen />);
    await pressGive(getByTestId);

    expect(lastStatusArgs()).toEqual({ paymentIntentId: "pi_test_123" });
    expect(JSON.stringify(lastStatusArgs())).not.toContain("cs_test_123");
  });

  // Stripe can defer creating the PaymentIntent; the gift still lands via the
  // webhook, so the wait degrades to manual rather than subscribing to garbage.
  it("skips the watch when Stripe returned no PaymentIntent", async () => {
    mockCreateSession.mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
      sessionId: "cs_test_123",
      paymentIntentId: null,
    });
    const { getByTestId } = render(<GiveScreen />);
    await pressGive(getByTestId);

    expect(getByTestId("give-step").props.children).toBe("confirmation");
    expect(lastStatusArgs()).toBe("skip");
    // ...and the view is told, so it can offer an exit that isn't "Cancel".
    expect(getByTestId("give-can-auto-advance").props.children).toBe("false");
  });

  it("routes to the thank-you screen with the recorded amount once the gift lands", async () => {
    checkoutStatus = {
      status: "complete",
      amountCents: 5300,
      fundName: "Young Adults — Manhattan",
      communityName: "First Church Inc.",
    };
    const { getByTestId } = render(<GiveScreen />);
    await pressGive(getByTestId);

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(
      "/groups/group_1/give-success?amount=5300" +
        `&fund=${encodeURIComponent("Young Adults — Manhattan")}` +
        `&community=${encodeURIComponent("First Church Inc.")}`,
    );
  });

  // A lone surrogate in a fund/community name makes `encodeURIComponent` throw,
  // and it would throw here — inside the effect, after the navigate-once guard
  // has latched — costing the donor the thank-you with no retry.
  it("survives a name that would make encodeURIComponent throw", async () => {
    checkoutStatus = {
      status: "complete",
      amountCents: 5000,
      fundName: "Fund \ud800",
      communityName: "First Church",
    };
    const { getByTestId } = render(<GiveScreen />);
    await pressGive(getByTestId);

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(
      "/groups/group_1/give-success?amount=5000&fund=Fund%20&community=First%20Church",
    );
  });

  // The status query keeps reporting "complete" with a fresh object every
  // update; `router.replace` is not idempotent, so the guard is load-bearing.
  it("navigates exactly once no matter how many times 'complete' re-renders", async () => {
    checkoutStatus = { status: "complete", amountCents: 5000 };
    const { getByTestId, rerender } = render(<GiveScreen />);
    await pressGive(getByTestId);

    await act(async () => {
      rerender(<GiveScreen />);
      rerender(<GiveScreen />);
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("stays put while the gift is still pending", async () => {
    checkoutStatus = { status: "pending" };
    const { getByTestId } = render(<GiveScreen />);
    await pressGive(getByTestId);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(getByTestId("give-step").props.children).toBe("confirmation");
  });

  it("dismisses the browser sheet it opened before handing over to the thank-you", async () => {
    checkoutStatus = { status: "complete", amountCents: 5000 };
    const { getByTestId } = render(<GiveScreen />);
    await pressGive(getByTestId);

    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
      "https://checkout.stripe.com/c/pay/cs_test_123",
    );
    expect(WebBrowser.dismissBrowser).toHaveBeenCalled();
  });

  // A monthly gift has no PaymentIntent to watch — subscription-mode Checkout
  // doesn't create one. The waiting step watches the recurring row instead,
  // which Stripe flips to `active` via checkout.session.completed →
  // invoice.paid.
  describe("a monthly gift", () => {
    it("creates a subscription Checkout session, not a one-off", async () => {
      const { getByTestId } = render(<GiveScreen />);
      await pressGiveMonthly(getByTestId);

      expect(mockCreateRecurringSession).toHaveBeenCalledWith(
        expect.objectContaining({ fundId: "fund_1", amountCents: 5000 }),
      );
      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(useAuthenticatedAction).toHaveBeenCalledWith(CREATE_ONE_OFF);
      expect(useAuthenticatedAction).toHaveBeenCalledWith(CREATE_RECURRING);
    });

    it("watches the recurring row's fund, and nothing PaymentIntent-shaped", async () => {
      const { getByTestId } = render(<GiveScreen />);
      await pressGiveMonthly(getByTestId);

      expect(lastRecurringArgs()).toEqual({ fundId: "fund_1" });
      expect(lastStatusArgs()).toBe("skip");
      // ...and the wait is still a watched one, so no manual escape hatch.
      expect(getByTestId("give-can-auto-advance").props.children).toBe("true");
    });

    it("does not watch anything until the donor is actually waiting", () => {
      render(<GiveScreen />);
      expect(lastRecurringArgs()).toBe("skip");
    });

    it("routes to the thank-you with recurring=1 once the gift activates", async () => {
      recurringStatus = {
        id: "rec_1",
        fundId: "fund_1",
        fundName: "Young Adults — Manhattan",
        amountCents: 5000,
        feeCoverCents: 175,
        status: "active",
        currentPeriodEnd: 1,
        createdAt: 1,
      };
      const { getByTestId } = render(<GiveScreen />);
      await pressGiveMonthly(getByTestId);

      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith(
        "/groups/group_1/give-success?amount=5175" +
          `&fund=${encodeURIComponent("Young Adults — Manhattan")}` +
          `&community=${encodeURIComponent("First Church Inc.")}` +
          "&recurring=1",
      );
    });

    it("stays put while the row is still pending (nothing charged yet)", async () => {
      recurringStatus = null; // getRecurringForFund excludes pending rows.
      const { getByTestId } = render(<GiveScreen />);
      await pressGiveMonthly(getByTestId);

      expect(mockReplace).not.toHaveBeenCalled();
      expect(getByTestId("give-step").props.children).toBe("confirmation");
    });

    // Thanking someone for a declined card is the one screen that would stop
    // them fixing it — the failed first invoice keeps them on the waiting step.
    it("does not thank the donor when the first invoice failed", async () => {
      recurringStatus = {
        id: "rec_1",
        fundId: "fund_1",
        fundName: "Young Adults — Manhattan",
        amountCents: 5000,
        feeCoverCents: 0,
        status: "past_due",
        currentPeriodEnd: 1,
        createdAt: 1,
      };
      const { getByTestId } = render(<GiveScreen />);
      await pressGiveMonthly(getByTestId);

      expect(mockReplace).not.toHaveBeenCalled();
      expect(getByTestId("give-step").props.children).toBe("confirmation");
    });

    // A live gift belonging to some OTHER submission must not fake a thank-you
    // for this one.
    it("ignores a live row that isn't the one this submission created", async () => {
      recurringStatus = {
        id: "rec_someone_elses_tab",
        fundId: "fund_1",
        fundName: "Young Adults — Manhattan",
        amountCents: 9900,
        feeCoverCents: 0,
        status: "active",
        currentPeriodEnd: 1,
        createdAt: 1,
      };
      const { getByTestId } = render(<GiveScreen />);
      await pressGiveMonthly(getByTestId);

      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("navigates exactly once no matter how many times 'active' re-renders", async () => {
      recurringStatus = {
        id: "rec_1",
        fundId: "fund_1",
        fundName: "Young Adults — Manhattan",
        amountCents: 5000,
        feeCoverCents: 0,
        status: "active",
        currentPeriodEnd: 1,
        createdAt: 1,
      };
      const { getByTestId, rerender } = render(<GiveScreen />);
      await pressGiveMonthly(getByTestId);

      await act(async () => {
        rerender(<GiveScreen />);
        rerender(<GiveScreen />);
      });

      expect(mockReplace).toHaveBeenCalledTimes(1);
    });

    it("dismisses the browser sheet it opened before handing over", async () => {
      recurringStatus = {
        id: "rec_1",
        fundId: "fund_1",
        fundName: "Young Adults — Manhattan",
        amountCents: 5000,
        feeCoverCents: 0,
        status: "active",
        currentPeriodEnd: 1,
        createdAt: 1,
      };
      const { getByTestId } = render(<GiveScreen />);
      await pressGiveMonthly(getByTestId);

      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
        "https://checkout.stripe.com/c/pay/cs_sub_123",
      );
      expect(WebBrowser.dismissBrowser).toHaveBeenCalled();
    });

    // The rejection this call actually returns in production: a ConvexError
    // whose text is on `.data`, with `.message` reduced to an opaque
    // "[CONVEX A(...)] ... Server Error". A message-parsing formatter would
    // swap "finish that checkout, or try again in a few minutes" — the only
    // sentence that tells the donor what to DO during the grace window — for a
    // generic "couldn't start this gift".
    it("shows the server's actual reason a monthly gift was refused", async () => {
      mockCreateRecurringSession.mockRejectedValue(
        Object.assign(
          new Error(
            "[CONVEX A(functions/finance/giving:createRecurringDonationCheckoutSession)] [Request ID: abc] Server Error",
          ),
          { data: "Finish that checkout, or try again in a few minutes." },
        ),
      );
      const { getByTestId } = render(<GiveScreen />);
      await pressGiveMonthly(getByTestId);

      expect(getByTestId("give-error").props.children).toBe(
        "Finish that checkout, or try again in a few minutes.",
      );
    });

    // One active monthly per fund is a backend rule; the container refuses
    // before spending a Stripe call to be told the same thing.
    it("never starts a second monthly gift to the same fund", async () => {
      liveContext = {
        ...liveContext,
        existingRecurring: { amountCents: 2500, feeCoverCents: 0 },
      };
      const { getByTestId } = render(<GiveScreen />);
      await pressGiveMonthly(getByTestId);

      expect(mockCreateRecurringSession).not.toHaveBeenCalled();
      expect(getByTestId("give-step").props.children).toBe("amount");
    });

    it("still lets that donor give a one-off", async () => {
      liveContext = {
        ...liveContext,
        existingRecurring: { amountCents: 2500, feeCoverCents: 0 },
      };
      const { getByTestId } = render(<GiveScreen />);
      await pressGive(getByTestId);

      expect(mockCreateSession).toHaveBeenCalledTimes(1);
      expect(getByTestId("give-step").props.children).toBe("confirmation");
    });
  });

  describe("the cancel return", () => {
    // Stripe's cancel_url loads inside the in-app browser, which has its own
    // storage and no token: every query skips, so the give screen would sit on
    // a skeleton forever. The notice must render instead — and immediately.
    it("renders the static notice, with no loading state, when there is no auth", () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({
        group_id: "group_1",
        giving: "cancelled",
      });
      (useStoredAuthToken as jest.Mock).mockReturnValue(null);

      const { getByTestId, queryByTestId } = render(<GiveScreen />);
      expect(getByTestId("give-cancelled-notice")).toBeTruthy();
      expect(queryByTestId("give-step")).toBeNull();
    });

    it("returns an authenticated donor to the give form instead", () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({
        group_id: "group_1",
        giving: "cancelled",
      });

      const { getByTestId, queryByTestId } = render(<GiveScreen />);
      expect(queryByTestId("give-cancelled-notice")).toBeNull();
      expect(getByTestId("give-step").props.children).toBe("amount");
    });
  });
});
