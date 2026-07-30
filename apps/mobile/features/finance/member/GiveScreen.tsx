/**
 * GiveScreen — data wrapper for the member-facing give sheet (ADR-032 §3/§7
 * Phase 1). Reached from the "Give" button on FundScreen
 * (app/groups/[group_id]/give.tsx).
 *
 * All Convex/router wiring lives here; the actual UI is `GiveScreenView`,
 * kept prop-only so a verification harness can render it with mock data.
 *
 * Payment collection is a hosted Stripe Checkout page (ADR-032 §3/§7 Phase 1
 * decision: zero native dependencies, ships via OTA, Apple Pay works in the
 * browser sheet) — "Continue" creates a Checkout Session, then opens its
 * `url` via expo-web-browser, the same `openBrowserAsync` pattern
 * FinanceOnboardingStatusScreen uses for Stripe's hosted onboarding.
 */
import React, { useRef, useState } from "react";
import { Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  useAuthenticatedQuery,
  useAuthenticatedAction,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { formatError } from "@/utils/error-handling";
import { GiveScreenView, type GiveStep } from "./GiveScreenView";
import { estimateCoverFeesCents, resolveGiveAmountCents } from "./amount";
import type { CheckoutSession } from "./types";

/** Opens a URL in the platform's browser sheet — mirrors
 * FinanceOnboardingStatusScreen's handleContinueIdentityVerification. */
async function openCheckoutUrl(url: string): Promise<void> {
  if (Platform.OS === "web") {
    window.location.href = url;
  } else {
    await WebBrowser.openBrowserAsync(url);
  }
}

export function GiveScreen() {
  const params = useLocalSearchParams<{ group_id: string }>();
  const groupId = params.group_id;
  const router = useRouter();

  const context = useAuthenticatedQuery(
    api.functions.finance.giving.getGivingContext,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );

  const createDonationCheckoutSession = useAuthenticatedAction(
    api.functions.finance.giving.createDonationCheckoutSession,
  );

  const [step, setStep] = useState<GiveStep>("amount");
  const [selectedPresetCents, setSelectedPresetCents] = useState<number | null>(null);
  const [customAmountText, setCustomAmountText] = useState("");
  const [coverFees, setCoverFees] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutSession, setCheckoutSession] = useState<CheckoutSession | null>(null);

  // Minted once per give-sheet session (not per tap) so a retried/double-tapped
  // "Continue" reuses the same Stripe idempotency key instead of creating a
  // second Checkout Session — see createDonationCheckoutSession's doc comment.
  const idempotencyNonceRef = useRef<string>(
    `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

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
      const result = await createDonationCheckoutSession({
        fundId: context.fundId as Id<"funds">,
        amountCents,
        coverFeesCents,
        idempotencyNonce: idempotencyNonceRef.current,
      });
      setCheckoutSession(result);
      setStep("confirmation");
      await openCheckoutUrl(result.url);
    } catch (err) {
      setError(formatError(err, "Couldn't start this gift. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReopenCheckout = async () => {
    if (!checkoutSession) return;
    await openCheckoutUrl(checkoutSession.url);
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
      checkoutSession={checkoutSession}
      onBack={handleBack}
      onSelectPreset={handleSelectPreset}
      onCustomAmountChange={handleCustomAmountChange}
      onToggleCoverFees={setCoverFees}
      onContinue={handleContinue}
      onReopenCheckout={handleReopenCheckout}
    />
  );
}
