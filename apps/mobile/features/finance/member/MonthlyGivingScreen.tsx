/**
 * MonthlyGivingScreen — data wrapper for the donor-facing monthly-giving
 * manage screen (ADR-032 recurring giving). Reached from the fund dashboard's
 * "You give $X monthly" box and from the give sheet's already-giving notice
 * (app/groups/[group_id]/monthly-giving.tsx).
 *
 * All Convex/router wiring lives here; the UI is `MonthlyGivingScreenView`,
 * kept prop-only so a verification harness can render it with mock data.
 *
 * Two things worth knowing about the actions this screen calls:
 *
 *  1. **Cancelling is confirmed through `confirmAsync`, never `Alert.alert`.**
 *     `Alert.alert` is a no-op on web in this codebase, so a confirm built on
 *     it would silently do nothing there — and "nothing happened" on a Cancel
 *     button is indistinguishable from "it worked" until the next invoice.
 *  2. **Updating the card leaves the app.** `createCardUpdateSession` returns a
 *     Stripe Billing Portal URL, opened with the same `openBrowserAsync`
 *     pattern the give sheet uses for Checkout. Nothing here waits on it: the
 *     donor returns to a screen whose queries are live, so a replaced card
 *     shows up on its own when Stripe's webhook lands.
 */
import React, { useState } from "react";
import { Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useAuthenticatedQuery, useAuthenticatedAction, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { formatError } from "@/utils/error-handling";
import { confirmAsync } from "@/utils/platformAlert";
import { MonthlyGivingScreenView } from "./MonthlyGivingScreenView";
import { estimateCoverFeesCents, resolveGiveAmountCents } from "./amount";

/** Opens a URL in the platform's browser sheet — same helper shape as
 * `GiveScreen`'s `openCheckoutUrl`. */
async function openHostedUrl(url: string): Promise<void> {
  if (Platform.OS === "web") {
    window.location.href = url;
  } else {
    await WebBrowser.openBrowserAsync(url);
  }
}

export function MonthlyGivingScreen() {
  const params = useLocalSearchParams<{ group_id: string }>();
  const groupId = params.group_id;
  const router = useRouter();

  // The give context is only here for the fund id and the preset chips — this
  // screen never starts a gift, so nothing else on it is used.
  const context = useAuthenticatedQuery(
    api.functions.finance.giving.getGivingContext,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );
  const fundId = context?.fundId as Id<"funds"> | undefined;

  const recurring = useAuthenticatedQuery(
    api.functions.finance.giving.getRecurringForFund,
    fundId ? { fundId } : "skip",
  );

  const updateRecurringAmount = useAuthenticatedAction(
    api.functions.finance.giving.updateRecurringAmount,
  );
  const cancelRecurringDonation = useAuthenticatedAction(
    api.functions.finance.giving.cancelRecurringDonation,
  );
  const createCardUpdateSession = useAuthenticatedAction(
    api.functions.finance.giving.createCardUpdateSession,
  );

  const [editing, setEditing] = useState(false);
  const [selectedPresetCents, setSelectedPresetCents] = useState<number | null>(null);
  const [amountText, setAmountText] = useState("");
  const [coverFees, setCoverFees] = useState(false);
  const [saving, setSaving] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [updatingCard, setUpdatingCard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `context === null` means giving isn't set up for this group at all, which
  // for this screen is the same answer as "you have no monthly gift here" —
  // there is nothing to manage either way, and `undefined` (still loading) has
  // to stay distinct from both so the skeleton doesn't flash an empty state.
  const recurringForView =
    context === undefined ? undefined : context === null ? null : recurring;

  const goToFund = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(`/groups/${groupId}/fund` as any);
  };

  const handleStartEdit = () => {
    if (!recurring) return;
    // Seeded from the live gift, so "change the amount" opens on what they
    // actually give rather than an empty field they have to re-derive.
    setSelectedPresetCents(null);
    setAmountText(String(Math.round(recurring.amountCents / 100)));
    setCoverFees(recurring.feeCoverCents > 0);
    setError(null);
    setEditing(true);
  };

  const handleSelectPreset = (cents: number) => {
    setSelectedPresetCents((current) => (current === cents ? null : cents));
    setAmountText("");
    setError(null);
  };

  const handleAmountChange = (text: string) => {
    setAmountText(text);
    setSelectedPresetCents(null);
    setError(null);
  };

  const handleSaveAmount = async () => {
    if (!recurring) return;
    const amountCents = resolveGiveAmountCents(selectedPresetCents, amountText);
    if (!amountCents) return;

    setSaving(true);
    setError(null);
    try {
      await updateRecurringAmount({
        recurringDonationId: recurring.id as Id<"recurringDonations">,
        amountCents,
        coverFeesCents: coverFees ? estimateCoverFeesCents(amountCents) : 0,
      });
      setEditing(false);
    } catch (err) {
      setError(formatError(err, "Couldn't change this amount. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateCard = async () => {
    if (!recurring) return;
    setUpdatingCard(true);
    setError(null);
    try {
      const { url } = await createCardUpdateSession({
        recurringDonationId: recurring.id as Id<"recurringDonations">,
      });
      await openHostedUrl(url);
    } catch (err) {
      setError(formatError(err, "Couldn't open the payment page. Please try again."));
    } finally {
      setUpdatingCard(false);
    }
  };

  const handleCancelRecurring = async () => {
    if (!recurring) return;
    const confirmed = await confirmAsync({
      title: "Cancel monthly giving?",
      message: "Ends future gifts. Past gifts stay.",
      confirmText: "Stop giving monthly",
      cancelText: "Keep giving",
      destructive: true,
    });
    if (!confirmed) return;

    setCanceling(true);
    setError(null);
    try {
      await cancelRecurringDonation({
        recurringDonationId: recurring.id as Id<"recurringDonations">,
      });
      // Back to the fund, where the monthly box is now gone — the queries
      // behind it are live, so nothing here has to invalidate anything.
      goToFund();
    } catch (err) {
      setError(formatError(err, "Couldn't stop this monthly gift. Please try again."));
      setCanceling(false);
    }
  };

  return (
    <MonthlyGivingScreenView
      recurring={recurringForView}
      suggestedAmountsCents={context?.suggestedAmountsCents ?? []}
      editing={editing}
      editSelectedPresetCents={selectedPresetCents}
      editAmountText={amountText}
      editCoverFees={coverFees}
      saving={saving}
      canceling={canceling}
      updatingCard={updatingCard}
      error={error}
      onBack={goToFund}
      onStartEdit={handleStartEdit}
      onCancelEdit={() => {
        setEditing(false);
        setError(null);
      }}
      onSelectPreset={handleSelectPreset}
      onAmountChange={handleAmountChange}
      onToggleCoverFees={setCoverFees}
      onSaveAmount={handleSaveAmount}
      onUpdateCard={handleUpdateCard}
      onCancelRecurring={handleCancelRecurring}
    />
  );
}
