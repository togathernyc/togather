/**
 * SubmitReimbursementSheetView — presentational "Get reimbursed" sheet
 * (ADR-032 §3). Pure props in, no Convex imports.
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "@hooks/useTheme";
import { Modal, Input, Button, ImagePicker } from "@components/ui";
import { validateReimbursement } from "./validateReimbursement";

export interface SubmitReimbursementSheetViewProps {
  visible: boolean;
  amountText: string;
  description: string;
  /** Local URI for the picked receipt image, if any. */
  receiptPreviewUri: string | null;
  /** True while the picked receipt is uploading to R2. */
  receiptUploading: boolean;
  /** True once the receipt has finished uploading and is ready to submit. */
  receiptReady: boolean;
  submitting: boolean;
  error: string | null;
  onAmountChange: (text: string) => void;
  onDescriptionChange: (text: string) => void;
  onPickReceipt: (uri: string) => void;
  onRemoveReceipt: () => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function SubmitReimbursementSheetView({
  visible,
  amountText,
  description,
  receiptPreviewUri,
  receiptUploading,
  receiptReady,
  submitting,
  error,
  onAmountChange,
  onDescriptionChange,
  onPickReceipt,
  onRemoveReceipt,
  onSubmit,
  onClose,
}: SubmitReimbursementSheetViewProps) {
  const { colors } = useTheme();
  const validation = validateReimbursement({ amountText, description, receiptReady });
  const canSubmit = validation.valid && !submitting && !receiptUploading;

  return (
    <Modal visible={visible} onClose={onClose} title="Get reimbursed">
      <View style={styles.content}>
        <Input
          label="Amount"
          placeholder="$0.00"
          value={amountText}
          onChangeText={onAmountChange}
        />
        <Input
          label="What was this for?"
          placeholder="e.g. Snacks for small group"
          value={description}
          onChangeText={onDescriptionChange}
          multiline
          numberOfLines={2}
        />

        <Text style={[styles.label, { color: colors.text }]}>Receipt</Text>
        <ImagePicker
          onImageSelected={onPickReceipt}
          onImageRemoved={receiptPreviewUri ? onRemoveReceipt : undefined}
          currentImage={receiptPreviewUri ?? undefined}
          isUploading={receiptUploading}
          buttonText="Attach receipt photo"
        />

        {!!error && <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>}
        {!error && !!validation.reason && amountText.length > 0 && (
          <Text style={[styles.hintText, { color: colors.textSecondary }]}>
            {validation.reason}
          </Text>
        )}

        <Button onPress={onSubmit} disabled={!canSubmit} loading={submitting}>
          Submit for reimbursement
        </Button>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12 },
  label: { fontSize: 14, fontWeight: "600" },
  errorText: { fontSize: 14, textAlign: "center" },
  hintText: { fontSize: 13, textAlign: "center" },
});
