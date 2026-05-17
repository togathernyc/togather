/**
 * Notification Feed Screen
 *
 * Lists the user's non-chat notifications newest-first. Unread rows are
 * visually highlighted; each row shows a type-derived icon, title, body, and
 * relative time. Tapping a row marks it read and deep-links via the shared
 * `resolveNotificationNavigation` helper — the same resolver push-notification
 * taps use, so an in-app tap opens the same screen as the OS-shade tap.
 *
 * The `list` query is offset/limit based (not Convex-native pagination), so
 * "load more" simply grows the requested limit; Convex re-runs the query
 * reactively and the larger window streams back.
 */
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, api, useStoredAuthToken } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { EmptyState } from "@components/ui";
import { useMarkRead, useMarkAllRead } from "../hooks";
import { resolveNotificationNavigation } from "../utils/resolveNotificationNavigation";
import {
  iconForNotificationType,
  formatRelativeTime,
} from "../utils/notificationDisplay";

const PAGE_SIZE = 30;

type NotificationItem = {
  id: Id<"notifications">;
  notificationType: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  isRead: boolean;
  createdAt: number;
};

export function NotificationFeedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const token = useStoredAuthToken();
  const { colors, isDark } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  // Grow the limit to "load more". The query stays a single reactive
  // subscription that simply returns a wider window each time.
  const [limit, setLimit] = useState(PAGE_SIZE);

  const result = useQuery(
    api.functions.notifications.queries.list,
    token ? { token, limit } : "skip",
  );

  const notifications = (result?.notifications ?? []) as NotificationItem[];
  const unreadCount = result?.unreadCount ?? 0;
  const isLoading = result === undefined;
  // The list query caps each page at `totalCount`; if we received a full
  // window there may be more behind it.
  const canLoadMore = notifications.length >= limit;

  const handlePress = useCallback(
    async (item: NotificationItem) => {
      if (!item.isRead) {
        // Fire-and-forget — navigation shouldn't wait on the read write.
        markRead({ notificationId: item.id }).catch(() => {});
      }
      // DB notification rows keep the type in the `notificationType`
      // column; `data` often omits it. Surface it so the resolver can
      // route types like join_request_approved / group_creation_approved.
      await resolveNotificationNavigation({
        ...(item.data ?? {}),
        type: item.data?.type ?? item.notificationType,
      });
    },
    [markRead],
  );

  const handleMarkAllRead = useCallback(() => {
    markAllRead().catch(() => {});
  }, [markAllRead]);

  const renderItem = useCallback(
    ({ item }: { item: NotificationItem }) => {
      const unreadBg = isDark ? colors.surfaceSecondary : "#F0F7FF";
      return (
        <Pressable
          onPress={() => handlePress(item)}
          accessibilityRole="button"
          accessibilityLabel={`${item.title}${item.isRead ? "" : ", unread"}`}
        >
          {({ pressed }) => (
            <View
              style={[
                styles.row,
                {
                  backgroundColor: pressed
                    ? colors.surfaceSecondary
                    : item.isRead
                      ? colors.surface
                      : unreadBg,
                },
              ]}
            >
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: primaryColor + (isDark ? "33" : "1A") },
                ]}
              >
                <Ionicons
                  name={iconForNotificationType(item.notificationType)}
                  size={20}
                  color={primaryColor}
                />
              </View>
              <View style={styles.rowContent}>
                <View style={styles.rowTopLine}>
                  <Text
                    style={[
                      styles.rowTitle,
                      { color: colors.text },
                      !item.isRead && styles.rowTitleUnread,
                    ]}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  <Text
                    style={[styles.rowTime, { color: colors.textTertiary }]}
                  >
                    {formatRelativeTime(item.createdAt)}
                  </Text>
                </View>
                {item.body ? (
                  <Text
                    style={[styles.rowBody, { color: colors.textSecondary }]}
                    numberOfLines={2}
                  >
                    {item.body}
                  </Text>
                ) : null}
              </View>
              {!item.isRead ? (
                <View
                  style={[styles.unreadDot, { backgroundColor: primaryColor }]}
                />
              ) : null}
            </View>
          )}
        </Pressable>
      );
    },
    [colors, isDark, primaryColor, handlePress],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      {/* Custom header: a back affordance + "Mark all read" action. No big
          screen title — the back row already establishes context. */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.headerBack}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
          <Text style={[styles.headerBackText, { color: colors.text }]}>
            Notifications
          </Text>
        </Pressable>
        {unreadCount > 0 ? (
          <Pressable
            onPress={handleMarkAllRead}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Mark all notifications read"
          >
            <Text style={[styles.markAllText, { color: primaryColor }]}>
              Mark all read
            </Text>
          </Pressable>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={primaryColor} />
        </View>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon="notifications-outline"
          title="No notifications yet"
          message="Updates from your groups and events will show up here."
        />
      ) : (
        <FlatList
          data={notifications}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (canLoadMore) setLimit((l) => l + PAGE_SIZE);
          }}
          ListFooterComponent={
            canLoadMore ? (
              <View style={styles.footer}>
                <ActivityIndicator color={primaryColor} />
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  headerBack: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerBackText: {
    fontSize: 20,
    fontWeight: "700",
    marginLeft: 2,
  },
  markAllText: {
    fontSize: 14,
    fontWeight: "600",
    paddingHorizontal: 4,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  listContent: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
  },
  rowTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "600",
    flexShrink: 1,
    marginRight: 8,
  },
  rowTitleUnread: {
    fontWeight: "700",
  },
  rowTime: {
    fontSize: 12,
    flexShrink: 0,
  },
  rowBody: {
    fontSize: 14,
    marginTop: 2,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 10,
  },
  footer: {
    paddingVertical: 16,
  },
});
