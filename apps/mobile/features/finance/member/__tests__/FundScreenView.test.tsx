import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { FundScreenView } from "../FundScreenView";
import type { FundOverview, MyExpense } from "../types";
import { formatCents, formatSignedCents } from "../../format";

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
    },
  }),
}));

jest.mock("@components/ui", () => {
  const ReactActual = jest.requireActual("react");
  const RN = jest.requireActual("react-native");
  return {
    Badge: ({ children }: any) => ReactActual.createElement(RN.Text, null, children),
    Button: ({ children, onPress, disabled }: any) =>
      ReactActual.createElement(
        RN.TouchableOpacity,
        { onPress, disabled, accessibilityState: { disabled } },
        ReactActual.createElement(RN.Text, null, children),
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

const baseOverview: FundOverview = {
  fund: { id: "fund1", name: "Small Group Fund", status: "active" },
  balanceCents: 123456,
  monthToDate: { donationsCents: 5000, spentCents: 2000, donationCount: 2 },
  yearToDate: { donationsCents: 50000, spentCents: 20000, donationCount: 12 },
  activity: [
    {
      id: "e1",
      kind: "donation",
      amountCents: 5000,
      direction: "credit",
      createdAt: 1000,
      donorName: "Jane Smith",
    },
    {
      id: "e2",
      kind: "card_capture",
      amountCents: 1200,
      direction: "debit",
      createdAt: 900,
    },
  ],
  viewerCanSeeDonorNames: true,
};

const baseExpenses: MyExpense[] = [
  {
    id: "exp1",
    amountCents: 3000,
    kind: "reimbursement",
    description: "Snacks",
    status: "pending",
    receiptUrl: undefined,
    createdAt: 1,
    updatedAt: 1,
  },
];

const noop = () => {};

describe("FundScreenView", () => {
  it("shows a loading skeleton while overview is undefined", () => {
    render(
      <FundScreenView
        overview={undefined}
        myExpenses={undefined}
        onBack={noop}
        onGivePress={noop}
        onGetReimbursedPress={noop}
      />,
    );
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("shows the empty state when giving isn't set up", () => {
    render(
      <FundScreenView
        overview={null}
        myExpenses={undefined}
        onBack={noop}
        onGivePress={noop}
        onGetReimbursedPress={noop}
      />,
    );
    expect(screen.getByText("Giving isn't set up for this group yet")).toBeTruthy();
  });

  it("formats the balance via formatCents", () => {
    render(
      <FundScreenView
        overview={baseOverview}
        myExpenses={baseExpenses}
        onBack={noop}
        onGivePress={noop}
        onGetReimbursedPress={noop}
      />,
    );
    expect(screen.getByText(formatCents(123456))).toBeTruthy();
  });

  it("labels activity kinds and formats signed amounts, showing donor names when present", () => {
    render(
      <FundScreenView
        overview={baseOverview}
        myExpenses={baseExpenses}
        onBack={noop}
        onGivePress={noop}
        onGetReimbursedPress={noop}
      />,
    );
    expect(screen.getByText("Donation")).toBeTruthy();
    expect(screen.getByText(formatSignedCents(5000, "credit"))).toBeTruthy();
    expect(screen.getByText("Jane Smith")).toBeTruthy();

    expect(screen.getByText("Card purchase")).toBeTruthy();
    expect(screen.getByText(formatSignedCents(1200, "debit"))).toBeTruthy();
  });

  it("hides donor names when the overview omits them (viewer isn't manager+)", () => {
    const anonymized: FundOverview = {
      ...baseOverview,
      viewerCanSeeDonorNames: false,
      activity: baseOverview.activity.map(({ donorName: _donorName, ...rest }) => rest),
    };
    render(
      <FundScreenView
        overview={anonymized}
        myExpenses={baseExpenses}
        onBack={noop}
        onGivePress={noop}
        onGetReimbursedPress={noop}
      />,
    );
    expect(screen.queryByText("Jane Smith")).toBeNull();
  });

  it("renders my-reimbursements with status badges", () => {
    render(
      <FundScreenView
        overview={baseOverview}
        myExpenses={baseExpenses}
        onBack={noop}
        onGivePress={noop}
        onGetReimbursedPress={noop}
      />,
    );
    expect(screen.getByText("Snacks")).toBeTruthy();
    expect(screen.getByText("Pending")).toBeTruthy();
  });

  it("fires onGivePress from the header Give button", () => {
    const onGivePress = jest.fn();
    render(
      <FundScreenView
        overview={baseOverview}
        myExpenses={baseExpenses}
        onBack={noop}
        onGivePress={onGivePress}
        onGetReimbursedPress={noop}
      />,
    );
    fireEvent.press(screen.getByLabelText("Give"));
    expect(onGivePress).toHaveBeenCalled();
  });
});
