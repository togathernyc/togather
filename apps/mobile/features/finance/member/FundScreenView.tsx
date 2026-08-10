/**
 * FundScreenView — presentational transparency screen for group giving
 * (ADR-032 §3/§7 Phase 1), restyled onto the WhatsApp shell. Pure props in, no
 * Convex/router imports, so a verification harness can render it standalone
 * with mock data.
 *
 * Shell per `docs/plans/church-migration-ui-redesign/WHATSAPP-DESIGN-SYSTEM.md`
 * §3.1/§3.2, mirroring GroupInfoScreen: grouped-gray canvas + floating
 * `WaSubScreenHeader`, content as `WaInsetGroup` cards. The bespoke bar header
 * this replaced carried the gear and a header "Give" link; both moved into the
 * page (a full-width hero pill, and a leaders-only "Fund settings" cell at the
 * bottom) so the header is back/title only.
 *
 * `paddingTop: insets.top` is load-bearing, not cosmetic: this screen never
 * applied safe-area insets, so on a notched device its top row sat under the
 * status bar and could not be reached.
 */
import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { Badge, Skeleton, EmptyState } from "@components/ui";
import {
  WaSubScreenHeader,
  WaInsetGroup,
  WaCell,
  waAvatarPalette,
  waAvatarInitials,
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
import { formatCents, formatSignedCents } from "../format";
import {
  formatLedgerKind,
  formatExpenseStatus,
  expenseStatusBadgeVariant,
  expenseStatusNote,
} from "./labels";
import { GIVING_GOLD, GIVING_GOLD_TINT } from "./giveTheme";
import {
  isLiveRecurring,
  formatMonthlyTitle,
  formatMonthlySubtitle,
  type RecurringSummary,
} from "./recurring";
import type { FundActivityEntry, FundOverview, MyExpense } from "./types";

/** Hero balance type size — the one number this whole screen exists to show. */
const BALANCE_SIZE = 46;
/** Fund-glyph tile edge, sized to sit above the balance without competing. */
const GLYPH_TILE = 44;
/**
 * Gold tile edge inside the monthly box's cell. A hair wider than
 * `WA_CELL_ICON_COLUMN` (24) so the disc reads as a tile rather than a bare
 * glyph; the 4pt it borrows comes out of the 16pt icon→label gap, which stays
 * comfortably wider than the gap on a plain cell's 24pt glyph.
 */
const MONTHLY_TILE = 28;

export interface FundScreenViewProps {
  /** `undefined` while loading, `null` when giving isn't set up for this group. */
  overview: FundOverview | null | undefined;
  /** The viewer's own reimbursement requests. `undefined` while loading. */
  myExpenses: MyExpense[] | undefined;
  onBack: () => void;
  onGivePress: () => void;
  onGetReimbursedPress: () => void;
  /**
   * The viewer's own monthly gift to this fund. `undefined` while loading,
   * `null` when they have none. A `pending` or `canceled` row renders nothing
   * at all — see `isLiveRecurring`.
   */
  recurring?: RecurringSummary | null;
  /** Opens the monthly-giving manage screen. */
  onManageRecurringPress?: () => void;
  /**
   * Set for manager+ viewers — renders the leaders-only "Fund settings" cell
   * that opens the leader giving hub (approvals + roles). Its presence IS the
   * permission gate; `FundScreen` passes `undefined` for everyone else.
   */
  onManagePress?: () => void;
}

export function FundScreenView({
  overview,
  myExpenses,
  onBack,
  onGivePress,
  onGetReimbursedPress,
  recurring,
  onManageRecurringPress,
  onManagePress,
}: FundScreenViewProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.backgroundGrouped, paddingTop: insets.top },
      ]}
    >
      <WaSubScreenHeader title="Giving" onBack={onBack} />

      {overview === undefined ? (
        <View style={styles.loadingContainer} testID="fund-screen-loading">
          <Skeleton height={180} borderRadius={WA_GROUP_RADIUS} style={styles.loadingBlock} />
          <Skeleton height={90} borderRadius={WA_GROUP_RADIUS} style={styles.loadingBlock} />
          <Skeleton height={200} borderRadius={WA_GROUP_RADIUS} />
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
          {/* HERO — glyph, fund name, balance, and the screen's single primary
              action. "Get reimbursed" deliberately does NOT sit here: it is a
              rare errand, and pairing it with Give made two equal-weight
              buttons out of one obvious one. It lives in its own card below. */}
          <WaInsetGroup>
            <View style={styles.hero}>
              <View style={[styles.glyphTile, { backgroundColor: GIVING_GOLD_TINT }]}>
                <Ionicons name="cash-outline" size={24} color={GIVING_GOLD} />
              </View>
              <Text style={[styles.fundName, { color: colors.textSecondary }]} numberOfLines={2}>
                {overview.fund.name}
              </Text>
              <Text style={[styles.balance, { color: colors.text }]}>
                {formatCents(overview.balanceCents)}
              </Text>
              <Pressable
                onPress={onGivePress}
                accessibilityRole="button"
                accessibilityLabel="Give"
                style={({ pressed }) => [
                  styles.givePill,
                  { backgroundColor: colors.buttonPrimary },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.givePillLabel, { color: colors.buttonPrimaryText }]}>
                  Give
                </Text>
              </Pressable>
            </View>
          </WaInsetGroup>

          {/* STAT TILES — this month / this year, 2-up. Card fees keep their
              own line (rather than folding into "spent") because a fee is
              money the group never chose to spend; see summarizePeriod. */}
          <View style={styles.statsRow}>
            <StatTile
              label="This month"
              totals={overview.monthToDate}
              surface={colors.surfaceGrouped}
              titleColor={colors.text}
              subtitleColor={colors.textSecondary}
            />
            <StatTile
              label="This year"
              totals={overview.yearToDate}
              surface={colors.surfaceGrouped}
              titleColor={colors.text}
              subtitleColor={colors.textSecondary}
            />
          </View>

          {/* RECENT ACTIVITY */}
          <View style={styles.group}>
            <WaInsetGroup header="Recent activity" separatorInset={0}>
              {overview.activity.length === 0 ? (
                <View style={styles.emptyRow}>
                  <Text style={[styles.emptyRowText, { color: colors.textSecondary }]}>
                    No activity yet
                  </Text>
                </View>
              ) : (
                overview.activity.map((entry) => (
                  <ActivityRow
                    key={entry.id}
                    entry={entry}
                    isDark={isDark}
                    titleColor={colors.text}
                    subtitleColor={colors.textSecondary}
                    creditColor={colors.success}
                  />
                ))
              )}
            </WaInsetGroup>
          </View>

          {/* YOUR MONTHLY GIVING — pinned between the group's activity and the
              viewer's own errands, because that is exactly what it is: the
              hinge from "here is what the fund did" to "here is your business
              with it". Above Reimbursements on purpose — a live monthly gift
              is standing money the donor should be able to see and stop
              without scrolling past a rare errand to reach it.

              Rendered only for a gift that is actually collecting: a `pending`
              row (donor still in Checkout) or a canceled one gets no group at
              all, header included, rather than an empty card. */}
          {isLiveRecurring(recurring) && (
            <View style={styles.group}>
              <WaInsetGroup>
                <WaCell
                  testID="fund-monthly-box"
                  iconNode={
                    <View
                      style={[styles.monthlyTile, { backgroundColor: GIVING_GOLD_TINT }]}
                    >
                      <Ionicons name="repeat" size={16} color={GIVING_GOLD} />
                    </View>
                  }
                  title={formatMonthlyTitle(recurring.amountCents)}
                  description={formatMonthlySubtitle(recurring)}
                  // A failing card has to LOOK different, not just read
                  // differently — the sub-line's default gray is the same ink
                  // "Next gift Sep 1" wears, and a donor scanning the screen
                  // would skim straight past the one row that needs them.
                  descriptionColor={
                    recurring.status === "past_due" ? colors.warning : undefined
                  }
                  onPress={onManageRecurringPress}
                />
              </WaInsetGroup>
            </View>
          )}

          {/* REIMBURSEMENTS — the ask sits first as a normal navigational cell,
              then the viewer's own requests below it, so "Get reimbursed" and
              "where did my request get to" are one place instead of two. */}
          <View style={styles.group}>
            <WaInsetGroup header="Reimbursements" separatorInset={0}>
              <WaCell
                icon="receipt-outline"
                title="Get reimbursed"
                description="Spent for the group? Send the receipt."
                onPress={onGetReimbursedPress}
              />
              {myExpenses === undefined ? (
                <View style={styles.emptyRow}>
                  <Skeleton height={40} borderRadius={8} />
                </View>
              ) : myExpenses.length === 0 ? (
                <View style={styles.emptyRow}>
                  <Text style={[styles.emptyRowText, { color: colors.textSecondary }]}>
                    No requests yet
                  </Text>
                </View>
              ) : (
                myExpenses.map((expense) => {
                  // Approved-but-unpaid is the one status a member can read as
                  // "settled" when it isn't — it gets a sentence saying who
                  // still owes them the money (see labels.ts).
                  const note = expenseStatusNote(expense.status);
                  return (
                    <View key={expense.id} style={styles.expenseRow}>
                      <View style={styles.expenseText}>
                        <Text style={[styles.expenseDescription, { color: colors.text }]}>
                          {expense.description || "Reimbursement"}
                        </Text>
                        <Text style={[styles.expenseAmount, { color: colors.textSecondary }]}>
                          {formatCents(expense.amountCents)}
                        </Text>
                        {!!note && (
                          <Text
                            testID={`expense-note-${expense.id}`}
                            style={[styles.expenseNote, { color: colors.textSecondary }]}
                          >
                            {note}
                          </Text>
                        )}
                      </View>
                      <Badge variant={expenseStatusBadgeVariant(expense.status)}>
                        {formatExpenseStatus(expense.status)}
                      </Badge>
                    </View>
                  );
                })
              )}
            </WaInsetGroup>
          </View>

          {/* FUND — leaders only. Last, and labelled, because it is the one row
              on this screen most members will never see. */}
          {!!onManagePress && (
            <View style={styles.group}>
              <WaInsetGroup header="Fund">
                <WaCell
                  icon="settings-outline"
                  title="Fund settings"
                  description="Leaders only"
                  onPress={onManagePress}
                />
              </WaInsetGroup>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

/** One of the two "This month" / "This year" tiles. */
function StatTile({
  label,
  totals,
  surface,
  titleColor,
  subtitleColor,
}: {
  label: string;
  totals: FundOverview["monthToDate"];
  surface: string;
  titleColor: string;
  subtitleColor: string;
}) {
  return (
    <View style={[styles.statTile, { backgroundColor: surface }]}>
      <Text style={[styles.statLabel, { color: subtitleColor }]}>{label}</Text>
      <Text style={[styles.statValue, { color: titleColor }]}>
        {formatCents(totals.donationsCents)}
      </Text>
      <Text style={[styles.statSubtitle, { color: subtitleColor }]}>
        {totals.donationCount} {totals.donationCount === 1 ? "gift" : "gifts"} ·{" "}
        {formatCents(totals.spentCents)} spent
      </Text>
      {totals.feesCents > 0 && (
        <Text style={[styles.statSubtitle, { color: subtitleColor }]}>
          {formatCents(totals.feesCents)} card fees
        </Text>
      )}
    </View>
  );
}

/**
 * One ledger row: initials disc, who, what + when, signed amount.
 *
 * Anonymized entries (a viewer who isn't manager+ sees no donor names) fall
 * back to the ledger kind as the title, so the row still reads as a sentence
 * instead of leaving a blank line above the subtitle.
 */
function ActivityRow({
  entry,
  isDark,
  titleColor,
  subtitleColor,
  creditColor,
}: {
  entry: FundActivityEntry;
  isDark: boolean;
  titleColor: string;
  subtitleColor: string;
  creditColor: string;
}) {
  const kind = formatLedgerKind(entry.kind);
  const title = entry.donorName || kind;
  const palette = waAvatarPalette(title, isDark);
  return (
    <View style={styles.activityRow}>
      <View style={[styles.activityAvatar, { backgroundColor: palette.background }]}>
        <Text style={[styles.activityInitials, { color: palette.foreground }]}>
          {waAvatarInitials(title)}
        </Text>
      </View>
      <View style={styles.activityText}>
        <Text style={[styles.activityTitle, { color: titleColor }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.activitySubtitle, { color: subtitleColor }]} numberOfLines={1}>
          {kind} · {formatActivityDate(entry.createdAt)}
        </Text>
      </View>
      <Text
        style={[
          styles.activityAmount,
          { color: entry.direction === "credit" ? creditColor : titleColor },
        ]}
      >
        {formatSignedCents(entry.amountCents, entry.direction)}
      </Text>
    </View>
  );
}

/** "Jul 29" — the ledger's own date, never a relative "2 days ago". */
function formatActivityDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const ACTIVITY_AVATAR = 40;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loadingContainer: { padding: WA_GROUP_MARGIN },
  loadingBlock: { marginBottom: 16 },
  emptyState: { flex: 1, justifyContent: "center" },
  scrollContent: { paddingTop: 16, paddingBottom: 40 },
  group: { marginTop: WA_GROUP_SPACING },

  hero: { alignItems: "center", paddingHorizontal: WA_CELL_PADDING, paddingVertical: 24 },
  monthlyTile: {
    width: MONTHLY_TILE,
    height: MONTHLY_TILE,
    borderRadius: MONTHLY_TILE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  glyphTile: {
    width: GLYPH_TILE,
    height: GLYPH_TILE,
    borderRadius: GLYPH_TILE / 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  fundName: {
    fontSize: 13.5,
    fontWeight: WA_WEIGHT_SEMIBOLD,
    textAlign: "center",
  },
  balance: {
    fontSize: BALANCE_SIZE,
    fontWeight: WA_WEIGHT_BOLD,
    fontVariant: ["tabular-nums"],
    marginTop: 4,
    marginBottom: 20,
  },
  givePill: {
    alignSelf: "stretch",
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  givePillLabel: { fontSize: WA_TYPE_ROW_TITLE, fontWeight: WA_WEIGHT_SEMIBOLD },
  pressed: { opacity: 0.85 },

  statsRow: {
    flexDirection: "row",
    gap: 12,
    marginHorizontal: WA_GROUP_MARGIN,
    marginTop: WA_GROUP_SPACING,
  },
  statTile: { flex: 1, borderRadius: WA_GROUP_RADIUS, padding: 16 },
  statLabel: { fontSize: WA_TYPE_FOOTNOTE, fontWeight: WA_WEIGHT_SEMIBOLD },
  statValue: {
    fontSize: 24,
    fontWeight: WA_WEIGHT_BOLD,
    fontVariant: ["tabular-nums"],
    marginTop: 4,
  },
  statSubtitle: { fontSize: 12, marginTop: 2 },

  emptyRow: { paddingHorizontal: WA_CELL_PADDING, paddingVertical: 18 },
  emptyRowText: { fontSize: WA_TYPE_SUBTITLE },

  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: WA_CELL_PADDING,
    paddingVertical: 10,
    gap: 12,
  },
  activityAvatar: {
    width: ACTIVITY_AVATAR,
    height: ACTIVITY_AVATAR,
    borderRadius: ACTIVITY_AVATAR / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  activityInitials: { fontSize: 15, fontWeight: WA_WEIGHT_SEMIBOLD },
  activityText: { flex: 1, minWidth: 0 },
  activityTitle: { fontSize: WA_TYPE_ROW_TITLE, fontWeight: WA_WEIGHT_SEMIBOLD },
  activitySubtitle: { fontSize: WA_TYPE_FOOTNOTE, marginTop: 2 },
  activityAmount: {
    fontSize: WA_TYPE_SUBTITLE,
    fontWeight: WA_WEIGHT_SEMIBOLD,
    fontVariant: ["tabular-nums"],
  },

  expenseRow: {
    flexDirection: "row",
    // Top-aligned, not centered: approved rows carry a wrapping note, and a
    // centered badge would drift to the middle of a three-line row.
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: WA_CELL_PADDING,
    paddingVertical: 12,
    gap: 8,
  },
  expenseText: { flex: 1, minWidth: 0 },
  expenseDescription: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_SEMIBOLD },
  expenseAmount: { fontSize: WA_TYPE_FOOTNOTE, marginTop: 2 },
  expenseNote: { fontSize: 12, lineHeight: 16, marginTop: 6 },
});
