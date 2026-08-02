/**
 * GiveScreenView — presentational give sheet (ADR-032 §3/§7 Phase 1),
 * restyled onto the WhatsApp shell. Pure props in, no Convex/router imports.
 *
 * Payment is collected on a hosted Stripe Checkout page (ADR-032 §3/§7 Phase
 * 1 decision: zero native dependencies, ships via OTA, Apple Pay works in
 * the browser sheet). The "confirmation" step here isn't a payment
 * confirmation at all — it's a "finish in the browser" waypoint shown right
 * after `GiveScreen` launches the Checkout URL, since the actual payment
 * completes outside this screen. On native, `GiveScreen` watches
 * `getCheckoutSessionStatus` and replaces this step with the success screen
 * the moment the money lands, so the waiting step's own buttons (Reopen /
 * Cancel) are the manual fallback, not the happy path. There is deliberately
 * no "Done": a donor tapping it mid-payment would leave with no idea whether
 * their gift went through.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Animated,
  Easing,
  AccessibilityInfo,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { Skeleton, EmptyState } from "@components/ui";
import {
  WaSubScreenHeader,
  WaInsetGroup,
  WaCell,
  WA_GROUP_MARGIN,
  WA_GROUP_SPACING,
  WA_CELL_PADDING,
  WA_TYPE_FOOTNOTE,
  WA_TYPE_SUBTITLE,
  WA_TYPE_ROW_TITLE,
  WA_WEIGHT_BOLD,
  WA_WEIGHT_SEMIBOLD,
} from "@components/wa";
import { formatCents } from "../format";
import { estimateCoverFeesCents, resolveGiveAmountCents } from "./amount";
import { GIVING_GOLD, GIVING_GOLD_TINT } from "./giveTheme";
import type { CheckoutSession, GivingContext } from "./types";

export type GiveStep = "amount" | "confirmation";

/** Typed-amount display size — the give sheet's one hero number. */
const AMOUNT_SIZE = 56;

export interface GiveScreenViewProps {
  /** `undefined` while loading, `null` when giving isn't set up for this group. */
  context: GivingContext | null | undefined;
  step: GiveStep;
  selectedPresetCents: number | null;
  customAmountText: string;
  coverFees: boolean;
  submitting: boolean;
  error: string | null;
  checkoutSession: CheckoutSession | null;
  onBack: () => void;
  onSelectPreset: (cents: number) => void;
  onCustomAmountChange: (text: string) => void;
  onToggleCoverFees: (value: boolean) => void;
  onContinue: () => void;
  onReopenCheckout: () => void;
}

export function GiveScreenView({
  context,
  step,
  selectedPresetCents,
  customAmountText,
  coverFees,
  submitting,
  error,
  checkoutSession,
  onBack,
  onSelectPreset,
  onCustomAmountChange,
  onToggleCoverFees,
  onContinue,
  onReopenCheckout,
}: GiveScreenViewProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const amountCents = resolveGiveAmountCents(selectedPresetCents, customAmountText);
  const feeCents = coverFees && amountCents ? estimateCoverFeesCents(amountCents) : 0;
  const totalCents = (amountCents ?? 0) + feeCents;
  const canContinue = !!amountCents && !submitting;

  // The big display IS the input: a tapped preset writes its dollars into the
  // same field the donor types in, so there is one amount on screen and one
  // source of truth. `onCustomAmountChange` clears the preset upstream, which
  // is what makes typing over a chip behave the way it looks like it should.
  const displayText =
    selectedPresetCents !== null ? String(selectedPresetCents / 100) : customAmountText;

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.backgroundGrouped, paddingTop: insets.top },
      ]}
    >
      <WaSubScreenHeader title="Give" onBack={onBack} />

      {context === undefined ? (
        <View style={styles.loadingContainer} testID="give-screen-loading">
          <Skeleton height={200} borderRadius={24} style={styles.loadingBlock} />
          <Skeleton height={90} borderRadius={24} />
        </View>
      ) : context === null ? (
        <EmptyState
          icon="cash-outline"
          title="Giving isn't set up for this group yet"
          style={styles.emptyState}
        />
      ) : !context.givingLive ? (
        <EmptyState
          icon="time-outline"
          title="Giving isn't available right now"
          message="This group's giving is still being set up. Check back soon."
          style={styles.emptyState}
        />
      ) : step === "confirmation" ? (
        <WaitingStep
          fundName={context.fundName}
          totalCents={totalCents}
          canReopen={!!checkoutSession}
          onReopenCheckout={onReopenCheckout}
          onCancelGift={onBack}
          bottomInset={insets.bottom}
        />
      ) : (
        <>
          <ScrollView
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: insets.bottom + CTA_CLEARANCE },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.kicker, { color: colors.textSecondary }]}>
              Tax-deductible gift to {context.communityLegalName}
            </Text>

            <WaInsetGroup>
              <View style={styles.amountCard}>
                <View style={styles.amountRow}>
                  <Text style={[styles.amountPrefix, { color: colors.textSecondary }]}>$</Text>
                  <TextInput
                    value={displayText}
                    onChangeText={onCustomAmountChange}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor={colors.textTertiary}
                    accessibilityLabel="Gift amount in dollars"
                    testID="give-amount-input"
                    style={[styles.amountInput, { color: colors.text }]}
                  />
                </View>

                <View style={styles.presetRow}>
                  {context.suggestedAmountsCents.map((cents) => {
                    const selected = selectedPresetCents === cents;
                    return (
                      <Pressable
                        key={cents}
                        onPress={() => onSelectPreset(cents)}
                        accessibilityRole="button"
                        accessibilityLabel={`${formatCents(cents)} preset`}
                        accessibilityState={{ selected }}
                        style={({ pressed }) => [
                          styles.presetChip,
                          {
                            backgroundColor: selected
                              ? colors.buttonPrimary
                              : colors.backgroundGrouped,
                          },
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text
                          style={[
                            styles.presetChipText,
                            { color: selected ? colors.buttonPrimaryText : colors.text },
                          ]}
                        >
                          {formatCents(cents)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </WaInsetGroup>

            <View style={styles.group}>
              <WaInsetGroup>
                <WaCell
                  variant="toggle"
                  title="Cover the processing fee"
                  description={
                    amountCents
                      ? `+${formatCents(estimateCoverFeesCents(amountCents))} so the fund gets the full ${formatCents(amountCents)}`
                      : "Stripe's cut comes out of the gift unless you cover it."
                  }
                  toggleValue={coverFees}
                  onToggleChange={onToggleCoverFees}
                  accent={GIVING_GOLD}
                />
              </WaInsetGroup>
            </View>

            {!!error && (
              <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
            )}
          </ScrollView>

          {/* Pinned rather than `WaFloatingCta`: that component positions itself
              against the floating tab island's band, which this sub-screen
              doesn't have, and it fills with the community accent where the
              approved design calls for the neutral dark primary. */}
          <View style={[styles.ctaBar, { paddingBottom: insets.bottom + 12 }]}>
            <Pressable
              onPress={onContinue}
              disabled={!canContinue}
              accessibilityRole="button"
              accessibilityLabel={amountCents ? `Give ${formatCents(totalCents)}` : "Give"}
              accessibilityState={{ disabled: !canContinue }}
              style={({ pressed }) => [
                styles.ctaPill,
                {
                  backgroundColor: canContinue ? colors.buttonPrimary : colors.buttonDisabled,
                },
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.ctaLabel,
                  { color: canContinue ? colors.buttonPrimaryText : colors.textSecondary },
                ]}
              >
                {amountCents ? `Give ${formatCents(totalCents)}` : "Give"}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

/**
 * The waiting step — shown while the donor is in the Stripe browser sheet.
 *
 * On native this screen is transient: `GiveScreen` subscribes to
 * `getCheckoutSessionStatus` and routes to the success screen the moment the
 * donation is recorded. The pulse is what tells a donor staring at a static
 * page that something is still happening.
 */
function WaitingStep({
  fundName,
  totalCents,
  canReopen,
  onReopenCheckout,
  onCancelGift,
  bottomInset,
}: {
  fundName: string;
  totalCents: number;
  canReopen: boolean;
  onReopenCheckout: () => void;
  onCancelGift: () => void;
  bottomInset: number;
}) {
  const { colors } = useTheme();

  return (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + 32 }]}
      showsVerticalScrollIndicator={false}
    >
      <WaInsetGroup>
        <View style={styles.waitingCard}>
          <View style={[styles.lockTile, { backgroundColor: GIVING_GOLD_TINT }]}>
            <Ionicons name="lock-closed" size={26} color={GIVING_GOLD} />
          </View>
          <Text style={[styles.waitingTitle, { color: colors.text }]}>
            Finish in the browser
          </Text>
          <Text style={[styles.waitingCopy, { color: colors.textSecondary }]}>
            We&rsquo;ll bring you back here as soon as it goes through.
          </Text>
          <PulseDots color={colors.textTertiary} />
        </View>
      </WaInsetGroup>

      <View style={styles.group}>
        <WaInsetGroup separatorInset={0}>
          <KeyValueRow label="Amount" value={formatCents(totalCents)} />
          <KeyValueRow label="Fund" value={fundName} />
        </WaInsetGroup>
      </View>

      <View style={styles.waitingActions}>
        <Pressable
          onPress={onReopenCheckout}
          disabled={!canReopen}
          accessibilityRole="button"
          accessibilityLabel="Reopen payment page"
          accessibilityState={{ disabled: !canReopen }}
          style={({ pressed }) => [
            styles.secondaryPill,
            { backgroundColor: colors.surfaceGrouped, opacity: canReopen ? 1 : 0.5 },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.secondaryLabel, { color: colors.text }]}>
            Reopen payment page
          </Text>
        </Pressable>

        <Pressable
          onPress={onCancelGift}
          accessibilityRole="button"
          accessibilityLabel="Cancel this gift"
          style={({ pressed }) => [styles.ghostPill, pressed && styles.pressed]}
        >
          <Text style={[styles.ghostLabel, { color: colors.textSecondary }]}>
            Cancel this gift
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function KeyValueRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.kvRow}>
      <Text style={[styles.kvLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.kvValue, { color: colors.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Three dots pulsing in sequence.
 *
 * The app has no reduced-motion helper, so this asks `AccessibilityInfo`
 * directly and renders the dots at rest when the setting is on — a waiting
 * screen must never be the thing that triggers someone's vestibular symptoms.
 */
function PulseDots({ color }: { color: string }) {
  const [reduceMotion, setReduceMotion] = useState(false);
  // One shared clock, three dots reading different windows of it — cheaper
  // than three loops and guarantees they can never drift apart.
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setReduceMotion(enabled);
      })
      .catch(() => {
        // Some platforms (RN-Web) reject rather than resolve; a still dot
        // row is the safe default.
      });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      cancelled = true;
      subscription?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 3,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress, reduceMotion]);

  return (
    <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map((index) => (
        <Animated.View
          key={index}
          style={[
            styles.dot,
            { backgroundColor: color },
            reduceMotion
              ? { opacity: 0.4 }
              : {
                  opacity: progress.interpolate({
                    inputRange: [index - 1, index, index + 1, index + 3],
                    outputRange: [0.25, 1, 0.25, 0.25],
                    extrapolate: "clamp",
                  }),
                },
          ]}
        />
      ))}
    </View>
  );
}

/**
 * The static "you cancelled" page — what the Stripe `cancel_url` lands on
 * INSIDE the in-app browser on native, where the app has no auth token (that
 * browser has its own storage). Every query on the give screen would skip and
 * sit at `undefined` forever, so the donor would watch a permanent skeleton.
 * This renders instead: no queries, no spinner, and no instruction the donor
 * can't follow from inside a browser sheet.
 */
export function GiveCancelledNotice() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.screen,
        styles.cancelled,
        { backgroundColor: colors.backgroundGrouped, paddingTop: insets.top },
      ]}
      testID="give-cancelled-notice"
    >
      <Ionicons name="close-circle-outline" size={44} color={colors.textSecondary} />
      <Text style={[styles.cancelledTitle, { color: colors.text }]}>Gift cancelled</Text>
      <Text style={[styles.cancelledCopy, { color: colors.textSecondary }]}>
        You can close this window.
      </Text>
    </View>
  );
}

/** Room the scroll content leaves for the pinned CTA bar above it. */
const CTA_CLEARANCE = 86;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loadingContainer: { padding: WA_GROUP_MARGIN },
  loadingBlock: { marginBottom: 16 },
  emptyState: { flex: 1, justifyContent: "center" },
  scrollContent: { paddingTop: 8 },
  group: { marginTop: WA_GROUP_SPACING },
  pressed: { opacity: 0.85 },

  kicker: {
    fontSize: WA_TYPE_FOOTNOTE,
    textAlign: "center",
    marginBottom: 16,
    paddingHorizontal: WA_GROUP_MARGIN,
  },

  amountCard: { paddingHorizontal: WA_CELL_PADDING, paddingTop: 20, paddingBottom: 16 },
  amountRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center" },
  amountPrefix: {
    fontSize: 24,
    fontWeight: WA_WEIGHT_SEMIBOLD,
    marginTop: 12,
    marginRight: 2,
  },
  amountInput: {
    fontSize: AMOUNT_SIZE,
    fontWeight: WA_WEIGHT_BOLD,
    fontVariant: ["tabular-nums"],
    minWidth: 80,
    paddingVertical: 0,
    textAlign: "center",
  },
  presetRow: { flexDirection: "row", gap: 10, marginTop: 20 },
  presetChip: {
    flex: 1,
    borderRadius: 22,
    paddingVertical: 12,
    alignItems: "center",
  },
  presetChipText: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_SEMIBOLD },

  errorText: {
    fontSize: WA_TYPE_SUBTITLE,
    textAlign: "center",
    marginTop: 16,
    paddingHorizontal: WA_GROUP_MARGIN,
  },

  ctaBar: {
    paddingHorizontal: WA_GROUP_MARGIN,
    paddingTop: 12,
  },
  ctaPill: {
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaLabel: {
    fontSize: WA_TYPE_ROW_TITLE,
    fontWeight: WA_WEIGHT_SEMIBOLD,
    fontVariant: ["tabular-nums"],
  },

  waitingCard: { alignItems: "center", paddingHorizontal: WA_CELL_PADDING, paddingVertical: 28 },
  lockTile: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  waitingTitle: { fontSize: 20, fontWeight: WA_WEIGHT_BOLD },
  waitingCopy: {
    fontSize: WA_TYPE_SUBTITLE,
    textAlign: "center",
    marginTop: 6,
  },
  dots: { flexDirection: "row", gap: 6, marginTop: 20 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },

  kvRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: WA_CELL_PADDING,
    minHeight: 54,
    gap: 12,
  },
  kvLabel: { fontSize: WA_TYPE_ROW_TITLE },
  kvValue: { fontSize: WA_TYPE_ROW_TITLE, fontWeight: WA_WEIGHT_SEMIBOLD, flexShrink: 1 },

  waitingActions: { marginTop: WA_GROUP_SPACING, paddingHorizontal: WA_GROUP_MARGIN, gap: 8 },
  secondaryPill: {
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryLabel: { fontSize: WA_TYPE_ROW_TITLE, fontWeight: WA_WEIGHT_SEMIBOLD },
  ghostPill: { height: 44, alignItems: "center", justifyContent: "center" },
  ghostLabel: { fontSize: WA_TYPE_SUBTITLE },

  cancelled: { alignItems: "center", justifyContent: "center", padding: 32 },
  cancelledTitle: { fontSize: 22, fontWeight: WA_WEIGHT_BOLD, marginTop: 16 },
  cancelledCopy: { fontSize: WA_TYPE_SUBTITLE, marginTop: 6, textAlign: "center" },
});
