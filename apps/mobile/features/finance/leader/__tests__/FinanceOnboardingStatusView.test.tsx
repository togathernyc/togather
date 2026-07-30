import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { FinanceOnboardingStatusView } from "../FinanceOnboardingStatusView";

const baseProps = {
  isLoading: false,
  formSubmitted: true,
  providersReady: true,
  paymentsVerified: false,
  bankAccountsReady: false,
  onboardingStatus: "verifying" as const,
  blockedReason: null,
  provisioningError: null,
  linkError: null,
  isLoadingLink: false,
  isRetrying: false,
  onStartForm: jest.fn(),
  onContinueIdentityVerification: jest.fn(),
  onRetryProvisioning: jest.fn(),
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

  it("shows a setting-up state (not the identity CTA) while providers are provisioning", () => {
    render(
      <FinanceOnboardingStatusView
        {...baseProps}
        providersReady={false}
        onboardingStatus="collecting"
      />
    );

    expect(screen.getByText("Setting up your accounts…")).toBeTruthy();
    expect(screen.queryByText("Continue identity verification")).toBeNull();
  });

  it("shows the provisioning error and a retry CTA when provisioning failed", () => {
    render(
      <FinanceOnboardingStatusView
        {...baseProps}
        providersReady={false}
        onboardingStatus="stripe_blocked"
        provisioningError="Stripe API error: platform profile incomplete"
      />
    );

    expect(
      screen.getByText("Stripe API error: platform profile incomplete")
    ).toBeTruthy();
    fireEvent.press(screen.getByText("Try again"));
    expect(baseProps.onRetryProvisioning).toHaveBeenCalled();
    // Deterministic provider rejections need corrected data, not a retry —
    // the failure state must offer a path back to the intake form.
    fireEvent.press(screen.getByText("Edit church details"));
    expect(baseProps.onStartForm).toHaveBeenCalled();
    expect(screen.queryByText("Continue identity verification")).toBeNull();
  });

  it("shows a retry failure inline in the provisioning-failed state", () => {
    render(
      <FinanceOnboardingStatusView
        {...baseProps}
        providersReady={false}
        onboardingStatus="stripe_blocked"
        provisioningError="Stripe API error"
        linkError="Couldn't retry setup. Please try again."
      />
    );

    expect(screen.getByText("Try again")).toBeTruthy();
    expect(screen.getByText("Couldn't retry setup. Please try again.")).toBeTruthy();
  });

  it("shows the link error inline under the identity CTA", () => {
    render(
      <FinanceOnboardingStatusView
        {...baseProps}
        linkError="Failed to open identity verification"
      />
    );

    expect(screen.getByText("Continue identity verification")).toBeTruthy();
    expect(screen.getByText("Failed to open identity verification")).toBeTruthy();
  });
});
