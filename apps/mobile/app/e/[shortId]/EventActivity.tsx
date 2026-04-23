/**
 * EventActivity
 *
 * Inline "Activity" feed that lives on the event page (Partiful-style) —
 * renders chat messages below the event details with a sticky bottom composer.
 * Replaces the previous standalone chat-room route (`/inbox/{groupId}/event-…`).
 *
 * Embedded inside the event page's ScrollView, so this uses a plain mapped
 * message list (not a virtualized FlatList) to avoid nesting VirtualizedLists.
 * For v1 we cap at 100 messages per page and expose a "Load earlier messages"
 * button when the server reports more.
 *
 * Sending flow:
 *   - If no channel exists yet (getChannelByMeetingId returned null), calls
 *     openEventChat on first send to materialize the channel row, then sends.
 *   - Subsequent sends reuse the channelId.
 *
 * Permission gate: `canAccess` is computed by the parent (host + RSVPer with
 * an enabled option). The backend is authoritative — this is just UI gating.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useQuery,
  useAuthenticatedMutation,
  useMutation,
  api,
  type Id,
} from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { MessageItem } from "@/features/chat/components/MessageItem";
import { ReactionsProvider } from "@/features/chat/context/ReactionsContext";
import { useAuth } from "@/providers/AuthProvider";

const PAGE_SIZE = 100;

export interface EventActivityProps {
  meetingId: Id<"meetings">;
  groupId: Id<"groups">;
  shortId: string;
  currentUserId: Id<"users">;
  /** Host + RSVPer-with-enabled-option. Caller computes this. */
  canAccess: boolean;
  /** From getChannelByMeetingId → channel.isEnabled; defaults true when no channel yet. */
  isChatEnabled: boolean;
  /** Pre-resolved channel id (if the channel exists). Null = no channel yet; will materialize on first send. */
  channelId: Id<"chatChannels"> | null;
  authToken: string;
}

export function EventActivity({
  meetingId,
  groupId,
  shortId: _shortId,
  currentUserId,
  canAccess,
  isChatEnabled,
  channelId: initialChannelId,
  authToken,
}: EventActivityProps) {
  const { colors } = useTheme();
  const { user } = useAuth();

  // Locally track the channelId so that after openEventChat materializes a
  // channel, the message list can start subscribing without waiting for the
  // parent's getChannelByMeetingId query to re-resolve.
  const [channelId, setChannelId] = useState<Id<"chatChannels"> | null>(
    initialChannelId
  );

  // Keep channelId in sync if the parent's query resolves later.
  React.useEffect(() => {
    if (initialChannelId && !channelId) {
      setChannelId(initialChannelId);
    }
  }, [initialChannelId, channelId]);

  // Fetch messages (single-page, ascending). Re-queries reactively as new
  // messages come in since we're watching the latest page.
  const messagesResult = useQuery(
    api.functions.messaging.messages.getMessages,
    channelId && canAccess
      ? {
          token: authToken,
          channelId,
          limit: PAGE_SIZE,
          viewingGroupId: groupId,
        }
      : "skip"
  );

  // Pagination (older messages)
  const [olderMessages, setOlderMessages] = useState<any[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | undefined>(undefined);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [loadOlderCursor, setLoadOlderCursor] = useState<string | undefined>(
    undefined
  );

  const olderResult = useQuery(
    api.functions.messaging.messages.getMessages,
    channelId && canAccess && loadOlderCursor
      ? {
          token: authToken,
          channelId,
          limit: PAGE_SIZE,
          cursor: loadOlderCursor,
          viewingGroupId: groupId,
        }
      : "skip"
  );

  React.useEffect(() => {
    // Seed pagination state from the live page (only on first resolve)
    if (messagesResult && olderCursor === undefined && !loadOlderCursor) {
      setHasMoreOlder(messagesResult.hasMore ?? false);
      setOlderCursor(messagesResult.cursor);
    }
  }, [messagesResult, olderCursor, loadOlderCursor]);

  React.useEffect(() => {
    if (olderResult && loadOlderCursor) {
      const existing = new Set(olderMessages.map((m: any) => m._id));
      const fresh = (olderResult.messages ?? []).filter(
        (m: any) => !existing.has(m._id)
      );
      setOlderMessages((prev) => [...fresh, ...prev]);
      setHasMoreOlder(olderResult.hasMore ?? false);
      setOlderCursor(olderResult.cursor);
      setLoadOlderCursor(undefined);
      setIsLoadingOlder(false);
    }
  }, [olderResult, loadOlderCursor, olderMessages]);

  const liveMessages = messagesResult?.messages ?? [];

  // Merged list, ascending chronological (oldest first)
  const messages = useMemo(() => {
    if (olderMessages.length === 0) return liveMessages;
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const m of olderMessages) {
      if (!seen.has(m._id)) {
        seen.add(m._id);
        merged.push(m);
      }
    }
    for (const m of liveMessages) {
      if (!seen.has(m._id)) {
        seen.add(m._id);
        merged.push(m);
      }
    }
    merged.sort((a, b) => a.createdAt - b.createdAt);
    return merged;
  }, [liveMessages, olderMessages]);

  const messageIds = useMemo<Id<"chatMessages">[]>(
    () => messages.map((m: any) => m._id),
    [messages]
  );

  const handleLoadOlder = useCallback(() => {
    if (isLoadingOlder || !olderCursor || !hasMoreOlder) return;
    setIsLoadingOlder(true);
    setLoadOlderCursor(olderCursor);
  }, [olderCursor, hasMoreOlder, isLoadingOlder]);

  // -------------------- Composer --------------------
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const openEventChatMutation = useAuthenticatedMutation(
    api.functions.messaging.eventChat.openEventChat
  );
  const sendMessageMutation = useMutation(
    api.functions.messaging.messages.sendMessage
  );

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (isSending) return;

    setIsSending(true);
    try {
      // Materialize channel if needed
      let cid = channelId;
      if (!cid) {
        const { channelId: newChannelId } = await openEventChatMutation({
          meetingId,
        });
        cid = newChannelId;
        setChannelId(newChannelId);
      }

      await sendMessageMutation({
        token: authToken,
        channelId: cid,
        content: trimmed,
      });
      setText("");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not send message";
      if (Platform.OS === "web") {
        window.alert(message);
      } else {
        Alert.alert("Message failed", message);
      }
    } finally {
      setIsSending(false);
    }
  }, [
    text,
    isSending,
    channelId,
    openEventChatMutation,
    sendMessageMutation,
    authToken,
    meetingId,
  ]);

  // -------------------- Render --------------------
  if (!canAccess) return null;

  const messageCount = messages.length;
  // Hide the query-loading state before the channel exists — that's just the
  // "no channel yet" state, not a spinner case.
  const isLoadingMessages =
    channelId !== null && canAccess && messagesResult === undefined;

  return (
    <View style={styles.root}>
      <View style={styles.headingRow}>
        <Text style={[styles.heading, { color: colors.text }]}>Activity</Text>
        {messageCount > 0 && (
          <Text style={[styles.subLabel, { color: colors.textSecondary }]}>
            {messageCount} {messageCount === 1 ? "update" : "updates"}
          </Text>
        )}
      </View>

      {/* Load earlier */}
      {hasMoreOlder && !isLoadingMessages && (
        <TouchableOpacity
          style={styles.loadEarlierButton}
          onPress={handleLoadOlder}
          disabled={isLoadingOlder}
        >
          {isLoadingOlder ? (
            <ActivityIndicator size="small" color={DEFAULT_PRIMARY_COLOR} />
          ) : (
            <Text
              style={[
                styles.loadEarlierText,
                { color: DEFAULT_PRIMARY_COLOR },
              ]}
            >
              Load earlier messages
            </Text>
          )}
        </TouchableOpacity>
      )}

      {/* Messages list (ascending). Wrap in ReactionsProvider so MessageItem's
          useReactions reads from the batched context (one query for all
          messages, not one per message). */}
      <ReactionsProvider messageIds={messageIds} channelId={channelId}>
        {isLoadingMessages ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator size="small" color={DEFAULT_PRIMARY_COLOR} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Text
              style={[styles.emptyText, { color: colors.textSecondary }]}
            >
              No messages yet. Be the first to say something.
            </Text>
          </View>
        ) : (
          <View style={styles.messagesList}>
            {messages.map((msg: any) => (
              <MessageItem
                key={msg._id}
                message={{
                  _id: msg._id,
                  channelId: msg.channelId,
                  senderId: msg.senderId,
                  content: msg.content || "",
                  contentType: msg.contentType || "text",
                  attachments: msg.attachments,
                  createdAt: msg.createdAt,
                  editedAt: msg.editedAt,
                  isDeleted: msg.isDeleted,
                  senderName: msg.senderName,
                  senderProfilePhoto: msg.senderProfilePhoto,
                  mentionedUserIds: msg.mentionedUserIds,
                  threadReplyCount: msg.threadReplyCount,
                  hideLinkPreview: msg.hideLinkPreview,
                  reachOutRequestId: msg.reachOutRequestId,
                  taskId: msg.taskId,
                  blastId: msg.blastId,
                }}
                currentUserId={currentUserId}
                groupId={groupId}
              />
            ))}
          </View>
        )}
      </ReactionsProvider>

      {/* Composer (hidden when chat disabled). v1: plain text only, no
          attachments / GIFs / voice — parity with the brief. */}
      {isChatEnabled ? (
        <View
          style={[
            styles.composer,
            {
              backgroundColor: colors.surfaceSecondary,
              borderColor: colors.border,
            },
          ]}
        >
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Say something…"
            placeholderTextColor={colors.textSecondary}
            style={[styles.composerInput, { color: colors.text }]}
            multiline
            editable={!isSending}
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={!text.trim() || isSending}
            style={[
              styles.sendButton,
              {
                backgroundColor:
                  text.trim() && !isSending
                    ? DEFAULT_PRIMARY_COLOR
                    : colors.border,
              },
            ]}
            accessibilityLabel="Send message"
          >
            {isSending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="arrow-up" size={20} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <Text
          style={[styles.disabledText, { color: colors.textSecondary }]}
        >
          Chat is disabled
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginTop: 24,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    marginBottom: 12,
  },
  heading: {
    fontSize: 18,
    fontWeight: "600",
  },
  subLabel: {
    fontSize: 13,
  },
  loadEarlierButton: {
    paddingVertical: 10,
    alignItems: "center",
  },
  loadEarlierText: {
    fontSize: 14,
    fontWeight: "600",
  },
  loadingBlock: {
    padding: 24,
    alignItems: "center",
  },
  emptyBlock: {
    padding: 24,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
  },
  messagesList: {
    // Leave MessageItem's own spacing intact. Messages render in ascending
    // order top-to-bottom (newest at the bottom, like Partiful).
  },
  composer: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 8,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
  },
  composerInput: {
    flex: 1,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxHeight: 120,
    minHeight: 36,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  disabledText: {
    marginTop: 16,
    fontSize: 14,
    textAlign: "center",
    fontStyle: "italic",
  },
});
