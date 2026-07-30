import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { FinanceOnboardingFormView } from "../FinanceOnboardingFormView";

const baseProps = {
  isSubmitting: false,
  submitError: null,
  onSubmit: jest.fn(),
};

async function fillRequiredNonEinFields() {
  fireEvent.changeText(screen.getByTestId("onboarding-legal-name"), "First Community Church");
  fireEvent.changeText(screen.getByTestId("onboarding-address-line1"), "123 Main St");
  fireEvent.changeText(screen.getByTestId("onboarding-city"), "Springfield");
  fireEvent.changeText(screen.getByTestId("onboarding-state"), "IL");
  fireEvent.changeText(screen.getByTestId("onboarding-zip"), "62704");
}

describe("FinanceOnboardingFormView", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("rejects an EIN that doesn't match NN-NNNNNNN and does not submit", async () => {
    const onSubmit = jest.fn();
    render(<FinanceOnboardingFormView {...baseProps} onSubmit={onSubmit} />);

    await fillRequiredNonEinFields();
    // Too few digits — formats to "12-3", which still fails the pattern.
    fireEvent.changeText(screen.getByTestId("onboarding-ein"), "123");
    fireEvent.press(screen.getByText("Submit"));

    await waitFor(() => {
      expect(screen.getByText("EIN must be in NN-NNNNNNN format")).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("auto-formats digits into NN-NNNNNNN and submits a valid EIN", async () => {
    const onSubmit = jest.fn();
    render(<FinanceOnboardingFormView {...baseProps} onSubmit={onSubmit} />);

    await fillRequiredNonEinFields();
    fireEvent.changeText(screen.getByTestId("onboarding-ein"), "123456789");

    expect(screen.getByTestId("onboarding-ein").props.value).toBe("12-3456789");

    fireEvent.press(screen.getByText("Submit"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        legalName: "First Community Church",
        ein: "12-3456789",
        addressLine1: "123 Main St",
        city: "Springfield",
        state: "IL",
        zipCode: "62704",
      })
    );
  });

  it("shows a required-field error when legal name is left blank", async () => {
    render(<FinanceOnboardingFormView {...baseProps} />);

    fireEvent.changeText(screen.getByTestId("onboarding-ein"), "123456789");
    fireEvent.press(screen.getByText("Submit"));

    await waitFor(() => {
      expect(screen.getByText("Legal name is required")).toBeTruthy();
    });
  });
});
