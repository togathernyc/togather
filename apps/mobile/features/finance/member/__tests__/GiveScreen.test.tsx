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

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      finance: {
        giving: {
          getGivingContext: "api.functions.finance.giving.getGivingContext",
          getCheckoutSessionStatus:
            "api.functions.finance.giving.getCheckoutSessionStatus",
          createDonationCheckoutSession:
            "api.functions.finance.giving.createDonationCheckoutSession",
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
    GiveScreenView: ({ step, onContinue, onBack, onSelectPreset }: any) => (
      <>
        <Text testID="give-step">{step}</Text>
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

const liveContext = {
  fundId: "fund_1",
  fundName: "Young Adults — Manhattan",
  communityLegalName: "First Church Inc.",
  givingLive: true,
  suggestedAmountsCents: [2500, 5000],
};

/** Convex hands back a fresh object per update; identity churn is what the
 * navigate-once guard has to survive. */
let checkoutStatus: Record<string, unknown> | undefined;

function mockQueries() {
  (useAuthenticatedQuery as jest.Mock).mockImplementation(
    (fn: string, args: unknown) => {
      if (fn === GET_GIVING_CONTEXT) return liveContext;
      if (fn === GET_CHECKOUT_STATUS) {
        return args === "skip" || !checkoutStatus ? undefined : { ...checkoutStatus };
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

/** Picks an amount, then submits — `handleContinue` no-ops without one. */
async function pressGive(getByTestId: (id: string) => unknown) {
  await act(async () => {
    fireEvent.press(getByTestId("give-preset") as never);
  });
  await act(async () => {
    fireEvent.press(getByTestId("give-continue") as never);
  });
}

describe("GiveScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checkoutStatus = undefined;
    (useLocalSearchParams as jest.Mock).mockReturnValue({ group_id: "group_1" });
    (useStoredAuthToken as jest.Mock).mockReturnValue("token_abc");
    (useRouter as jest.Mock).mockReturnValue({
      replace: mockReplace,
      push: mockPush,
      back: jest.fn(),
      canGoBack: () => true,
    });
    (useAuthenticatedAction as jest.Mock).mockReturnValue(mockCreateSession);
    mockCreateSession.mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
      sessionId: "cs_test_123",
      paymentIntentId: "pi_test_123",
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
