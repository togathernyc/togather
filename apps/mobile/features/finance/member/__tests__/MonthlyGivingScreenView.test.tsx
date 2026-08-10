import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { MonthlyGivingScreenView } from "../MonthlyGivingScreenView";
import { estimateCoverFeesCents } from "../amount";
import { formatCents } from "../../format";
import type { RecurringSummary } from "../recurring";

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
      warning: "#e0a800",
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

const activeMonthly: RecurringSummary = {
  id: "rec1",
  fundId: "fund1",
  groupId: "group1",
  fundName: "Young Adults — Manhattan",
  amountCents: 2500,
  feeCoverCents: 105,
  status: "active",
  currentPeriodEnd: Date.UTC(2026, 8, 1, 12),
  createdAt: 1,
};

const noop = () => {};

const baseProps = {
  recurring: activeMonthly,
  suggestedAmountsCents: [1000, 2500, 5000] as readonly number[],
  editing: false,
  editSelectedPresetCents: null,
  editAmountText: "",
  editCoverFees: false,
  saving: false,
  canceling: false,
  updatingCard: false,
  error: null,
  onBack: noop,
  onStartEdit: noop,
  onCancelEdit: noop,
  onSelectPreset: noop,
  onAmountChange: noop,
  onToggleCoverFees: noop,
  onSaveAmount: noop,
  onUpdateCard: noop,
  onCancelRecurring: noop,
};

describe("MonthlyGivingScreenView", () => {
  it("shows a loading skeleton while the gift is still loading", () => {
    render(<MonthlyGivingScreenView {...baseProps} recurring={undefined} />);
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("says plainly when there's nothing to manage", () => {
    render(<MonthlyGivingScreenView {...baseProps} recurring={null} />);
    expect(screen.getByText("No monthly gift here")).toBeTruthy();
    expect(screen.queryByTestId("monthly-cancel")).toBeNull();
  });

  describe("the hero", () => {
    it("shows the gift and where it goes, every month", () => {
      render(<MonthlyGivingScreenView {...baseProps} />);
      expect(screen.getByText("$25.00")).toBeTruthy();
      expect(screen.getByText(/every month to Young Adults/)).toBeTruthy();
    });

    // The card is charged $26.05; the GIFT is $25. The hero shows the gift and
    // the fee gets its own row, so neither number is a surprise.
    it("shows the gift, not the fee-inclusive charge", () => {
      render(<MonthlyGivingScreenView {...baseProps} />);
      expect(screen.queryByText("$26.05")).toBeNull();
    });
  });

  describe("the facts", () => {
    it("dates the next gift", () => {
      render(<MonthlyGivingScreenView {...baseProps} />);
      expect(screen.getByTestId("monthly-next-gift").props.children).toMatch(
        /^[A-Z][a-z]{2} \d{1,2}$/,
      );
    });

    // Stripe hasn't reported a period on a just-bound gift — never fabricate
    // one.
    it("says 'Scheduled' rather than a fabricated date when there isn't one", () => {
      render(
        <MonthlyGivingScreenView
          {...baseProps}
          recurring={{ ...activeMonthly, currentPeriodEnd: null }}
        />,
      );
      expect(screen.getByTestId("monthly-next-gift").props.children).toBe("Scheduled");
    });

    it("names the covered fee, and says Off when it isn't", () => {
      render(<MonthlyGivingScreenView {...baseProps} />);
      expect(screen.getByTestId("monthly-fee-cover").props.children).toBe("On · +$1.05");

      screen.rerender(
        <MonthlyGivingScreenView
          {...baseProps}
          recurring={{ ...activeMonthly, feeCoverCents: 0 }}
        />,
      );
      expect(screen.getByTestId("monthly-fee-cover").props.children).toBe("Off");
    });

    // The card row leaves the app. Saying so up front is the difference
    // between a trusted redirect and a jarring one.
    it("warns that the card row opens Stripe", () => {
      const onUpdateCard = jest.fn();
      render(<MonthlyGivingScreenView {...baseProps} onUpdateCard={onUpdateCard} />);
      expect(screen.getByText("Opens Stripe's secure page")).toBeTruthy();
      fireEvent.press(screen.getByText("Update payment method"));
      expect(onUpdateCard).toHaveBeenCalledTimes(1);
    });
  });

  describe("past due", () => {
    const pastDue = { ...activeMonthly, status: "past_due" as const };

    it("banners the failure at the very top and links the card fix", () => {
      const onUpdateCard = jest.fn();
      render(
        <MonthlyGivingScreenView
          {...baseProps}
          recurring={pastDue}
          onUpdateCard={onUpdateCard}
        />,
      );
      expect(screen.getByTestId("monthly-past-due-banner")).toBeTruthy();
      fireEvent.press(screen.getByText("A payment didn't go through"));
      expect(onUpdateCard).toHaveBeenCalledTimes(1);
    });

    it("shows no banner on a healthy gift", () => {
      render(<MonthlyGivingScreenView {...baseProps} />);
      expect(screen.queryByTestId("monthly-past-due-banner")).toBeNull();
    });
  });

  describe("changing the amount", () => {
    it("offers the change as a cell, and promises when it takes effect", () => {
      const onStartEdit = jest.fn();
      render(<MonthlyGivingScreenView {...baseProps} onStartEdit={onStartEdit} />);
      expect(
        screen.getByText(
          "A new amount starts with your next gift — this month is already paid.",
        ),
      ).toBeTruthy();
      fireEvent.press(screen.getByText("Change amount"));
      expect(onStartEdit).toHaveBeenCalledTimes(1);
    });

    const editing = { ...baseProps, editing: true, editAmountText: "25" };

    it("replaces the cell with the editor rather than opening below it", () => {
      render(<MonthlyGivingScreenView {...editing} />);
      expect(screen.getByTestId("monthly-amount-editor")).toBeTruthy();
      expect(screen.queryByTestId("monthly-change-amount")).toBeNull();
    });

    it("reuses the give form's vocabulary — typed amount, presets, fee toggle", () => {
      render(<MonthlyGivingScreenView {...editing} />);
      expect(screen.getByTestId("monthly-amount-input").props.value).toBe("25");
      expect(screen.getByLabelText(`${formatCents(5000)} preset`)).toBeTruthy();
      expect(screen.getByText("Cover the processing fee")).toBeTruthy();
    });

    it("shows a tapped preset's dollars in the same field the donor types in", () => {
      render(
        <MonthlyGivingScreenView
          {...editing}
          editAmountText=""
          editSelectedPresetCents={5000}
        />,
      );
      expect(screen.getByTestId("monthly-amount-input").props.value).toBe("50");
    });

    it("explains the fee toggle in terms of what the fund ends up with", () => {
      render(<MonthlyGivingScreenView {...editing} editCoverFees />);
      const fee = estimateCoverFeesCents(2500);
      expect(
        screen.getByText(
          `+${formatCents(fee)} so the fund gets the full ${formatCents(2500)}`,
        ),
      ).toBeTruthy();
    });

    it("labels the save with the new monthly amount, and submits it", () => {
      const onSaveAmount = jest.fn();
      render(<MonthlyGivingScreenView {...editing} onSaveAmount={onSaveAmount} />);
      const save = screen.getByLabelText("Save new amount");
      expect(save.props.accessibilityState.disabled).toBe(false);
      expect(screen.getByText("Give $25.00 monthly")).toBeTruthy();
      fireEvent.press(save);
      expect(onSaveAmount).toHaveBeenCalledTimes(1);
    });

    it("can't be saved without an amount", () => {
      render(<MonthlyGivingScreenView {...editing} editAmountText="" />);
      expect(
        screen.getByLabelText("Save new amount").props.accessibilityState.disabled,
      ).toBe(true);
    });

    it("offers a way out that keeps the current amount", () => {
      const onCancelEdit = jest.fn();
      render(<MonthlyGivingScreenView {...editing} onCancelEdit={onCancelEdit} />);
      fireEvent.press(screen.getByLabelText("Keep the current amount"));
      expect(onCancelEdit).toHaveBeenCalledTimes(1);
    });

    // A donor mid-edit is deciding how much to give, not whether — the stop
    // control has no business under their thumb while they type.
    it("hides the cancel-giving cell while the editor is open", () => {
      render(<MonthlyGivingScreenView {...editing} />);
      expect(screen.queryByTestId("monthly-cancel")).toBeNull();
    });
  });

  describe("stopping the gift", () => {
    it("is the last thing on the screen, and says what it does and doesn't do", () => {
      render(<MonthlyGivingScreenView {...baseProps} />);
      expect(screen.getByText("Cancel monthly giving")).toBeTruthy();
      expect(screen.getByText("Ends future gifts. Past gifts stay.")).toBeTruthy();
    });

    it("hands the confirmation upward rather than stopping anything itself", () => {
      const onCancelRecurring = jest.fn();
      render(
        <MonthlyGivingScreenView
          {...baseProps}
          onCancelRecurring={onCancelRecurring}
        />,
      );
      fireEvent.press(screen.getByText("Cancel monthly giving"));
      expect(onCancelRecurring).toHaveBeenCalledTimes(1);
    });

    it("goes disabled while the cancel is in flight, so it can't be double-tapped", () => {
      const onCancelRecurring = jest.fn();
      render(
        <MonthlyGivingScreenView
          {...baseProps}
          canceling
          onCancelRecurring={onCancelRecurring}
        />,
      );
      fireEvent.press(screen.getByText("Cancel monthly giving"));
      expect(onCancelRecurring).not.toHaveBeenCalled();
    });
  });

  it("surfaces an action failure instead of swallowing it", () => {
    render(
      <MonthlyGivingScreenView {...baseProps} error="Couldn't change this amount." />,
    );
    expect(screen.getByTestId("monthly-giving-error").props.children).toBe(
      "Couldn't change this amount.",
    );
  });
});
