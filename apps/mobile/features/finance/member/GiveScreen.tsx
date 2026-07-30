/**
 * GiveScreen — data wrapper for the member-facing give sheet (ADR-032 §3/§7
 * Phase 1). Reached from the "Give" button on FundScreen
 * (app/groups/[group_id]/give.tsx).
 *
 * All Convex/router wiring lives here; the actual UI is `GiveScreenView`,
 * kept prop-only so a verification harness can render it with mock data.
 */
import React, { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  useAuthenticatedQuery,
  useAuthenticatedAction,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { formatError } from "@/utils/error-handling";
import { GiveScreenView, type GiveStep } from "./GiveScreenView";
import { estimateCoverFeesCents, resolveGiveAmountCents } from "./amount";
import type { DonationIntent } from "./types";

export function GiveScreen() {
  const params = useLocalSearchParams<{ group_id: string }>();
  const groupId = params.group_id;
  const router = useRouter();

  const context = useAuthenticatedQuery(
    api.functions.finance.giving.getGivingContext,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );

  const createDonationIntent = useAuthenticatedAction(
    api.functions.finance.giving.createDonationIntent,
  );

  const [step, setStep] = useState<GiveStep>("amount");
  const [selectedPresetCents, setSelectedPresetCents] = useState<number | null>(null);
  const [customAmountText, setCustomAmountText] = useState("");
  const [coverFees, setCoverFees] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<DonationIntent | null>(null);

  const handleBack = () => {
    if (step === "confirmation") {
      setStep("amount");
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else if (groupId) {
      router.push(`/groups/${groupId}/fund` as any);
    }
  };

  const handleSelectPreset = (cents: number) => {
    setSelectedPresetCents((current) => (current === cents ? null : cents));
    setCustomAmountText("");
    setError(null);
  };

  const handleCustomAmountChange = (text: string) => {
    setCustomAmountText(text);
    setSelectedPresetCents(null);
    setError(null);
  };

  const handleContinue = async () => {
    if (!context) return;
    const amountCents = resolveGiveAmountCents(selectedPresetCents, customAmountText);
    if (!amountCents) return;

    setSubmitting(true);
    setError(null);
    try {
      const coverFeesCents = coverFees ? estimateCoverFeesCents(amountCents) : 0;
      const result = await createDonationIntent({
        fundId: context.fundId as Id<"funds">,
        amountCents,
        coverFeesCents,
      });
      setIntent(result);
      setStep("confirmation");
    } catch (err) {
      setError(formatError(err, "Couldn't start this gift. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <GiveScreenView
      context={context}
      step={step}
      selectedPresetCents={selectedPresetCents}
      customAmountText={customAmountText}
      coverFees={coverFees}
      submitting={submitting}
      error={error}
      intent={intent}
      onBack={handleBack}
      onSelectPreset={handleSelectPreset}
      onCustomAmountChange={handleCustomAmountChange}
      onToggleCoverFees={setCoverFees}
      onContinue={handleContinue}
    />
  );
}
