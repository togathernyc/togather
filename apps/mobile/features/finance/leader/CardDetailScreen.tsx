/**
 * CardDetailScreen — data wrapper for a single group-fund virtual card
 * (group-fund cards phase). Resolves the card via `getCardDetail` and hands
 * plain props to the presentational CardDetailView.
 */
import React, { useState } from "react";
import { View, StyleSheet, TouchableOpacity, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthenticatedQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { DragHandle } from "@components/ui/DragHandle";
import { ToastManager } from "@components/ui";
import { useMembersPage } from "@features/leader-tools/hooks/useMembersPage";
import { formatError } from "@/utils/error-handling";
import { useReceiptUpload } from "../member/useReceiptUpload";
import { CardDetailView } from "./CardDetailView";
import type { CardDetail } from "./types";

export function CardDetailScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group_id, card_id } = useLocalSearchParams<{ group_id: string; card_id: string }>();
  const groupId = group_id || "";
  const cardId = card_id || "";

  const { group, handleBack } = useMembersPage(groupId);

  const cardRaw = useAuthenticatedQuery(
    api.functions.finance.cards.getCardDetail,
    cardId ? { cardId: cardId as Id<"cards"> } : "skip",
  );

  const setCardFrozen = useAuthenticatedMutation(api.functions.finance.cards.setCardFrozen);
  const cancelCard = useAuthenticatedMutation(api.functions.finance.cards.cancelCard);
  const attachExpenseReceipt = useAuthenticatedMutation(
    api.functions.finance.expenses.attachExpenseReceipt,
  );
  // The reimbursement flow's uploader, reused verbatim: a card-charge receipt
  // is the same R2 object with the same `r2:<key>` storage path, and
  // `attachExpenseReceipt` asserts the uploader owns it.
  const { uploadReceipt } = useReceiptUpload();

  const { user } = useAuth();
  const [isFreezing, setIsFreezing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [attachingExpenseId, setAttachingExpenseId] = useState<string | null>(null);

  const card: CardDetail | null | undefined = cardRaw === undefined ? undefined : cardRaw === null ? null : toCardDetail(cardRaw);

  const handleToggleFrozen = async () => {
    if (!card || isFreezing) return;
    setIsFreezing(true);
    try {
      await setCardFrozen({ cardId: cardId as Id<"cards">, frozen: card.status !== "disabled" });
      ToastManager.success(card.status === "disabled" ? "Card unfrozen" : "Card frozen");
    } catch (error) {
      ToastManager.error(formatError(error, "Failed to update card"));
    } finally {
      setIsFreezing(false);
    }
  };

  const handleCancelCard = async () => {
    if (!card || isCancelling) return;
    setIsCancelling(true);
    try {
      await cancelCard({ cardId: cardId as Id<"cards"> });
      ToastManager.success("Card canceled");
      handleBack();
    } catch (error) {
      ToastManager.error(formatError(error, "Failed to cancel card"));
    } finally {
      setIsCancelling(false);
    }
  };

  const handleAttachReceipt = async (expenseId: string, imageUri: string) => {
    if (attachingExpenseId) return;
    setAttachingExpenseId(expenseId);
    try {
      const upload = await uploadReceipt(imageUri);
      if (upload.error || !upload.storagePath) {
        ToastManager.error(upload.error || "Couldn't upload that photo");
        return;
      }
      await attachExpenseReceipt({
        expenseId: expenseId as Id<"expenses">,
        receiptKey: upload.storagePath,
      });
      // Two different promises, and only one of them is true at a time: at a
      // provider with a receipt API the file leaves Togather, and saying so is
      // the difference between an accurate record and a surprise.
      ToastManager.success(
        card?.capabilities.receiptForwarding
          ? "Saved and sent to your card provider"
          : "Saved to the fund",
      );
    } catch (error) {
      ToastManager.error(formatError(error, "Couldn't attach that receipt"));
    } finally {
      setAttachingExpenseId(null);
    }
  };

  return (
    <>
      <DragHandle />
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack} testID="back-button">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {card?.name || "Card"}
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
            {card ? `Virtual card ··${card.last4}` : "Loading…"}
          </Text>
        </View>
      </View>

      <CardDetailView
        card={card}
        fundName={group?.name || "this group"}
        isFreezing={isFreezing}
        onToggleFrozen={handleToggleFrozen}
        isCancelling={isCancelling}
        onCancelCard={handleCancelCard}
        currentUserId={user?.id ?? null}
        onAttachReceipt={handleAttachReceipt}
        attachingExpenseId={attachingExpenseId}
      />
    </>
  );
}

function toCardDetail(raw: any): CardDetail {
  return {
    id: String(raw.id),
    name: raw.name,
    holderUserId: String(raw.holderUserId),
    holderName: raw.holderName,
    last4: raw.last4,
    status: raw.status,
    spendLimitCents: raw.spendLimitCents ?? null,
    limitPeriod: raw.limitPeriod ?? null,
    managedLimit: !!raw.managedLimit,
    manualCapCents: raw.manualCapCents ?? null,
    createdAt: raw.createdAt,
    // Defaulted to the conservative row rather than left undefined: the "none"
    // provider's capabilities promise nothing, which is the right thing for a
    // UI to render if a card ever arrives without them.
    capabilities: {
      cardCloseReversible: !!raw.capabilities?.cardCloseReversible,
      cardFreezeReversible: !!raw.capabilities?.cardFreezeReversible,
      weeklyLimits: !!raw.capabilities?.weeklyLimits,
      limitRequired: raw.capabilities?.limitRequired ?? true,
      managedFundLimit: !!raw.capabilities?.managedFundLimit,
      maxCardsPerFund: raw.capabilities?.maxCardsPerFund ?? null,
      receiptForwarding: !!raw.capabilities?.receiptForwarding,
    },
    activity: (raw.activity ?? []).map((entry: any) => ({
      id: String(entry.id),
      amountCents: entry.amountCents,
      description: entry.description ?? "",
      status: entry.status,
      receiptAttached: !!entry.receiptAttached,
      createdAt: entry.createdAt,
    })),
    viewerCanFreeze: !!raw.viewerCanFreeze,
    viewerCanUnfreeze: !!raw.viewerCanUnfreeze,
    viewerCanCancel: !!raw.viewerCanCancel,
  };
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 2,
  },
});
