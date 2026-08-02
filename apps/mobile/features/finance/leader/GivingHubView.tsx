/**
 * GivingHubView — presentational leader/admin "Fund settings" surface for
 * group giving (ADR-032 §2 CTA, §4 approvals queue; group-fund cards phase).
 * Plain props only, no Convex — see GivingHubScreen.tsx for the data wrapper
 * that renders this and owns the `WaSubScreenHeader`.
 *
 * WhatsApp-shell restyle (approved giving-flow mock). Structure, top to
 * bottom, on the `bg.grouped` canvas the screen wrapper paints:
 *   1. Hero `WaInsetGroup` — fund name, large tabular balance, and the
 *      "Giving is live" chip.
 *   2. "Needs your approval" — the pre-existing approvals queue, re-laid as
 *      WA cells with a `WaAvatar` initials disc per submitter.
 *   3. "Cards" — one cell per fund card, plus the accent "Create a card"
 *      action cell behind the unchanged `canManageCards` gate.
 *   4. "People" — "Fund roles" and "Share fund" navigational cells.
 *   5. "Activity" — a single accent "View all transactions" action cell.
 *
 * Built on `components/wa/*` (`WaInsetGroup`, `WaCell`, `WaAvatar`) with every
 * measurement imported from `components/wa/metrics` per that module's own
 * "import these instead of re-typing raw numbers" rule.
 *
 * Two rows are bespoke rather than literal `<WaCell>`s, following
 * `GroupInfoScreen`'s `SettingsToggleRow` precedent — both are built to the
 * same `WA_CELL_*` metrics so they sit in the same rhythm:
 *   - `ApprovalRow` needs an avatar well, a trailing amount, a receipt
 *     thumbnail, and an Approve/Deny button pair *below* the row; `WaCell` has
 *     slots for none of that.
 *   - The hero is a two-line centered block, not a row.
 *
 * Deliberately NOT carried over from the pre-restyle screen (the approved
 * mock's structure is the six items above, and every one of these lives on the
 * member fund screen that "View all transactions" opens):
 *   - The Give / Reimburse quick-action tiles — `FundScreen` owns both.
 *   - The month-to-date stat tiles and the inline recent-activity list.
 */
import React, { useMemo, useState } from "react";
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
import { waAccentPalette } from "@utils/waPalette";
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
import { WaAvatar, WaCell, WaInsetGroup } from "@components/wa";
import {
  WA_CELL_ICON_LABEL_GAP,
  WA_CELL_PADDING,
  WA_CELL_TALL_MIN_HEIGHT,
  WA_CHEVRON_SIZE,
  WA_CHEVRON_GAP,
  WA_GROUP_MARGIN,
  WA_GROUP_SPACING,
  WA_TYPE_FOOTNOTE,
  WA_TYPE_ROW_TITLE,
  WA_TYPE_SUBTITLE,
  WA_WEIGHT_BOLD,
  WA_WEIGHT_SEMIBOLD,
} from "@components/wa/metrics";
import { formatCents } from "../format";
import type {
  FundCard,
  GivingExpense,
  GivingHubBalanceSummary,
  CardStatus,
} from "./types";
import { formatCardLimit } from "./types";

export type GivingHubState = "loading" | "no-fund-admin" | "no-fund-member" | "ready";

/** Avatar disc in an approval row — the cell-scale counterpart of the 56pt list avatar. */
const APPROVAL_AVATAR_SIZE = 40;
/** Hero balance type size — the mock's ~36pt, between WA's 34pt large title and its 28pt hero name. */
const HERO_BALANCE_SIZE = 36;
/** Hero fund-name type size — the mock's 13.5pt gray semibold eyebrow above the balance. */
const HERO_FUND_NAME_SIZE = 13.5;

export interface GivingHubViewProps {
  /** Which top-level state to render (fund resolution + gating). */
  state: GivingHubState;
  groupName: string;
  givingLive: boolean;
  /** Hero fund name + balance. `undefined` while loading. */
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

  onEnableGiving: () => void;
  isEnablingGiving: boolean;

  onViewRoles: () => void;
  onCreateCardPress: () => void;
  /** Undefined hides the "Share fund" cell (no shareable group link available). */
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
  onEnableGiving,
  isEnablingGiving,
  onViewRoles,
  onCreateCardPress,
  onSharePress,
  onViewCard,
  onViewAllActivity,
}: GivingHubViewProps) {
  const { colors, isDark } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const accent = useMemo(
    () => waAccentPalette(primaryColor, isDark).accent,
    [primaryColor, isDark],
  );
  const [denyingExpenseId, setDenyingExpenseId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [previewImages, setPreviewImages] = useState<string[] | null>(null);

  if (state === "loading") {
    return (
      <View style={styles.container}>
        <View style={styles.loadingPad}>
          <Skeleton width="60%" height={20} />
          <Skeleton width="100%" height={80} style={{ marginTop: 16 }} />
          <Skeleton width="100%" height={80} style={{ marginTop: 12 }} />
        </View>
      </View>
    );
  }

  // Not-set-up states: same logic and copy as before the restyle, re-hosted on
  // the grouped canvas the screen wrapper paints.
  if (state === "no-fund-admin") {
    return (
      <View style={styles.container}>
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
      <View style={styles.container}>
        <EmptyState
          icon="wallet-outline"
          title="Giving isn't set up for this group yet"
          message="Ask a community admin to enable giving for this group from Community Finance settings."
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* 1. HERO — fund name eyebrow, large tabular balance, live chip. */}
        {balance === undefined ? (
          <View style={styles.heroSkeleton}>
            <Skeleton width="100%" height={120} borderRadius={24} />
          </View>
        ) : (
          <WaInsetGroup>
            <View style={styles.hero}>
              <Text style={[styles.heroFundName, { color: colors.textSecondary }]} numberOfLines={1}>
                {balance.fundName}
              </Text>
              <Text style={[styles.heroBalance, { color: colors.text }]}>
                {formatCents(balance.balanceCents)}
              </Text>
              {givingLive && (
                <View style={[styles.liveChip, { backgroundColor: `${accent}1a` }]}>
                  <View style={[styles.liveDot, { backgroundColor: accent }]} />
                  <Text style={[styles.liveChipText, { color: accent }]}>Giving is live</Text>
                </View>
              )}
            </View>
          </WaInsetGroup>
        )}

        {/* 2. NEEDS YOUR APPROVAL */}
        <View style={styles.section}>
          {isLoadingExpenses ? (
            <Skeleton width="100%" height={80} borderRadius={24} style={styles.inlineSkeleton} />
          ) : (
            <WaInsetGroup
              header="Needs your approval"
              separatorInset={WA_CELL_PADDING + APPROVAL_AVATAR_SIZE + WA_CELL_ICON_LABEL_GAP}
            >
              {expenses.length === 0 ? (
                <View style={styles.emptyCell}>
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    No pending approvals
                  </Text>
                </View>
              ) : (
                expenses.map((expense) => (
                  <ApprovalRow
                    key={expense.id}
                    expense={expense}
                    canApprove={canApprove}
                    currentUserId={currentUserId}
                    isProcessing={processingExpenseId === expense.id}
                    onApprove={onApprove}
                    onOpenDeny={(id) => {
                      setDenyingExpenseId(id);
                      setDenyReason("");
                    }}
                    onViewReceipt={(url) => setPreviewImages([url])}
                  />
                ))
              )}
            </WaInsetGroup>
          )}
        </View>

        {/* 3. CARDS */}
        <View style={styles.section}>
          {isLoadingCards ? (
            <Skeleton width="100%" height={80} borderRadius={24} style={styles.inlineSkeleton} />
          ) : (
            <WaInsetGroup
              header="Cards"
              footer="Cards spend directly from this fund's bank account, and the bank declines anything over a card's limit. Every charge lands in the fund's activity as soon as it settles."
            >
              {cards.length === 0 && !canManageCards ? (
                <View key="cards-empty" style={styles.emptyCell}>
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No cards yet</Text>
                </View>
              ) : null}

              {cards.map((card) => (
                <WaCell
                  key={card.id}
                  icon="card-outline"
                  title={`${card.name} ·· ${card.last4}`}
                  description={`${card.holderName} · ${formatCardLimit(
                    card.spendLimitCents,
                    card.limitPeriod,
                    formatCents,
                  )}`}
                  onPress={() => onViewCard(card.id)}
                  testID={`giving-hub-card-${card.id}`}
                  trailingAccessory={
                    <View style={styles.cardTrailing}>
                      <CardStatusBadge status={card.status} />
                      <Ionicons
                        name="chevron-forward"
                        size={WA_CHEVRON_SIZE}
                        color={colors.textTertiary}
                      />
                    </View>
                  }
                />
              ))}

              {canManageCards ? (
                <WaCell
                  key="create-card"
                  variant="action"
                  accent={accent}
                  title="Create a card"
                  onPress={onCreateCardPress}
                  testID="giving-hub-create-card"
                />
              ) : null}
            </WaInsetGroup>
          )}
        </View>

        {/* 4. PEOPLE */}
        <View style={styles.section}>
          <WaInsetGroup header="People">
            <WaCell
              icon="key-outline"
              title="Fund roles"
              description="Who can manage, approve, spend"
              onPress={onViewRoles}
              testID="giving-hub-roles-link"
            />
            {onSharePress ? (
              <WaCell
                key="share-fund"
                icon="link-outline"
                title="Share fund"
                description="Invite people to give"
                onPress={onSharePress}
                testID="giving-hub-action-share"
              />
            ) : null}
          </WaInsetGroup>
        </View>

        {/* 5. ACTIVITY */}
        <View style={styles.section}>
          <WaInsetGroup
            header="Activity"
            footer="Card charges sync automatically from the bank. Balance reconciles nightly against the fund's account."
          >
            <WaCell
              variant="action"
              accent={accent}
              title="View all transactions"
              onPress={onViewAllActivity}
              testID="giving-hub-see-all-transactions"
            />
          </WaInsetGroup>
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

/**
 * ApprovalRow — one pending expense inside the "Needs your approval" card.
 *
 * A bespoke row rather than a `<WaCell>` (which has no slot for an avatar
 * well, a trailing amount, a receipt thumbnail, or the Approve/Deny pair that
 * hangs below the row), built to the same `WA_CELL_*` metrics so it keeps the
 * card's rhythm. Every gate is the caller's, unchanged: `canApprove`, the
 * self-approval block, and the two-approver badge.
 */
function ApprovalRow({
  expense,
  canApprove,
  currentUserId,
  isProcessing,
  onApprove,
  onOpenDeny,
  onViewReceipt,
}: {
  expense: GivingExpense;
  canApprove: boolean;
  currentUserId: string | null;
  isProcessing: boolean;
  onApprove: (expenseId: string) => void;
  onOpenDeny: (expenseId: string) => void;
  onViewReceipt: (url: string) => void;
}) {
  const { colors } = useTheme();
  const isSelf = !!currentUserId && expense.submitter.id === currentUserId;
  const needsSecondApproval = expense.status === "pending" && !!expense.approverId;
  const canActOnRow = canApprove && expense.status === "pending" && !isSelf;
  const receiptMissing = expense.kind === "card_charge" && !expense.receiptUrl;
  const submitterName =
    expense.submitter.displayName ||
    `${expense.submitter.firstName ?? ""} ${expense.submitter.lastName ?? ""}`.trim() ||
    "Unknown";
  const kindLabel = expense.kind === "card_charge" ? "Card charge" : "Reimbursement";

  return (
    <View testID={`expense-row-${expense.id}`}>
      <View style={styles.approvalRow}>
        <WaAvatar
          imageUrl={expense.submitter.profileImage}
          label={submitterName}
          seed={expense.submitter.id || submitterName}
          size={APPROVAL_AVATAR_SIZE}
          style={styles.approvalAvatar}
        />
        <View style={styles.approvalText}>
          <Text style={[styles.approvalTitle, { color: colors.text }]} numberOfLines={1}>
            {kindLabel} · {formatCents(expense.amountCents)}
          </Text>
          <Text style={[styles.approvalSubtitle, { color: colors.textTertiary }]} numberOfLines={2}>
            {submitterName} — {expense.description}
            {receiptMissing ? " · " : ""}
            {receiptMissing && (
              <Text style={{ color: colors.destructive, fontWeight: WA_WEIGHT_BOLD }}>
                receipt missing
              </Text>
            )}
          </Text>
        </View>
        {expense.receiptUrl ? (
          <TouchableOpacity
            onPress={() => onViewReceipt(expense.receiptUrl as string)}
            accessibilityRole="button"
            accessibilityLabel="View receipt"
            testID={`expense-receipt-${expense.id}`}
          >
            <Image source={{ uri: expense.receiptUrl }} style={styles.receiptThumb} />
          </TouchableOpacity>
        ) : null}
      </View>

      {needsSecondApproval && (
        <View style={styles.approvalBadgeRow}>
          <Badge variant="warning" size="small">1 of 2 approvals</Badge>
        </View>
      )}

      {canActOnRow && (
        <View style={styles.approvalActions}>
          <Button
            variant="secondary"
            onPress={() => onOpenDeny(expense.id)}
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
    padding: WA_GROUP_MARGIN,
  },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 32,
  },
  section: {
    marginTop: WA_GROUP_SPACING,
  },
  heroSkeleton: {
    marginHorizontal: WA_GROUP_MARGIN,
  },
  inlineSkeleton: {
    marginHorizontal: WA_GROUP_MARGIN,
  },
  hero: {
    alignItems: "center",
    paddingVertical: 20,
    paddingHorizontal: WA_CELL_PADDING,
  },
  heroFundName: {
    fontSize: HERO_FUND_NAME_SIZE,
    fontWeight: WA_WEIGHT_SEMIBOLD,
  },
  heroBalance: {
    marginTop: 4,
    fontSize: HERO_BALANCE_SIZE,
    fontWeight: WA_WEIGHT_BOLD,
    letterSpacing: -0.5,
    // Tabular figures so a changing balance doesn't reflow the hero.
    fontVariant: ["tabular-nums"],
  },
  liveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 100,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  liveChipText: {
    fontSize: WA_TYPE_FOOTNOTE,
    fontWeight: WA_WEIGHT_SEMIBOLD,
  },
  emptyCell: {
    minHeight: WA_CELL_TALL_MIN_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: WA_CELL_PADDING,
  },
  emptyText: {
    fontSize: WA_TYPE_SUBTITLE,
  },
  cardTrailing: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: WA_CHEVRON_GAP,
    flexShrink: 0,
  },
  approvalRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: WA_CELL_TALL_MIN_HEIGHT,
    paddingHorizontal: WA_CELL_PADDING,
    paddingVertical: 10,
    gap: WA_CELL_ICON_LABEL_GAP,
  },
  approvalAvatar: {
    flexShrink: 0,
  },
  approvalText: {
    flex: 1,
    minWidth: 0,
  },
  approvalTitle: {
    fontSize: WA_TYPE_ROW_TITLE,
    fontWeight: WA_WEIGHT_SEMIBOLD,
  },
  approvalSubtitle: {
    fontSize: WA_TYPE_FOOTNOTE,
    marginTop: 2,
    lineHeight: 18,
  },
  receiptThumb: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  approvalBadgeRow: {
    flexDirection: "row",
    paddingHorizontal: WA_CELL_PADDING,
    paddingBottom: 8,
  },
  approvalActions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: WA_CELL_PADDING,
    paddingBottom: 12,
  },
  actionButton: {
    flex: 1,
  },
  selfNote: {
    fontSize: 12,
    marginBottom: 12,
    paddingHorizontal: WA_CELL_PADDING,
    fontStyle: "italic",
  },
  denyLabel: {
    fontSize: WA_TYPE_FOOTNOTE,
    fontWeight: WA_WEIGHT_SEMIBOLD,
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
