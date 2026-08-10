/**
 * CreateCardView — presentational "New virtual card" sheet (group-fund cards
 * phase). Plain props only, no Convex — see CreateCardScreen.tsx for the
 * data wrapper.
 *
 * TWO LIMIT MODELS, and which applies is the community's provider's
 * declaration rather than anything this sheet or its user chooses
 * (`capabilities.managedFundLimit`, ADR-033 Phase 3):
 *
 *   TYPED    — the original: pick a window (week/month/charge) and an amount;
 *              the bank declines anything over it.
 *   MANAGED  — Togather keeps the limit equal to what's left in the fund. There
 *              is no window to pick, so the segmented control is GONE rather
 *              than disabled: a greyed "Weekly" implies a setting that could be
 *              unlocked, and `createFundCard` refuses a `limitPeriod` outright
 *              on these providers. The amount field survives as an optional
 *              lower cap.
 *
 * Provider-anonymous throughout — this is a group-level surface. See
 * CardDetailView.tsx's header.
 */
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { Input, Button, EmptyState, Skeleton } from "@components/ui";
import { formatCents } from "../format";
import { FUND_ROLE_LABELS, CARD_CHARGE_SETTLEMENT_NOTE, type CardholderCandidate, type CardLimitPeriod } from "./types";

export type LimitSelection = "none" | CardLimitPeriod;

const LIMIT_OPTIONS: { key: LimitSelection; label: string }[] = [
  { key: "none", label: "None" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
  { key: "charge", label: "Per charge" },
];

/**
 * The bank's own reset semantics, stated plainly. These aren't decoration:
 * Increase enforces the limit on these exact windows (per_week / per_month /
 * per_transaction, all anchored to midnight UTC — see
 * `apps/convex/lib/finance/cardPolicy.ts`), so the wording has to match what
 * Increase actually does, UTC included.
 */
const LIMIT_HINTS: Record<LimitSelection, string | null> = {
  none: null,
  week: "Resets every Monday at midnight UTC",
  month: "Resets on the 1st of the month at midnight UTC",
  charge: "Applies to each individual charge",
};

export type CreateCardState = "loading" | "not-allowed" | "ready";

export interface CreateCardViewProps {
  /**
   * `not-allowed` is for someone who deep-linked in: ADR-033 moved card
   * issuing from "finance_admin on this fund" to COMMUNITY finance access, so
   * a group leader (and even a fund's own finance_admin) can reach this route
   * and must be told why rather than shown a form that can only fail.
   */
  state: CreateCardState;
  /** The provider computes the limit from the fund's balance — no period to pick. */
  managedLimit: boolean;
  /** The fund is already at its provider's per-fund card cap. */
  cardSlotFull: boolean;
  fundName: string;
  fundBalanceCents: number;
  candidates: CardholderCandidate[];
  isLoadingCandidates: boolean;
  selectedHolderUserId: string | null;
  onSelectHolder: (userId: string) => void;
  onGrantRolePress: () => void;
  name: string;
  onNameChange: (text: string) => void;
  limitSelection: LimitSelection;
  onChangeLimitSelection: (selection: LimitSelection) => void;
  amountText: string;
  onAmountChange: (text: string) => void;
  isSubmitting: boolean;
  error: string | null;
  canSubmit: boolean;
  onSubmit: () => void;
  onClose: () => void;
}

export function CreateCardView({
  state,
  managedLimit,
  cardSlotFull,
  fundName,
  fundBalanceCents,
  candidates,
  isLoadingCandidates,
  selectedHolderUserId,
  onSelectHolder,
  onGrantRolePress,
  name,
  onNameChange,
  limitSelection,
  onChangeLimitSelection,
  amountText,
  onAmountChange,
  isSubmitting,
  error,
  canSubmit,
  onSubmit,
  onClose,
}: CreateCardViewProps) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  const header = (
    <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <TouchableOpacity style={styles.closeButton} onPress={onClose} accessibilityLabel="Close">
        <Ionicons name="close" size={22} color={colors.text} />
      </TouchableOpacity>
      <View style={styles.headerContent}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>New virtual card</Text>
        <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
          {fundName} · fund balance {formatCents(fundBalanceCents)}
        </Text>
      </View>
    </View>
  );

  if (state === "loading") {
    return (
      <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
        {header}
        <View style={styles.loadingPad}>
          <Skeleton width="100%" height={110} borderRadius={16} />
          <Skeleton width="100%" height={64} borderRadius={16} style={{ marginTop: 16 }} />
        </View>
      </View>
    );
  }

  if (state === "not-allowed") {
    return (
      <View
        style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}
        testID="create-card-not-allowed"
      >
        {header}
        <EmptyState
          icon="lock-closed-outline"
          title="You can't issue cards for this fund"
          message="Only someone with your community's financial controls can issue a card — ask your community's primary admin."
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {header}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* CARDHOLDER */}
        <View>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Cardholder</Text>
          {isLoadingCandidates ? (
            <Skeleton width="100%" height={110} borderRadius={16} />
          ) : candidates.length === 0 ? (
            <View style={[styles.group, { backgroundColor: colors.surface }]}>
              <EmptyState
                icon="person-outline"
                title="No eligible cardholders yet"
                message="Grant a member the cardholder role before issuing a card."
              />
            </View>
          ) : (
            <View style={[styles.group, { backgroundColor: colors.surface }]}>
              {candidates.map((candidate, index) => {
                const selected = candidate.userId === selectedHolderUserId;
                return (
                  <TouchableOpacity
                    key={candidate.userId}
                    style={[
                      styles.cell,
                      index > 0 && [styles.cellDivider, { borderTopColor: colors.border }],
                    ]}
                    onPress={() => onSelectHolder(candidate.userId)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    testID={`cardholder-option-${candidate.userId}`}
                  >
                    <Ionicons name="person-circle-outline" size={24} color={colors.textSecondary} />
                    <View style={styles.cellMain}>
                      <Text style={[styles.cellTitle, { color: colors.text }]} numberOfLines={1}>
                        {candidate.name}
                      </Text>
                      <Text style={[styles.cellSub, { color: colors.textSecondary }]}>
                        {FUND_ROLE_LABELS[candidate.role]}
                      </Text>
                    </View>
                    {selected && (
                      <Ionicons name="checkmark" size={20} color={primaryColor} />
                    )}
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[styles.cell, styles.cellDivider, { borderTopColor: colors.border }]}
                onPress={onGrantRolePress}
                accessibilityRole="button"
                testID="grant-cardholder-role-link"
              >
                <Text style={[styles.actionCellText, { color: primaryColor }]}>
                  Grant someone the cardholder role…
                </Text>
              </TouchableOpacity>
            </View>
          )}
          <Text style={[styles.footerNote, { color: colors.textSecondary }]}>
            Only members holding a cardholder (or higher) role on this fund can receive a card.
          </Text>
        </View>

        {/* CARD NAME */}
        <View>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Card name</Text>
          <View style={[styles.group, styles.fieldGroup, { backgroundColor: colors.surface }]}>
            <Input
              placeholder="e.g. Groceries & supplies"
              value={name}
              onChangeText={onNameChange}
            />
            <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>
              Shown on statements and in activity
            </Text>
          </View>
        </View>

        {/* SPENDING LIMIT — managed: no window to pick, only an optional cap. */}
        {managedLimit ? (
          <View testID="managed-limit-section">
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Spending limit</Text>
            <View style={[styles.group, styles.fieldGroup, { backgroundColor: colors.surface }]}>
              <Text style={[styles.managedHeadline, { color: colors.text }]}>
                This card's limit follows the fund's balance
              </Text>
              <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>
                Togather keeps it equal to what's left in the fund, so the card
                can never outspend the group's money. There's no weekly or
                monthly window to set — the limit just moves with the fund.
              </Text>
            </View>
            <View style={[styles.group, styles.fieldGroup, { backgroundColor: colors.surface, marginTop: 10 }]}>
              <Input
                label="Set a lower cap (optional)"
                placeholder="$0.00"
                value={amountText}
                onChangeText={onAmountChange}
              />
              <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>
                {/* Only ever tighter: the backend refuses a cap above the
                    fund's balance, because a cap that exceeded it would be a
                    number the card could never actually reach. */}
                A cap can only make the card tighter than the fund — it can't be
                more than the fund holds. Leave it blank to follow the balance.
              </Text>
            </View>
          </View>
        ) : (
        <View>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Spending limit</Text>
          <View style={[styles.segmented, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {LIMIT_OPTIONS.map((option) => {
              const selected = option.key === limitSelection;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[
                    styles.segmentedOption,
                    selected && { backgroundColor: colors.surfaceSecondary },
                  ]}
                  onPress={() => onChangeLimitSelection(option.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  testID={`limit-option-${option.key}`}
                >
                  <Text
                    style={[
                      styles.segmentedLabel,
                      { color: selected ? colors.text : colors.textSecondary, fontWeight: selected ? "700" : "500" },
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {limitSelection !== "none" && (
            <View style={[styles.group, styles.fieldGroup, { backgroundColor: colors.surface, marginTop: 10 }]}>
              <Input
                placeholder="$0.00"
                value={amountText}
                onChangeText={onAmountChange}
              />
              {!!LIMIT_HINTS[limitSelection] && (
                <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>
                  {LIMIT_HINTS[limitSelection]}
                </Text>
              )}
            </View>
          )}
          <Text style={[styles.footerNote, { color: colors.textSecondary }]}>
            {limitSelection === "none"
              ? "Without a limit, this card can spend the fund's whole balance. It can never reach another group's money."
              : "The bank declines anything over this limit, so it holds even if nobody's watching."}
          </Text>
        </View>
        )}

        {/* WHAT HAPPENS AFTER A CHARGE */}
        <View>
          <Text style={[styles.footerNote, { color: colors.textSecondary }]}>
            {CARD_CHARGE_SETTLEMENT_NOTE}
          </Text>
        </View>

        {/* The provider's per-fund cap, refused server-side by
            `assertFundCardSlotFree`. Stated BEFORE the button rather than as a
            submit error: the fix is on another screen (close the existing
            card), so there's nothing to gain from letting the tap through. */}
        {cardSlotFull ? (
          <Text
            style={[styles.footerNote, { color: colors.error }]}
            testID="create-card-slot-full"
          >
            This fund already has a card. Your community's card provider sizes a
            fund's spending to the card itself, so a second card would double
            what this fund can spend — close the existing card first, or change
            who holds it.
          </Text>
        ) : null}

        {!!error && <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>}

        <Button
          variant="primary"
          onPress={onSubmit}
          loading={isSubmitting}
          disabled={!canSubmit || cardSlotFull}
          style={styles.submitButton}
        >
          Create card
        </Button>
        <Text style={[styles.footerNote, styles.centeredNote, { color: colors.textSecondary }]}>
          Issued instantly on the fund's bank account. Physical cards come later.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
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
  closeButton: { marginRight: 12, padding: 4 },
  headerContent: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: "bold" },
  headerSubtitle: { fontSize: 14, marginTop: 2 },
  scrollContent: { padding: 16, paddingBottom: 48, gap: 20 },
  loadingPad: { padding: 16 },
  managedHeadline: { fontSize: 15.5, fontWeight: "600", marginBottom: 4 },
  sectionLabel: { fontSize: 13, marginBottom: 8, paddingHorizontal: 4 },
  group: { borderRadius: 16, overflow: "hidden" },
  fieldGroup: { padding: 14 },
  fieldHint: { fontSize: 12.5, marginTop: 4 },
  cell: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cellDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  cellMain: { flex: 1 },
  cellTitle: { fontSize: 15.5 },
  cellSub: { fontSize: 12.5, marginTop: 2 },
  actionCellText: { fontSize: 15.5, fontWeight: "600" },
  footerNote: { fontSize: 12.5, marginTop: 8, paddingHorizontal: 4, lineHeight: 17 },
  centeredNote: { textAlign: "center" },
  segmented: {
    flexDirection: "row",
    borderRadius: 14,
    padding: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentedOption: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 9,
    borderRadius: 10,
  },
  segmentedLabel: { fontSize: 13.5 },
  errorText: { fontSize: 14, textAlign: "center" },
  submitButton: { borderRadius: 100 },
});
