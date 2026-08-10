/**
 * SubmitReimbursementSheet — data wrapper for the "Get reimbursed" flow
 * (ADR-032 §3). Reached from FundScreen's "Get reimbursed" button.
 *
 * All Convex/upload wiring lives here; the actual UI is
 * `SubmitReimbursementSheetView`, kept prop-only for the verification
 * harness.
 */
import React, { useState } from "react";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { ToastManager } from "@components/ui";
import { formatError } from "@/utils/error-handling";
import { SubmitReimbursementSheetView } from "./SubmitReimbursementSheetView";
import { validateReimbursement } from "./validateReimbursement";
import { useReceiptUpload } from "./useReceiptUpload";

export interface SubmitReimbursementSheetProps {
  visible: boolean;
  fundId: Id<"funds">;
  onClose: () => void;
}

export function SubmitReimbursementSheet({
  visible,
  fundId,
  onClose,
}: SubmitReimbursementSheetProps) {
  const [amountText, setAmountText] = useState("");
  const [description, setDescription] = useState("");
  const [receiptPreviewUri, setReceiptPreviewUri] = useState<string | null>(null);
  const [receiptKey, setReceiptKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { uploadReceipt, uploading: receiptUploading } = useReceiptUpload();
  const submitExpense = useAuthenticatedMutation(
    api.functions.finance.expenses.submitExpense,
  );

  const reset = () => {
    setAmountText("");
    setDescription("");
    setReceiptPreviewUri(null);
    setReceiptKey(null);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handlePickReceipt = async (uri: string) => {
    setReceiptPreviewUri(uri);
    setReceiptKey(null);
    setError(null);
    const result = await uploadReceipt(uri);
    if (result.error) {
      setError(result.error);
      setReceiptPreviewUri(null);
      return;
    }
    setReceiptKey(result.storagePath);
  };

  const handleRemoveReceipt = () => {
    setReceiptPreviewUri(null);
    setReceiptKey(null);
  };

  const handleSubmit = async () => {
    const validation = validateReimbursement({
      amountText,
      description,
      receiptReady: !!receiptKey,
    });
    if (!validation.valid || !validation.amountCents || !receiptKey) return;

    setSubmitting(true);
    setError(null);
    try {
      await submitExpense({
        fundId,
        amountCents: validation.amountCents,
        kind: "reimbursement",
        description: description.trim(),
        receiptKey,
      });
      ToastManager.success("Reimbursement request submitted");
      reset();
      onClose();
    } catch (err) {
      setError(
        formatError(err, "Couldn't submit this reimbursement. Please try again."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SubmitReimbursementSheetView
      visible={visible}
      amountText={amountText}
      description={description}
      receiptPreviewUri={receiptPreviewUri}
      receiptUploading={receiptUploading}
      receiptReady={!!receiptKey}
      submitting={submitting}
      error={error}
      onAmountChange={setAmountText}
      onDescriptionChange={setDescription}
      onPickReceipt={handlePickReceipt}
      onRemoveReceipt={handleRemoveReceipt}
      onSubmit={handleSubmit}
      onClose={handleClose}
    />
  );
}
