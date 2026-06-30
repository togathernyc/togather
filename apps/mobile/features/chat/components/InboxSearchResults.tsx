/**
 * Inbox message search results.
 *
 * Renders the results of `messaging.search.searchMessages` as a tappable list.
 * Each row deep-links to the channel the message lives in, reusing the same
 * routes the normal inbox rows use (`/inbox/{groupId}/{slug}`, `/inbox/dm/{id}`,
 * and `/e/{shortId}` for event channels).
 */

import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import type { Id } from "@services/api/convex";

export type MessageSearchResult = {
  messageId: Id<"chatMessages">;
  /** Set when the hit is a thread reply; null for top-level messages. */
  parentMessageId: Id<"chatMessages"> | null;
  channelId: Id<"chatChannels">;
  channelName: string;
  channelType: string;
  channelSlug: string;
  isAdHoc: boolean;
  groupId: Id<"groups"> | null;
  groupName: string | null;
  meetingShortId: string | null;
  content: string;
  senderId: Id<"users"> | null;
  senderName: string | null;
  createdAt: number;
};

interface InboxSearchResultsProps {
  /** The active (trimmed) search term, used for the empty-state copy. */
  query: string;
  /** Results from the query; `undefined` while the query is in flight. */
  results: MessageSearchResult[] | undefined;
  /**
   * True when the backend stopped before exhausting the index (hit the result
   * or scan cap). We surface a hint so users on large communities know more
   * matches may exist beyond what's shown.
   */
  truncated?: boolean;
}

/**
 * Display label for a result row's header. DMs/group DMs often have an empty
 * `channelName` (DM titles are computed client-side from members), so fall back
 * to the sender's name or a generic label rather than rendering a blank header.
 */
function resultHeaderLabel(result: MessageSearchResult): string {
  if (result.groupName) {
    return `${result.groupName} · ${result.channelName}`;
  }
  if (result.channelName) return result.channelName;
  if (result.isAdHoc || !result.groupId) {
    return result.senderName ?? "Direct message";
  }
  return "Direct message";
}

/** Compact relative time for a search-result row ("3h", "2d", "Apr 8"). */
function formatResultTime(timestamp: number, now: number): string {
  const diffMs = now - timestamp;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function InboxSearchResults({
  query,
  results,
  truncated,
}: InboxSearchResultsProps) {
  const router = useRouter();
  const { colors } = useTheme();

  const openResult = useCallback(
    (result: MessageSearchResult) => {
      // Event channels live on the event page with inline activity.
      if (result.channelType === "event" && result.meetingShortId) {
        router.push(`/e/${result.meetingShortId}?source=app` as any);
        return;
      }
      // When the hit is a thread reply, the reply itself never appears in the
      // main channel list (`getMessages` skips replies), so anchoring on its id
      // would page backward forever and land at the top. Anchor on the parent
      // (which is in the list) and flag the thread to auto-open so the matched
      // reply is shown in context.
      const anchorMessageId = result.parentMessageId ?? result.messageId;
      const openThreadId = result.parentMessageId ?? undefined;

      // Ad-hoc DMs / group DMs have no owning group. `channelName` is often
      // empty for DMs (the title is computed client-side from members), so pass
      // a sensible header label rather than a blank one.
      if (result.isAdHoc || !result.groupId) {
        router.push({
          pathname: `/inbox/dm/${result.channelId}` as any,
          // `messageId` tells the chat screen which message to scroll to and
          // highlight on arrival; `openThreadId` (reply hits only) auto-opens
          // the parent's thread.
          params: {
            groupName: resultHeaderLabel(result),
            messageId: anchorMessageId,
            ...(openThreadId ? { openThreadId } : {}),
          },
        });
        return;
      }
      // Group channels.
      router.push({
        pathname: `/inbox/${result.groupId}/${result.channelSlug}` as any,
        params: {
          groupName: result.groupName ?? "",
          channelId: result.channelId,
          // Scroll to and highlight the matched message on arrival.
          messageId: anchorMessageId,
          ...(openThreadId ? { openThreadId } : {}),
        },
      });
    },
    [router],
  );

  if (results === undefined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="small" color={colors.icon} />
      </View>
    );
  }

  if (results.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons
          name="search-outline"
          size={40}
          color={colors.iconSecondary}
          style={{ marginBottom: 12 }}
        />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>No messages found</Text>
        <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
          No messages match “{query}”
        </Text>
      </View>
    );
  }

  const now = Date.now();

  return (
    <FlatList
      data={results}
      keyExtractor={(item) => item.messageId}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.listContent}
      ListFooterComponent={
        truncated ? (
          <Text style={[styles.truncatedFooter, { color: colors.textSecondary }]}>
            Showing top matches — refine your search to narrow results.
          </Text>
        ) : null
      }
      renderItem={({ item }) => {
        const location = resultHeaderLabel(item);
        const senderPrefix = item.senderName ? `${item.senderName}: ` : "";
        return (
          <Pressable
            onPress={() => openResult(item)}
            style={[styles.row, { borderBottomColor: colors.border }]}
          >
            <View style={styles.rowHeader}>
              <Text
                style={[styles.location, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {location}
              </Text>
              <Text style={[styles.time, { color: colors.textSecondary }]}>
                {formatResultTime(item.createdAt, now)}
              </Text>
            </View>
            <Text style={[styles.snippet, { color: colors.text }]} numberOfLines={2}>
              {senderPrefix}
              {item.content}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingTop: 48,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: "center",
  },
  listContent: {
    paddingBottom: 24,
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  location: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    marginRight: 8,
  },
  time: {
    fontSize: 12,
  },
  snippet: {
    fontSize: 15,
    lineHeight: 20,
  },
  truncatedFooter: {
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
});
