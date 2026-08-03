/**
 * FinancialControlsView — presentational roster of who holds a community's
 * financial controls, plus the primary admin's grant/revoke flow (ADR-033 §5).
 * Plain props only, no Convex — see FinancialControlsScreen.tsx for the data
 * wrapper.
 *
 * REVOKED GRANTS ARE NOT LISTED. The roster answers one question — who can
 * touch this community's money right now — and a dimmed row for someone who
 * can't is read as someone who can by anyone skimming. The history isn't lost:
 * every grant and revoke writes a `logFinanceAudit` row server-side, which is
 * the record an audit actually needs and this screen was never going to be.
 *
 * Non-primary-admin holders see the roster and NO buttons: the mutations are
 * primary-admin-only, so a revoke control here could do nothing but error.
 * `viewerIsPrimaryAdmin` comes straight from the query for exactly that reason.
 */
import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { waAccentPalette } from "@utils/waPalette";
import { ConfirmModal, Skeleton } from "@components/ui";
// See GivingHubView.tsx for why Modal is imported from the concrete file
// rather than the "@components/ui" barrel.
import { CustomModal as Modal } from "@components/ui/Modal";
import { WaCell, WaInsetGroup } from "@components/wa";
import {
  WA_CELL_PADDING,
  WA_GROUP_MARGIN,
  WA_GROUP_SPACING,
  WA_TYPE_FOOTNOTE,
  WA_TYPE_ROW_TITLE,
  WA_TYPE_SUBTITLE,
} from "@components/wa/metrics";
import { CommunityFinanceAccessDenied } from "./CommunityFinanceAccess";
import { financeDisplayName } from "./utils";
import {
  FINANCIAL_CONTROLS_NOTE,
  type CommunityFinanceRoleRow,
  type FinanceUserSummary,
} from "./types";

export type FinancialControlsState = "loading" | "not-allowed" | "ready";

/** Shared by this screen's own not-allowed state and its access boundary's fallback. */
export const FINANCIAL_CONTROLS_DENIED_MESSAGE =
  "Who holds this community's financial controls is itself finance information, so only people who hold them can see the list. Ask your community's primary admin.";

export interface FinancialControlsViewProps {
  state: FinancialControlsState;
  /** Active grants only — revoked ones are deliberately not listed. */
  roles: CommunityFinanceRoleRow[];
  /** Gates every grant/revoke control, mirroring the mutations' own check. */
  viewerIsPrimaryAdmin: boolean;

  isPickerOpen: boolean;
  onOpenPicker: () => void;
  onClosePicker: () => void;
  /** Community admins with no active grant. Empty means everyone already has it. */
  grantable: FinanceUserSummary[];
  isLoadingGrantable: boolean;
  onGrant: (userId: string) => void;
  isGranting: boolean;
  grantError: string | null;

  revokeTargetUserId: string | null;
  onRequestRevoke: (userId: string) => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: () => void;
  isRevoking: boolean;
  revokeError: string | null;
}

export function FinancialControlsView({
  state,
  roles,
  viewerIsPrimaryAdmin,
  isPickerOpen,
  onOpenPicker,
  onClosePicker,
  grantable,
  isLoadingGrantable,
  onGrant,
  isGranting,
  grantError,
  revokeTargetUserId,
  onRequestRevoke,
  onCancelRevoke,
  onConfirmRevoke,
  isRevoking,
  revokeError,
}: FinancialControlsViewProps) {
  const { colors, isDark } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const accent = useMemo(
    () => waAccentPalette(primaryColor, isDark).accent,
    [primaryColor, isDark],
  );

  if (state === "loading") {
    return (
      <View style={styles.loadingPad}>
        <Skeleton width="100%" height={140} borderRadius={24} />
      </View>
    );
  }

  if (state === "not-allowed") {
    return (
      <View style={styles.container} testID="financial-controls-not-allowed">
        <CommunityFinanceAccessDenied message={FINANCIAL_CONTROLS_DENIED_MESSAGE} />
      </View>
    );
  }

  const revokeTarget = roles.find((r) => r.userId === revokeTargetUserId) ?? null;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <WaInsetGroup header="Financial controls" footer={FINANCIAL_CONTROLS_NOTE}>
            {roles.length === 0 ? (
              <View key="roles-empty" style={styles.emptyCell}>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  Only the primary admin has financial controls.
                </Text>
              </View>
            ) : null}

            {roles.map((row) => (
              <WaCell
                key={row.id}
                icon="person-circle-outline"
                title={financeDisplayName(row.user ?? { id: row.userId })}
                description="Financial controls"
                testID={`financial-controls-row-${row.userId}`}
                trailingAccessory={
                  viewerIsPrimaryAdmin ? (
                    <TouchableOpacity
                      onPress={() => onRequestRevoke(row.userId)}
                      accessibilityRole="button"
                      style={styles.revokeButton}
                      testID={`financial-controls-revoke-${row.userId}`}
                    >
                      <Text style={[styles.revokeText, { color: colors.destructive }]}>
                        Remove
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    // An empty node rather than the default chevron: these rows
                    // don't navigate anywhere, and a chevron promising a detail
                    // screen that doesn't exist is its own small lie.
                    <View />
                  )
                }
              />
            ))}

            {viewerIsPrimaryAdmin ? (
              <WaCell
                key="grant"
                variant="action"
                accent={accent}
                title="Give someone financial controls"
                onPress={onOpenPicker}
                testID="financial-controls-grant-button"
              />
            ) : null}
          </WaInsetGroup>
        </View>
      </ScrollView>

      <Modal
        visible={isPickerOpen}
        onClose={onClosePicker}
        title="Give financial controls"
      >
        <View>
          {isLoadingGrantable ? (
            <Skeleton width="100%" height={110} borderRadius={16} />
          ) : grantable.length === 0 ? (
            <Text
              style={[styles.pickerEmpty, { color: colors.textSecondary }]}
              testID="financial-controls-picker-empty"
            >
              Everyone who's a community admin already has this — make someone
              an admin first.
            </Text>
          ) : (
            <View style={[styles.pickerGroup, { backgroundColor: colors.surface }]}>
              {grantable.map((candidate, index) => (
                <TouchableOpacity
                  key={candidate.id}
                  style={[
                    styles.pickerCell,
                    index > 0 && [styles.pickerDivider, { borderTopColor: colors.border }],
                  ]}
                  onPress={() => onGrant(candidate.id)}
                  disabled={isGranting}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: false, disabled: isGranting }}
                  testID={`financial-controls-candidate-${candidate.id}`}
                >
                  <Ionicons
                    name="person-circle-outline"
                    size={24}
                    color={colors.textSecondary}
                  />
                  <Text style={[styles.pickerName, { color: colors.text }]} numberOfLines={1}>
                    {financeDisplayName(candidate)}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {grantError ? (
            <Text
              style={[styles.errorText, { color: colors.error }]}
              testID="financial-controls-grant-error"
            >
              {grantError}
            </Text>
          ) : null}
        </View>
      </Modal>

      <ConfirmModal
        visible={!!revokeTargetUserId}
        title="Remove financial controls"
        message={
          revokeError ??
          (revokeTarget
            ? `${financeDisplayName(revokeTarget.user ?? { id: revokeTarget.userId })} will no longer be able to connect a card provider, issue cards, or change this community's finance setup.`
            : "Remove this person's financial controls?")
        }
        confirmText="Remove"
        destructive
        isLoading={isRevoking}
        onConfirm={onConfirmRevoke}
        onCancel={onCancelRevoke}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingPad: {
    padding: WA_GROUP_MARGIN,
  },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 32,
  },
  section: {
    marginTop: WA_GROUP_SPACING,
  },
  emptyCell: {
    minHeight: 54,
    justifyContent: "center",
    paddingHorizontal: WA_CELL_PADDING,
  },
  emptyText: {
    fontSize: WA_TYPE_SUBTITLE,
  },
  revokeButton: {
    paddingVertical: 6,
    paddingLeft: 8,
  },
  revokeText: {
    fontSize: WA_TYPE_SUBTITLE,
    fontWeight: "600",
  },
  pickerGroup: {
    borderRadius: 16,
    overflow: "hidden",
  },
  pickerCell: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pickerDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pickerName: {
    flex: 1,
    fontSize: WA_TYPE_ROW_TITLE,
  },
  pickerEmpty: {
    fontSize: WA_TYPE_SUBTITLE,
    lineHeight: 21,
  },
  errorText: {
    fontSize: WA_TYPE_FOOTNOTE,
    lineHeight: 19,
    marginTop: 12,
  },
});
