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
 *
 * MONTHLY gifts reuse all of it with one substitution. Subscription-mode
 * Checkout has NO PaymentIntent, so there is nothing for
 * `getCheckoutSessionStatus` to watch. Instead the waiting step subscribes to
 * `getRecurringForFund` — a live (not polled) Convex query that returns only
 * `active`/`past_due` rows — and advances when it hands back the very row this
 * submission created. Stripe drives that flip in two beats:
 * `checkout.session.completed` binds the subscription to the pending row, then
 * `invoice.paid` activates it. Only `active` advances: `past_due` means the
 * first invoice failed, and a thank-you screen for a declined card is a lie the
 * donor's statement contradicts — they stay on the waiting step with Reopen and
 * Cancel, exactly as a failed one-off does.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import {
  GiveScreenView,
  GiveCancelledNotice,
  type GiveStep,
  type GiveFrequency,
} from "./GiveScreenView";
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
  const createRecurringDonationCheckoutSession = useAuthenticatedAction(
    api.functions.finance.giving.createRecurringDonationCheckoutSession,
  );
  // Only ever called on the row THIS screen just created and the donor then
  // walked away from — see `handleBack`.
  const cancelRecurringDonation = useAuthenticatedAction(
    api.functions.finance.giving.cancelRecurringDonation,
  );

  const [step, setStep] = useState<GiveStep>("amount");
  const [frequency, setFrequency] = useState<GiveFrequency>("once");
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

  // The monthly equivalent. `getRecurringForFund` is donor-scoped and returns
  // only a LIVE row, so "it came back non-null with our id" is precisely
  // "Stripe bound the subscription and the first invoice was paid".
  const watchedRecurringDonationId =
    step === "confirmation" ? (checkoutSession?.recurringDonationId ?? null) : null;
  const recurringStatus = useAuthenticatedQuery(
    api.functions.finance.giving.getRecurringForFund,
    watchedRecurringDonationId && context?.fundId
      ? { fundId: context.fundId as Id<"funds"> }
      : "skip",
  );

  // Guards the redirect against a re-render firing it twice (the query stays
  // "complete" once it flips, and `router.replace` isn't idempotent). Shared
  // by both watchers — only one is ever live, and a single latch means neither
  // can double-navigate the other.
  const advancedRef = useRef(false);

  /**
   * Hands the donor to the thank-you screen. Shared by both watchers so the
   * one-off and monthly paths can never drift on the query string the
   * zero-auth success screen renders from.
   */
  const goToThankYou = useCallback(
    (gift: {
      amountCents: number;
      fund: string;
      community: string;
      recurring: boolean;
    }) => {
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

      // `urlSafeName`, not bare `encodeURIComponent`: it throws on an unpaired
      // surrogate, and throwing here — after `advancedRef` has latched — costs
      // the donor the thank-you screen with no retry. Same helper shape the
      // backend uses to build Stripe's success_url.
      const query =
        `?amount=${gift.amountCents}` +
        `&fund=${urlSafeName(gift.fund)}` +
        `&community=${urlSafeName(gift.community)}` +
        // Matches `buildGiveReturnUrls`' own flag, so a monthly gift reads the
        // same whether the donor came back through Stripe's redirect or
        // through this watcher.
        (gift.recurring ? "&recurring=1" : "");
      router.replace(`/groups/${groupId}/give-success${query}` as any);
    },
    [groupId, router],
  );

  useEffect(() => {
    if (checkoutStatus?.status !== "complete") return;
    if (advancedRef.current) return;
    advancedRef.current = true;

    // The query's own values win over local state: they're what was actually
    // charged and recorded, where the local total is only what was requested.
    const giftCents = resolveGiveAmountCents(selectedPresetCents, customAmountText) ?? 0;
    const localTotalCents =
      giftCents + (coverFees ? estimateCoverFeesCents(giftCents) : 0);
    goToThankYou({
      amountCents: checkoutStatus.amountCents ?? localTotalCents,
      fund: checkoutStatus.fundName ?? context?.fundName ?? "",
      community: checkoutStatus.communityName ?? context?.communityLegalName ?? "",
      recurring: false,
    });
  }, [
    checkoutStatus,
    context?.fundName,
    context?.communityLegalName,
    coverFees,
    customAmountText,
    goToThankYou,
    selectedPresetCents,
  ]);

  // The monthly watcher. Two guards beyond "a row came back":
  //
  //  - the id must be THIS submission's, so a row created in another tab (or
  //    an unrelated live gift the donor somehow has) can't fake a thank-you;
  //  - the status must be `active`, not merely live. `past_due` means the very
  //    first invoice failed, and thanking someone for a declined card is the
  //    one screen that would stop them from fixing it.
  useEffect(() => {
    if (!watchedRecurringDonationId) return;
    if (!recurringStatus || recurringStatus.id !== watchedRecurringDonationId) return;
    if (recurringStatus.status !== "active") return;
    if (advancedRef.current) return;
    advancedRef.current = true;

    // Server truth again: the row holds the validated gift/fee split, so the
    // amount shown is what the subscription actually bills.
    goToThankYou({
      amountCents: recurringStatus.amountCents + recurringStatus.feeCoverCents,
      fund: recurringStatus.fundName || (context?.fundName ?? ""),
      // The recurring row carries no community name — the give context is the
      // only place this screen has one, and it's the same community either way.
      community: context?.communityLegalName ?? "",
      recurring: true,
    });
  }, [
    context?.communityLegalName,
    context?.fundName,
    goToThankYou,
    recurringStatus,
    watchedRecurringDonationId,
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

  const handleBack = async () => {
    if (step === "confirmation") {
      // Editing the gift after a session was created starts a NEW submission
      // — drop the stale session so "Reopen" can't relaunch the old amount.
      // (The nonce was already rotated when that session was created, so the
      // next Give gets a fresh idempotency key; reusing the old key with
      // different params would make Stripe reject the request.)
      const abandonedRecurringId = checkoutSession?.recurringDonationId;
      setCheckoutSession(null);
      setStep("amount");

      // A MONTHLY submission left a `pending` recurringDonations row on the
      // server, and that row blocks a new monthly gift to this fund for the
      // whole `PENDING_CHECKOUT_GRACE_MS` window (30 minutes) while its Stripe
      // page stays live. Clearing local state alone would therefore turn
      // "Cancel this gift" into "you may not give monthly for half an hour",
      // with the reason ("a checkout is already in progress") describing a
      // page the donor just walked away from. Release it: the action expires
      // the Checkout Session and marks the row canceled.
      //
      // Awaited behind `submitting` rather than fired and forgotten, because
      // the give CTA is disabled while submitting — that is what stops an
      // immediate re-tap from racing its own release and hitting the block.
      // Failures are swallowed: the donor lands exactly where an unreleased
      // row would have left them, and the row's grace window still expires.
      if (abandonedRecurringId) {
        setSubmitting(true);
        try {
          await cancelRecurringDonation({
            recurringDonationId: abandonedRecurringId as Id<"recurringDonations">,
          });
        } catch {
          // Intentionally silent — nothing the donor can act on here.
        } finally {
          setSubmitting(false);
        }
      }
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else if (groupId) {
      router.push(`/groups/${groupId}/fund` as any);
    }
  };

  const handleSelectFrequency = (next: GiveFrequency) => {
    setFrequency(next);
    // A rejected monthly submission left an error the donor can't act on once
    // they've switched back to a one-off (and vice versa).
    setError(null);
  };

  const handleManageRecurring = () => {
    if (!groupId) return;
    router.push(`/groups/${groupId}/monthly-giving` as any);
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
    // One active monthly per fund is enforced server-side; the view swaps the
    // CTA for a "you already give $X/month" notice, and this is the matching
    // guard for anything that reaches the handler anyway.
    if (frequency === "monthly" && context.existingRecurring) return;
    const amountCents = resolveGiveAmountCents(selectedPresetCents, customAmountText);
    if (!amountCents) return;

    setSubmitting(true);
    setError(null);
    try {
      const coverFeesCents = coverFees ? estimateCoverFeesCents(amountCents) : 0;
      const args = {
        fundId: context.fundId as Id<"funds">,
        amountCents,
        coverFeesCents,
        idempotencyNonce: idempotencyNonceRef.current,
      };
      // Subscription-mode Checkout returns no PaymentIntent, so the monthly
      // result is normalised into the same shape with the recurring row id in
      // place of it — that id is what the waiting step watches.
      const result: CheckoutSession =
        frequency === "monthly"
          ? {
              ...(await createRecurringDonationCheckoutSession(args)),
              paymentIntentId: null,
            }
          : await createDonationCheckoutSession(args);
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
      frequency={frequency}
      selectedPresetCents={selectedPresetCents}
      customAmountText={customAmountText}
      coverFees={coverFees}
      submitting={submitting}
      error={error}
      checkoutSession={checkoutSession}
      // Whichever join key this gift's path actually has. Monthly gets the
      // recurring row id; a one-off gets its PaymentIntent. Neither present
      // means nothing is watching, and the waiting step offers its way out.
      canAutoAdvance={
        checkoutSession?.paymentIntentId != null ||
        checkoutSession?.recurringDonationId != null
      }
      onBack={handleBack}
      onSelectFrequency={handleSelectFrequency}
      onSelectPreset={handleSelectPreset}
      onCustomAmountChange={handleCustomAmountChange}
      onToggleCoverFees={setCoverFees}
      onContinue={handleContinue}
      onReopenCheckout={handleReopenCheckout}
      onFinishManually={handleFinishManually}
      onManageRecurringPress={handleManageRecurring}
    />
  );
}
