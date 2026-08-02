import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { GiveScreenView, GiveCancelledNotice } from "../GiveScreenView";
import { estimateCoverFeesCents } from "../amount";
import { formatCents } from "../../format";
import type { GivingContext } from "../types";

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      background: "#fff",
      surface: "#fff",
      surfaceSecondary: "#f5f5f5",
      text: "#111",
      textSecondary: "#666",
      textTertiary: "#999",
      textInverse: "#fff",
      border: "#e0e0e0",
      buttonPrimary: "#222",
      buttonSecondary: "#fafafa",
      buttonDisabled: "#ccc",
      success: "#2e7d32",
      error: "#c00",
      link: "#06f",
      destructive: "#c00",
      iconSecondary: "#999",
      separator: "#e0e0e0",
      backgroundGrouped: "#F2F2F2",
      surfaceGrouped: "#FFFFFF",
      buttonPrimaryText: "#fff",
    },
    isDark: false,
  }),
}));

jest.mock("@components/ui", () => {
  const ReactActual = jest.requireActual("react");
  const RN = jest.requireActual("react-native");
  return {
    Button: ({ children, onPress, disabled }: any) =>
      ReactActual.createElement(
        RN.TouchableOpacity,
        {
          onPress,
          disabled,
          accessibilityState: { disabled },
          accessibilityLabel: typeof children === "string" ? children : undefined,
        },
        ReactActual.createElement(RN.Text, null, children),
      ),
    Input: ({ label, value, onChangeText, placeholder }: any) =>
      ReactActual.createElement(
        RN.View,
        null,
        label ? ReactActual.createElement(RN.Text, null, label) : null,
        ReactActual.createElement(RN.TextInput, {
          value,
          onChangeText,
          placeholder,
          testID: `input-${label}`,
        }),
      ),
    Switch: ({ value, onValueChange, label }: any) =>
      ReactActual.createElement(
        RN.TouchableOpacity,
        { onPress: () => onValueChange(!value), accessibilityLabel: label },
        ReactActual.createElement(RN.Text, null, label),
      ),
    Skeleton: (props: any) =>
      ReactActual.createElement(RN.View, { testID: "skeleton", ...props }),
    EmptyState: ({ title, message }: any) =>
      ReactActual.createElement(
        RN.View,
        null,
        ReactActual.createElement(RN.Text, null, title),
        message ? ReactActual.createElement(RN.Text, null, message) : null,
      ),
  };
});

const liveContext: GivingContext = {
  fundId: "fund1",
  fundName: "Young Adults — Manhattan",
  communityLegalName: "First Church Inc.",
  suggestedAmountsCents: [1000, 5000, 10000],
  givingLive: true,
};

const noop = () => {};

const baseProps = {
  context: liveContext,
  step: "amount" as const,
  selectedPresetCents: null,
  customAmountText: "",
  coverFees: false,
  submitting: false,
  error: null,
  checkoutSession: null,
  onBack: noop,
  onSelectPreset: noop,
  onCustomAmountChange: noop,
  onToggleCoverFees: noop,
  onContinue: noop,
  onReopenCheckout: noop,
};

describe("GiveScreenView", () => {
  it("shows a loading skeleton while context is undefined", () => {
    render(<GiveScreenView {...baseProps} context={undefined} />);
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("shows the empty state when giving isn't set up", () => {
    render(<GiveScreenView {...baseProps} context={null} />);
    expect(screen.getByText("Giving isn't set up for this group yet")).toBeTruthy();
  });

  it("disables the flow with a friendly message when givingLive is false", () => {
    render(
      <GiveScreenView {...baseProps} context={{ ...liveContext, givingLive: false }} />,
    );
    expect(screen.getByText("Giving isn't available right now")).toBeTruthy();
    expect(screen.queryByLabelText("Give")).toBeNull();
  });

  it("shows the tax-deductible legal line with the community's legal name", () => {
    render(<GiveScreenView {...baseProps} />);
    expect(
      screen.getByText("Tax-deductible gift to First Church Inc."),
    ).toBeTruthy();
  });

  it("calls onSelectPreset when a preset chip is tapped", () => {
    const onSelectPreset = jest.fn();
    render(<GiveScreenView {...baseProps} onSelectPreset={onSelectPreset} />);
    fireEvent.press(screen.getByLabelText(`${formatCents(5000)} preset`));
    expect(onSelectPreset).toHaveBeenCalledWith(5000);
  });

  // The big display and the chips are one field: a tapped chip writes its
  // dollars into the same input the donor types in.
  it("shows a tapped preset's dollars in the typed-amount display", () => {
    render(<GiveScreenView {...baseProps} selectedPresetCents={5000} />);
    expect(screen.getByTestId("give-amount-input").props.value).toBe("50");
  });

  it("shows what the donor typed when no preset is selected", () => {
    render(<GiveScreenView {...baseProps} customAmountText="37" />);
    expect(screen.getByTestId("give-amount-input").props.value).toBe("37");
  });

  it("routes typing through onCustomAmountChange (which clears the preset upstream)", () => {
    const onCustomAmountChange = jest.fn();
    render(
      <GiveScreenView {...baseProps} onCustomAmountChange={onCustomAmountChange} />,
    );
    fireEvent.changeText(screen.getByTestId("give-amount-input"), "75");
    expect(onCustomAmountChange).toHaveBeenCalledWith("75");
  });

  it("disables the CTA until an amount is chosen, and labels it plainly", () => {
    render(<GiveScreenView {...baseProps} />);
    const cta = screen.getByLabelText("Give");
    expect(cta.props.accessibilityState.disabled).toBe(true);
  });

  // The pill carries the number so nobody taps it without knowing the total.
  it("enables the CTA once a preset is selected and labels it with the total", () => {
    render(<GiveScreenView {...baseProps} selectedPresetCents={5000} />);
    const cta = screen.getByLabelText(`Give ${formatCents(5000)}`);
    expect(cta.props.accessibilityState.disabled).toBe(false);
  });

  it("adds the covered fee to the CTA's total", () => {
    render(<GiveScreenView {...baseProps} selectedPresetCents={5000} coverFees />);
    const fee = estimateCoverFeesCents(5000);
    expect(screen.getByLabelText(`Give ${formatCents(5000 + fee)}`)).toBeTruthy();
  });

  it("explains the fee toggle in terms of what the fund ends up with", () => {
    render(<GiveScreenView {...baseProps} selectedPresetCents={5000} coverFees />);
    const fee = estimateCoverFeesCents(5000);
    expect(
      screen.getByText(
        `+${formatCents(fee)} so the fund gets the full ${formatCents(5000)}`,
      ),
    ).toBeTruthy();
  });

  describe("waiting step", () => {
    const waitingProps = {
      ...baseProps,
      step: "confirmation" as const,
      selectedPresetCents: 5000,
      checkoutSession: {
        url: "https://checkout.stripe.com/c/pay/cs_test_123",
        sessionId: "cs_test_123",
        paymentIntentId: "pi_test_123",
      },
    };

    it("says where the gift is being finished, with the amount and fund", () => {
      render(<GiveScreenView {...waitingProps} />);
      expect(screen.getByText("Finish in the browser")).toBeTruthy();
      expect(screen.getByText(formatCents(5000))).toBeTruthy();
      expect(screen.getByText("Young Adults — Manhattan")).toBeTruthy();
    });

    it("calls onReopenCheckout when 'Reopen payment page' is tapped", () => {
      const onReopenCheckout = jest.fn();
      render(
        <GiveScreenView {...waitingProps} onReopenCheckout={onReopenCheckout} />,
      );
      fireEvent.press(screen.getByLabelText("Reopen payment page"));
      expect(onReopenCheckout).toHaveBeenCalledTimes(1);
    });

    it("returns to the amount step from 'Cancel this gift'", () => {
      const onBack = jest.fn();
      render(<GiveScreenView {...waitingProps} onBack={onBack} />);
      fireEvent.press(screen.getByLabelText("Cancel this gift"));
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    // A donor tapping "Done" mid-payment would leave with no idea whether the
    // gift went through — the screen advances itself, or not at all.
    it("offers no 'Done' escape hatch", () => {
      render(<GiveScreenView {...waitingProps} />);
      expect(screen.queryByLabelText("Done")).toBeNull();
      expect(screen.queryByText("Done")).toBeNull();
    });
  });
});

describe("GiveCancelledNotice", () => {
  // Stripe's cancel_url loads in the in-app browser, which has no auth — the
  // give screen's queries would skip and spin forever. This is what renders
  // instead, and it must not need anything.
  it("tells the donor the gift was cancelled and that they can close the window", () => {
    render(<GiveCancelledNotice />);
    expect(screen.getByText("Gift cancelled")).toBeTruthy();
    expect(screen.getByText("You can close this window.")).toBeTruthy();
  });

  it("shows no loading state at all", () => {
    render(<GiveCancelledNotice />);
    expect(screen.queryByTestId("skeleton")).toBeNull();
    expect(screen.queryByTestId("give-screen-loading")).toBeNull();
  });
});
