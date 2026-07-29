/**
 * GivingHubView — presentational leader/admin surface for group giving
 * (ADR-032 §2 CTA, §4 approvals queue). Plain props only, no Convex — see
 * GivingHubScreen.tsx for the data wrapper that renders this.
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
import { Badge, Avatar, Button, EmptyState, Skeleton, ImageViewer } from "@components/ui";
// NOTE: imported from the concrete file, not the "@components/ui" barrel.
// Under this repo's current Jest/Babel setup, `CustomModal as Modal`
// resolves to `undefined` when named-imported through the barrel (wildcard
// `import * as UI` resolves it fine — this looks like a stale/partial CJS
// interop binding for renamed re-exports, not anything specific to this
// screen). Importing straight from the file sidesteps it; flagged for a
// framework-level look since other barrel consumers of `Modal` likely hit
// the same thing under test.
import { CustomModal as Modal } from "@components/ui/Modal";
import { formatCents } from "../format";
import type { GivingExpense } from "./types";

export type GivingHubTab = "pending" | "approved" | "all";

export type GivingHubState = "loading" | "no-fund-admin" | "no-fund-member" | "ready";

const TABS: { key: GivingHubTab; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "all", label: "All" },
];

export interface GivingHubViewProps {
  /** Which top-level state to render (fund resolution + gating). */
  state: GivingHubState;
  groupName: string;
  tab: GivingHubTab;
  onTabChange: (tab: GivingHubTab) => void;
  expenses: GivingExpense[];
  isLoadingExpenses: boolean;
  /** manager+ per getMyFundRole — gates Approve/Deny controls. */
  canApprove: boolean;
  currentUserId: string | null;
  /** Expense id currently being approved/denied (row-level spinner). */
  processingExpenseId: string | null;
  onApprove: (expenseId: string) => void;
  onDeny: (expenseId: string, reason: string) => void;
  onEnableGiving: () => void;
  isEnablingGiving: boolean;
  onViewRoles: () => void;
}

export function GivingHubView({
  state,
  groupName,
  tab,
  onTabChange,
  expenses,
  isLoadingExpenses,
  canApprove,
  currentUserId,
  processingExpenseId,
  onApprove,
  onDeny,
  onEnableGiving,
  isEnablingGiving,
  onViewRoles,
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

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <View style={styles.headerRow}>
        <View
          style={[styles.tabsTrack]}
        >
          <SegmentedTabsInline value={tab} onChange={onTabChange} />
        </View>
        <TouchableOpacity
          onPress={onViewRoles}
          style={styles.rolesLink}
          accessibilityRole="button"
          testID="giving-hub-roles-link"
        >
          <Ionicons name="people-outline" size={16} color={primaryColor} />
          <Text style={[styles.rolesLinkText, { color: primaryColor }]}>Roles</Text>
        </TouchableOpacity>
      </View>

      {isLoadingExpenses ? (
        <View style={styles.loadingPad}>
          <Skeleton width="100%" height={80} />
          <Skeleton width="100%" height={80} style={{ marginTop: 12 }} />
        </View>
      ) : expenses.length === 0 ? (
        <EmptyState
          icon="checkmark-done-circle-outline"
          title={tab === "pending" ? "No pending approvals" : "No expenses"}
          message={
            tab === "pending"
              ? "New card charges and reimbursement requests will show up here."
              : "Nothing to show for this filter yet."
          }
        />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {expenses.map((expense) => {
            const isSelf = !!currentUserId && expense.submitter.id === currentUserId;
            const needsSecondApproval = expense.status === "pending" && !!expense.approverId;
            const canActOnRow = canApprove && expense.status === "pending" && !isSelf;
            const isProcessing = processingExpenseId === expense.id;

            return (
              <View
                key={expense.id}
                style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
                testID={`expense-row-${expense.id}`}
              >
                <View style={styles.rowTop}>
                  <Avatar
                    name={
                      expense.submitter.displayName ||
                      `${expense.submitter.firstName ?? ""} ${expense.submitter.lastName ?? ""}`
                    }
                    imageUrl={expense.submitter.profileImage}
                    size={40}
                  />
                  <View style={styles.rowInfo}>
                    <Text style={[styles.submitterName, { color: colors.text }]} numberOfLines={1}>
                      {expense.submitter.displayName ||
                        `${expense.submitter.firstName ?? ""} ${expense.submitter.lastName ?? ""}`.trim() ||
                        "Unknown"}
                    </Text>
                    <Text style={[styles.description, { color: colors.textSecondary }]} numberOfLines={2}>
                      {expense.description}
                    </Text>
                  </View>
                  <Text style={[styles.amount, { color: colors.text }]}>
                    {formatCents(expense.amountCents)}
                  </Text>
                </View>

                <View style={styles.rowMeta}>
                  <StatusBadge status={expense.status} />
                  {needsSecondApproval && (
                    <Badge variant="warning" size="small">
                      1 of 2 approvals
                    </Badge>
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
                  <View style={styles.actionsRow}>
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
        </ScrollView>
      )}

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

function StatusBadge({ status }: { status: GivingExpense["status"] }) {
  const variant =
    status === "approved" || status === "paid"
      ? "success"
      : status === "denied"
        ? "danger"
        : "secondary";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <Badge variant={variant} size="small">
      {label}
    </Badge>
  );
}

/** Minimal inline segmented control — avoids importing SegmentedTabs' generic
 * type ceremony for a fixed 3-option tab bar. */
function SegmentedTabsInline({
  value,
  onChange,
}: {
  value: GivingHubTab;
  onChange: (tab: GivingHubTab) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.segTrack, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      {TABS.map((t) => {
        const selected = t.key === value;
        return (
          <TouchableOpacity
            key={t.key}
            onPress={() => onChange(t.key)}
            style={[styles.segOption, selected && { backgroundColor: colors.surface }]}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            testID={`giving-hub-tab-${t.key}`}
          >
            <Text
              style={[
                styles.segLabel,
                { color: selected ? colors.text : colors.textSecondary, fontWeight: selected ? "700" : "600" },
              ]}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
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
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  tabsTrack: {
    flexShrink: 1,
  },
  segTrack: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    padding: 3,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segOption: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  segLabel: {
    fontSize: 13,
  },
  rolesLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 4,
  },
  rolesLinkText: {
    fontSize: 14,
    fontWeight: "600",
  },
  list: {
    padding: 16,
    gap: 12,
  },
  row: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowInfo: {
    flex: 1,
  },
  submitterName: {
    fontSize: 15,
    fontWeight: "600",
  },
  description: {
    fontSize: 13,
    marginTop: 2,
  },
  amount: {
    fontSize: 16,
    fontWeight: "700",
  },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  receiptThumbWrap: {
    marginLeft: "auto",
  },
  receiptThumb: {
    width: 36,
    height: 36,
    borderRadius: 6,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  actionButton: {
    flex: 1,
  },
  selfNote: {
    fontSize: 12,
    marginTop: 10,
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
