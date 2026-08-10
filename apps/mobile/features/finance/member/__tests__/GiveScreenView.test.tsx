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
  frequency: "once" as const,
  selectedPresetCents: null,
  customAmountText: "",
  coverFees: false,
  submitting: false,
  error: null,
  checkoutSession: null,
  onBack: noop,
  onSelectFrequency: noop,
  onSelectPreset: noop,
  onCustomAmountChange: noop,
  onToggleCoverFees: noop,
  onContinue: noop,
  onReopenCheckout: noop,
  onFinishManually: noop,
  onManageRecurringPress: noop,
  canAutoAdvance: true,
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

  // Focusing a $50 preset and typing 2 must mean $2, not $502 — the caret
  // sitting after the preset's digits would otherwise turn a replacement into
  // a ten-times-larger gift.
  it("selects the showing amount on focus so typing replaces it", () => {
    render(<GiveScreenView {...baseProps} selectedPresetCents={5000} />);
    expect(screen.getByTestId("give-amount-input").props.selectTextOnFocus).toBe(true);
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

  // Frequency sits ABOVE the amount: the number a donor picks depends on how
  // often they're being asked for it.
  describe("frequency", () => {
    it("offers One time and Monthly as chips", () => {
      render(<GiveScreenView {...baseProps} />);
      expect(screen.getByTestId("give-frequency-once")).toBeTruthy();
      expect(screen.getByTestId("give-frequency-monthly")).toBeTruthy();
    });

    it("marks the chosen frequency as selected, and only that one", () => {
      render(<GiveScreenView {...baseProps} frequency="monthly" />);
      expect(
        screen.getByTestId("give-frequency-monthly").props.accessibilityState.selected,
      ).toBe(true);
      expect(
        screen.getByTestId("give-frequency-once").props.accessibilityState.selected,
      ).toBe(false);
    });

    it("reports a frequency change upward", () => {
      const onSelectFrequency = jest.fn();
      render(<GiveScreenView {...baseProps} onSelectFrequency={onSelectFrequency} />);
      fireEvent.press(screen.getByTestId("give-frequency-monthly"));
      expect(onSelectFrequency).toHaveBeenCalledWith("monthly");
    });

    // The CTA is the last thing read before a card is charged — it has to say
    // whether this is once or every month.
    it("says 'monthly' on the CTA when monthly is chosen", () => {
      render(
        <GiveScreenView {...baseProps} frequency="monthly" selectedPresetCents={5000} />,
      );
      expect(screen.getByLabelText(`Give ${formatCents(5000)} monthly`)).toBeTruthy();
      expect(screen.queryByLabelText(`Give ${formatCents(5000)}`)).toBeNull();
    });

    it("leaves the one-off CTA alone", () => {
      render(<GiveScreenView {...baseProps} selectedPresetCents={5000} />);
      expect(screen.getByLabelText(`Give ${formatCents(5000)}`)).toBeTruthy();
      expect(screen.queryByLabelText(/monthly/)).toBeNull();
    });

    it("adds the covered fee to the monthly CTA's total too", () => {
      render(
        <GiveScreenView
          {...baseProps}
          frequency="monthly"
          selectedPresetCents={5000}
          coverFees
        />,
      );
      const fee = estimateCoverFeesCents(5000);
      expect(
        screen.getByLabelText(`Give ${formatCents(5000 + fee)} monthly`),
      ).toBeTruthy();
    });
  });

  // One active monthly per fund is a backend rule. The UI never offers a
  // second — it points at the one they have instead of letting them find out
  // from an error after a tap.
  describe("when the donor already gives monthly to this fund", () => {
    const withExisting = {
      ...baseProps,
      context: {
        ...liveContext,
        existingRecurring: { amountCents: 2500, feeCoverCents: 105 },
      },
      selectedPresetCents: 5000,
    };

    it("replaces the CTA with a notice naming the gift they already have", () => {
      render(<GiveScreenView {...withExisting} frequency="monthly" />);
      expect(screen.getByTestId("give-existing-recurring-notice")).toBeTruthy();
      expect(screen.getByText(/You already give/)).toBeTruthy();
      expect(screen.getByText(/\$25\.00\/month/)).toBeTruthy();
      expect(screen.queryByLabelText(/^Give /)).toBeNull();
    });

    // The notice names the GIFT, not the charge: a donor covering the fee
    // chose $25, and restating it as $26.05 is a number they never picked.
    it("names the gift amount, not the fee-inclusive charge", () => {
      render(<GiveScreenView {...withExisting} frequency="monthly" />);
      expect(screen.queryByText(/\$26\.05/)).toBeNull();
    });

    it("offers a way through to managing it", () => {
      const onManageRecurringPress = jest.fn();
      render(
        <GiveScreenView
          {...withExisting}
          frequency="monthly"
          onManageRecurringPress={onManageRecurringPress}
        />,
      );
      fireEvent.press(screen.getByLabelText("Manage your monthly gift"));
      expect(onManageRecurringPress).toHaveBeenCalledTimes(1);
    });

    // Non-blocking: an existing monthly gift must not stop a one-off.
    it("leaves the one-time CTA fully usable", () => {
      render(<GiveScreenView {...withExisting} frequency="once" />);
      expect(screen.queryByTestId("give-existing-recurring-notice")).toBeNull();
      const cta = screen.getByLabelText(`Give ${formatCents(5000)}`);
      expect(cta.props.accessibilityState.disabled).toBe(false);
    });
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

    // A monthly gift's summary must not read as a one-off total — the donor is
    // committing to this number every month, not once.
    it("marks the amount as monthly on a monthly gift", () => {
      render(<GiveScreenView {...waitingProps} frequency="monthly" />);
      expect(screen.getByText(`${formatCents(5000)}/month`)).toBeTruthy();
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
    // gift went through — while something IS watching, the screen advances
    // itself or not at all.
    it("offers no 'Done' escape hatch while the gift is being watched", () => {
      render(<GiveScreenView {...waitingProps} />);
      expect(screen.queryByLabelText("Done")).toBeNull();
      expect(screen.queryByText("Done")).toBeNull();
      expect(screen.queryByLabelText("Go to the fund")).toBeNull();
    });

    // Stripe can hand back no PaymentIntent, and then nothing will ever advance
    // this screen. Leaving "Cancel this gift" as the only way out of a screen
    // the donor may have already paid on is how you get a second donation.
    describe("when nothing is watching the gift", () => {
      const unwatched = { ...waitingProps, canAutoAdvance: false };

      it("offers a way to the fund that doesn't cancel anything", () => {
        const onFinishManually = jest.fn();
        const onBack = jest.fn();
        render(
          <GiveScreenView
            {...unwatched}
            onFinishManually={onFinishManually}
            onBack={onBack}
          />,
        );
        fireEvent.press(screen.getByLabelText("Go to the fund"));
        expect(onFinishManually).toHaveBeenCalledTimes(1);
        expect(onBack).not.toHaveBeenCalled();
      });

      it("says plainly that it can't confirm, instead of promising a return", () => {
        render(<GiveScreenView {...unwatched} />);
        expect(screen.getByText(/can’t confirm this one automatically/)).toBeTruthy();
        expect(screen.queryByText(/as soon as it goes through/)).toBeNull();
      });
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
