/**
 * CardDetailView — presentational virtual-card detail screen (group-fund
 * cards phase). Plain props only, no Convex — see CardDetailScreen.tsx for
 * the data wrapper.
 */
import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { Badge, Skeleton, ConfirmModal } from "@components/ui";
import { formatCents } from "../format";
import { formatCardLimit, CARD_CHARGE_SETTLEMENT_NOTE, type CardDetail } from "./types";

export interface CardDetailViewProps {
  /** `undefined` while loading, `null` if the card couldn't be found/loaded. */
  card: CardDetail | null | undefined;
  /** The fund's display name, shown on the card art. */
  fundName: string;
  isFreezing: boolean;
  onToggleFrozen: () => void;
  isCancelling: boolean;
  onCancelCard: () => void;
}

export function CardDetailView({
  card,
  fundName,
  isFreezing,
  onToggleFrozen,
  isCancelling,
  onCancelCard,
}: CardDetailViewProps) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  if (card === undefined) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
        <View style={styles.loadingPad}>
          <Skeleton width="100%" height={180} borderRadius={20} />
          <Skeleton width="100%" height={64} style={{ marginTop: 16 }} />
          <Skeleton width="100%" height={140} style={{ marginTop: 12 }} />
        </View>
      </View>
    );
  }

  if (card === null) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.surfaceSecondary }]}>
        <Text style={{ color: colors.textSecondary }}>This card couldn't be loaded.</Text>
      </View>
    );
  }

  const isFrozen = card.status === "disabled";
  const isFailed = card.status === "failed";
  const isPending = card.status === "pending";
  const isCanceled = card.status === "canceled";
  // Per-action gates mirror the mutations' own checks (setCardFrozen /
  // cancelCard) so the UI never offers a control that would reject this
  // viewer — e.g. a non-admin holder who froze their own card must see no
  // unfreeze control at all.
  const canFreeze = card.status === "active" && card.viewerCanFreeze;
  const canUnfreeze = isFrozen && card.viewerCanUnfreeze;
  const showFreezeToggle = canFreeze || canUnfreeze;
  const canCancel = !isFailed && !isCanceled && card.viewerCanCancel;

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* CARD ART */}
        <View style={styles.cardArt} testID="card-art">
          <View style={styles.cardArtRow}>
            <Text style={styles.cardArtBrand}>TOGATHER</Text>
            <View style={styles.cardArtChip} />
          </View>
          <Text style={styles.cardArtNumber}>•••• •••• •••• {card.last4}</Text>
          <View style={styles.cardArtMetaRow}>
            <CardArtMetaItem label="Cardholder" value={card.holderName} />
            <CardArtMetaItem label="Expires" value="••/••" />
            <CardArtMetaItem label="Fund" value={fundName} />
          </View>
        </View>

        {isFrozen && (
          <View style={[styles.frozenStrip, { backgroundColor: colors.surface }]}>
            <Ionicons name="snow-outline" size={16} color={primaryColor} />
            <Text style={[styles.frozenStripText, { color: primaryColor }]}>
              This card is frozen — new charges will be declined.
            </Text>
          </View>
        )}
        {isPending && (
          <View style={[styles.frozenStrip, { backgroundColor: colors.surface }]}>
            <Ionicons name="hourglass-outline" size={16} color={colors.textSecondary} />
            <Text style={[styles.frozenStripText, { color: colors.textSecondary }]}>
              Setting up… this card isn't ready to use yet.
            </Text>
          </View>
        )}
        {isFailed && (
          <View style={[styles.frozenStrip, { backgroundColor: colors.surface }]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
            <Text style={[styles.frozenStripText, { color: colors.error }]}>
              Something went wrong issuing this card. Contact support.
            </Text>
          </View>
        )}

        {/* ACTIONS */}
        <View style={styles.actionsRow}>
          <DisabledAction icon="eye-outline" label="Reveal number" colors={colors} />
          {showFreezeToggle ? (
            <TouchableOpacity
              style={[styles.actionCard, { backgroundColor: colors.surface }]}
              onPress={onToggleFrozen}
              disabled={isFreezing}
              accessibilityRole="button"
              testID="card-freeze-action"
            >
              <Ionicons
                name={isFrozen ? "sunny-outline" : "snow-outline"}
                size={20}
                color={colors.text}
              />
              <Text style={[styles.actionLabel, { color: colors.text }]}>
                {isFrozen ? "Unfreeze" : "Freeze"}
              </Text>
            </TouchableOpacity>
          ) : (
            <DisabledAction
              icon={isFrozen ? "sunny-outline" : "snow-outline"}
              label={isFrozen ? "Unfreeze" : "Freeze"}
              colors={colors}
            />
          )}
          <DisabledAction icon="phone-portrait-outline" label="Add to wallet" colors={colors} />
        </View>
        <Text style={[styles.comingSoonNote, { color: colors.textTertiary }]}>
          Reveal number and Add to wallet are coming soon.
        </Text>

        {/* SPENDING CONTROLS */}
        <View>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            Spending controls
          </Text>
          <View style={[styles.group, { backgroundColor: colors.surface }]}>
            <View style={styles.cell}>
              <Text style={[styles.cellTitle, { color: colors.text }]}>Limit</Text>
              <Text style={[styles.cellValue, { color: colors.text }]}>
                {formatCardLimit(card.spendLimitCents, card.limitPeriod, formatCents)}
              </Text>
            </View>
          </View>
          <Text style={[styles.footerNote, { color: colors.textSecondary }]}>
            {card.spendLimitCents == null
              ? "No limit set, so this card can spend the fund's whole balance. Only finance admins can set one."
              : "The bank declines anything over this limit. Only finance admins can change it."}
          </Text>
          <Text style={[styles.footerNote, { color: colors.textSecondary }]}>
            {CARD_CHARGE_SETTLEMENT_NOTE}
          </Text>
        </View>

        {/* ACTIVITY */}
        <View>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            This card's activity
          </Text>
          {card.activity.length === 0 ? (
            <View style={[styles.group, styles.emptyGroup, { backgroundColor: colors.surface }]}>
              <Text style={{ color: colors.textSecondary }}>No charges yet</Text>
            </View>
          ) : (
            <View style={[styles.group, { backgroundColor: colors.surface }]}>
              {card.activity.map((entry, index) => (
                <View
                  key={entry.id}
                  style={[
                    styles.cell,
                    index > 0 && [styles.cellDivider, { borderTopColor: colors.border }],
                  ]}
                  testID={`card-activity-${entry.id}`}
                >
                  <View style={styles.cellMain}>
                    <Text style={[styles.cellTitle, { color: colors.text }]} numberOfLines={1}>
                      {entry.description || "Card charge"}
                    </Text>
                    <Text style={[styles.cellSub, { color: colors.textSecondary }]}>
                      {formatDate(entry.createdAt)} · {entry.status === "pending" ? "pending settle" : "settled"}
                    </Text>
                  </View>
                  {entry.receiptAttached ? (
                    <Badge variant="success" size="small">✓</Badge>
                  ) : (
                    <Badge variant="danger" size="small">No receipt</Badge>
                  )}
                  <Text style={[styles.activityAmount, { color: colors.text }]}>
                    -{formatCents(entry.amountCents)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {canCancel && (
          <View style={[styles.group, { backgroundColor: colors.surface }]}>
            <TouchableOpacity
              style={styles.cancelCell}
              onPress={() => setConfirmingCancel(true)}
              accessibilityRole="button"
              testID="cancel-card-button"
            >
              <Text style={[styles.cancelText, { color: colors.destructive }]}>
                Cancel this card
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <ConfirmModal
        visible={confirmingCancel}
        title="Cancel this card"
        message={`This permanently disables ${card.name}. This can't be undone.`}
        confirmText="Cancel card"
        destructive
        isLoading={isCancelling}
        onConfirm={() => {
          onCancelCard();
          setConfirmingCancel(false);
        }}
        onCancel={() => setConfirmingCancel(false)}
      />
    </View>
  );
}

function CardArtMetaItem({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text style={styles.cardArtMetaLabel}>{label}</Text>
      <Text style={styles.cardArtMetaValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function DisabledAction({
  icon,
  label,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  colors: { surface: string; textTertiary: string };
}) {
  return (
    <View style={[styles.actionCard, styles.actionCardDisabled, { backgroundColor: colors.surface }]}>
      <Ionicons name={icon} size={20} color={colors.textTertiary} />
      <Text style={[styles.actionLabel, { color: colors.textTertiary }]}>{label}</Text>
    </View>
  );
}

function formatDate(timestampMs: number): string {
  return new Date(timestampMs).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const CARD_ART_DARK = "#23303a";

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: "center", justifyContent: "center" },
  loadingPad: { padding: 16 },
  scrollContent: { padding: 16, paddingBottom: 32, gap: 20 },
  cardArt: {
    borderRadius: 20,
    padding: 20,
    backgroundColor: CARD_ART_DARK,
  },
  cardArtRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardArtBrand: {
    color: "#e9edef",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
    opacity: 0.85,
  },
  cardArtChip: {
    width: 34,
    height: 24,
    borderRadius: 6,
    backgroundColor: "#b8860b",
  },
  cardArtNumber: {
    color: "#e9edef",
    fontSize: 19,
    letterSpacing: 3,
    marginTop: 22,
    marginBottom: 14,
  },
  cardArtMetaRow: { flexDirection: "row", justifyContent: "space-between" },
  cardArtMetaLabel: {
    color: "#e9edef",
    opacity: 0.6,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  cardArtMetaValue: { color: "#e9edef", fontSize: 13, fontWeight: "600", maxWidth: 110 },
  frozenStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 14,
  },
  frozenStripText: { fontSize: 13, fontWeight: "600", flex: 1 },
  actionsRow: { flexDirection: "row", gap: 10 },
  actionCard: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    gap: 6,
  },
  actionCardDisabled: { opacity: 0.55 },
  actionLabel: { fontSize: 12.5, fontWeight: "600" },
  comingSoonNote: { fontSize: 12, textAlign: "center", marginTop: -12 },
  sectionLabel: { fontSize: 13, marginBottom: 8, paddingHorizontal: 4 },
  footerNote: { fontSize: 12.5, marginTop: 8, paddingHorizontal: 4, lineHeight: 17 },
  group: { borderRadius: 16, overflow: "hidden" },
  emptyGroup: { padding: 20, alignItems: "center" },
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
  cellValue: { fontSize: 14.5, fontWeight: "600" },
  activityAmount: { fontSize: 14.5, fontWeight: "700" },
  cancelCell: { padding: 16, alignItems: "center" },
  cancelText: { fontSize: 15.5, fontWeight: "600" },
});
