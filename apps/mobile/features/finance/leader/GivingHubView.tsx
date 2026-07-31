/**
 * GivingHubView — presentational leader/admin surface for group giving
 * (ADR-032 §2 CTA, §4 approvals queue; group-fund cards phase). Plain props
 * only, no Convex — see GivingHubScreen.tsx for the data wrapper that
 * renders this.
 *
 * Sections mirror the approved mock: balance header + "Giving is live" chip,
 * month-to-date stat tiles, a quick-action row (Give / Reimburse / New card
 * / Share fund), a "Cards" inset group, a "Needs your approval" inset group
 * (folds in the pre-existing approve/deny flow), a "Recent activity" inset
 * group (ships today via `getFundOverview`), then a Roles cell.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { Badge, Button, EmptyState, Skeleton, ImageViewer } from "@components/ui";
// NOTE: imported from the concrete file, not the "@components/ui" barrel.
// Under this repo's current Jest/Babel setup, `CustomModal as Modal`
// resolves to `undefined` when named-imported through the barrel (wildcard
// `import * as UI` resolves it fine — this looks like a stale/partial CJS
// interop binding for renamed re-exports, not anything specific to this
// screen). Importing straight from the file sidesteps it; flagged for a
// framework-level look since other barrel consumers of `Modal` likely hit
// the same thing under test.
import { CustomModal as Modal } from "@components/ui/Modal";
import { formatCents, formatSignedCents } from "../format";
import { formatLedgerKind } from "./utils";
import type {
  FundCard,
  GivingExpense,
  GivingHubActivityEntry,
  GivingHubBalanceSummary,
  CardStatus,
} from "./types";
import { formatCardLimit } from "./types";

export type GivingHubState = "loading" | "no-fund-admin" | "no-fund-member" | "ready";

export interface GivingHubViewProps {
  /** Which top-level state to render (fund resolution + gating). */
  state: GivingHubState;
  groupName: string;
  givingLive: boolean;
  /** Balance header + month-to-date stats. `undefined` while loading. */
  balance: GivingHubBalanceSummary | undefined;

  cards: FundCard[];
  isLoadingCards: boolean;
  /** finance_admin (incl. community-admin override) — same gate `createFundCard`
   * enforces. Comes straight from `listFundCards`' `viewerCanManageCards`. */
  canManageCards: boolean;

  /** Pending expenses (card charges + reimbursements) awaiting approval. */
  expenses: GivingExpense[];
  isLoadingExpenses: boolean;
  /** manager+ per getMyFundRole — gates Approve/Deny controls. */
  canApprove: boolean;
  currentUserId: string | null;
  /** Expense id currently being approved/denied (row-level spinner). */
  processingExpenseId: string | null;
  onApprove: (expenseId: string) => void;
  onDeny: (expenseId: string, reason: string) => void;

  /** Recent fund ledger activity — ships today via getFundOverview. */
  activity: GivingHubActivityEntry[] | undefined;

  onEnableGiving: () => void;
  isEnablingGiving: boolean;

  onViewRoles: () => void;
  onGivePress: () => void;
  onReimbursePress: () => void;
  onCreateCardPress: () => void;
  /** Undefined hides the "Share fund" tile (no shareable group link available). */
  onSharePress?: () => void;
  onViewCard: (cardId: string) => void;
  onViewAllActivity: () => void;
}

export function GivingHubView({
  state,
  groupName,
  givingLive,
  balance,
  cards,
  isLoadingCards,
  canManageCards,
  expenses,
  isLoadingExpenses,
  canApprove,
  currentUserId,
  processingExpenseId,
  onApprove,
  onDeny,
  activity,
  onEnableGiving,
  isEnablingGiving,
  onViewRoles,
  onGivePress,
  onReimbursePress,
  onCreateCardPress,
  onSharePress,
  onViewCard,
  onViewAllActivity,
}: GivingHubViewProps) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const [denyingExpenseId, setDenyingExpenseId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [previewImages, setPreviewImages] = useState<string[] | null>(null);

  if (state === "loading") {
    return (
      <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
        <View style={styles.loadingPad}>
          <Skeleton width="60%" height={20} />
          <Skeleton width="100%" height={80} style={{ marginTop: 16 }} />
          <Skeleton width="100%" height={80} style={{ marginTop: 12 }} />
        </View>
      </View>
    );
  }

  if (state === "no-fund-admin") {
    return (
      <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
        <EmptyState
          icon="wallet-outline"
          title="Giving isn't set up for this group yet"
          message={`Enable giving for ${groupName} so members can donate directly and leaders can spend and reimburse from a group fund.`}
          actionLabel={isEnablingGiving ? "Enabling…" : "Enable giving for this group"}
          onAction={onEnableGiving}
        />
      </View>
    );
  }

  if (state === "no-fund-member") {
    return (
      <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
        <EmptyState
          icon="wallet-outline"
          title="Giving isn't set up for this group yet"
          message="Ask a community admin to enable giving for this group from Community Finance settings."
        />
      </View>
    );
  }

  const pendingTotalCents = expenses
    .filter((e) => e.status === "pending")
    .reduce((sum, e) => sum + e.amountCents, 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* BALANCE HEADER */}
        {balance === undefined ? (
          <Skeleton width="100%" height={120} borderRadius={20} />
        ) : (
          <View style={styles.balance}>
            <Text style={[styles.balanceAmount, { color: colors.text }]}>
              {formatCents(balance.balanceCents)}
            </Text>
            <Text style={[styles.balanceFund, { color: colors.textSecondary }]}>
              {balance.fundName} · Group fund
            </Text>
            {givingLive && (
              <View style={[styles.liveChip, { backgroundColor: `${primaryColor}1a` }]}>
                <Ionicons name="checkmark" size={13} color={primaryColor} />
                <Text style={[styles.liveChipText, { color: primaryColor }]}>Giving is live</Text>
              </View>
            )}
          </View>
        )}

        {balance !== undefined && (
          <View style={styles.statsRow}>
            <StatTile
              label="GIVEN THIS MONTH"
              value={formatCents(balance.monthDonationsCents)}
              sub={`${balance.monthDonationCount} ${balance.monthDonationCount === 1 ? "gift" : "gifts"}`}
            />
            <StatTile
              label="SPENT THIS MONTH"
              value={formatCents(balance.monthSpentCents)}
              // Processing fees aren't spend, but hiding them makes "given"
              // minus "spent" fail to reconcile against the balance above.
              sub={
                balance.monthFeesCents > 0
                  ? `+ ${formatCents(balance.monthFeesCents)} fees`
                  : undefined
              }
            />
            <StatTile
              label="PENDING"
              value={formatCents(pendingTotalCents)}
              sub={`${expenses.length} ${expenses.length === 1 ? "approval" : "approvals"}`}
            />
          </View>
        )}

        {/* QUICK ACTIONS */}
        <View style={styles.actionsRow}>
          <ActionTile icon="heart-outline" label="Give" onPress={onGivePress} testID="giving-hub-action-give" />
          <ActionTile icon="receipt-outline" label="Reimburse" onPress={onReimbursePress} testID="giving-hub-action-reimburse" />
          {canManageCards && (
            <ActionTile icon="card-outline" label="New card" onPress={onCreateCardPress} testID="giving-hub-action-new-card" />
          )}
          {onSharePress && (
            <ActionTile icon="share-outline" label="Share fund" onPress={onSharePress} testID="giving-hub-action-share" />
          )}
        </View>

        {/* CARDS */}
        <View>
          <View style={styles.labelRow}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Cards</Text>
          </View>
          {isLoadingCards ? (
            <Skeleton width="100%" height={80} borderRadius={16} />
          ) : (
            <View style={[styles.group, { backgroundColor: colors.surface }]}>
              {cards.length === 0 && !canManageCards ? (
                <View style={styles.emptyCell}>
                  <Text style={{ color: colors.textSecondary }}>No cards yet</Text>
                </View>
              ) : (
                cards.map((card, index) => (
                  <TouchableOpacity
                    key={card.id}
                    style={[
                      styles.cell,
                      index > 0 && [styles.cellDivider, { borderTopColor: colors.border }],
                    ]}
                    onPress={() => onViewCard(card.id)}
                    accessibilityRole="button"
                    testID={`giving-hub-card-${card.id}`}
                  >
                    <Ionicons name="card-outline" size={20} color={colors.textSecondary} />
                    <View style={styles.cellMain}>
                      <Text style={[styles.cellTitle, { color: colors.text }]} numberOfLines={1}>
                        {card.name} ·· {card.last4}
                      </Text>
                      <Text style={[styles.cellSub, { color: colors.textSecondary }]} numberOfLines={1}>
                        {card.holderName} · {formatCardLimit(card.spendLimitCents, card.limitPeriod, formatCents)}
                      </Text>
                    </View>
                    <CardStatusBadge status={card.status} />
                    <Ionicons name="chevron-forward" size={17} color={colors.textTertiary} />
                  </TouchableOpacity>
                ))
              )}
              {canManageCards && (
                <TouchableOpacity
                  style={[
                    styles.cell,
                    cards.length > 0 && [styles.cellDivider, { borderTopColor: colors.border }],
                  ]}
                  onPress={onCreateCardPress}
                  accessibilityRole="button"
                  testID="giving-hub-create-card"
                >
                  <Text style={[styles.actionCellText, { color: primaryColor }]}>
                    Create a virtual card…
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          <Text style={[styles.footerNote, { color: colors.textSecondary }]}>
            Cards spend directly from this fund's bank account. Charges over $200 need a second approver.
          </Text>
        </View>

        {/* NEEDS YOUR APPROVAL */}
        <View>
          <View style={styles.labelRow}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Needs your approval</Text>
            <TouchableOpacity onPress={onViewAllActivity} testID="giving-hub-all-activity-link">
              <Text style={[styles.labelLink, { color: primaryColor }]}>All activity</Text>
            </TouchableOpacity>
          </View>
          {isLoadingExpenses ? (
            <Skeleton width="100%" height={80} borderRadius={16} />
          ) : expenses.length === 0 ? (
            <View style={[styles.group, styles.emptyCell, { backgroundColor: colors.surface }]}>
              <Text style={{ color: colors.textSecondary }}>No pending approvals</Text>
            </View>
          ) : (
            <View style={[styles.group, { backgroundColor: colors.surface }]}>
              {expenses.map((expense, index) => {
                const isSelf = !!currentUserId && expense.submitter.id === currentUserId;
                const needsSecondApproval = expense.status === "pending" && !!expense.approverId;
                const canActOnRow = canApprove && expense.status === "pending" && !isSelf;
                const isProcessing = processingExpenseId === expense.id;
                const receiptMissing = expense.kind === "card_charge" && !expense.receiptUrl;

                return (
                  <View
                    key={expense.id}
                    style={[
                      styles.expenseCell,
                      index > 0 && [styles.cellDivider, { borderTopColor: colors.border }],
                    ]}
                    testID={`expense-row-${expense.id}`}
                  >
                    <View style={styles.cell}>
                      <Ionicons
                        name={expense.kind === "card_charge" ? "card-outline" : "receipt-outline"}
                        size={20}
                        color={colors.textSecondary}
                      />
                      <View style={styles.cellMain}>
                        <Text style={[styles.cellTitle, { color: colors.text }]} numberOfLines={1}>
                          {expense.description}
                        </Text>
                        <Text style={[styles.cellSub, { color: colors.textSecondary }]} numberOfLines={1}>
                          {expense.kind === "card_charge" ? "Card charge" : "Reimbursement"} ·{" "}
                          {expense.submitter.displayName ||
                            `${expense.submitter.firstName ?? ""} ${expense.submitter.lastName ?? ""}`.trim() ||
                            "Unknown"}
                          {receiptMissing ? " · " : ""}
                          {receiptMissing && (
                            <Text style={{ color: colors.destructive, fontWeight: "700" }}>receipt missing</Text>
                          )}
                        </Text>
                      </View>
                      <Text style={[styles.expenseAmount, { color: colors.text }]}>
                        {formatCents(expense.amountCents)}
                      </Text>
                    </View>

                    <View style={styles.expenseMeta}>
                      {needsSecondApproval && (
                        <Badge variant="warning" size="small">1 of 2 approvals</Badge>
                      )}
                      {expense.receiptUrl ? (
                        <TouchableOpacity
                          onPress={() => setPreviewImages([expense.receiptUrl as string])}
                          style={styles.receiptThumbWrap}
                          accessibilityRole="button"
                          accessibilityLabel="View receipt"
                          testID={`expense-receipt-${expense.id}`}
                        >
                          <Image source={{ uri: expense.receiptUrl }} style={styles.receiptThumb} />
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {canActOnRow && (
                      <View style={styles.expenseActions}>
                        <Button
                          variant="secondary"
                          onPress={() => {
                            setDenyingExpenseId(expense.id);
                            setDenyReason("");
                          }}
                          disabled={isProcessing}
                          style={styles.actionButton}
                        >
                          Deny
                        </Button>
                        <Button
                          variant="primary"
                          onPress={() => onApprove(expense.id)}
                          loading={isProcessing}
                          style={styles.actionButton}
                        >
                          Approve
                        </Button>
                      </View>
                    )}
                    {isSelf && expense.status === "pending" && (
                      <Text style={[styles.selfNote, { color: colors.textTertiary }]}>
                        You can't approve your own request.
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* RECENT ACTIVITY */}
        <View>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Recent activity</Text>
          {activity === undefined ? (
            <Skeleton width="100%" height={80} borderRadius={16} />
          ) : activity.length === 0 ? (
            <View style={[styles.group, styles.emptyCell, { backgroundColor: colors.surface }]}>
              <Text style={{ color: colors.textSecondary }}>No activity yet</Text>
            </View>
          ) : (
            <View style={[styles.group, { backgroundColor: colors.surface }]}>
              {activity.map((entry, index) => (
                <View
                  key={entry.id}
                  style={[
                    styles.cell,
                    index > 0 && [styles.cellDivider, { borderTopColor: colors.border }],
                  ]}
                >
                  <Ionicons name={activityIcon(entry.kind)} size={20} color={colors.textSecondary} />
                  <View style={styles.cellMain}>
                    <Text style={[styles.cellTitle, { color: colors.text }]} numberOfLines={1}>
                      {formatLedgerKind(entry.kind)}
                      {entry.donorName ? ` · ${entry.donorName}` : ""}
                    </Text>
                    <Text style={[styles.cellSub, { color: colors.textSecondary }]}>
                      {formatDate(entry.createdAt)}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.expenseAmount,
                      { color: entry.direction === "credit" ? colors.success : colors.text },
                    ]}
                  >
                    {formatSignedCents(entry.amountCents, entry.direction)}
                  </Text>
                </View>
              ))}
              <TouchableOpacity
                style={[styles.cell, styles.cellDivider, { borderTopColor: colors.border }]}
                onPress={onViewAllActivity}
                accessibilityRole="button"
                testID="giving-hub-see-all-transactions"
              >
                <Text style={[styles.actionCellText, { color: primaryColor }]}>
                  See all transactions…
                </Text>
              </TouchableOpacity>
            </View>
          )}
          <Text style={[styles.footerNote, { color: colors.textSecondary }]}>
            Card charges sync automatically from the bank. Balance reconciles nightly against the fund's account.
          </Text>
        </View>

        {/* ROLES */}
        <View style={[styles.group, { backgroundColor: colors.surface }]}>
          <TouchableOpacity
            style={styles.cell}
            onPress={onViewRoles}
            accessibilityRole="button"
            testID="giving-hub-roles-link"
          >
            <Ionicons name="people-outline" size={20} color={colors.textSecondary} />
            <View style={styles.cellMain}>
              <Text style={[styles.cellTitle, { color: colors.text }]}>Roles</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal
        visible={!!denyingExpenseId}
        onClose={() => setDenyingExpenseId(null)}
        title="Deny expense"
      >
        <View>
          <Text style={[styles.denyLabel, { color: colors.textSecondary }]}>
            Reason (shared with the submitter)
          </Text>
          <DenyReasonInput value={denyReason} onChangeText={setDenyReason} />
          <Button
            variant="danger"
            onPress={() => {
              if (denyingExpenseId) {
                onDeny(denyingExpenseId, denyReason.trim());
              }
              setDenyingExpenseId(null);
            }}
            disabled={!denyReason.trim()}
            style={{ marginTop: 16 }}
          >
            Deny expense
          </Button>
        </View>
      </Modal>

      <ImageViewer
        visible={!!previewImages}
        images={previewImages ?? []}
        initialIndex={0}
        onClose={() => setPreviewImages(null)}
      />
    </View>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.statTile, { backgroundColor: colors.surface }]}>
      <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
      {!!sub && <Text style={[styles.statSub, { color: colors.textSecondary }]}>{sub}</Text>}
    </View>
  );
}

function ActionTile({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[styles.actionTile, { backgroundColor: colors.surface }]}
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
    >
      <Ionicons name={icon} size={20} color={colors.text} />
      <Text style={[styles.actionTileLabel, { color: colors.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function CardStatusBadge({ status }: { status: CardStatus }) {
  switch (status) {
    case "active":
      return <Badge variant="success" size="small">Active</Badge>;
    case "disabled":
      return <Badge variant="secondary" size="small">Frozen</Badge>;
    case "pending":
      return <Badge variant="warning" size="small">Setting up…</Badge>;
    case "failed":
      return <Badge variant="danger" size="small">Failed</Badge>;
    case "canceled":
      return <Badge variant="secondary" size="small">Canceled</Badge>;
    default:
      return null;
  }
}

function activityIcon(kind: string): keyof typeof Ionicons.glyphMap {
  switch (kind) {
    case "donation":
      return "heart-outline";
    case "card_capture":
      return "card-outline";
    case "reimbursement":
      return "receipt-outline";
    case "allocation":
    case "transfer":
    case "sweep":
      return "business-outline";
    case "refund":
      return "return-down-back-outline";
    default:
      return "swap-horizontal-outline";
  }
}

function formatDate(timestampMs: number): string {
  return new Date(timestampMs).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function DenyReasonInput({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (text: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder="e.g. Missing receipt"
      placeholderTextColor={colors.inputPlaceholder}
      multiline
      style={[
        styles.denyInput,
        { color: colors.text, borderColor: colors.inputBorder, backgroundColor: colors.inputBackground },
      ]}
      testID="deny-reason-input"
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingPad: {
    padding: 16,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 20,
  },
  balance: {
    alignItems: "center",
    paddingTop: 8,
  },
  balanceAmount: {
    fontSize: 40,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  balanceFund: {
    fontSize: 13,
    marginTop: 2,
  },
  liveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 100,
  },
  liveChipText: {
    fontSize: 12,
    fontWeight: "700",
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  statTile: {
    flex: 1,
    borderRadius: 16,
    padding: 12,
  },
  statLabel: {
    fontSize: 10.5,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  statValue: {
    fontSize: 17,
    fontWeight: "700",
    marginTop: 3,
  },
  statSub: {
    fontSize: 11,
    marginTop: 1,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionTile: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
    gap: 5,
  },
  actionTileLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionLabel: {
    fontSize: 13,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  labelLink: {
    fontSize: 13,
    fontWeight: "600",
  },
  group: {
    borderRadius: 20,
    overflow: "hidden",
  },
  emptyCell: {
    padding: 20,
    alignItems: "center",
  },
  cell: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cellDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cellMain: {
    flex: 1,
  },
  cellTitle: {
    fontSize: 15.5,
  },
  cellSub: {
    fontSize: 12.5,
    marginTop: 2,
  },
  actionCellText: {
    fontSize: 15.5,
    fontWeight: "600",
  },
  footerNote: {
    fontSize: 12.5,
    marginTop: 8,
    paddingHorizontal: 4,
    lineHeight: 17,
  },
  expenseCell: {
    paddingVertical: 6,
  },
  expenseAmount: {
    fontSize: 15,
    fontWeight: "700",
  },
  expenseMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  receiptThumbWrap: {
    marginLeft: "auto",
  },
  receiptThumb: {
    width: 32,
    height: 32,
    borderRadius: 6,
  },
  expenseActions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 4,
  },
  actionButton: {
    flex: 1,
  },
  selfNote: {
    fontSize: 12,
    marginTop: 4,
    marginBottom: 6,
    paddingHorizontal: 14,
    fontStyle: "italic",
  },
  denyLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  denyInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    minHeight: 80,
    textAlignVertical: "top",
    fontSize: 15,
  },
});
