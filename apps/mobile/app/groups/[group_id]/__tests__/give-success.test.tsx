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

  it("replaces into the fund when there is no stack (a cold web boot on success_url)", () => {
    canGoBack = false;
    render(<GiveSuccessScreen />);
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(mockReplace).toHaveBeenCalledWith("/groups/group_1/fund");
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
