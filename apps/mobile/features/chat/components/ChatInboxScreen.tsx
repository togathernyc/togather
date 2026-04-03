/**
 * Chat Inbox Screen using Convex messaging
 *
 * Lists all user's groups with their channels, using grouped display.
 * Shows channels grouped by group - single channels show simple row,
 * multiple channels (e.g., main + leaders) show group header with indented channel rows.
 */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { useQuery, api, useStoredAuthToken } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { GroupedInboxItem } from "./GroupedInboxItem";
import { useExpandedGroups } from "../hooks/useExpandedGroups";
import { useInboxCache } from "../../../stores/inboxCache";

// Type for the grouped inbox data from getInboxChannels query
type InboxGroup = {
  group: {
    _id: Id<"groups">;
    name: string;
    preview: string | undefined;
    groupTypeId: Id<"groupTypes">;
    groupTypeName: string | undefined;
    groupTypeSlug: string | undefined;
    isAnnouncementGroup: boolean | undefined;
  };
  channels: Array<{
    _id: Id<"chatChannels">;
    slug: string;
    channelType: string;
    name: string;
    lastMessagePreview: string | null;
    lastMessageAt: number | null;
    lastMessageSenderName: string | null;
    lastMessageSenderId: Id<"users"> | null;
    unreadCount: number;
  }>;
  userRole: "leader" | "member";
};

interface ChatInboxScreenProps {
  sidebarMode?: boolean;
  activeGroupId?: string;
  activeChannelSlug?: string;
}

export function ChatInboxScreen({
  sidebarMode,
  activeGroupId,
  activeChannelSlug,
}: ChatInboxScreenProps = {}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { user, community } = useAuth();
  const token = useStoredAuthToken();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();
  const hasCommunity = !!community?.id;
  const { isGroupExpanded, toggleGroupExpanded } = useExpandedGroups();
  const { getInboxChannels, setInboxChannels } = useInboxCache();
  const hasAutoSelected = useRef(false);

  // Get Convex IDs from auth context
  const userId = user?.id as Id<"users"> | undefined;
  const communityId = community?.id as Id<"communities"> | undefined;

  // Debug logging for chat loading issues (dev only)
  if (__DEV__) {
    console.log("[ChatInboxScreen] Auth state:", {
      hasUser: !!user,
      userId,
      hasCommunity: !!community,
      communityId,
      hasToken: !!token,
      tokenPreview: token ? `${token.substring(0, 20)}...` : null,
    });
  }

  // Fetch inbox channels using the new grouped query
  const inboxQueryArgs = useMemo(() => {
    if (!userId || !communityId || !token) {
      return "skip" as const;
    }
    return { token, communityId };
  }, [userId, communityId, token]);

  const inboxChannels = useQuery(
    api.functions.messaging.channels.getInboxChannels,
    inboxQueryArgs
  );

  // Cache inbox data for offline use
  useEffect(() => {
    if (inboxChannels && inboxChannels.length > 0 && communityId) {
      setInboxChannels(communityId, inboxChannels);
    }
  }, [inboxChannels, communityId, setInboxChannels]);

  // Render a single grouped inbox item
  const renderItem = useCallback(
    ({ item }: { item: InboxGroup }) => (
      <GroupedInboxItem
        group={item.group}
        channels={item.channels}
        userRole={item.userRole}
        isExpanded={isGroupExpanded(item.group._id)}
        onToggleExpand={() => toggleGroupExpanded(item.group._id)}
        activeGroupId={sidebarMode ? activeGroupId : undefined}
        activeChannelSlug={sidebarMode ? activeChannelSlug : undefined}
      />
    ),
    [isGroupExpanded, toggleGroupExpanded, sidebarMode, activeGroupId, activeChannelSlug]
  );

  // Key extractor for FlatList
  const keyExtractor = useCallback(
    (item: InboxGroup) => item.group._id,
    []
  );

  const Wrapper = React.Fragment;
  const headerPaddingTop = sidebarMode ? 16 : insets.top + 16;

  // Auto-select first conversation when in sidebar mode and no conversation is active
  useEffect(() => {
    if (!sidebarMode || hasAutoSelected.current) return;
    if (!inboxChannels || inboxChannels.length === 0) return;
    // Only auto-select if we're on the bare /inbox/ route
    if (pathname !== "/inbox" && pathname !== "/inbox/") return;

    const firstGroup = inboxChannels[0];
    const firstChannel = firstGroup.channels[0];
    if (!firstGroup || !firstChannel) return;

    hasAutoSelected.current = true;
    router.replace({
      pathname: `/inbox/${firstGroup.group._id}/${firstChannel.slug}` as any,
      params: {
        groupName: firstGroup.group.name,
        groupType: firstGroup.group.groupTypeName || "",
        groupTypeId: firstGroup.group.groupTypeId,
        imageUrl: firstGroup.group.preview || "",
        isLeader: firstGroup.userRole === "leader" ? "1" : "0",
        isAnnouncementGroup: firstGroup.group.isAnnouncementGroup ? "1" : "0",
        channelId: firstChannel._id,
      },
    });
  }, [sidebarMode, inboxChannels, pathname, router]);

  // Show message when user has no community context
  if (!hasCommunity) {
    return (
      <Wrapper>
        <View style={[styles.container, { backgroundColor: colors.surface }]}>
          <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Inbox</Text>
          </View>
          <View style={styles.centered}>
            <Ionicons
              name="chatbubbles-outline"
              size={48}
              color={colors.iconSecondary}
              style={{ marginBottom: 16 }}
            />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No Community Selected</Text>
            <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
              Join a community to access group chats
            </Text>
          </View>
        </View>
      </Wrapper>
    );
  }

  const isLoading = inboxChannels === undefined;

  // Stale-while-revalidate: show cached data while loading
  let displayChannels = inboxChannels;
  let isStale = false;

  if (isLoading && communityId) {
    const cached = getInboxChannels(communityId);
    if (cached && cached.length > 0) {
      displayChannels = cached;
      isStale = true;
    }
  }

  const showLoadingSpinner = isLoading && !isStale;

  if (showLoadingSpinner) {
    return (
      <Wrapper>
        <View style={[styles.container, { backgroundColor: colors.surface }]}>
          <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Inbox</Text>
          </View>
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={primaryColor} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading your chats...</Text>
          </View>
        </View>
      </Wrapper>
    );
  }

  if (!displayChannels || displayChannels.length === 0) {
    return (
      <Wrapper>
        <View style={[styles.container, { backgroundColor: colors.surface }]}>
          <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Inbox</Text>
          </View>
          <ScrollView contentContainerStyle={styles.centeredScrollContent}>
            <Ionicons
              name="chatbubbles-outline"
              size={48}
              color={colors.iconSecondary}
              style={{ marginBottom: 16 }}
            />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No Groups Yet</Text>
            <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
              Join a group to start chatting
            </Text>
          </ScrollView>
        </View>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Inbox</Text>
        </View>
        <FlatList
          data={displayChannels}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContainer}
          style={styles.list}
        />
      </View>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  centeredScrollContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 16,
    textAlign: "center",
  },
  list: {
    flex: 1,
  },
  listContainer: {
    paddingVertical: 8,
  },
});
