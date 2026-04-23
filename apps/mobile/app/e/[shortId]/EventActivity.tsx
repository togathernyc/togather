/**
 * EventActivity
 *
 * Inline "Activity" feed that lives on the event page (Partiful-style) —
 * renders chat messages below the event details. The composer is rendered
 * separately by the parent (`EventActivityComposer` below) so it can be
 * sticky at the bottom of the viewport and move with the keyboard via the
 * parent's `KeyboardAvoidingView`.
 *
 * Embedded inside the event page's ScrollView, so this uses a plain mapped
 * message list (not a virtualized FlatList) to avoid nesting VirtualizedLists.
 * For v1 we cap at 100 messages per page and expose a "Load earlier messages"
 * button when the server reports more.
 *
 * Permission gate: `canAccess` is computed by the parent (host + RSVPer with
 * an enabled option). The backend is authoritative — this is just UI gating.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import {
  useQuery,
  api,
  type Id,
} from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { ReactionsProvider } from "@/features/chat/context/ReactionsContext";
import { Ionicons } from "@expo/vector-icons";
import { EventComment } from "./EventComment";
import { EventCommentSheet } from "./EventCommentSheet";

const PAGE_SIZE = 100;

export interface EventActivityProps {
  meetingId: Id<"meetings">;
  groupId: Id<"groups">;
  shortId: string;
  /** Event title — threaded down to EventComment so the thread header reads
   *  "Thread / #My Event" instead of the generic "Thread / #event". */
  eventTitle: string;
  currentUserId: Id<"users">;
  /** Host + RSVPer-with-enabled-option. Caller computes this. */
  canAccess: boolean;
  /** From getChannelByMeetingId → channel.isEnabled; defaults true when no channel yet. */
  isChatEnabled: boolean;
  /** Pre-resolved channel id (if the channel exists). Null = still materializing. */
  channelId: Id<"chatChannels"> | null;
  authToken: string;
}

export function EventActivity({
  meetingId: _meetingId,
  groupId,
  shortId,
  eventTitle,
  currentUserId,
  canAccess,
  isChatEnabled,
  channelId,
  authToken,
}: EventActivityProps) {
  const { colors } = useTheme();

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
  const [showCommentSheet, setShowCommentSheet] = useState(false);
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

  // -------------------- Render --------------------
  if (!canAccess) return null;

  const messageCount = messages.length;
  // Hide the query-loading state before the channel exists — that's just the
  // "no channel yet" state, not a spinner case.
  const isLoadingMessages =
    channelId !== null && canAccess && messagesResult === undefined;

  // Partiful-style: newest first. The paginated query returns ascending; reverse
  // for display without mutating the source array.
  const displayMessages = [...messages].reverse();

  return (
    <View style={styles.root}>
      <View style={styles.headingRow}>
        <View style={styles.headingLabelGroup}>
          <Text style={[styles.heading, { color: colors.text }]}>Activity</Text>
          {messageCount > 0 && (
            <Text style={[styles.subLabel, { color: colors.textSecondary }]}>
              {messageCount} {messageCount === 1 ? "update" : "updates"}
            </Text>
          )}
        </View>
        {isChatEnabled && (
          <TouchableOpacity
            style={[
              styles.commentButton,
              { borderColor: colors.border },
            ]}
            onPress={() => setShowCommentSheet(true)}
            accessibilityLabel="Leave a comment"
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={16}
              color={colors.text}
            />
            <Text style={[styles.commentButtonText, { color: colors.text }]}>
              Comment
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Messages list (newest-first). Wrap in ReactionsProvider so
          EventComment's useReactions reads from the batched context. */}
      <ReactionsProvider messageIds={messageIds} channelId={channelId}>
        {isLoadingMessages ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator size="small" color={DEFAULT_PRIMARY_COLOR} />
          </View>
        ) : displayMessages.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Text
              style={[styles.emptyText, { color: colors.textSecondary }]}
            >
              {isChatEnabled
                ? "No comments yet. Be the first to say something."
                : "Comments are disabled"}
            </Text>
          </View>
        ) : (
          <View style={styles.messagesList}>
            {displayMessages.map((msg: any) => (
              <EventComment
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
                  blastId: msg.blastId,
                }}
                currentUserId={currentUserId}
                groupId={groupId}
                eventShortId={shortId}
                eventTitle={eventTitle}
              />
            ))}
          </View>
        )}
      </ReactionsProvider>

      {/* Load earlier — appears at the BOTTOM in newest-first layout. */}
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
              Load earlier comments
            </Text>
          )}
        </TouchableOpacity>
      )}

      <EventCommentSheet
        visible={showCommentSheet}
        onClose={() => setShowCommentSheet(false)}
        channelId={channelId}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginTop: 24,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  headingLabelGroup: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    flexShrink: 1,
  },
  heading: {
    fontSize: 18,
    fontWeight: "600",
  },
  subLabel: {
    fontSize: 13,
  },
  commentButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  commentButtonText: {
    fontSize: 14,
    fontWeight: "500",
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
    // EventComment owns its own padding. Newest comment on top.
  },
});
