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
 * browser sheet) — "Give" creates a Checkout Session, then opens its `url`
 * via expo-web-browser, the same `openBrowserAsync` pattern
 * FinanceOnboardingStatusScreen uses for Stripe's hosted onboarding.
 *
 * Two things this screen owns that the view can't:
 *
 *  1. **Auto-advance.** On native, Stripe's `success_url` loads INSIDE the
 *     in-app browser, which has its own storage and no session — so the app
 *     never sees the redirect. Instead the waiting step subscribes to
 *     `getCheckoutSessionStatus` and, the moment the webhook records the
 *     donation, dismisses the browser itself and routes to the success screen.
 *  2. **The cancel return.** Stripe's `cancel_url` is this same route with
 *     `?giving=cancelled`, and on native it too opens in that auth-less
 *     browser — where every `useAuthenticatedQuery` skips and the screen would
 *     sit on a skeleton forever. Unauthenticated + cancelled renders a static
 *     notice instead.
 */
import React, { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  useAuthenticatedQuery,
  useAuthenticatedAction,
  useStoredAuthToken,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { formatError } from "@/utils/error-handling";
import { GiveScreenView, GiveCancelledNotice, type GiveStep } from "./GiveScreenView";
import { estimateCoverFeesCents, resolveGiveAmountCents } from "./amount";
import { urlSafeName } from "./giveSuccessParams";
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
  const params = useLocalSearchParams<{ group_id: string; giving?: string }>();
  const groupId = params.group_id;
  const router = useRouter();
  const token = useStoredAuthToken();

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
  // "Give" reuses the same Stripe idempotency key instead of creating a
  // second Checkout Session — see createDonationCheckoutSession's doc comment.
  const idempotencyNonceRef = useRef<string>(
    `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  // Only subscribes while the donor is actually waiting AND Stripe handed back
  // a PaymentIntent to watch. When it didn't (`paymentIntentId === null`, which
  // that action logs), this skips and the wait degrades to manual: the gift
  // still lands via the webhook, and the waiting step swaps its pulse for a
  // "Go to the fund" exit (`canAutoAdvance`), because with nothing watching,
  // "Cancel this gift" would otherwise be the only way off a screen the donor
  // may have already paid on.
  const watchedPaymentIntentId =
    step === "confirmation" ? (checkoutSession?.paymentIntentId ?? null) : null;
  const checkoutStatus = useAuthenticatedQuery(
    api.functions.finance.giving.getCheckoutSessionStatus,
    watchedPaymentIntentId ? { paymentIntentId: watchedPaymentIntentId } : "skip",
  );

  // Guards the redirect against a re-render firing it twice (the query stays
  // "complete" once it flips, and `router.replace` isn't idempotent).
  const advancedRef = useRef(false);

  useEffect(() => {
    if (checkoutStatus?.status !== "complete") return;
    if (advancedRef.current) return;
    advancedRef.current = true;

    // The browser sheet is a native-only surface; on web the donor is already
    // ON Stripe's page and its own `success_url` navigation does this job.
    // Dismissing is a courtesy, never a precondition for the thank-you: when
    // nothing is open this throws on some platforms and rejects on others, and
    // the `.then` wrapper swallows both.
    if (Platform.OS !== "web") {
      Promise.resolve()
        .then(() => WebBrowser.dismissBrowser())
        .catch(() => {});
    }

    // The query's own values win over local state: they're what was actually
    // charged and recorded, where the local total is only what was requested.
    const giftCents = resolveGiveAmountCents(selectedPresetCents, customAmountText) ?? 0;
    const localTotalCents =
      giftCents + (coverFees ? estimateCoverFeesCents(giftCents) : 0);
    const amountCents = checkoutStatus.amountCents ?? localTotalCents;
    const fund = checkoutStatus.fundName ?? context?.fundName ?? "";
    const community = checkoutStatus.communityName ?? context?.communityLegalName ?? "";

    // `urlSafeName`, not bare `encodeURIComponent`: it throws on an unpaired
    // surrogate, and throwing here — after `advancedRef` has latched — costs
    // the donor the thank-you screen with no retry. Same helper shape the
    // backend uses to build Stripe's success_url.
    const query =
      `?amount=${amountCents}` +
      `&fund=${urlSafeName(fund)}` +
      `&community=${urlSafeName(community)}`;
    router.replace(`/groups/${groupId}/give-success${query}` as any);
  }, [
    checkoutStatus,
    context?.fundName,
    context?.communityLegalName,
    coverFees,
    customAmountText,
    groupId,
    router,
    selectedPresetCents,
  ]);

  // Stripe's cancel_url inside the auth-less in-app browser. Placed after every
  // hook so the hook order never changes; the queries above already skip
  // without a token, so nothing is in flight behind this.
  //
  // NOTE: `useStoredAuthToken` starts at `null` and resolves from storage a
  // frame or two later, so a signed-in donor cancelling on WEB (where the app
  // cold-boots on this URL) sees this notice briefly before the give form
  // takes over. That's the deliberate trade: gating it on `Platform.OS` would
  // hand a signed-out web visitor the permanent skeleton this exists to kill.
  if (params.giving === "cancelled" && !token) {
    return <GiveCancelledNotice />;
  }

  const handleBack = () => {
    if (step === "confirmation") {
      // Editing the gift after a session was created starts a NEW submission
      // — drop the stale session so "Reopen" can't relaunch the old amount.
      // (The nonce was already rotated when that session was created, so the
      // next Give gets a fresh idempotency key; reusing the old key with
      // different params would make Stripe reject the request.)
      setCheckoutSession(null);
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
      // Rotate the nonce now that this submission has its session: a failed
      // call keeps the old nonce (retry = same idempotency key = no double
      // session), while the donor's NEXT gift — after cancel/back — gets a
      // fresh key instead of colliding with this one.
      idempotencyNonceRef.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      advancedRef.current = false;
      setStep("confirmation");
      await openCheckoutUrl(result.url);
    } catch (err) {
      setError(formatError(err, "Couldn't start this gift. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  // Leaves for the fund without resetting anything: used only when nothing is
  // watching this gift (no PaymentIntent), where the alternative on screen is
  // "Cancel this gift" — which clears the form and invites a second donation
  // after a charge that may well have succeeded.
  const handleFinishManually = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(`/groups/${groupId}/fund` as any);
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
      canAutoAdvance={checkoutSession?.paymentIntentId != null}
      onBack={handleBack}
      onSelectPreset={handleSelectPreset}
      onCustomAmountChange={handleCustomAmountChange}
      onToggleCoverFees={setCoverFees}
      onContinue={handleContinue}
      onReopenCheckout={handleReopenCheckout}
      onFinishManually={handleFinishManually}
    />
  );
}
