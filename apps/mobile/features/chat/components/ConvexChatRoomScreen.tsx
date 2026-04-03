/**
 * Convex Chat Room Screen
 * 
 * Replaces StreamChat-based ChatRoomScreen with Convex-native messaging.
 * Uses Convex hooks and components for all messaging functionality.
 */

import React, { useCallback, useState, useEffect, useMemo, useRef } from "react";
import {
  View,
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Pressable,
  Share,
  ActionSheetIOS,
  InteractionManager,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { useAuth } from "@providers/AuthProvider";
import { useNotifications } from "@providers/NotificationProvider";
import { useLeaveGroup } from "@features/groups/hooks/useLeaveGroup";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { parseStreamChannelId } from "@togather/shared";
import { DOMAIN_CONFIG } from "@togather/shared";
import type { Id } from "@services/api/convex";
import { useQuery, api } from "@services/api/convex";

// Local components
import { ChatHeader, ChatHeaderPlaceholder } from "./ChatHeader";
import { ChatNavigation, type ChannelTab } from "./ChatNavigation";
import { ChatMenuModal } from "./ChatMenuModal";
import { ExternalChatModal } from "./ExternalChatModal";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { TypingIndicator } from "./TypingIndicator";
import { MessageActionsOverlay } from "./MessageActionsOverlay";
import { ChannelMembersModal } from "@features/channels";
import { SyncResultModal } from "./SyncResultModal";
import { ReachOutScreen } from "./ReachOutScreen";

// Hooks
import { useConvexChannelFromGroup } from "../hooks/useConvexChannelFromGroup";
import { useReadState } from "../hooks/useReadState";
import { useTypingIndicators } from "../hooks/useTypingIndicators";
import { useSendMessage } from "../hooks/useConvexSendMessage";
import { BlockedUsersProvider, useBlockedUsersContext } from "../context/BlockedUsersContext";
import { useMutation, useAction } from "@services/api/convex";
import { useGroupCache } from "@/stores/groupCache";
import { useChannelsCache } from "@/stores/channelsCache";

/**
 * iOS freezes if ActionSheet / Share is presented in the same tick as closing an RN Modal.
 * Defer until interactions + modal teardown complete (see SO #63062133, RN modal stack issues).
 */
function runAfterChatMenuDismiss(action: () => void) {
  InteractionManager.runAfterInteractions(() => {
    setTimeout(action, 320);
  });
}

type ChatRoomParams = {
  chat_id?: string;
  channelId?: string;
  channelSlug?: string; // URL-based routing: "general", "leaders", or custom slug
  channelType?: string; // Legacy: kept for backwards compatibility
  groupId?: string;
  groupName?: string;
  groupType?: string;
  groupTypeId?: string;
  imageUrl?: string;
  isLeader?: string;
  leadersChannelId?: string;
  isAnnouncementGroup?: string;
  externalChatLink?: string;
};

const ConvexChatRoomScreenInner: React.FC = () => {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams() as ChatRoomParams;
  const router = useRouter();
  const pathname = usePathname();
  const { user, token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();
  const { addBlockedUser } = useBlockedUsersContext();

  // Mutations
  const flagMessageMutation = useMutation(api.functions.messaging.flagging.flagMessage);
  const blockUserMutation = useMutation(api.functions.messaging.blocking.blockUser);
  const toggleReactionMutation = useMutation(api.functions.messaging.reactions.toggleReaction);
  const deleteMessageMutation = useMutation(api.functions.messaging.messages.deleteMessage);

  // Actions
  const triggerGroupSyncAction = useAction(api.functions.pcoServices.index.triggerGroupSync);

  // Get channel ID from route - prefer Convex channel ID, fallback to parsing Stream channel ID
  const { chat_id, channelId: directChannelId } = params;
  const channelIdFromRoute = directChannelId || chat_id;
  
  // Check if chat_id is a Convex channel ID vs Stream channel ID
  // Convex IDs are base64url encoded (typically start with letters, no underscores)
  // Stream channel IDs have format like "prod_123" or "staging_456" (with underscores)
  const isConvexChannelId = channelIdFromRoute && 
    !channelIdFromRoute.includes('_') && // Stream IDs have underscores
    channelIdFromRoute.length > 10; // Convex IDs are longer

  // Get group metadata from params
  const {
    groupId: groupIdParam,
    channelSlug: channelSlugParam, // URL-based routing (new)
    channelType: channelTypeParam, // Legacy param (kept for backwards compatibility)
    groupName,
    groupType,
    groupTypeId: groupTypeIdParam,
    imageUrl,
    isLeader,
    isAnnouncementGroup: isAnnouncementGroupParam,
    externalChatLink: externalChatLinkParam,
  } = params;

  // Resolve channel slug - prefer channelSlug, fall back to channelType for backwards compatibility
  const resolvedChannelSlug = channelSlugParam || channelTypeParam;

  // Parse Stream channel ID only if it's not a Convex channel ID
  const parsedChannel = useMemo(() => {
    if (!channelIdFromRoute || isConvexChannelId) return null;
    return parseStreamChannelId(channelIdFromRoute);
  }, [channelIdFromRoute, isConvexChannelId]);

  // Determine group ID (from params or parsed channel)
  // Also check if channelIdFromRoute is actually a group ID
  const groupId = useMemo(() => {
    if (groupIdParam) {
      // Check if it's a legacy UUID (contains dashes) or Convex ID
      if (groupIdParam.includes('-')) {
        // Legacy UUID - need to fetch Convex ID
        return null; // Will be fetched below
      }
      return groupIdParam as Id<"groups">;
    }
    if (parsedChannel?.groupId) {
      return parsedChannel.groupId as Id<"groups">;
    }
    // If channelIdFromRoute matches groupIdParam, it's a group ID, not a channel ID
    // This helps us detect when navigation passed a group ID as chat_id
    if (channelIdFromRoute && groupIdParam && channelIdFromRoute === groupIdParam) {
      return groupIdParam as Id<"groups">;
    }
    return null;
  }, [groupIdParam, parsedChannel, channelIdFromRoute]);

  // Derive active slug from route parameter (URL-based routing)
  // Priority: resolvedChannelSlug > parsedChannel type > default "general"
  const activeSlug: string = useMemo(() => {
    // If we have a channel slug from the URL, use it directly
    if (resolvedChannelSlug) return resolvedChannelSlug;
    // Fallback to parsed channel type if available (legacy Stream URLs)
    if (parsedChannel?.type === "leaders") return "leaders";
    // Default to general
    return "general";
  }, [resolvedChannelSlug, parsedChannel]);

  // Check if this is a custom channel (not general or leaders)
  const isCustomChannel = useMemo(() => {
    return resolvedChannelSlug &&
           resolvedChannelSlug !== "general" &&
           resolvedChannelSlug !== "leaders";
  }, [resolvedChannelSlug]);

  // Fetch group data if we have a legacy UUID
  const groupData = useQuery(
    api.functions.groups.index.getByLegacyIdPublic,
    groupIdParam && groupIdParam.includes('-') && groupIdParam
      ? { legacyId: groupIdParam }
      : "skip"
  );

  // Fallback: Fetch channel to get groupId when navigating from notification with only channelId
  const channelData = useQuery(
    api.functions.messaging.channels.getChannel,
    // Only fetch if we have a Convex channel ID but no group ID
    isConvexChannelId && !groupId && token
      ? { token, channelId: channelIdFromRoute as Id<"chatChannels"> }
      : "skip"
  );

  // Use fetched group ID if we had a legacy UUID, or from channel lookup (notification deep link)
  const resolvedGroupId = useMemo(() => {
    if (groupId) return groupId;
    if (groupData?._id) return groupData._id as Id<"groups">;
    if (channelData?.groupId) return channelData.groupId as Id<"groups">;
    return null;
  }, [groupId, groupData, channelData]);

  // Query all channels for this group - this is the source of truth for tab rendering
  const groupChannels = useQuery(
    api.functions.messaging.channels.listGroupChannels,
    resolvedGroupId && token ? { token, groupId: resolvedGroupId } : "skip"
  );

  // Query for whether the group has PCO auto channels (for sync button visibility)
  const hasPcoChannels = useQuery(
    api.functions.messaging.channels.hasAutoChannels,
    resolvedGroupId && token ? { token, groupId: resolvedGroupId } : "skip"
  );

  // Cache integration for group channels (eliminates tab bar flash)
  const { setGroupChannels: cacheGroupChannels, getGroupChannels: getCachedGroupChannels } = useChannelsCache();

  // Write to cache when live channel data arrives
  useEffect(() => {
    if (groupChannels && resolvedGroupId) {
      cacheGroupChannels(resolvedGroupId, groupChannels);
    }
  }, [groupChannels, resolvedGroupId, cacheGroupChannels]);

  // Read from cache while channels query is loading
  const cachedGroupChannels = groupChannels === undefined && resolvedGroupId
    ? getCachedGroupChannels(resolvedGroupId)
    : null;
  const effectiveGroupChannels = groupChannels ?? cachedGroupChannels;

  // Build channel tabs from the query result (or cache) — member + leader-enabled (tab bar)
  const channelTabs: ChannelTab[] = useMemo(() => {
    if (!effectiveGroupChannels) return [];

    return effectiveGroupChannels
      .filter(
        (channel: any) =>
          channel.isMember && channel.isEnabled !== false
      )
      .map((channel: any) => ({
        slug: channel.slug,
        channelType: channel.channelType,
        name: channel.name,
        unreadCount: channel.unreadCount,
        isShared: channel.isShared || undefined,
      }));
  }, [effectiveGroupChannels]);

  // Get Convex channel IDs for main and leaders
  const mainChannelId = useConvexChannelFromGroup(resolvedGroupId, "main");
  const leadersChannelId = useConvexChannelFromGroup(resolvedGroupId, "leaders");

  // Query channel by slug for custom channels
  const channelBySlug = useQuery(
    api.functions.messaging.channels.getChannelBySlug,
    // Only query if we have a custom channel slug (not general or leaders)
    resolvedGroupId && token && isCustomChannel && resolvedChannelSlug
      ? { token, groupId: resolvedGroupId, slug: resolvedChannelSlug }
      : "skip"
  );

  // Active channel: derive from URL-based routing
  // With URL-based routing, the slug is the source of truth
  // If user doesn't have access to leaders channel, fallback to general
  const activeChannelId = useMemo(() => {
    // PRIORITY 1: Use directly passed channelId from navigation (enables prefetch usage)
    // This is set by GroupedInboxItem to allow immediate use of prefetched data
    if (isConvexChannelId && directChannelId) {
      return directChannelId as Id<"chatChannels">;
    }

    // For custom channels, use the channel from slug query
    if (isCustomChannel && channelBySlug?._id) {
      return channelBySlug._id;
    }

    // Use slug-based selection for standard channels - activeSlug is derived from URL
    let channelId = activeSlug === "general" ? mainChannelId : leadersChannelId;

    // Fallback: if leaders slug is requested but user doesn't have access,
    // use main channel instead to prevent infinite loading
    if (activeSlug === "leaders" && leadersChannelId === null && mainChannelId) {
      channelId = mainChannelId;
    }

    return channelId;
  }, [activeSlug, resolvedChannelSlug, isCustomChannel, mainChannelId, leadersChannelId, channelBySlug, isConvexChannelId, directChannelId]);

  // Fetch group details for display (with token to get user's role)
  const groupDetailsRaw = useQuery(
    api.functions.groups.index.getById,
    resolvedGroupId && token ? { groupId: resolvedGroupId, token } : "skip"
  );

  // Cache integration for group details (eliminates toolbar flash)
  const { setGroupDetails: cacheGroupDetails, getGroupDetails: getCachedGroupDetails } = useGroupCache();
  const cachedGroupDetailsRef = useRef<any>(null);
  const cachedGroupIdRef = useRef<string | null>(null);

  // Write to cache when live data arrives
  useEffect(() => {
    if (groupDetailsRaw && resolvedGroupId) {
      cacheGroupDetails(resolvedGroupId, groupDetailsRaw);
    }
  }, [groupDetailsRaw, resolvedGroupId, cacheGroupDetails]);

  // Read from cache while query is loading (compute once, store in ref)
  // Reset cached data when resolvedGroupId changes to avoid showing stale data from a different group
  if (resolvedGroupId !== cachedGroupIdRef.current) {
    cachedGroupDetailsRef.current = null;
    cachedGroupIdRef.current = resolvedGroupId;
  }
  if (groupDetailsRaw === undefined && resolvedGroupId && !cachedGroupDetailsRef.current) {
    cachedGroupDetailsRef.current = getCachedGroupDetails(resolvedGroupId);
  }
  if (groupDetailsRaw !== undefined) {
    cachedGroupDetailsRef.current = null; // Clear ref once live data arrives
  }
  const groupDetails = groupDetailsRaw ?? cachedGroupDetailsRef.current;

  // Computed display values
  const displayName = groupName || groupDetails?.name || groupData?.name || "Chat";
  const displayType =
    groupType || groupDetails?.groupTypeName || groupData?.groupTypeName || "";
  const displayImage = imageUrl || groupDetails?.preview || groupData?.preview || "";
  // Determine leader status from backend data - this is the source of truth for authorization.
  // While loading, use channelTypeParam as a hint to avoid UI flash (if navigating to leaders
  // channel, user must be a leader since notifications only go to leaders).
  // Once backend data loads, it becomes authoritative and overrides any initial hint.
  const isRoleLoading = groupDetails === undefined && groupData === undefined;
  const isUserLeader =
    groupDetails?.userRole === "leader" ||
    groupDetails?.userRole === "admin" ||
    groupData?.userRole === "leader" ||
    groupData?.userRole === "admin" ||
    // While loading, show leaders tab if navigating to leaders channel (avoids flash)
    (isRoleLoading && channelTypeParam === "leaders") ||
    false;
  // Community admins can delete any message in groups within their community
  const isCommunityAdmin = user?.is_admin === true;
  const hasGroup = !!resolvedGroupId;
  // Get user role for toolbar visibility
  const userRole = (groupDetails?.userRole || groupData?.userRole) as "admin" | "leader" | "member" | undefined;
  // Type for group with visibility settings
  type GroupWithVisibility = typeof groupDetails & {
    showToolbarToMembers?: boolean;
    toolVisibility?: Record<string, string>;
    toolDisplayNames?: Record<string, string>;
  };
  const groupWithVisibility = groupDetails as GroupWithVisibility | null;
  // Show toolbar to leaders/admins always, or to members if enabled
  const showLeaderTools = hasGroup && (
    isUserLeader ||
    (groupWithVisibility?.showToolbarToMembers === true)
  );
  // SECURITY: externalChatLink may be undefined for non-members (gated by backend)
  const externalChatLink = externalChatLinkParam || (groupDetails as any)?.externalChatLink || null;

  // Convert groupTypeId to a numeric value for color scheme lookup
  // Convex IDs are base64url strings, so we use a hash-based approach for non-numeric IDs
  const parseGroupTypeId = (id: string | number | undefined | null): number => {
    if (id == null) return 3; // Default
    if (typeof id === 'number') return id;
    // Try parsing as numeric string first
    const parsed = parseInt(id, 10);
    if (!isNaN(parsed)) return parsed;
    // For Convex string IDs, use a hash to get a consistent color
    const hash = id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return (hash % 10) + 1; // Returns 1-10 for color palette
  };

  const groupTypeIdSource = groupTypeIdParam || groupDetails?.groupTypeId || groupData?.groupTypeId;
  const groupTypeId = parseGroupTypeId(groupTypeIdSource);
  const isAnnouncementGroup = isAnnouncementGroupParam === "1" || groupDetails?.isAnnouncementGroup || false;
  const canSendMessages = !isAnnouncementGroup || isUserLeader;

  // Determine if the active channel is a reach_out channel
  const isReachOutChannel = useMemo(() => {
    const activeTab = channelTabs.find((t) => t.slug === activeSlug);
    return activeTab?.channelType === "reach_out";
  }, [channelTabs, activeSlug]);

  // UI state
  const [menuVisible, setMenuVisible] = useState(false);
  const [externalChatModalVisible, setExternalChatModalVisible] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayReactionsOnly, setOverlayReactionsOnly] = useState(false);
  const [overlayTapY, setOverlayTapY] = useState<number | undefined>();
  const [membersModalChannel, setMembersModalChannel] = useState<{ channelId: Id<"chatChannels">; name: string; slug: string } | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<Id<"chatMessages"> | null>(null);
  const [selectedMessageSenderId, setSelectedMessageSenderId] = useState<Id<"users"> | null>(null);
  const [selectedMessageContent, setSelectedMessageContent] = useState<string>("");
  const [selectedMessageSenderName, setSelectedMessageSenderName] = useState<string | undefined>();
  const [selectedMessageSenderPhoto, setSelectedMessageSenderPhoto] = useState<string | undefined>();
  const [selectedMessageAttachments, setSelectedMessageAttachments] = useState<Array<{ type: string; url: string }> | undefined>();
  const [replyToMessageId, setReplyToMessageId] = useState<Id<"chatMessages"> | null>(null);

  // Sync modal state
  const [syncModalVisible, setSyncModalVisible] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResults, setSyncResults] = useState<Array<{
    channelName: string;
    status: "synced" | "skipped" | "error";
    addedCount: number;
    removedCount: number;
    reason?: string;
  }> | null>(null);

  // Hooks
  // activeChannelId is now guaranteed to be a channel ID (or null/undefined), not a group ID
  // Convert undefined to null for hooks that expect Id<"chatChannels"> | null
  const channelIdForHooks = activeChannelId ?? null;
  const { markAsRead } = useReadState(channelIdForHooks);
  const { typingUsers } = useTypingIndicators(channelIdForHooks);
  // Message sending with optimistic updates and offline queue
  const { sendMessage, optimisticMessages, isSending, retryMessage, dismissMessage } = useSendMessage(
    channelIdForHooks,
    resolvedGroupId
  );
  const currentUserId = user?.id as Id<"users"> | undefined;

  // Mark messages as read when viewing (only if we have a valid channel ID)
  useEffect(() => {
    if (activeChannelId && currentUserId) {
      markAsRead();
    }
  }, [activeChannelId, currentUserId, markAsRead]);

  // Redirect to general if user accessed leaders URL but leaders channel doesn't exist
  // This keeps the URL in sync with the actual channel being displayed
  // Only redirect when:
  // 1. User is on leaders slug
  // 2. Leaders channel lookup has COMPLETED (null, not undefined/loading) and channel not found
  // 3. Main channel exists (we have somewhere to redirect to)
  useEffect(() => {
    if (
      activeSlug === "leaders" &&
      leadersChannelId === null && // null = query completed, channel not found (not undefined = still loading)
      mainChannelId &&
      resolvedGroupId
    ) {
      // Leaders channel doesn't exist - redirect to general with preserved params
      router.replace({
        pathname: `/inbox/${resolvedGroupId}/general` as any,
        params: {
          groupName: displayName,
          groupType: displayType,
          groupTypeId: groupTypeIdSource || "",
          imageUrl: displayImage,
          isLeader: isUserLeader ? "1" : "0",
          isAnnouncementGroup: isAnnouncementGroup ? "1" : "0",
          externalChatLink: externalChatLink || "",
        },
      });
    }
  }, [activeSlug, leadersChannelId, mainChannelId, resolvedGroupId, router, displayName, displayType, groupTypeIdSource, displayImage, isUserLeader, isAnnouncementGroup, externalChatLink]);

  // Track active channel for notification suppression
  // When viewing a channel, suppress push notification banners for that channel
  const { setActiveChannelId } = useNotifications();
  useEffect(() => {
    if (activeChannelId) {
      setActiveChannelId(activeChannelId);
    }
    // Clear active channel when leaving this screen
    return () => {
      setActiveChannelId(null);
    };
  }, [activeChannelId, setActiveChannelId]);

  // Leave group mutation
  const leaveGroupMutation = useLeaveGroup();

  const handleLeaveGroup = useCallback(() => {
    setMenuVisible(false);
    if (!resolvedGroupId || !user?.id) return;

    Alert.alert(
      "Leave Group",
      `Are you sure you want to leave ${displayName}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () => {
            leaveGroupMutation.mutate({ groupId: resolvedGroupId, userId: String(user.id) });
          },
        },
      ]
    );
  }, [resolvedGroupId, user?.id, displayName, setMenuVisible, leaveGroupMutation]);

  // Handle tab change - uses URL-based routing
  // Preserve all navigation params to prevent state loss during tab switches
  const handleTabChange = useCallback(
    (slug: string) => {
      // Clear reply when switching tabs
      setReplyToMessageId(null);
      // Navigate via URL for URL-based tab routing, preserving params
      if (resolvedGroupId) {
        router.replace({
          pathname: `/inbox/${resolvedGroupId}/${slug}` as any,
          params: {
            groupName: displayName,
            groupType: displayType,
            groupTypeId: groupTypeIdSource || "",
            imageUrl: displayImage,
            isLeader: isUserLeader ? "1" : "0",
            isAnnouncementGroup: isAnnouncementGroup ? "1" : "0",
            externalChatLink: externalChatLink || "",
          },
        });
      }
    },
    [resolvedGroupId, router, displayName, displayType, groupTypeIdSource, displayImage, isUserLeader, isAnnouncementGroup, externalChatLink]
  );

  // Navigation handlers
  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push("/(tabs)/chat");
    }
  }, [router]);

  const getGroupIdForNavigation = useCallback(() => {
    return resolvedGroupId;
  }, [resolvedGroupId]);

  const handleGoToMembers = useCallback(() => {
    setMenuVisible(false);
    const id = getGroupIdForNavigation();
    if (id) {
      router.push(`/(user)/leader-tools/${id}/members`);
    }
  }, [router, getGroupIdForNavigation]);

  const handleGoToEvents = useCallback(() => {
    setMenuVisible(false);
    const id = getGroupIdForNavigation();
    const name = groupDetails?.name || groupData?.name || 'Group';
    if (id) {
      router.push(`/(user)/group-events?groupId=${id}&groupName=${encodeURIComponent(name)}`);
    }
  }, [router, getGroupIdForNavigation, groupDetails?.name, groupData?.name]);

  const handleGoToAttendance = useCallback(() => {
    setMenuVisible(false);
    const id = getGroupIdForNavigation();
    if (id) {
      router.push(`/(user)/leader-tools/${id}/attendance`);
    }
  }, [router, getGroupIdForNavigation]);

  const handleGoToFollowup = useCallback(() => {
    setMenuVisible(false);
    const id = getGroupIdForNavigation();
    if (id) {
      router.push(`/(user)/leader-tools/${id}/followup`);
    }
  }, [router, getGroupIdForNavigation]);

  const handleGoToBots = useCallback(() => {
    setMenuVisible(false);
    const id = getGroupIdForNavigation();
    if (id) {
      router.push(`/(user)/leader-tools/${id}/bots`);
    }
  }, [router, getGroupIdForNavigation]);

  const handleGoToTasks = useCallback(() => {
    setMenuVisible(false);
    const id = getGroupIdForNavigation();
    const encodedReturnTo = encodeURIComponent(pathname);
    if (id) {
      router.push(`/(user)/leader-tools/${id}/tasks?returnTo=${encodedReturnTo}`);
      return;
    }
    router.push(`/tasks?returnTo=${encodedReturnTo}`);
  }, [router, getGroupIdForNavigation, pathname]);

  const handleGoToRunSheet = useCallback(() => {
    setMenuVisible(false);
    const id = getGroupIdForNavigation();
    if (id) {
      router.push(`/(user)/leader-tools/${id}/run-sheet`);
    }
  }, [router, getGroupIdForNavigation]);

  // Handle PCO sync for auto channels
  const handleSyncPress = useCallback(async () => {
    if (!resolvedGroupId || !token) return;

    setSyncLoading(true);
    setSyncModalVisible(true);
    setSyncResults(null);

    try {
      const result = await triggerGroupSyncAction({
        token,
        groupId: resolvedGroupId,
      });
      setSyncResults(result.results);
    } catch (error) {
      console.error("[ConvexChatRoomScreen] Failed to sync:", error);
      setSyncResults([{
        channelName: "Sync Error",
        status: "error",
        addedCount: 0,
        removedCount: 0,
        reason: error instanceof Error ? error.message : "Unknown error",
      }]);
    } finally {
      setSyncLoading(false);
    }
  }, [resolvedGroupId, token, triggerGroupSyncAction]);

  // Unified handler for toolbar tool presses
  const handleToolPress = useCallback((toolId: string) => {
    switch (toolId) {
      case 'attendance':
        handleGoToAttendance();
        break;
      case 'followup':
        handleGoToFollowup();
        break;
      case 'events':
        handleGoToEvents();
        break;
      case 'bots':
        handleGoToBots();
        break;
      case 'tasks':
        handleGoToTasks();
        break;
      case 'runsheet':
        handleGoToRunSheet();
        break;
      case 'sync':
        handleSyncPress();
        break;
    }
  }, [handleGoToAttendance, handleGoToFollowup, handleGoToEvents, handleGoToBots, handleGoToTasks, handleGoToRunSheet, handleSyncPress]);

  // Handle long-press on channel tab to show members modal
  const handleTabLongPress = useCallback((channel: ChannelTab) => {
    // Find the channel ID from groupChannels (live or cached)
    const channelData = effectiveGroupChannels?.find((ch: any) => ch.slug === channel.slug);
    if (channelData) {
      setMembersModalChannel({
        channelId: channelData._id,
        name: channel.channelType === "main" ? "General" : channel.channelType === "leaders" ? "Leaders" : channel.name,
        slug: channelData.slug,
      });
    }
  }, [effectiveGroupChannels]);

  const handleGoToGroupPage = useCallback(() => {
    setMenuVisible(false);
    const id = getGroupIdForNavigation();
    if (id) {
      router.push(`/groups/${id}`);
    }
  }, [router, getGroupIdForNavigation]);

  const handleShareGroup = useCallback(() => {
    setMenuVisible(false);
    runAfterChatMenuDismiss(() => {
      const shortId = (groupDetails as { shortId?: string } | undefined)?.shortId
        ?? (groupData as { shortId?: string } | undefined)?.shortId;
      if (!shortId) {
        Alert.alert("Cannot Share", "This group doesn't have a shareable link yet.");
        return;
      }
      const groupUrl = DOMAIN_CONFIG.groupShareUrl(shortId);
      const groupName = displayName || "Group";

      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ["Cancel", "Copy Link", "Share"],
            cancelButtonIndex: 0,
          },
          async (buttonIndex) => {
            if (buttonIndex === 1) {
              await Clipboard.setStringAsync(groupUrl);
              Alert.alert("Link Copied", "Group link has been copied to clipboard.");
            } else if (buttonIndex === 2) {
              await Share.share({
                message: `${groupName}\n${groupUrl}`,
                url: groupUrl,
              });
            }
          }
        );
      } else {
        void Share.share({
          message: `${groupName}\n${groupUrl}`,
        });
      }
    });
  }, [groupDetails, groupData, displayName]);

  // Message action handlers
  const handleMessageReply = useCallback((messageId: Id<"chatMessages">) => {
    setReplyToMessageId(messageId);
    setOverlayVisible(false);
  }, []);

  const handleMessageReact = useCallback((messageId: Id<"chatMessages">) => {
    // This is called when "React" is tapped from the action sheet
    // The actual reaction toggling happens via the overlay's toggleReaction handler
    setOverlayVisible(false);
  }, []);

  const handleMessageDelete = useCallback(async (messageId: Id<"chatMessages">) => {
    if (!token) return;

    Alert.alert(
      "Delete Message",
      "Are you sure you want to delete this message for everyone?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMessageMutation({
                token,
                messageId,
              });
              setOverlayVisible(false);
            } catch (error) {
              console.error("[ConvexChatRoomScreen] Failed to delete message:", error);
              Alert.alert(
                "Error",
                "Failed to delete message. Please try again.",
                [{ text: "OK" }]
              );
            }
          },
        },
      ]
    );
    setOverlayVisible(false);
  }, [token, deleteMessageMutation]);

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
    setOverlayReactionsOnly(false);
    setOverlayVisible(true);
  }, []);

  const handleDoubleTapMessage = useCallback((
    message: {
      _id: Id<"chatMessages">;
      senderId: Id<"users">;
      content: string;
      senderName?: string;
      senderProfilePhoto?: string;
      attachments?: Array<{ type: string; url: string; name?: string }>;
    },
    event: { nativeEvent: { pageX: number; pageY: number } }
  ) => {
    setSelectedMessageId(message._id);
    setSelectedMessageSenderId(message.senderId);
    setSelectedMessageContent(message.content);
    setSelectedMessageSenderName(message.senderName);
    setSelectedMessageSenderPhoto(message.senderProfilePhoto);
    setSelectedMessageAttachments(message.attachments?.map(a => ({ type: a.type, url: a.url })));
    setOverlayReactionsOnly(true);
    setOverlayTapY(event.nativeEvent.pageY);
    setOverlayVisible(true);
  }, []);

  const handleOverlayClose = useCallback(() => {
    setOverlayVisible(false);
    setOverlayReactionsOnly(false);
    setOverlayTapY(undefined);
    setSelectedMessageId(null);
    setSelectedMessageSenderId(null);
    setSelectedMessageContent("");
    setSelectedMessageSenderName(undefined);
    setSelectedMessageSenderPhoto(undefined);
    setSelectedMessageAttachments(undefined);
  }, []);

  // Flag message handler
  const handleFlagMessage = useCallback(async () => {
    if (!selectedMessageId || !token) return;

    try {
      await flagMessageMutation({
        token,
        messageId: selectedMessageId,
        reason: "inappropriate",
      });
      Alert.alert(
        "Message Reported",
        "Thank you for reporting this message. Our team will review it within 24 hours.",
        [{ text: "OK" }]
      );
      setOverlayVisible(false);
    } catch (error) {
      console.error("[ConvexChatRoomScreen] Failed to flag message:", error);
      Alert.alert(
        "Error",
        "Failed to report message. Please try again.",
        [{ text: "OK" }]
      );
    }
  }, [selectedMessageId, token, flagMessageMutation]);

  // Block user handler
  const handleBlockUser = useCallback(async () => {
    if (!selectedMessageSenderId || !token || !user?.id) return;

    const targetUserId = selectedMessageSenderId;
    const targetUserName = "this user"; // TODO: Get actual user name from message

    Alert.alert(
      "Block User",
      `Are you sure you want to block ${targetUserName}? You won't see their messages anymore.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              await blockUserMutation({
                token,
                blockedId: targetUserId,
              });
              addBlockedUser(targetUserId);
              Alert.alert(
                "User Blocked",
                `${targetUserName} has been blocked. You can unblock them from your settings.`,
                [{ text: "OK" }]
              );
              setOverlayVisible(false);
            } catch (error) {
              console.error("[ConvexChatRoomScreen] Failed to block user:", error);
              Alert.alert(
                "Error",
                "Failed to block user. Please try again.",
                [{ text: "OK" }]
              );
            }
          },
        },
      ]
    );
  }, [selectedMessageSenderId, token, blockUserMutation, addBlockedUser]);

  const handleCancelReply = useCallback(() => {
    setReplyToMessageId(null);
  }, []);

  // Dismiss keyboard when tapping outside input
  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  // Don't render the full UI until essential data is ready. Without this gate,
  // the toolbar and message list flash empty then populate, causing visible jitter.
  // The inbox flow resolves quickly (prefetch + params), notifications may take longer.
  const isEssentialDataReady = resolvedGroupId && activeChannelId != null;

  // Loading state: show placeholder while essential data resolves
  if (!isEssentialDataReady) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <ChatHeaderPlaceholder
          displayName={displayName}
          onBack={handleBack}
          topInset={insets.top}
        />
        <View style={[styles.centered, { backgroundColor: colors.surface }]}>
          <ActivityIndicator
            size="large"
            color={primaryColor}
            testID="loading-indicator"
          />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading chat...</Text>
        </View>
      </View>
    );
  }

  if (!currentUserId) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.surface }]}>
        <Text style={styles.errorText}>Not authenticated</Text>
        <TouchableOpacity style={styles.backButtonError} onPress={handleBack}>
          <Text style={styles.backButtonErrorText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.surface }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <Pressable style={[styles.container, { backgroundColor: colors.surface }]} onPress={Platform.OS === 'web' ? undefined : dismissKeyboard}>
        <ChatHeader
          displayName={displayName}
          displayType={displayType}
          displayImage={displayImage}
          groupTypeId={groupTypeId}
          onBack={handleBack}
          onMenuPress={() => setMenuVisible(true)}
          onGroupPagePress={handleGoToGroupPage}
        />
        <ChatNavigation
          activeSlug={activeSlug}
          channels={channelTabs}
          showLeaderTools={showLeaderTools}
          externalChatLink={externalChatLink}
          onTabChange={handleTabChange}
          onTabLongPress={handleTabLongPress}
          onExternalChatPress={() => setExternalChatModalVisible(true)}
          tools={(groupDetails as { leaderToolbarTools?: string[] } | undefined)?.leaderToolbarTools}
          hasPcoChannels={hasPcoChannels ?? false}
          toolVisibility={groupWithVisibility?.toolVisibility}
          toolDisplayNames={groupWithVisibility?.toolDisplayNames}
          userRole={userRole}
          groupId={resolvedGroupId ?? undefined}
          onToolPress={handleToolPress}
        />
        <ChatMenuModal
          visible={menuVisible}
          hasGroup={hasGroup}
          showLeaderTools={showLeaderTools}
          onClose={() => setMenuVisible(false)}
          onMembersPress={handleGoToMembers}
          onEventsPress={handleGoToEvents}
          onAttendancePress={handleGoToAttendance}
          onFollowupPress={handleGoToFollowup}
          onBotsPress={handleGoToBots}
          onGroupPagePress={handleGoToGroupPage}
          onShareGroupPress={handleShareGroup}
          onLeaveGroupPress={handleLeaveGroup}
        />
        <ExternalChatModal
          visible={externalChatModalVisible}
          externalChatLink={externalChatLink}
          onClose={() => setExternalChatModalVisible(false)}
        />

        {/* Reach Out Screen or Standard Chat */}
        {isReachOutChannel && activeChannelId && resolvedGroupId ? (
          <ReachOutScreen
            channelId={activeChannelId}
            groupId={resolvedGroupId}
          />
        ) : (
          <>
            {/* Message List - handles its own loading state when channelId is null */}
            <View style={styles.chatContainer}>
              <MessageList
                channelId={activeChannelId ?? null}
                currentUserId={currentUserId}
                groupId={resolvedGroupId ?? undefined}
                channelName={activeSlug}
                onMessageReply={handleMessageReply}
                onMessageReact={handleMessageReact}
                onMessageDelete={handleMessageDelete}
                onMessageLongPress={handleLongPressMessage}
                onMessageDoubleTap={handleDoubleTapMessage}
                optimisticMessages={optimisticMessages}
                onRetryMessage={retryMessage}
                onDismissMessage={dismissMessage}
              />
            </View>

            {/* Typing Indicator */}
            <TypingIndicator typingUsers={typingUsers} />

            {/* Message Input */}
            {canSendMessages ? (
              <MessageInput
                channelId={activeChannelId ?? null}
                replyToMessage={replyToMessageId ? { _id: replyToMessageId, content: "", senderName: "" } : null}
                onCancelReply={handleCancelReply}
                externalSendMessage={sendMessage}
                externalIsSending={isSending}
              />
            ) : (
              <View style={[styles.readOnlyBanner, { backgroundColor: colors.surfaceSecondary, borderTopColor: colors.border }]}>
                <Text style={[styles.readOnlyText, { color: colors.textSecondary }]}>
                  Only admins can post in this channel. You can react to messages.
                </Text>
              </View>
            )}
          </>
        )}

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
                  console.error("[ConvexChatRoomScreen] Failed to toggle reaction:", error);
                }
              },
              copyMessage: async () => {
                if (!selectedMessageContent) return;
                try {
                  await Clipboard.setStringAsync(selectedMessageContent);
                } catch (error) {
                  console.error("[ConvexChatRoomScreen] Failed to copy message:", error);
                  Alert.alert("Error", "Failed to copy message. Please try again.");
                }
              },
              deleteMessage: () => handleMessageDelete(selectedMessageId),
              quotedReply: () => handleMessageReply(selectedMessageId),
              flagMessage: handleFlagMessage,
              blockUser: handleBlockUser,
            }}
            onClose={handleOverlayClose}
            isOwnMessage={selectedMessageSenderId === currentUserId}
            isUserLeader={isUserLeader}
            isCommunityAdmin={isCommunityAdmin}
            reactionsOnly={overlayReactionsOnly}
            tapY={overlayTapY}
          />
        )}

        {/* Channel Members Modal (long-press on channel tab) */}
        <ChannelMembersModal
          visible={!!membersModalChannel}
          onClose={() => setMembersModalChannel(null)}
          channelId={membersModalChannel?.channelId}
          channelName={membersModalChannel?.name ?? ""}
          groupId={resolvedGroupId}
          channelSlug={membersModalChannel?.slug}
        />

        {/* Sync Result Modal */}
        <SyncResultModal
          visible={syncModalVisible}
          results={syncResults}
          loading={syncLoading}
          onClose={() => {
            setSyncModalVisible(false);
            setSyncResults(null);
          }}
        />
      </Pressable>
    </KeyboardAvoidingView>
  );
};

/**
 * Convex ChatRoomScreen wrapper that provides BlockedUsersContext.
 */
export const ConvexChatRoomScreen: React.FC = () => {
  return (
    <BlockedUsersProvider>
      <ConvexChatRoomScreenInner />
    </BlockedUsersProvider>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  chatContainer: {
    flex: 1,
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
  },
  errorText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#e74c3c",
    marginBottom: 8,
    textAlign: "center",
  },
  backButtonError: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonErrorText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  readOnlyBanner: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
  },
  readOnlyText: {
    fontSize: 14,
    textAlign: "center",
  },
});

