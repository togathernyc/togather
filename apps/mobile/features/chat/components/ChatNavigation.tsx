/**
 * Chat Navigation Component
 * Contains TabBar (dynamic channel tabs) and Toolbar (quick actions).
 */
import React, { memo, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { getExternalChatInfo } from "../utils/externalChat";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import {
  TOOLBAR_TOOLS,
  DEFAULT_TOOLS,
  isResourceToolId,
  getResourceIdFromToolId,
  type ToolId,
} from "../constants/toolbarTools";

/**
 * Represents a channel tab that can be displayed in the tab bar.
 * This structure matches the output from listGroupChannels query.
 */
export type ChannelTab = {
  slug: string;
  channelType: string;
  name: string;
  unreadCount: number;
  isShared?: boolean;
};

type ChatTabBarProps = {
  /** The slug of the currently active channel */
  activeSlug: string;
  /** List of channels to display as tabs */
  channels: ChannelTab[];
  /** External chat link (optional) */
  externalChatLink: string | null;
  /** Callback when a tab is selected */
  onTabChange: (slug: string) => void;
  /** Callback when a tab is long-pressed (to show members) */
  onTabLongPress?: (channel: ChannelTab) => void;
  /** Callback when external chat button is pressed */
  onExternalChatPress: () => void;
};

export const ChatTabBar = memo(function ChatTabBar({
  activeSlug,
  channels,
  externalChatLink,
  onTabChange,
  onTabLongPress,
  onExternalChatPress,
}: ChatTabBarProps) {
  const { primaryColor } = useCommunityTheme();
  const externalChatInfo = externalChatLink ? getExternalChatInfo(externalChatLink) : null;

  // Helper to get display name for a channel
  const getDisplayName = (channel: ChannelTab): string => {
    if (channel.channelType === "main") return "General";
    if (channel.channelType === "leaders") return "Leaders";
    if (channel.channelType === "reach_out") return channel.name || "Reach Out";
    return channel.name;
  };

  return (
    <View style={styles.tabBar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabBarScrollContent}
      >
        {channels.map((channel) => {
          const isActive = channel.slug === activeSlug;
          const hasUnread = !isActive && channel.unreadCount > 0;
          const displayName = getDisplayName(channel);

          return (
            <TouchableOpacity
              key={channel.slug}
              style={[styles.tab, isActive && { borderBottomColor: primaryColor }]}
              onPress={() => onTabChange(channel.slug)}
              onLongPress={() => onTabLongPress?.(channel)}
              delayLongPress={300}
              activeOpacity={0.7}
            >
              <View style={styles.tabContent}>
                {channel.isShared && (
                  <Ionicons
                    name="link"
                    size={12}
                    color={isActive ? primaryColor : "#8B5CF6"}
                    style={styles.sharedTabIcon}
                  />
                )}
                <Text
                  style={[styles.tabText, isActive && { color: primaryColor }]}
                  numberOfLines={1}
                >
                  {displayName}
                </Text>
                {hasUnread && <View style={styles.unreadDot} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {externalChatInfo && (
        <TouchableOpacity
          style={styles.externalChatTab}
          onPress={onExternalChatPress}
        >
          <Ionicons
            name={externalChatInfo.iconName as keyof typeof Ionicons.glyphMap}
            size={16}
            color={externalChatInfo.color}
          />
          <Text style={[styles.tabText, { color: externalChatInfo.color, marginLeft: 4 }]}>
            Join
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
});

type ChatToolbarProps = {
  showLeaderTools: boolean;
  tools?: string[];           // Ordered list of tool IDs (undefined = default)
  hasPcoChannels?: boolean;   // Filter out "sync" if no PCO channels
  toolVisibility?: Record<string, string>;  // Per-tool visibility settings
  toolDisplayNames?: Record<string, string>; // Custom display names for tools
  userRole?: "admin" | "leader" | "member"; // Current user's role in the group
  groupId?: string;           // Group ID for navigation to settings
  onToolPress: (toolId: string) => void;
};

/**
 * Represents a toolbar item that can be displayed.
 */
type ToolbarItem = {
  id: string;
  icon: string;
  label: string;
  isResource: boolean;
  resourceId?: string;
};

export const ChatToolbar = memo(function ChatToolbar({
  showLeaderTools,
  tools,
  hasPcoChannels,
  toolVisibility,
  toolDisplayNames,
  userRole,
  groupId,
  onToolPress,
}: ChatToolbarProps) {
  const router = useRouter();
  const { token } = useAuth();

  // Check if user is a leader/admin
  const isLeaderOrAdmin = userRole === "leader" || userRole === "admin";

  // Fetch resources for this group
  // Leaders/admins see ALL resources (to manage them), members see only visible ones
  const allResources = useQuery(
    api.functions.groupResources.index.listByGroup,
    token && groupId && isLeaderOrAdmin
      ? { groupId: groupId as Id<"groups">, token }
      : "skip"
  );
  const visibleResources = useQuery(
    api.functions.groupResources.index.getVisibleForUser,
    token && groupId && !isLeaderOrAdmin
      ? { groupId: groupId as Id<"groups">, token }
      : "skip"
  );

  // Use all resources for leaders, visible resources for members
  const resources = isLeaderOrAdmin ? allResources : visibleResources;

  // Use default tools if tools prop is undefined
  const toolsToShow = tools ?? DEFAULT_TOOLS;

  // Build the list of all tool items (built-in tools + resource tools)
  const allToolItems = useMemo(() => {
    if (!toolsToShow) return [];

    return toolsToShow
      .map((toolId): ToolbarItem | null => {
        // Handle resource tools
        if (isResourceToolId(toolId)) {
          const resourceId = getResourceIdFromToolId(toolId);
          const resource = resources?.find((r) => r._id === resourceId);

          // Don't show if resource not found
          if (!resource) return null;

          return {
            id: toolId,
            icon: resource.icon || "document-outline",
            label: resource.title,
            isResource: true,
            resourceId: resource._id,
          };
        }

        // Handle built-in tools
        if (!(toolId in TOOLBAR_TOOLS)) return null;

        const tool = TOOLBAR_TOOLS[toolId as ToolId] as {
          id: string;
          icon: string;
          label: string;
          requiresPco?: boolean;
          defaultVisibility?: "leaders" | "everyone";
        };

        // Filter out PCO-required tools if hasPcoChannels is false
        if (tool.requiresPco && !hasPcoChannels) return null;

        const label = toolDisplayNames?.[toolId] || tool.label;

        // Leaders/admins see all built-in tools
        if (isLeaderOrAdmin) {
          return {
            id: toolId,
            icon: tool.icon,
            label,
            isResource: false,
          };
        }

        // For non-leaders, check visibility settings
        const visibility =
          toolVisibility?.[toolId] ?? tool.defaultVisibility ?? "leaders";

        // Only show tools with "everyone" visibility to non-leaders
        if (visibility !== "everyone") return null;

        return {
          id: toolId,
          icon: tool.icon,
          label,
          isResource: false,
        };
      })
      .filter((item): item is ToolbarItem => item !== null);
  }, [
    toolsToShow,
    resources,
    isLeaderOrAdmin,
    hasPcoChannels,
    toolVisibility,
    toolDisplayNames,
  ]);

  // Handle tool press - navigate to resource page or call onToolPress
  const handleToolPress = (item: ToolbarItem) => {
    if (item.isResource && item.resourceId) {
      router.push(`/(user)/group/${groupId}/resource/${item.resourceId}`);
    } else {
      onToolPress(item.id);
    }
  };

  // Return null if showLeaderTools is false OR if allToolItems is empty
  if (!showLeaderTools || allToolItems.length === 0) return null;

  return (
    <View style={styles.toolbarContainer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.toolbarContent}
        style={styles.toolbarScrollView}
      >
        {allToolItems.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.toolbarItem}
            onPress={() => handleToolPress(item)}
          >
            <Ionicons
              name={item.icon as keyof typeof Ionicons.glyphMap}
              size={18}
              color="#333"
            />
            <Text style={styles.toolbarItemText}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {isLeaderOrAdmin && groupId && (
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() =>
            router.push(`/(user)/leader-tools/${groupId}/toolbar-settings`)
          }
        >
          <Ionicons name="settings-outline" size={18} color="#888" />
        </TouchableOpacity>
      )}
    </View>
  );
});

// Combined navigation component
type ChatNavigationProps = {
  /** The slug of the currently active channel */
  activeSlug: string;
  /** List of channels to display as tabs */
  channels: ChannelTab[];
  /** Whether to show leader tools toolbar */
  showLeaderTools: boolean;
  /** External chat link (optional) */
  externalChatLink: string | null;
  /** Callback when a tab is selected */
  onTabChange: (slug: string) => void;
  /** Callback when a tab is long-pressed (to show members) */
  onTabLongPress?: (channel: ChannelTab) => void;
  /** Callback when external chat button is pressed */
  onExternalChatPress: () => void;
  /** Ordered list of tool IDs to display (undefined = default) */
  tools?: string[];
  /** Whether the group has PCO channels (filters out "sync" if false) */
  hasPcoChannels?: boolean;
  /** Per-tool visibility settings */
  toolVisibility?: Record<string, string>;
  /** Custom display names for tools */
  toolDisplayNames?: Record<string, string>;
  /** Current user's role in the group */
  userRole?: "admin" | "leader" | "member";
  /** Group ID for navigation to toolbar settings */
  groupId?: string;
  /** Callback when a toolbar tool is pressed */
  onToolPress: (toolId: string) => void;
};

export const ChatNavigation = memo(function ChatNavigation({
  activeSlug,
  channels,
  showLeaderTools,
  externalChatLink,
  onTabChange,
  onTabLongPress,
  onExternalChatPress,
  tools,
  hasPcoChannels,
  toolVisibility,
  toolDisplayNames,
  userRole,
  groupId,
  onToolPress,
}: ChatNavigationProps) {
  return (
    <>
      <ChatTabBar
        activeSlug={activeSlug}
        channels={channels}
        externalChatLink={externalChatLink}
        onTabChange={onTabChange}
        onTabLongPress={onTabLongPress}
        onExternalChatPress={onExternalChatPress}
      />
      <ChatToolbar
        showLeaderTools={showLeaderTools}
        tools={tools}
        hasPcoChannels={hasPcoChannels}
        toolVisibility={toolVisibility}
        toolDisplayNames={toolDisplayNames}
        userRole={userRole}
        groupId={groupId}
        onToolPress={onToolPress}
      />
    </>
  );
});

const styles = StyleSheet.create({
  // Tab bar styles
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    paddingHorizontal: 16,
  },
  tabBarScrollContent: {
    flexDirection: "row",
    alignItems: "center",
    flexGrow: 1,
  },
  tab: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginRight: 8,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  tabText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#666",
  },
  sharedTabIcon: {
    marginRight: 4,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FF3B30",
    marginLeft: 6,
  },
  externalChatTab: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginLeft: "auto",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    alignSelf: "center",
  },
  // Toolbar styles
  toolbarContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  toolbarScrollView: {
    flex: 1,
  },
  toolbarContent: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  toolbarItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    backgroundColor: "#fff",
    gap: 6,
  },
  toolbarItemText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
  },
  settingsButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: "center",
    alignItems: "center",
  },
});
