/**
 * ThreadPage Component
 *
 * Full-page thread view showing:
 * - Thread header with back navigation
 * - Parent message at top
 * - List of replies
 * - Reply input at bottom
 */

import React, { useCallback, useRef, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { FlashList, FlashListRef } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useMutation, api } from "@services/api/convex";
import { useParentMessage } from "../hooks/useParentMessage";
import { useThreadReplies } from "../hooks/useThreadReplies";
import { useGroupDetails } from "../../groups/hooks/useGroupDetails";
import { ThreadHeader } from "./ThreadHeader";
import { MessageItem } from "./MessageItem";
import { MessageInput } from "./MessageInput";
import { MessageActionsOverlay } from "./MessageActionsOverlay";

interface ThreadPageProps {
  messageId: Id<"chatMessages">;
  groupId: Id<"groups">;
  channelName?: string;
}

export function ThreadPage({
  messageId,
  groupId,
  channelName,
}: ThreadPageProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const currentUserId = user?.id as Id<"users"> | undefined;
  const flashListRef = useRef<FlashListRef<any>>(null);

  // Fetch group details to determine if user is a leader
  const { data: groupDetails } = useGroupDetails(groupId);
  const isUserLeader =
    groupDetails?.user_role === "leader" ||
    groupDetails?.user_role === "admin";

  // Mutations for message actions
  const toggleReactionMutation = useMutation(api.functions.messaging.reactions.toggleReaction);
  const deleteMessageMutation = useMutation(api.functions.messaging.messages.deleteMessage);
  const flagMessageMutation = useMutation(api.functions.messaging.flagging.flagMessage);

  // Message actions overlay state
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState<Id<"chatMessages"> | null>(null);
  const [selectedMessageSenderId, setSelectedMessageSenderId] = useState<Id<"users"> | null>(null);
  const [selectedMessageContent, setSelectedMessageContent] = useState<string>("");
  const [selectedMessageSenderName, setSelectedMessageSenderName] = useState<string | undefined>();
  const [selectedMessageSenderPhoto, setSelectedMessageSenderPhoto] = useState<string | undefined>();
  const [selectedMessageAttachments, setSelectedMessageAttachments] = useState<Array<{ type: string; url: string }> | undefined>();

  // Fetch parent message
  const { message: parentMessage, isLoading: parentLoading } = useParentMessage(messageId);

  // Fetch thread replies
  const { replies, isLoading: repliesLoading } = useThreadReplies(messageId);

  // Track reply count to auto-scroll on new replies
  const lastReplyCountRef = useRef(replies.length);
  useEffect(() => {
    if (replies.length > lastReplyCountRef.current) {
      // New reply added, scroll to bottom
      setTimeout(() => {
        flashListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
    lastReplyCountRef.current = replies.length;
  }, [replies.length]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/inbox/${groupId}/general`);
    }
  }, [router, groupId]);

  // Message action handlers
  const handleLongPressMessage = useCallback((
    message: {
      _id: Id<"chatMessages">;
      senderId: Id<"users">;
      content: string;
      senderName?: string;
      senderProfilePhoto?: string;
      attachments?: Array<{ type: string; url: string; name?: string }>;
    },
    _event: { nativeEvent: { pageX: number; pageY: number } }
  ) => {
    setSelectedMessageId(message._id);
    setSelectedMessageSenderId(message.senderId);
    setSelectedMessageContent(message.content);
    setSelectedMessageSenderName(message.senderName);
    setSelectedMessageSenderPhoto(message.senderProfilePhoto);
    setSelectedMessageAttachments(message.attachments?.map(a => ({ type: a.type, url: a.url })));
    setOverlayVisible(true);
  }, []);

  const handleOverlayClose = useCallback(() => {
    setOverlayVisible(false);
    setSelectedMessageId(null);
    setSelectedMessageSenderId(null);
    setSelectedMessageContent("");
    setSelectedMessageSenderName(undefined);
    setSelectedMessageSenderPhoto(undefined);
    setSelectedMessageAttachments(undefined);
  }, []);

  const handleMessageDelete = useCallback(async (msgId: Id<"chatMessages">) => {
    if (!token) return;

    Alert.alert(
      "Delete Message",
      "Are you sure you want to delete this message?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMessageMutation({ token, messageId: msgId });
              setOverlayVisible(false);
            } catch (error) {
              console.error("[ThreadPage] Failed to delete message:", error);
              Alert.alert("Error", "Failed to delete message.");
            }
          },
        },
      ]
    );
  }, [token, deleteMessageMutation]);

  const handleFlagMessage = useCallback(async () => {
    if (!selectedMessageId || !token) return;

    try {
      await flagMessageMutation({
        token,
        messageId: selectedMessageId,
        reason: "inappropriate",
      });
      Alert.alert("Message Reported", "Thank you for reporting this message.");
      setOverlayVisible(false);
    } catch (error) {
      console.error("[ThreadPage] Failed to flag message:", error);
      Alert.alert("Error", "Failed to report message.");
    }
  }, [selectedMessageId, token, flagMessageMutation]);

  // Loading state
  if (parentLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ThreadHeader channelName={channelName} onBack={handleBack} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={styles.loadingText}>Loading thread...</Text>
        </View>
      </View>
    );
  }

  // Parent message not found
  if (!parentMessage) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ThreadHeader channelName={channelName} onBack={handleBack} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Message not found</Text>
          <Text style={styles.errorSubtext}>This message may have been deleted.</Text>
        </View>
      </View>
    );
  }

  if (!currentUserId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ThreadHeader channelName={channelName} onBack={handleBack} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Not authenticated</Text>
        </View>
      </View>
    );
  }

  // Build list data: parent message header + separator + replies
  const listData = [
    { type: "parent" as const, data: parentMessage },
    { type: "separator" as const, count: replies.length },
    ...replies.map((reply) => ({ type: "reply" as const, data: reply })),
  ];

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <ThreadHeader channelName={channelName} onBack={handleBack} />

      <View style={styles.content}>
        <FlashList
          ref={flashListRef}
          data={listData}
          keyExtractor={(item, index) => {
            if (item.type === "parent") return `parent-${item.data._id}`;
            if (item.type === "separator") return "separator";
            return `reply-${item.data._id}`;
          }}
          renderItem={({ item }) => {
            if (item.type === "parent") {
              return (
                <View style={styles.parentMessageContainer}>
                  <MessageItem
                    message={{
                      _id: item.data._id,
                      channelId: item.data.channelId,
                      senderId: item.data.senderId as Id<"users">,
                      content: item.data.content || "",
                      contentType: item.data.contentType || "text",
                      attachments: item.data.attachments,
                      createdAt: item.data.createdAt,
                      editedAt: item.data.editedAt,
                      isDeleted: item.data.isDeleted,
                      senderName: item.data.senderName,
                      senderProfilePhoto: item.data.senderProfilePhoto,
                    }}
                    currentUserId={currentUserId}
                    onLongPress={handleLongPressMessage}
                  />
                </View>
              );
            }

            if (item.type === "separator") {
              return (
                <View style={styles.separatorContainer}>
                  <View style={styles.separatorLine} />
                  <Text style={styles.separatorText}>
                    {item.count === 0
                      ? "No replies yet"
                      : `${item.count} ${item.count === 1 ? "reply" : "replies"}`}
                  </Text>
                  <View style={styles.separatorLine} />
                </View>
              );
            }

            // Reply item
            return (
              <View style={styles.replyContainer}>
                <MessageItem
                  message={{
                    _id: item.data._id,
                    channelId: item.data.channelId,
                    senderId: item.data.senderId as Id<"users">,
                    content: item.data.content || "",
                    contentType: item.data.contentType || "text",
                    attachments: item.data.attachments,
                    createdAt: item.data.createdAt,
                    editedAt: item.data.editedAt,
                    isDeleted: item.data.isDeleted,
                    senderName: item.data.senderName,
                    senderProfilePhoto: item.data.senderProfilePhoto,
                  }}
                  currentUserId={currentUserId}
                  onLongPress={handleLongPressMessage}
                />
              </View>
            );
          }}
          ListFooterComponent={
            repliesLoading ? (
              <View style={styles.loadingReplies}>
                <ActivityIndicator size="small" color={primaryColor} />
              </View>
            ) : null
          }
          contentContainerStyle={styles.listContent}
        />
      </View>

      {/* Reply input - always send as a reply to parent message */}
      {/* Use parentMessage.channelId for reliability - it's guaranteed valid after loading */}
      <MessageInput
        channelId={parentMessage.channelId as Id<"chatChannels">}
        replyToMessage={{
          _id: parentMessage._id,
          content: parentMessage.content,
          senderName: parentMessage.senderName || "Unknown",
        }}
        hideReplyPreview
      />

      {/* Message Actions Overlay */}
      {selectedMessageId && (
        <MessageActionsOverlay
          visible={overlayVisible}
          message={{
            _id: String(selectedMessageId),
            content: selectedMessageContent,
            senderName: selectedMessageSenderName,
            senderProfilePhoto: selectedMessageSenderPhoto,
            attachments: selectedMessageAttachments,
          }}
          actionHandlers={{
            toggleReaction: async (emoji: string) => {
              if (!selectedMessageId || !token) return;
              try {
                await toggleReactionMutation({
                  token,
                  messageId: selectedMessageId,
                  emoji,
                });
              } catch (error) {
                console.error("[ThreadPage] Failed to toggle reaction:", error);
              }
            },
            copyMessage: async () => {
              if (!selectedMessageContent) return;
              try {
                await Clipboard.setStringAsync(selectedMessageContent);
              } catch (error) {
                console.error("[ThreadPage] Failed to copy message:", error);
                Alert.alert("Error", "Failed to copy message. Please try again.");
              }
            },
            deleteMessage: () => handleMessageDelete(selectedMessageId),
            flagMessage: handleFlagMessage,
            blockUser: async () => {
              // TODO: Implement block user if needed
              setOverlayVisible(false);
            },
          }}
          onClose={handleOverlayClose}
          isOwnMessage={selectedMessageSenderId === currentUserId}
          isUserLeader={isUserLeader}
          hideReplyAction
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    flex: 1,
    backgroundColor: "#f9f9f9",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
  },
  errorText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  errorSubtext: {
    fontSize: 14,
    color: "#666",
  },
  listContent: {
    paddingBottom: 16,
  },
  parentMessageContainer: {
    backgroundColor: "#fff",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E0E0E0",
  },
  separatorContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#E0E0E0",
  },
  separatorText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#999",
    marginHorizontal: 12,
    textTransform: "uppercase",
  },
  replyContainer: {
    paddingVertical: 4,
  },
  loadingReplies: {
    padding: 16,
    alignItems: "center",
  },
});
