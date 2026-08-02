/**
 * MonthlyGivingScreen (container) — the wiring the view can't be asked about:
 * that stopping a gift is confirmed through the web-safe helper (not
 * `Alert.alert`, which is a no-op on web), that a declined confirm changes
 * nothing, and that the card row leaves for Stripe rather than trying to
 * collect a card in-app.
 */
import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import { useAuthenticatedQuery } from "@services/api/convex";
import { useLocalSearchParams } from "expo-router";
import { confirmAsync } from "@/utils/platformAlert";
import { MonthlyGivingScreen } from "../MonthlyGivingScreen";
import { estimateCoverFeesCents } from "../amount";

const GET_GIVING_CONTEXT = "api.functions.finance.giving.getGivingContext";
const GET_RECURRING_FOR_FUND = "api.functions.finance.giving.getRecurringForFund";
const UPDATE_AMOUNT = "api.functions.finance.giving.updateRecurringAmount";
const CANCEL = "api.functions.finance.giving.cancelRecurringDonation";
const CARD_UPDATE = "api.functions.finance.giving.createCardUpdateSession";

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      finance: {
        giving: {
          getGivingContext: "api.functions.finance.giving.getGivingContext",
          getRecurringForFund: "api.functions.finance.giving.getRecurringForFund",
          updateRecurringAmount: "api.functions.finance.giving.updateRecurringAmount",
          cancelRecurringDonation:
            "api.functions.finance.giving.cancelRecurringDonation",
          createCardUpdateSession:
            "api.functions.finance.giving.createCardUpdateSession",
        },
      },
    },
  },
  useAuthenticatedQuery: jest.fn(),
  useAuthenticatedAction: jest.fn(),
}));

jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: jest.fn(),
}));

jest.mock("expo-web-browser", () => ({
  openBrowserAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/utils/platformAlert", () => ({
  confirmAsync: jest.fn(),
}));

// Stubbed to the handful of affordances the container drives, so these tests
// fail for container reasons only.
jest.mock("../MonthlyGivingScreenView", () => {
  const { Text, Pressable } = require("react-native");
  return {
    MonthlyGivingScreenView: ({
      recurring,
      editing,
      editAmountText,
      error,
      onStartEdit,
      onAmountChange,
      onSaveAmount,
      onUpdateCard,
      onCancelRecurring,
    }: any) => (
      <>
        <Text testID="mg-recurring">{recurring === undefined ? "loading" : String(recurring?.status ?? "none")}</Text>
        <Text testID="mg-editing">{String(editing)}</Text>
        <Text testID="mg-amount-text">{editAmountText}</Text>
        <Text testID="mg-error">{error ?? ""}</Text>
        <Pressable testID="mg-start-edit" onPress={onStartEdit}>
          <Text>Change amount</Text>
        </Pressable>
        <Pressable testID="mg-type-50" onPress={() => onAmountChange("50")}>
          <Text>Type 50</Text>
        </Pressable>
        <Pressable testID="mg-save" onPress={onSaveAmount}>
          <Text>Save</Text>
        </Pressable>
        <Pressable testID="mg-update-card" onPress={onUpdateCard}>
          <Text>Update card</Text>
        </Pressable>
        <Pressable testID="mg-cancel" onPress={onCancelRecurring}>
          <Text>Cancel monthly giving</Text>
        </Pressable>
      </>
    ),
  };
});

const { useAuthenticatedAction } = jest.requireMock("@services/api/convex");
const { useRouter } = jest.requireMock("expo-router");

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockUpdateAmount = jest.fn();
const mockCancel = jest.fn();
const mockCardUpdate = jest.fn();

const context = {
  fundId: "fund_1",
  fundName: "Young Adults — Manhattan",
  communityLegalName: "First Church Inc.",
  givingLive: true,
  suggestedAmountsCents: [1000, 2500, 5000],
  existingRecurring: { amountCents: 2500, feeCoverCents: 105 },
};

const activeRow = {
  id: "rec_1",
  fundId: "fund_1",
  groupId: "group_1",
  fundName: "Young Adults — Manhattan",
  amountCents: 2500,
  feeCoverCents: 105,
  status: "active",
  currentPeriodEnd: Date.UTC(2026, 8, 1, 12),
  createdAt: 1,
};

let recurring: Record<string, unknown> | null | undefined = activeRow;

describe("MonthlyGivingScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    recurring = activeRow;
    (useLocalSearchParams as jest.Mock).mockReturnValue({ group_id: "group_1" });
    (useRouter as jest.Mock).mockReturnValue({
      back: mockBack,
      replace: mockReplace,
      push: jest.fn(),
      canGoBack: () => true,
    });
    (useAuthenticatedQuery as jest.Mock).mockImplementation((fn: string) => {
      if (fn === GET_GIVING_CONTEXT) return context;
      if (fn === GET_RECURRING_FOR_FUND) return recurring;
      return undefined;
    });
    (useAuthenticatedAction as jest.Mock).mockImplementation((fn: string) => {
      if (fn === UPDATE_AMOUNT) return mockUpdateAmount;
      if (fn === CANCEL) return mockCancel;
      if (fn === CARD_UPDATE) return mockCardUpdate;
      return jest.fn();
    });
    mockUpdateAmount.mockResolvedValue({ amountCents: 5000, feeCoverCents: 0 });
    mockCancel.mockResolvedValue({ canceled: true });
    mockCardUpdate.mockResolvedValue({
      url: "https://billing.stripe.com/p/session/test_123",
    });
    (confirmAsync as jest.Mock).mockResolvedValue(true);
  });

  it("reads the donor's gift for the fund the group's giving context names", () => {
    const { getByTestId } = render(<MonthlyGivingScreen />);
    const call = (useAuthenticatedQuery as jest.Mock).mock.calls.find(
      ([fn]) => fn === GET_RECURRING_FOR_FUND,
    );
    expect(call?.[1]).toEqual({ fundId: "fund_1" });
    expect(getByTestId("mg-recurring").props.children).toBe("active");
  });

  // Giving not being set up for the group at all is the same answer as "you
  // have no monthly gift here" — but neither may be confused with loading.
  it("reports no gift when giving isn't set up for the group", () => {
    (useAuthenticatedQuery as jest.Mock).mockImplementation((fn: string) =>
      fn === GET_GIVING_CONTEXT ? null : undefined,
    );
    const { getByTestId } = render(<MonthlyGivingScreen />);
    expect(getByTestId("mg-recurring").props.children).toBe("none");
  });

  it("stays on the loading state while the context is still resolving", () => {
    (useAuthenticatedQuery as jest.Mock).mockReturnValue(undefined);
    const { getByTestId } = render(<MonthlyGivingScreen />);
    expect(getByTestId("mg-recurring").props.children).toBe("loading");
  });

  // Opening on an empty field would make the donor re-derive what they already
  // give before they can change it.
  it("seeds the editor with the amount they currently give", () => {
    const { getByTestId } = render(<MonthlyGivingScreen />);
    act(() => {
      fireEvent.press(getByTestId("mg-start-edit"));
    });
    expect(getByTestId("mg-editing").props.children).toBe("true");
    expect(getByTestId("mg-amount-text").props.children).toBe("25");
  });

  // The fee-cover choice carries over too, and is RE-QUOTED for the new
  // amount: sending the old $1.05 with a $50 gift would silently under-cover
  // the fund by exactly the difference.
  it("submits the new amount with a fee re-quoted for it, then closes the editor", async () => {
    const { getByTestId } = render(<MonthlyGivingScreen />);
    act(() => {
      fireEvent.press(getByTestId("mg-start-edit"));
    });
    act(() => {
      fireEvent.press(getByTestId("mg-type-50"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("mg-save"));
    });

    expect(mockUpdateAmount).toHaveBeenCalledWith({
      recurringDonationId: "rec_1",
      amountCents: 5000,
      coverFeesCents: estimateCoverFeesCents(5000),
    });
    expect(getByTestId("mg-editing").props.children).toBe("false");
  });

  it("sends no fee at all when the donor never covered one", async () => {
    recurring = { ...(recurring as object), feeCoverCents: 0 } as typeof recurring;
    const { getByTestId } = render(<MonthlyGivingScreen />);
    act(() => {
      fireEvent.press(getByTestId("mg-start-edit"));
    });
    act(() => {
      fireEvent.press(getByTestId("mg-type-50"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("mg-save"));
    });

    expect(mockUpdateAmount).toHaveBeenCalledWith(
      expect.objectContaining({ coverFeesCents: 0 }),
    );
  });

  it("keeps the editor open and shows why when the change is rejected", async () => {
    mockUpdateAmount.mockRejectedValue(new Error("Donation amount must be between"));
    const { getByTestId } = render(<MonthlyGivingScreen />);
    act(() => {
      fireEvent.press(getByTestId("mg-start-edit"));
    });
    act(() => {
      fireEvent.press(getByTestId("mg-type-50"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("mg-save"));
    });

    expect(getByTestId("mg-editing").props.children).toBe("true");
    expect(getByTestId("mg-error").props.children).toMatch(/must be between/);
  });

  describe("stopping the gift", () => {
    // `Alert.alert` is a no-op on web in this codebase — a confirm built on it
    // would silently never stop anything there.
    it("confirms through the web-safe helper, naming what is and isn't ended", async () => {
      const { getByTestId } = render(<MonthlyGivingScreen />);
      await act(async () => {
        fireEvent.press(getByTestId("mg-cancel"));
      });

      expect(confirmAsync).toHaveBeenCalledTimes(1);
      const opts = (confirmAsync as jest.Mock).mock.calls[0][0];
      expect(opts.message).toBe("Ends future gifts. Past gifts stay.");
      expect(opts.destructive).toBe(true);
    });

    it("stops the gift and returns to the fund once confirmed", async () => {
      const { getByTestId } = render(<MonthlyGivingScreen />);
      await act(async () => {
        fireEvent.press(getByTestId("mg-cancel"));
      });

      expect(mockCancel).toHaveBeenCalledWith({ recurringDonationId: "rec_1" });
      expect(mockBack).toHaveBeenCalledTimes(1);
    });

    it("does nothing at all when the donor backs out of the confirm", async () => {
      (confirmAsync as jest.Mock).mockResolvedValue(false);
      const { getByTestId } = render(<MonthlyGivingScreen />);
      await act(async () => {
        fireEvent.press(getByTestId("mg-cancel"));
      });

      expect(mockCancel).not.toHaveBeenCalled();
      expect(mockBack).not.toHaveBeenCalled();
    });

    it("stays put and says why when the stop fails", async () => {
      mockCancel.mockRejectedValue(new Error("Network request failed"));
      const { getByTestId } = render(<MonthlyGivingScreen />);
      await act(async () => {
        fireEvent.press(getByTestId("mg-cancel"));
      });

      expect(mockBack).not.toHaveBeenCalled();
      expect(getByTestId("mg-error").props.children).toBeTruthy();
    });
  });

  describe("updating the card", () => {
    it("opens the Stripe portal URL it was handed", async () => {
      const { getByTestId } = render(<MonthlyGivingScreen />);
      await act(async () => {
        fireEvent.press(getByTestId("mg-update-card"));
      });

      expect(mockCardUpdate).toHaveBeenCalledWith({ recurringDonationId: "rec_1" });
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
        "https://billing.stripe.com/p/session/test_123",
      );
    });

    it("surfaces a failure rather than opening nothing silently", async () => {
      mockCardUpdate.mockRejectedValue(new Error("still being set up"));
      const { getByTestId } = render(<MonthlyGivingScreen />);
      await act(async () => {
        fireEvent.press(getByTestId("mg-update-card"));
      });

      expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
      expect(getByTestId("mg-error").props.children).toMatch(/still being set up/);
    });
  });
});
