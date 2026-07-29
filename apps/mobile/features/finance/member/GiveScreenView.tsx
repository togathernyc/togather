/**
 * GiveScreenView — presentational give sheet (ADR-032 §3/§7 Phase 1). Pure
 * props in, no Convex/router imports.
 *
 * PAYMENT STEP IS STUBBED: the "confirmation" step just proves a Stripe
 * PaymentIntent was created (masked client secret + amount). Wiring an
 * actual payment sheet ships with the Stripe payment-sheet decision — ADR-032
 * open question: native `@stripe/stripe-react-native` sheet (better Apple Pay
 * conversion, but a new native dependency that must be gated per ADR-013) vs.
 * a web-based Stripe Checkout (zero native-dep risk). Do NOT import
 * `@stripe/stripe-react-native` here until that's decided.
 */
import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { Button, Input, Switch, Skeleton, EmptyState } from "@components/ui";
import { formatCents } from "../format";
import { estimateCoverFeesCents, resolveGiveAmountCents } from "./amount";
import type { DonationIntent, GivingContext } from "./types";

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
  intent: DonationIntent | null;
  onBack: () => void;
  onSelectPreset: (cents: number) => void;
  onCustomAmountChange: (text: string) => void;
  onToggleCoverFees: (value: boolean) => void;
  onContinue: () => void;
}

/** "pi_3P...secret_1a2b" -> "pi_3P••••••••1a2b" — never render the full secret. */
export function maskClientSecret(secret: string): string {
  if (secret.length <= 12) return "•".repeat(secret.length);
  return `${secret.slice(0, 6)}${"•".repeat(8)}${secret.slice(-4)}`;
}

export function GiveScreenView({
  context,
  step,
  selectedPresetCents,
  customAmountText,
  coverFees,
  submitting,
  error,
  intent,
  onBack,
  onSelectPreset,
  onCustomAmountChange,
  onToggleCoverFees,
  onContinue,
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
            <Ionicons name="checkmark-circle" size={40} color={colors.success} />
            <Text style={[styles.confirmationTitle, { color: colors.text }]}>
              Payment intent created
            </Text>
            <Text style={[styles.confirmationSubtitle, { color: colors.textSecondary }]}>
              STUBBED — the payment sheet that collects the card and confirms
              this intent isn't wired up yet (see ADR-032 open questions).
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
                {context.communityLegalName}
              </Text>
            </View>
            {!!intent && (
              <View style={styles.confirmationRow}>
                <Text style={[styles.confirmationLabel, { color: colors.textSecondary }]}>
                  Client secret
                </Text>
                <Text
                  style={[styles.confirmationValue, styles.mono, { color: colors.textTertiary }]}
                >
                  {maskClientSecret(intent.clientSecret)}
                </Text>
              </View>
            )}
          </View>
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
  mono: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) },
});
