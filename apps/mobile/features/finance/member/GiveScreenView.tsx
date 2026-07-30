/**
 * GiveScreenView — presentational give sheet (ADR-032 §3/§7 Phase 1). Pure
 * props in, no Convex/router imports.
 *
 * Payment is collected on a hosted Stripe Checkout page (ADR-032 §3/§7 Phase
 * 1 decision: zero native dependencies, ships via OTA, Apple Pay works in
 * the browser sheet). The "confirmation" step here isn't a payment
 * confirmation at all — it's a "finish in the browser" waypoint shown right
 * after `GiveScreen` launches the Checkout URL, since the actual payment
 * completes outside this screen (in the browser sheet, then via the
 * `success_url`/`cancel_url` universal link back to the fund screen; Convex
 * reactivity — not the redirect — is what updates the fund balance/activity).
 */
import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { Button, Input, Switch, Skeleton, EmptyState } from "@components/ui";
import { formatCents } from "../format";
import { estimateCoverFeesCents, resolveGiveAmountCents } from "./amount";
import type { CheckoutSession, GivingContext } from "./types";

export type GiveStep = "amount" | "confirmation";

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

  const amountCents = resolveGiveAmountCents(selectedPresetCents, customAmountText);
  const feeCents = coverFees && amountCents ? estimateCoverFeesCents(amountCents) : 0;
  const totalCents = (amountCents ?? 0) + feeCents;
  const canContinue = !!amountCents && !submitting;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: colors.surface, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity style={styles.backButton} onPress={onBack} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Give</Text>
        <View style={styles.headerSpacer} />
      </View>

      {context === undefined ? (
        <View style={styles.loadingContainer} testID="give-screen-loading">
          <Skeleton height={80} borderRadius={12} style={{ marginBottom: 16 }} />
          <Skeleton height={160} borderRadius={12} />
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
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={[styles.confirmationPanel, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="lock-closed" size={40} color={colors.success} />
            <Text style={[styles.confirmationTitle, { color: colors.text }]}>
              Finish your gift in the browser
            </Text>
            <Text style={[styles.confirmationSubtitle, { color: colors.textSecondary }]}>
              Complete your gift in the secure Stripe page that just opened.
              Once it's done, you can close that page and come back here.
            </Text>
            <View style={styles.confirmationRow}>
              <Text style={[styles.confirmationLabel, { color: colors.textSecondary }]}>
                Amount
              </Text>
              <Text style={[styles.confirmationValue, { color: colors.text }]}>
                {formatCents(totalCents)}
              </Text>
            </View>
            <View style={styles.confirmationRow}>
              <Text style={[styles.confirmationLabel, { color: colors.textSecondary }]}>
                Fund
              </Text>
              <Text style={[styles.confirmationValue, { color: colors.text }]}>
                {context.fundName}
              </Text>
            </View>
          </View>

          <Button
            onPress={onReopenCheckout}
            disabled={!checkoutSession}
            variant="secondary"
          >
            Reopen payment page
          </Button>

          <Button onPress={onBack}>Done</Button>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={[styles.legalLine, { color: colors.textSecondary }]}>
            Tax-deductible gift to {context.communityLegalName}
          </Text>

          <View style={styles.presetRow}>
            {context.suggestedAmountsCents.map((cents) => {
              const selected = selectedPresetCents === cents;
              return (
                <TouchableOpacity
                  key={cents}
                  onPress={() => onSelectPreset(cents)}
                  accessibilityLabel={`${formatCents(cents)} preset`}
                  style={[
                    styles.presetChip,
                    {
                      backgroundColor: selected ? colors.buttonPrimary : colors.surfaceSecondary,
                      borderColor: selected ? colors.buttonPrimary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.presetChipText,
                      { color: selected ? colors.textInverse : colors.text },
                    ]}
                  >
                    {formatCents(cents)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Input
            label="Custom amount"
            placeholder="$0"
            value={customAmountText}
            onChangeText={onCustomAmountChange}
            style={styles.customAmountInput}
          />

          <View style={[styles.feeCard, { backgroundColor: colors.surfaceSecondary }]}>
            <Switch
              value={coverFees}
              onValueChange={onToggleCoverFees}
              label="Cover the processing fee"
            />
            {coverFees && !!amountCents && (
              <Text style={[styles.feeText, { color: colors.textSecondary }]}>
                +{formatCents(feeCents)} added — {formatCents(totalCents)} total
              </Text>
            )}
          </View>

          {!!error && (
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          )}

          <Button onPress={onContinue} disabled={!canContinue} loading={submitting}>
            Continue
          </Button>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: { padding: 4 },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
    marginRight: 32,
  },
  headerSpacer: { width: 32 },
  loadingContainer: { padding: 16 },
  emptyState: { flex: 1, justifyContent: "center" },
  scrollContent: { padding: 16, gap: 16, paddingBottom: 32 },
  legalLine: { fontSize: 14, textAlign: "center" },
  presetRow: { flexDirection: "row", gap: 10 },
  presetChip: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: "center",
  },
  presetChipText: { fontSize: 16, fontWeight: "600" },
  customAmountInput: { marginTop: 0 },
  feeCard: { borderRadius: 12, padding: 14, gap: 6 },
  feeText: { fontSize: 13 },
  errorText: { fontSize: 14, textAlign: "center" },
  confirmationPanel: {
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    gap: 8,
  },
  confirmationTitle: { fontSize: 18, fontWeight: "700", marginTop: 4 },
  confirmationSubtitle: { fontSize: 13, textAlign: "center", marginBottom: 8 },
  confirmationRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    paddingVertical: 6,
  },
  confirmationLabel: { fontSize: 14 },
  confirmationValue: { fontSize: 14, fontWeight: "600" },
});
