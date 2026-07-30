/**
 * FundScreenView — presentational transparency screen for group giving
 * (ADR-032 §3/§7 Phase 1). Pure props in, no Convex/router imports, so a
 * verification harness can render it standalone with mock data.
 */
import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { Badge, Button, Skeleton, EmptyState } from "@components/ui";
import { formatCents, formatSignedCents } from "../format";
import {
  formatLedgerKind,
  formatExpenseStatus,
  expenseStatusBadgeVariant,
} from "./labels";
import type { FundOverview, MyExpense } from "./types";

export interface FundScreenViewProps {
  /** `undefined` while loading, `null` when giving isn't set up for this group. */
  overview: FundOverview | null | undefined;
  /** The viewer's own reimbursement requests. `undefined` while loading. */
  myExpenses: MyExpense[] | undefined;
  onBack: () => void;
  onGivePress: () => void;
  onGetReimbursedPress: () => void;
  /** Set for manager+ viewers — shows the "Manage" link to the leader giving hub (approvals + roles). */
  onManagePress?: () => void;
}

export function FundScreenView({
  overview,
  myExpenses,
  onBack,
  onGivePress,
  onGetReimbursedPress,
  onManagePress,
}: FundScreenViewProps) {
  const { colors } = useTheme();

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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Giving</Text>
        {overview ? (
          <View style={styles.headerActions}>
            {onManagePress && (
              <TouchableOpacity onPress={onManagePress} accessibilityLabel="Manage giving">
                <Ionicons name="settings-outline" size={22} color={colors.link} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onGivePress} accessibilityLabel="Give">
              <Text style={[styles.headerGive, { color: colors.link }]}>Give</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {overview === undefined ? (
        <View style={styles.loadingContainer} testID="fund-screen-loading">
          <Skeleton height={100} borderRadius={16} style={{ marginBottom: 16 }} />
          <Skeleton height={60} borderRadius={12} style={{ marginBottom: 16 }} />
          <Skeleton height={200} borderRadius={12} />
        </View>
      ) : overview === null ? (
        <EmptyState
          icon="cash-outline"
          title="Giving isn't set up for this group yet"
          message="Ask a group leader or your community admin to turn on giving for this group."
          style={styles.emptyState}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* BALANCE */}
          <View style={[styles.balanceCard, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[styles.balanceLabel, { color: colors.textSecondary }]}>
              {overview.fund.name} balance
            </Text>
            <Text style={[styles.balanceAmount, { color: colors.text }]}>
              {formatCents(overview.balanceCents)}
            </Text>
            <View style={styles.balanceActions}>
              <Button onPress={onGivePress} style={styles.balanceActionButton}>
                Give
              </Button>
              <Button
                onPress={onGetReimbursedPress}
                variant="secondary"
                style={styles.balanceActionButton}
              >
                Get reimbursed
              </Button>
            </View>
          </View>

          {/* MTD / YTD STATS */}
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.statHeader, { color: colors.textSecondary }]}>
                MONTH TO DATE
              </Text>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {formatCents(overview.monthToDate.donationsCents)} given
              </Text>
              <Text style={[styles.statSubvalue, { color: colors.textSecondary }]}>
                {formatCents(overview.monthToDate.spentCents)} spent ·{" "}
                {overview.monthToDate.donationCount}{" "}
                {overview.monthToDate.donationCount === 1 ? "gift" : "gifts"}
              </Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.statHeader, { color: colors.textSecondary }]}>
                YEAR TO DATE
              </Text>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {formatCents(overview.yearToDate.donationsCents)} given
              </Text>
              <Text style={[styles.statSubvalue, { color: colors.textSecondary }]}>
                {formatCents(overview.yearToDate.spentCents)} spent ·{" "}
                {overview.yearToDate.donationCount}{" "}
                {overview.yearToDate.donationCount === 1 ? "gift" : "gifts"}
              </Text>
            </View>
          </View>

          {/* ACTIVITY */}
          <View style={styles.section}>
            <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
              RECENT ACTIVITY
            </Text>
            {overview.activity.length === 0 ? (
              <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[styles.emptyRowText, { color: colors.textSecondary }]}>
                  No activity yet
                </Text>
              </View>
            ) : (
              <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
                {overview.activity.map((entry, index) => (
                  <View
                    key={entry.id}
                    style={[
                      styles.activityRow,
                      index > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.border,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.activityKind, { color: colors.text }]}>
                        {formatLedgerKind(entry.kind)}
                      </Text>
                      {!!entry.donorName && (
                        <Text
                          style={[styles.activityDonor, { color: colors.textSecondary }]}
                        >
                          {entry.donorName}
                        </Text>
                      )}
                    </View>
                    <Text
                      style={[
                        styles.activityAmount,
                        { color: entry.direction === "credit" ? colors.success : colors.text },
                      ]}
                    >
                      {formatSignedCents(entry.amountCents, entry.direction)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* MY REIMBURSEMENTS */}
          <View style={styles.section}>
            <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
              MY REIMBURSEMENTS
            </Text>
            {myExpenses === undefined ? (
              <Skeleton height={72} borderRadius={12} />
            ) : myExpenses.length === 0 ? (
              <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[styles.emptyRowText, { color: colors.textSecondary }]}>
                  No reimbursement requests yet
                </Text>
              </View>
            ) : (
              <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
                {myExpenses.map((expense, index) => (
                  <View
                    key={expense.id}
                    style={[
                      styles.expenseRow,
                      index > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.border,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.expenseDescription, { color: colors.text }]}>
                        {expense.description || "Reimbursement"}
                      </Text>
                      <Text style={[styles.expenseAmount, { color: colors.textSecondary }]}>
                        {formatCents(expense.amountCents)}
                      </Text>
                    </View>
                    <Badge variant={expenseStatusBadgeVariant(expense.status)}>
                      {formatExpenseStatus(expense.status)}
                    </Badge>
                  </View>
                ))}
              </View>
            )}
          </View>
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
  headerGive: { fontSize: 16, fontWeight: "600" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 14 },
  headerSpacer: { width: 32 },
  loadingContainer: { padding: 16 },
  emptyState: { flex: 1, justifyContent: "center" },
  scrollContent: { padding: 16, paddingBottom: 32, gap: 16 },
  balanceCard: {
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
  },
  balanceLabel: { fontSize: 13, fontWeight: "500" },
  balanceAmount: { fontSize: 36, fontWeight: "700", marginTop: 4, marginBottom: 16 },
  balanceActions: { flexDirection: "row", gap: 12, width: "100%" },
  balanceActionButton: { flex: 1 },
  statsRow: { flexDirection: "row", gap: 12 },
  statCard: { flex: 1, borderRadius: 12, padding: 14 },
  statHeader: { fontSize: 11, fontWeight: "600", letterSpacing: 0.6, marginBottom: 6 },
  statValue: { fontSize: 16, fontWeight: "600" },
  statSubvalue: { fontSize: 12, marginTop: 2 },
  section: {},
  sectionHeader: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: { borderRadius: 12, overflow: "hidden" },
  emptyRowText: { fontSize: 14, padding: 16, textAlign: "center" },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
  },
  activityKind: { fontSize: 15, fontWeight: "500" },
  activityDonor: { fontSize: 13, marginTop: 2 },
  activityAmount: { fontSize: 15, fontWeight: "600" },
  expenseRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
    gap: 8,
  },
  expenseDescription: { fontSize: 15, fontWeight: "500" },
  expenseAmount: { fontSize: 13, marginTop: 2 },
});
