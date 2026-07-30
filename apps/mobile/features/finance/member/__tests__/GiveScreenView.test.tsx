import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { GiveScreenView, maskClientSecret } from "../GiveScreenView";
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
    },
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
  intent: null,
  onBack: noop,
  onSelectPreset: noop,
  onCustomAmountChange: noop,
  onToggleCoverFees: noop,
  onContinue: noop,
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
    expect(screen.queryByText("Continue")).toBeNull();
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

  it("disables Continue until an amount is chosen", () => {
    render(<GiveScreenView {...baseProps} />);
    const continueButton = screen.getByLabelText("Continue");
    expect(continueButton.props.accessibilityState.disabled).toBe(true);
  });

  it("enables Continue once a preset is selected", () => {
    render(<GiveScreenView {...baseProps} selectedPresetCents={5000} />);
    const continueButton = screen.getByLabelText("Continue");
    expect(continueButton.props.accessibilityState.disabled).toBe(false);
  });

  it("shows the estimated cover-fees amount when the toggle is on", () => {
    render(
      <GiveScreenView {...baseProps} selectedPresetCents={5000} coverFees />,
    );
    const fee = estimateCoverFeesCents(5000);
    expect(
      screen.getByText(
        `+${formatCents(fee)} added — ${formatCents(5000 + fee)} total`,
      ),
    ).toBeTruthy();
  });

  it("renders the stubbed confirmation panel with a masked client secret", () => {
    render(
      <GiveScreenView
        {...baseProps}
        step="confirmation"
        selectedPresetCents={5000}
        intent={{ clientSecret: "pi_123abc_secret_xyz789", paymentIntentId: "pi_123abc" }}
      />,
    );
    expect(screen.getByText("Payment intent created")).toBeTruthy();
    expect(
      screen.getByText(maskClientSecret("pi_123abc_secret_xyz789")),
    ).toBeTruthy();
    expect(screen.getByText(formatCents(5000))).toBeTruthy();
  });
});
