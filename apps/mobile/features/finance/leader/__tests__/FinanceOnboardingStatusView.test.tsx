import React from "react";
import { render, screen } from "@testing-library/react-native";
import { FinanceOnboardingStatusView } from "../FinanceOnboardingStatusView";

const baseProps = {
  isLoading: false,
  formSubmitted: true,
  paymentsVerified: false,
  bankAccountsReady: false,
  onboardingStatus: "verifying" as const,
  blockedReason: null,
  isLoadingLink: false,
  onStartForm: jest.fn(),
  onContinueIdentityVerification: jest.fn(),
};

describe("FinanceOnboardingStatusView", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("shows in-progress badges while verifying", () => {
    render(<FinanceOnboardingStatusView {...baseProps} />);

    expect(screen.getAllByText("In progress").length).toBeGreaterThan(0);
    expect(screen.getByText("Continue identity verification")).toBeTruthy();
  });

  it("surfaces the blocked reason on the identity row when Stripe blocks", () => {
    render(
      <FinanceOnboardingStatusView
        {...baseProps}
        onboardingStatus="stripe_blocked"
        blockedReason="We need a clearer photo ID."
      />
    );

    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByText("We need a clearer photo ID.")).toBeTruthy();
  });

  it("shows the live banner and hides all action buttons once fully live", () => {
    render(
      <FinanceOnboardingStatusView
        {...baseProps}
        paymentsVerified={true}
        bankAccountsReady={true}
        onboardingStatus="live"
      />
    );

    expect(screen.getByText("Giving is live for your community!")).toBeTruthy();
    expect(screen.queryByText("Continue identity verification")).toBeNull();
    expect(screen.queryByText("Get started")).toBeNull();
    expect(screen.getAllByText("Done")).toHaveLength(3);
  });

  it("shows a Get started CTA before the form has been submitted", () => {
    render(<FinanceOnboardingStatusView {...baseProps} formSubmitted={false} onboardingStatus="collecting" />);

    expect(screen.getByText("Get started")).toBeTruthy();
    expect(screen.queryByText("Continue identity verification")).toBeNull();
  });
});
