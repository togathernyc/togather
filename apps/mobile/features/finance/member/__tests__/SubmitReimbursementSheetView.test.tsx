import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { SubmitReimbursementSheetView } from "../SubmitReimbursementSheetView";

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      text: "#111",
      textSecondary: "#666",
      error: "#c00",
    },
  }),
}));

jest.mock("@components/ui", () => {
  const ReactActual = jest.requireActual("react");
  const RN = jest.requireActual("react-native");
  return {
    Modal: ({ visible, children }: any) =>
      visible ? ReactActual.createElement(RN.View, null, children) : null,
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
    // Echoes `currentImage` back out so the sheet's preview wiring is
    // observable here; the picker's own rendering is covered by
    // components/ui/__tests__/ImagePicker.test.tsx.
    ImagePicker: ({ onImageSelected, isUploading, buttonText, currentImage, testID }: any) =>
      ReactActual.createElement(
        RN.TouchableOpacity,
        { onPress: () => onImageSelected("file://mock-receipt.jpg"), accessibilityLabel: buttonText },
        ReactActual.createElement(RN.Text, null, isUploading ? "Uploading..." : buttonText),
        currentImage
          ? ReactActual.createElement(RN.Text, { testID: `${testID}-uri` }, currentImage)
          : null,
      ),
  };
});

const noop = () => {};

const baseProps = {
  visible: true,
  amountText: "",
  description: "",
  receiptPreviewUri: null,
  receiptUploading: false,
  receiptReady: false,
  submitting: false,
  error: null,
  onAmountChange: noop,
  onDescriptionChange: noop,
  onPickReceipt: noop,
  onRemoveReceipt: noop,
  onSubmit: noop,
  onClose: noop,
};

describe("SubmitReimbursementSheetView", () => {
  it("disables submit when nothing has been entered", () => {
    render(<SubmitReimbursementSheetView {...baseProps} />);
    const submit = screen.getByLabelText("Submit for reimbursement");
    expect(submit.props.accessibilityState.disabled).toBe(true);
  });

  it("stays disabled with an amount + description but no receipt", () => {
    render(
      <SubmitReimbursementSheetView
        {...baseProps}
        amountText="12.50"
        description="Snacks"
        receiptReady={false}
      />,
    );
    const submit = screen.getByLabelText("Submit for reimbursement");
    expect(submit.props.accessibilityState.disabled).toBe(true);
  });

  it("enables submit once amount, description, and receipt are all present", () => {
    render(
      <SubmitReimbursementSheetView
        {...baseProps}
        amountText="12.50"
        description="Snacks"
        receiptReady={true}
      />,
    );
    const submit = screen.getByLabelText("Submit for reimbursement");
    expect(submit.props.accessibilityState.disabled).toBe(false);
  });

  it("disables submit while the receipt is still uploading, even if otherwise valid", () => {
    render(
      <SubmitReimbursementSheetView
        {...baseProps}
        amountText="12.50"
        description="Snacks"
        receiptReady={true}
        receiptUploading={true}
      />,
    );
    const submit = screen.getByLabelText("Submit for reimbursement");
    expect(submit.props.accessibilityState.disabled).toBe(true);
  });

  it("calls onPickReceipt with the picked image URI", () => {
    const onPickReceipt = jest.fn();
    render(<SubmitReimbursementSheetView {...baseProps} onPickReceipt={onPickReceipt} />);
    fireEvent.press(screen.getByLabelText("Attach receipt photo"));
    expect(onPickReceipt).toHaveBeenCalledWith("file://mock-receipt.jpg");
  });

  it("hands the picked receipt URI to the picker so it can preview it", () => {
    // Web picks come back as blob:/data: URIs, so the sheet must pass them
    // through untouched — see the ImagePicker/getMediaUrl regression tests.
    const uri = "blob:http://localhost:8081/6b9f-1f2e";
    render(<SubmitReimbursementSheetView {...baseProps} receiptPreviewUri={uri} />);
    expect(screen.getByTestId("receipt-preview-uri").props.children).toBe(uri);
  });

  it("calls onSubmit when the submit button is pressed while valid", () => {
    const onSubmit = jest.fn();
    render(
      <SubmitReimbursementSheetView
        {...baseProps}
        amountText="12.50"
        description="Snacks"
        receiptReady={true}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.press(screen.getByLabelText("Submit for reimbursement"));
    expect(onSubmit).toHaveBeenCalled();
  });

  it("renders nothing when not visible", () => {
    const { toJSON } = render(
      <SubmitReimbursementSheetView {...baseProps} visible={false} />,
    );
    expect(toJSON()).toBeNull();
  });

  it("shows the server error message when present", () => {
    render(
      <SubmitReimbursementSheetView {...baseProps} error="Couldn't submit this reimbursement." />,
    );
    expect(screen.getByText("Couldn't submit this reimbursement.")).toBeTruthy();
  });
});
