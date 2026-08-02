/**
 * MonthlyGivingScreenView — presentational manage screen for a donor's own
 * monthly gift (ADR-032 recurring giving). Pure props in, no Convex/router
 * imports, so a verification harness can render it standalone with mock data.
 *
 * Same WhatsApp shell as `FundScreenView`: grouped-gray canvas, floating
 * `WaSubScreenHeader`, content as `WaInsetGroup` cards.
 *
 * The screen is ordered by how urgent each row is to the donor who opened it:
 * a failing payment first (it is the only reason most people arrive here in a
 * hurry), then what the gift IS, then the facts about it, then the two things
 * they might change, then the one thing they might stop. The destructive cell
 * is last and alone in its card — it is the only irreversible control on the
 * screen and must never sit a thumb's width from "Change amount".
 *
 * Changing the CARD is the one action that leaves the app: Stripe's Billing
 * Portal is what actually re-attaches a payment method to a live subscription,
 * so the row says where it is going ("Opens Stripe's secure page") rather than
 * looking like an in-app form that suddenly isn't one.
 */
import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { Skeleton, EmptyState } from "@components/ui";
import {
  WaSubScreenHeader,
  WaInsetGroup,
  WaCell,
  WA_GROUP_MARGIN,
  WA_GROUP_RADIUS,
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
import {
  formatFeeCoverValue,
  formatRecurringDate,
  type RecurringSummary,
} from "./recurring";

/** Hero amount type size — one step under the fund balance, which is the
 * bigger number on the screen the donor just came from. */
const AMOUNT_SIZE = 40;
/** Gold glyph tile above the amount, same language as the fund hero's. */
const GLYPH_TILE = 44;

export interface MonthlyGivingScreenViewProps {
  /** `undefined` while loading, `null` when there's no monthly gift here. */
  recurring: RecurringSummary | null | undefined;
  /** Preset chips for the inline amount editor — the give sheet's own. */
  suggestedAmountsCents: readonly number[];
  /** Whether the inline amount editor has replaced the "Change amount" cell. */
  editing: boolean;
  editSelectedPresetCents: number | null;
  editAmountText: string;
  editCoverFees: boolean;
  saving: boolean;
  /** Disables the destructive cell while the cancel is in flight. */
  canceling: boolean;
  /** Disables the card row while the portal session is being created. */
  updatingCard: boolean;
  error: string | null;
  onBack: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSelectPreset: (cents: number) => void;
  onAmountChange: (text: string) => void;
  onToggleCoverFees: (value: boolean) => void;
  onSaveAmount: () => void;
  onUpdateCard: () => void;
  onCancelRecurring: () => void;
}

export function MonthlyGivingScreenView({
  recurring,
  suggestedAmountsCents,
  editing,
  editSelectedPresetCents,
  editAmountText,
  editCoverFees,
  saving,
  canceling,
  updatingCard,
  error,
  onBack,
  onStartEdit,
  onCancelEdit,
  onSelectPreset,
  onAmountChange,
  onToggleCoverFees,
  onSaveAmount,
  onUpdateCard,
  onCancelRecurring,
}: MonthlyGivingScreenViewProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const nextGift = recurring ? formatRecurringDate(recurring.currentPeriodEnd) : null;

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.backgroundGrouped, paddingTop: insets.top },
      ]}
    >
      <WaSubScreenHeader title="Monthly giving" onBack={onBack} />

      {recurring === undefined ? (
        <View style={styles.loadingContainer} testID="monthly-giving-loading">
          <Skeleton height={160} borderRadius={WA_GROUP_RADIUS} style={styles.loadingBlock} />
          <Skeleton height={180} borderRadius={WA_GROUP_RADIUS} />
        </View>
      ) : recurring === null ? (
        <EmptyState
          icon="repeat"
          title="No monthly gift here"
          message="You're not giving monthly to this fund right now."
          style={styles.emptyState}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 40 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* PAST DUE — first, because it is the only state where every other
              row on this screen is describing a gift that isn't collecting. */}
          {recurring.status === "past_due" && (
            <View>
              <WaInsetGroup>
                <WaCell
                  testID="monthly-past-due-banner"
                  icon="alert-circle-outline"
                  iconColor={colors.warning}
                  title="A payment didn't go through"
                  description="Update your card to keep this gift going"
                  descriptionColor={colors.warning}
                  onPress={onUpdateCard}
                  disabled={updatingCard}
                />
              </WaInsetGroup>
            </View>
          )}

          {/* HERO — what the gift IS, in the donor's own words back to them. */}
          <View style={recurring.status === "past_due" ? styles.group : undefined}>
            <WaInsetGroup>
              <View style={styles.hero}>
                <View style={[styles.glyphTile, { backgroundColor: GIVING_GOLD_TINT }]}>
                  <Ionicons name="repeat" size={24} color={GIVING_GOLD} />
                </View>
                <Text style={[styles.amount, { color: colors.text }]}>
                  {formatCents(recurring.amountCents)}
                </Text>
                <Text
                  style={[styles.heroCaption, { color: colors.textSecondary }]}
                  numberOfLines={2}
                >
                  every month to {recurring.fundName}
                </Text>
              </View>
            </WaInsetGroup>
          </View>

          {/* THE FACTS — when, on what card, and whether the fee is covered. */}
          <View style={styles.group}>
            <WaInsetGroup>
              <WaCell
                icon="calendar-outline"
                title="Next gift"
                trailingAccessory={
                  <Text
                    testID="monthly-next-gift"
                    style={[styles.trailingValue, { color: colors.textTertiary }]}
                  >
                    {/* Stripe hasn't reported a period on a gift bound seconds
                        ago — say so rather than print a fabricated date. */}
                    {nextGift ?? "Scheduled"}
                  </Text>
                }
              />
              <WaCell
                testID="monthly-update-card"
                icon="card-outline"
                title="Update payment method"
                description="Opens Stripe's secure page"
                onPress={onUpdateCard}
                disabled={updatingCard}
              />
              <WaCell
                icon="pricetag-outline"
                title="Fee cover"
                trailingAccessory={
                  <Text
                    testID="monthly-fee-cover"
                    style={[styles.trailingValue, { color: colors.textTertiary }]}
                  >
                    {formatFeeCoverValue(recurring.feeCoverCents)}
                  </Text>
                }
              />
            </WaInsetGroup>
          </View>

          {/* CHANGE AMOUNT — the editor takes the cell's place rather than
              opening below it, so there is never a stale "$25.00 monthly" row
              sitting above a field that says something else. */}
          <View style={styles.group}>
            {editing ? (
              <AmountEditor
                suggestedAmountsCents={suggestedAmountsCents}
                selectedPresetCents={editSelectedPresetCents}
                amountText={editAmountText}
                coverFees={editCoverFees}
                saving={saving}
                onSelectPreset={onSelectPreset}
                onAmountChange={onAmountChange}
                onToggleCoverFees={onToggleCoverFees}
                onSave={onSaveAmount}
                onCancel={onCancelEdit}
              />
            ) : (
              <WaInsetGroup footer="A new amount starts with your next gift — this month is already paid.">
                <WaCell
                  testID="monthly-change-amount"
                  icon="pencil-outline"
                  title="Change amount"
                  onPress={onStartEdit}
                />
              </WaInsetGroup>
            )}
          </View>

          {!!error && (
            <Text testID="monthly-giving-error" style={[styles.errorText, { color: colors.error }]}>
              {error}
            </Text>
          )}

          {/* STOP — alone in its own card, last, and never while the editor is
              open: a donor mid-edit is deciding how much to give, not whether. */}
          {!editing && (
            <View style={styles.group}>
              <WaInsetGroup footer="Ends future gifts. Past gifts stay.">
                <WaCell
                  testID="monthly-cancel"
                  variant="destructive"
                  title="Cancel monthly giving"
                  onPress={onCancelRecurring}
                  disabled={canceling}
                />
              </WaInsetGroup>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * The inline amount editor — deliberately the give sheet's own vocabulary
 * (big typed number as the display, preset chips that write into it, one
 * fee-cover toggle), because "change my monthly amount" is the same decision
 * the donor already made once and should not have to relearn.
 */
function AmountEditor({
  suggestedAmountsCents,
  selectedPresetCents,
  amountText,
  coverFees,
  saving,
  onSelectPreset,
  onAmountChange,
  onToggleCoverFees,
  onSave,
  onCancel,
}: {
  suggestedAmountsCents: readonly number[];
  selectedPresetCents: number | null;
  amountText: string;
  coverFees: boolean;
  saving: boolean;
  onSelectPreset: (cents: number) => void;
  onAmountChange: (text: string) => void;
  onToggleCoverFees: (value: boolean) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const amountCents = resolveGiveAmountCents(selectedPresetCents, amountText);
  const canSave = !!amountCents && !saving;

  // Same one-field rule as the give sheet: a tapped preset writes its dollars
  // into the field the donor types in, so there is one amount on screen.
  const displayText =
    selectedPresetCents !== null ? String(selectedPresetCents / 100) : amountText;

  return (
    <View testID="monthly-amount-editor">
      <WaInsetGroup>
        <View style={styles.editorCard}>
          <View style={styles.amountRow}>
            <Text style={[styles.amountPrefix, { color: colors.textSecondary }]}>$</Text>
            <TextInput
              value={displayText}
              onChangeText={onAmountChange}
              selectTextOnFocus
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="New monthly amount in dollars"
              testID="monthly-amount-input"
              style={[styles.amountInput, { color: colors.text }]}
            />
          </View>

          <View style={styles.presetRow}>
            {suggestedAmountsCents.map((cents) => {
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

      <View style={styles.editorActions}>
        <Pressable
          onPress={onSave}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Save new amount"
          accessibilityState={{ disabled: !canSave }}
          testID="monthly-save-amount"
          style={({ pressed }) => [
            styles.pill,
            { backgroundColor: canSave ? colors.buttonPrimary : colors.buttonDisabled },
            pressed && styles.pressed,
          ]}
        >
          <Text
            style={[
              styles.pillLabel,
              { color: canSave ? colors.buttonPrimaryText : colors.textSecondary },
            ]}
          >
            {amountCents ? `Give ${formatCents(amountCents)} monthly` : "Save"}
          </Text>
        </Pressable>

        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Keep the current amount"
          testID="monthly-cancel-edit"
          style={({ pressed }) => [styles.ghostPill, pressed && styles.pressed]}
        >
          <Text style={[styles.ghostLabel, { color: colors.textSecondary }]}>
            Keep the current amount
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loadingContainer: { padding: WA_GROUP_MARGIN },
  loadingBlock: { marginBottom: 16 },
  emptyState: { flex: 1, justifyContent: "center" },
  scrollContent: { paddingTop: 16 },
  group: { marginTop: WA_GROUP_SPACING },
  pressed: { opacity: 0.85 },

  hero: { alignItems: "center", paddingHorizontal: WA_CELL_PADDING, paddingVertical: 24 },
  glyphTile: {
    width: GLYPH_TILE,
    height: GLYPH_TILE,
    borderRadius: GLYPH_TILE / 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  amount: {
    fontSize: AMOUNT_SIZE,
    fontWeight: WA_WEIGHT_BOLD,
    fontVariant: ["tabular-nums"],
  },
  heroCaption: { fontSize: WA_TYPE_SUBTITLE, textAlign: "center", marginTop: 4 },

  trailingValue: { fontSize: WA_TYPE_ROW_TITLE },

  editorCard: { paddingHorizontal: WA_CELL_PADDING, paddingTop: 20, paddingBottom: 16 },
  amountRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center" },
  amountPrefix: {
    fontSize: 22,
    fontWeight: WA_WEIGHT_SEMIBOLD,
    marginTop: 10,
    marginRight: 2,
  },
  amountInput: {
    fontSize: 48,
    fontWeight: WA_WEIGHT_BOLD,
    fontVariant: ["tabular-nums"],
    minWidth: 80,
    paddingVertical: 0,
    textAlign: "center",
  },
  presetRow: { flexDirection: "row", gap: 10, marginTop: 20 },
  presetChip: { flex: 1, borderRadius: 22, paddingVertical: 12, alignItems: "center" },
  presetChipText: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_SEMIBOLD },

  editorActions: {
    marginTop: WA_GROUP_SPACING,
    paddingHorizontal: WA_GROUP_MARGIN,
    gap: 8,
  },
  pill: { height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
  pillLabel: {
    fontSize: WA_TYPE_ROW_TITLE,
    fontWeight: WA_WEIGHT_SEMIBOLD,
    fontVariant: ["tabular-nums"],
  },
  ghostPill: { height: 44, alignItems: "center", justifyContent: "center" },
  ghostLabel: { fontSize: WA_TYPE_SUBTITLE },

  errorText: {
    fontSize: WA_TYPE_FOOTNOTE,
    textAlign: "center",
    marginTop: 16,
    paddingHorizontal: WA_GROUP_MARGIN,
  },
});
