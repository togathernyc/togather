/**
 * Message Requests
 *
 * Route: /inbox/requests
 *
 * Signal-style inbox for incoming chat requests. A user lands here from a
 * "You have N message requests" entry point on the chat inbox.
 *
 * Each row shows the inviter, the shared-community attribution, and a
 * preview of the first message they sent. Tapping a row opens a bottom-sheet
 * modal with three actions: Accept (opens the chat), Decline (silent — the
 * sender is not notified), or Block & Report (writes `chatUserBlocks` +
 * `chatUserFlags`). All three flow through `respondToChatRequest`.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Modal,
  Alert,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "@components/ui/Avatar";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { useQuery, useMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { DmFeatureGate } from "@features/chat/components/DmFeatureGate";

type ChatRequestRow = {
  channelId: Id<"chatChannels">;
  channelType: "dm" | "group_dm";
  channelName: string;
  inviterUserId: Id<"users">;
  inviterDisplayName: string;
  inviterProfilePhoto: string | null;
  sharedCommunityNames: string[];
  memberCount: number;
  firstMessagePreview: string | null;
  firstMessageSenderName: string | null;
  invitedAt: number;
};

/**
 * Format a millisecond timestamp as a compact relative label
 * ("now", "5m", "3h", "2d", "3w"). No external dep.
 */
function formatRelativeShort(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return "now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d`;
  return `${Math.floor(diffSec / 604800)}w`;
}

export default function ChatRequestsRoute() {
  return (
    <DmFeatureGate>
      <ChatRequestsScreen />
    </DmFeatureGate>
  );
}

function ChatRequestsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();

  const [selectedRequest, setSelectedRequest] = useState<ChatRequestRow | null>(
    null
  );
  const [pendingAction, setPendingAction] = useState<
    "accept" | "decline" | "block" | null
  >(null);

  const requests = useQuery(
    api.functions.messaging.directMessages.listChatRequests,
    token ? { token } : "skip"
  );

  const respondToChatRequest = useMutation(
    api.functions.messaging.directMessages.respondToChatRequest
  );

  const isLoading = requests === undefined && token != null;

  const handleClose = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/chat");
    }
  };

  const closeSheet = () => {
    if (pendingAction) return; // Block dismissal while a mutation is in flight.
    setSelectedRequest(null);
  };

  const handleAccept = async () => {
    if (!token || !selectedRequest || pendingAction) return;
    setPendingAction("accept");
    try {
      await respondToChatRequest({
        token,
        channelId: selectedRequest.channelId,
        response: "accept",
      });
      const row = selectedRequest;
      setSelectedRequest(null);
      setPendingAction(null);
      // Replace, not push, so back from the chat goes to the inbox — not
      // back to the requests list (which will likely be empty/stale).
      // For 1:1 DMs the chat header should show the inviter; for group_dms
      // it should show the group's name + a generic group avatar so users
      // recognize which thread they entered, not the inviter's identity.
      const isGroup = row.channelType === "group_dm";
      const headerName = isGroup
        ? row.channelName.trim().length > 0
          ? row.channelName
          : `Group chat (${row.memberCount})`
        : row.inviterDisplayName;
      const headerImage = isGroup ? "" : row.inviterProfilePhoto ?? "";
      router.replace({
        pathname: `/inbox/dm/${row.channelId}` as any,
        params: {
          groupName: headerName,
          imageUrl: headerImage,
        },
      });
    } catch (e) {
      setPendingAction(null);
      const message = e instanceof Error ? e.message : "Failed to accept";
      Alert.alert("Couldn't accept", message);
    }
  };

  const handleDecline = async () => {
    if (!token || !selectedRequest || pendingAction) return;
    setPendingAction("decline");
    try {
      await respondToChatRequest({
        token,
        channelId: selectedRequest.channelId,
        response: "decline",
      });
      setSelectedRequest(null);
      setPendingAction(null);
    } catch (e) {
      setPendingAction(null);
      const message = e instanceof Error ? e.message : "Failed to decline";
      Alert.alert("Couldn't decline", message);
    }
  };

  const handleBlock = async () => {
    if (!token || !selectedRequest || pendingAction) return;
    setPendingAction("block");
    try {
      await respondToChatRequest({
        token,
        channelId: selectedRequest.channelId,
        response: "block",
        // V1 ships with a hard-coded reason; the picker is V2.
        reportReason: "spam",
      });
      setSelectedRequest(null);
      setPendingAction(null);
      Alert.alert("Blocked", "They can't message you again.");
    } catch (e) {
      setPendingAction(null);
      const message = e instanceof Error ? e.message : "Failed to block";
      Alert.alert("Couldn't block", message);
    }
  };

  const renderRow = ({ item }: { item: ChatRequestRow }) => {
    const subtitle = item.sharedCommunityNames.slice(0, 2).join(" · ");
    const preview = item.firstMessagePreview ?? "Started a chat";
    return (
      <TouchableOpacity
        style={[styles.row, { borderBottomColor: colors.border }]}
        onPress={() => setSelectedRequest(item)}
        activeOpacity={0.7}
      >
        <Avatar
          name={item.inviterDisplayName}
          imageUrl={item.inviterProfilePhoto}
          size={48}
        />
        <View style={styles.rowText}>
          <View style={styles.rowTopLine}>
            <Text
              style={[styles.rowName, { color: colors.text }]}
              numberOfLines={1}
            >
              {item.inviterDisplayName}
            </Text>
            <Text
              style={[styles.rowTimestamp, { color: colors.textTertiary }]}
            >
              {formatRelativeShort(item.invitedAt)}
            </Text>
          </View>
          {subtitle.length > 0 ? (
            <Text
              style={[styles.rowSubtitle, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
          <Text
            style={[styles.rowPreview, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {preview}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => {
    if (isLoading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="small" color={primaryColor} />
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Ionicons
          name="mail-open-outline"
          size={56}
          color={colors.textTertiary}
        />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          No message requests
        </Text>
        <Text
          style={[styles.emptySubtitle, { color: colors.textSecondary }]}
        >
          When someone outside your existing chats messages you, you'll see
          them here.
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 16,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={handleClose}
          style={styles.headerSide}
          accessibilityLabel="Close"
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Message requests
        </Text>
        <View style={styles.headerSide} />
      </View>

      <FlatList
        data={requests ?? []}
        keyExtractor={(item) => item.channelId}
        renderItem={renderRow}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={
          (requests?.length ?? 0) === 0 ? styles.emptyListContent : undefined
        }
      />

      <Modal
        visible={selectedRequest !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeSheet}
      >
        {selectedRequest ? (
          <RequestSheetContent
            request={selectedRequest}
            primaryColor={primaryColor}
            colors={colors}
            pendingAction={pendingAction}
            onClose={closeSheet}
            onAccept={handleAccept}
            onDecline={handleDecline}
            onBlock={handleBlock}
          />
        ) : null}
      </Modal>
    </View>
  );
}

function RequestSheetContent({
  request,
  primaryColor,
  colors,
  pendingAction,
  onClose,
  onAccept,
  onDecline,
  onBlock,
}: {
  request: ChatRequestRow;
  primaryColor: string;
  colors: ReturnType<typeof useTheme>["colors"];
  pendingAction: "accept" | "decline" | "block" | null;
  onClose: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onBlock: () => void;
}) {
  const insets = useSafeAreaInsets();
  const subtitle = request.sharedCommunityNames.slice(0, 2).join(" · ");
  const isBusy = pendingAction !== null;

  return (
    <View
      style={[
        styles.sheetContainer,
        { backgroundColor: colors.background },
      ]}
    >
      {/* Sheet header */}
      <View
        style={[
          styles.sheetHeader,
          {
            paddingTop: Platform.OS === "ios" ? 16 : insets.top + 12,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={onClose}
          style={styles.sheetClose}
          disabled={isBusy}
          accessibilityLabel="Close"
        >
          <Text
            style={[
              styles.sheetCloseText,
              { color: isBusy ? colors.textTertiary : colors.textSecondary },
            ]}
          >
            Close
          </Text>
        </TouchableOpacity>
        <Text style={[styles.sheetTitle, { color: colors.text }]}>
          Message request
        </Text>
        <View style={styles.sheetClose} />
      </View>

      <View style={styles.sheetBody}>
        <View style={styles.sheetProfile}>
          <Avatar
            name={request.inviterDisplayName}
            imageUrl={request.inviterProfilePhoto}
            size={72}
          />
          <Text
            style={[styles.sheetName, { color: colors.text }]}
            numberOfLines={2}
          >
            {request.inviterDisplayName}
          </Text>
          {subtitle.length > 0 ? (
            <Text
              style={[
                styles.sheetSubtitle,
                { color: colors.textSecondary },
              ]}
              numberOfLines={2}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>

        <View
          style={[
            styles.sheetMessage,
            {
              backgroundColor: colors.surfaceSecondary,
              borderColor: colors.border,
            },
          ]}
        >
          <Text
            style={[
              styles.sheetMessageLabel,
              { color: colors.textTertiary },
            ]}
          >
            First message
          </Text>
          <Text style={[styles.sheetMessageText, { color: colors.text }]}>
            {request.firstMessagePreview ?? "(No message yet)"}
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.sheetActions,
          { paddingBottom: insets.bottom + 16 },
        ]}
      >
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: primaryColor }]}
          onPress={onAccept}
          disabled={isBusy}
        >
          {pendingAction === "accept" ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={[styles.actionButtonText, { color: "#fff" }]}>
              Accept
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.actionButton,
            styles.actionButtonNeutral,
            {
              borderColor: colors.border,
              backgroundColor: colors.surfaceSecondary,
            },
          ]}
          onPress={onDecline}
          disabled={isBusy}
        >
          {pendingAction === "decline" ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Text style={[styles.actionButtonText, { color: colors.text }]}>
              Decline
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.actionButton,
            styles.actionButtonDestructive,
            { borderColor: colors.destructive },
          ]}
          onPress={onBlock}
          disabled={isBusy}
        >
          {pendingAction === "block" ? (
            <ActivityIndicator size="small" color={colors.destructive} />
          ) : (
            <Text
              style={[
                styles.actionButtonText,
                { color: colors.destructive },
              ]}
            >
              Block & Report
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerSide: {
    width: 40,
    height: 32,
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "500",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  rowName: {
    fontSize: 16,
    fontWeight: "600",
    flexShrink: 1,
  },
  rowTimestamp: {
    fontSize: 12,
  },
  rowSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  rowPreview: {
    fontSize: 14,
    marginTop: 2,
  },
  emptyContainer: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: 80,
    alignItems: "center",
    gap: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginTop: 8,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  emptyListContent: {
    flexGrow: 1,
  },

  // Sheet
  sheetContainer: {
    flex: 1,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  sheetClose: {
    width: 60,
  },
  sheetCloseText: {
    fontSize: 16,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  sheetBody: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    gap: 24,
  },
  sheetProfile: {
    alignItems: "center",
    gap: 8,
  },
  sheetName: {
    fontSize: 22,
    fontWeight: "700",
    marginTop: 8,
    textAlign: "center",
  },
  sheetSubtitle: {
    fontSize: 14,
    textAlign: "center",
  },
  sheetMessage: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 6,
  },
  sheetMessageLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sheetMessageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  sheetActions: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  actionButton: {
    minHeight: 50,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  actionButtonNeutral: {
    borderWidth: 1,
  },
  actionButtonDestructive: {
    backgroundColor: "transparent",
    borderWidth: 1,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
