/**
 * give-success — the thank-you Stripe returns donors to.
 *
 * The parsing is covered in `giveSuccessParams.test.ts`; what's asserted here
 * is the part that can strand someone: whether the screen navigates, and where
 * to. It is reached in two very different contexts — the real app, and Stripe's
 * in-app browser, which has no session — and only one of them has a fund screen
 * worth returning to.
 */
import React from "react";
import { render, screen, act } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useStoredAuthToken } from "@services/api/convex";
import GiveSuccessScreen from "../give-success";

jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: jest.fn(),
}));

jest.mock("@services/api/convex", () => ({
  useStoredAuthToken: jest.fn(),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

const mockBack = jest.fn();
const mockReplace = jest.fn();
let canGoBack = true;

function setParams(params: Record<string, string>) {
  (useLocalSearchParams as jest.Mock).mockReturnValue({
    group_id: "group_1",
    ...params,
  });
}

describe("GiveSuccessScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    canGoBack = true;
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(false);
    jest
      .spyOn(AccessibilityInfo, "addEventListener")
      .mockReturnValue({ remove: jest.fn() } as never);
    setParams({ amount: "5000", fund: "Young Adults", community: "First Church" });
    (useStoredAuthToken as jest.Mock).mockReturnValue("token_abc");
    (useRouter as jest.Mock).mockReturnValue({
      back: mockBack,
      replace: mockReplace,
      canGoBack: () => canGoBack,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("thanks the donor in the community's name and shows the amount in dollars", () => {
    render(<GiveSuccessScreen />);
    expect(screen.getByText("First Church says thank you")).toBeTruthy();
    expect(screen.getByTestId("give-success-amount").props.children).toBe("$50.00");
    expect(screen.getByText("to Young Adults")).toBeTruthy();
  });

  it("shows no amount rather than '$NaN' when the param is garbage", () => {
    setParams({ amount: "not-a-number" });
    render(<GiveSuccessScreen />);
    expect(screen.queryByTestId("give-success-amount")).toBeNull();
    expect(screen.getByText("Thank you 🎉")).toBeTruthy();
  });

  // fund → give → (replaced) give-success: the fund is still one frame down.
  // Replacing instead would stack a second copy, and Back from it would reveal
  // an identical fund screen and look like a no-op.
  it("pops back to the fund already in the stack", () => {
    render(<GiveSuccessScreen />);
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("replaces into the fund when there is no stack at all", () => {
    canGoBack = false;
    render(<GiveSuccessScreen />);
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(mockReplace).toHaveBeenCalledWith("/groups/group_1/fund");
  });

  // The root layout pins `(tabs)` as initialRouteName, so a cold deep link
  // DOES have a frame underneath — popping would drop the donor on the tab bar.
  // `session_id` is on Stripe's success_url and nothing else.
  it("replaces after Stripe's redirect even though the tab bar is poppable", () => {
    setParams({ amount: "5000", session_id: "cs_test_123" });
    canGoBack = true;
    render(<GiveSuccessScreen />);
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(mockReplace).toHaveBeenCalledWith("/groups/group_1/fund");
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("pops, not replaces, when the native flow routed here (no session_id)", () => {
    render(<GiveSuccessScreen />);
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("does not navigate before the auto-return delay is up", () => {
    render(<GiveSuccessScreen />);
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("drops the pending auto-return when it unmounts", () => {
    const { unmount } = render(<GiveSuccessScreen />);
    unmount();
    act(() => {
      jest.advanceTimersByTime(10000);
    });
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  // The GIF is a 54-frame burst; firing it at someone who asked for less
  // motion, as the reward for paying, is exactly the case the setting exists
  // for. The waiting dots already honour it.
  describe("Reduce Motion", () => {
    it("plays the celebration when motion is fine", async () => {
      render(<GiveSuccessScreen />);
      await act(async () => {});
      expect(screen.getByTestId("give-success-gif")).toBeTruthy();
      expect(screen.queryByTestId("give-success-static-mark")).toBeNull();
    });

    it("swaps it for a still mark when the setting is on", async () => {
      (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
      render(<GiveSuccessScreen />);
      await act(async () => {});
      expect(screen.getByTestId("give-success-static-mark")).toBeTruthy();
      expect(screen.queryByTestId("give-success-gif")).toBeNull();
    });

    // Nothing animates while the answer is still in flight, and nothing
    // animates if it never arrives (RN-Web rejects rather than resolving).
    it("stays still while detection is pending, and if it never resolves", async () => {
      (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockRejectedValue(
        new Error("unsupported"),
      );
      render(<GiveSuccessScreen />);
      expect(screen.getByTestId("give-success-static-mark")).toBeTruthy();
      await act(async () => {});
      expect(screen.getByTestId("give-success-static-mark")).toBeTruthy();
    });
  });

  // Stripe's in-app browser has its own storage and no session, so /fund there
  // is a skeleton that never fills. The thank-you is terminal in that context.
  describe("inside Stripe's auth-less in-app browser", () => {
    beforeEach(() => {
      (useStoredAuthToken as jest.Mock).mockReturnValue(null);
    });

    it("never auto-returns", () => {
      render(<GiveSuccessScreen />);
      act(() => {
        jest.advanceTimersByTime(30000);
      });
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("tells the donor to close the window instead of offering Done", () => {
      render(<GiveSuccessScreen />);
      expect(screen.getByTestId("give-success-close-hint")).toBeTruthy();
      expect(screen.queryByLabelText("Done")).toBeNull();
    });

    it("still shows the thank-you and the amount", () => {
      render(<GiveSuccessScreen />);
      expect(screen.getByText("First Church says thank you")).toBeTruthy();
      expect(screen.getByTestId("give-success-amount").props.children).toBe("$50.00");
    });
  });
});
