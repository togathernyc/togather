/**
 * ChatRequestBanner
 *
 * Banner rendered above the message composer in `ConvexChatRoomScreen` when
 * the current user's membership row in an ad-hoc channel has
 * `requestState: "pending"`. Lets the recipient accept the request and start
 * replying, decline silently, or block & report the inviter.
 *
 * Placement is the caller's responsibility — this component renders inline
 * at full width and assumes it sits between the message list and the input.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { useMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

export interface ChatRequestBannerProps {
  channelId: Id<"chatChannels">;
  inviterDisplayName: string;
  /** Called after Accept succeeds — parent should refetch / re-render the chat room. */
  onAccepted?: () => void;
  /** Called after Decline / Block — parent should navigate away (back to inbox). */
  onResolved?: () => void;
}

export function ChatRequestBanner({
  channelId,
  inviterDisplayName,
  onAccepted,
  onResolved,
}: ChatRequestBannerProps) {
  const { token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();

  const [pendingAction, setPendingAction] = useState<
    "accept" | "decline" | "block" | null
  >(null);

  const respondToChatRequest = useMutation(
    api.functions.messaging.directMessages.respondToChatRequest
  );

  const isBusy = pendingAction !== null;

  const handleAccept = async () => {
    if (!token || isBusy) return;
    setPendingAction("accept");
    try {
      await respondToChatRequest({
        token,
        channelId,
        response: "accept",
      });
      setPendingAction(null);
      onAccepted?.();
    } catch (e) {
      setPendingAction(null);
      const message = e instanceof Error ? e.message : "Failed to accept";
      Alert.alert("Couldn't accept", message);
    }
  };

  const handleDecline = async () => {
    if (!token || isBusy) return;
    setPendingAction("decline");
    try {
      await respondToChatRequest({
        token,
        channelId,
        response: "decline",
      });
      setPendingAction(null);
      onResolved?.();
    } catch (e) {
      setPendingAction(null);
      const message = e instanceof Error ? e.message : "Failed to decline";
      Alert.alert("Couldn't decline", message);
    }
  };

  const handleBlock = async () => {
    if (!token || isBusy) return;
    setPendingAction("block");
    try {
      await respondToChatRequest({
        token,
        channelId,
        response: "block",
        reportReason: "spam",
      });
      setPendingAction(null);
      Alert.alert("Blocked", "They can't message you again.");
      onResolved?.();
    } catch (e) {
      setPendingAction(null);
      const message = e instanceof Error ? e.message : "Failed to block";
      Alert.alert("Couldn't block", message);
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surfaceSecondary,
          borderTopColor: colors.border,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <Text style={[styles.title, { color: colors.text }]}>
        {inviterDisplayName} would like to chat with you.
      </Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Accept to reply with messages, photos, and reactions. Read receipts and
        typing won't show until you accept.
      </Text>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: primaryColor }]}
          onPress={handleAccept}
          disabled={isBusy}
        >
          {pendingAction === "accept" ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={[styles.buttonText, { color: "#fff" }]}>Accept</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.button,
            styles.buttonNeutral,
            {
              borderColor: colors.border,
              backgroundColor: colors.surface,
            },
          ]}
          onPress={handleDecline}
          disabled={isBusy}
        >
          {pendingAction === "decline" ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Text style={[styles.buttonText, { color: colors.text }]}>
              Decline
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.button,
            styles.buttonDestructive,
            { borderColor: colors.destructive },
          ]}
          onPress={handleBlock}
          disabled={isBusy}
        >
          {pendingAction === "block" ? (
            <ActivityIndicator size="small" color={colors.destructive} />
          ) : (
            <Text
              style={[styles.buttonText, { color: colors.destructive }]}
            >
              Block & report
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 6,
  },
  button: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 100,
    minHeight: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  buttonNeutral: {
    borderWidth: 1,
  },
  buttonDestructive: {
    backgroundColor: "transparent",
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
