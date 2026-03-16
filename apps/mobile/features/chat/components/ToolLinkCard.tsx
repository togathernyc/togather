/**
 * ToolLinkCard - Compact card for tool links in chat messages
 *
 * Displays a single-row card: [icon] Group Name | Tool Name [>]
 * Much thinner than EventLinkCard — designed for Run Sheet and Resource links.
 */
import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActionSheetIOS,
  Platform,
  Alert,
  Share,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery, api } from '@services/api/convex';
import { DOMAIN_CONFIG } from '@togather/shared';
import * as Clipboard from 'expo-clipboard';
import type { PrefetchedToolData } from '../context/ChatPrefetchContext';

interface ToolLinkCardProps {
  shortId: string;
  isMyMessage?: boolean;
  embedded?: boolean;
  prefetchedData?: PrefetchedToolData | null;
}

export function ToolLinkCard({
  shortId,
  isMyMessage = true,
  embedded = false,
  prefetchedData,
}: ToolLinkCardProps) {
  const router = useRouter();

  // Skip network fetch if we have prefetched data
  const shouldSkipQuery = !!prefetchedData;

  const fetchedData = useQuery(
    api.functions.toolShortLinks.index.getByShortId,
    shouldSkipQuery ? "skip" : { shortId }
  );

  // Use prefetched data or fetched data
  const toolData = prefetchedData
    ? {
        toolType: prefetchedData.toolType,
        groupId: prefetchedData.groupId,
        groupName: prefetchedData.groupName,
        resourceId: prefetchedData.resourceId,
        resourceTitle: prefetchedData.resourceTitle,
        resourceIcon: prefetchedData.resourceIcon,
        taskId: prefetchedData.taskId,
        taskTitle: prefetchedData.taskTitle,
        taskStatus: prefetchedData.taskStatus,
      }
    : fetchedData
    ? {
        toolType: fetchedData.toolType as string,
        groupId: fetchedData.groupId as string,
        groupName: fetchedData.groupName as string,
        resourceId: fetchedData.resourceId as string | undefined,
        resourceTitle: fetchedData.resourceTitle as string | undefined,
        resourceIcon: fetchedData.resourceIcon as string | undefined,
        taskId: fetchedData.taskId as string | undefined,
        taskTitle: fetchedData.taskTitle as string | undefined,
        taskStatus: fetchedData.taskStatus as string | undefined,
      }
    : null;

  const isLoading = !prefetchedData && fetchedData === undefined;
  const error = fetchedData === null;

  // Handle tap — navigate to tool via (user) routes (opens as bottom-up modal)
  const handlePress = () => {
    if (!toolData) return;

    if (toolData.toolType === "runsheet" && toolData.groupId) {
      router.push(`/(user)/leader-tools/${toolData.groupId}/run-sheet`);
    } else if (toolData.toolType === "resource" && toolData.groupId && toolData.resourceId) {
      router.push(`/(user)/group/${toolData.groupId}/resource/${toolData.resourceId}`);
    } else if (toolData.toolType === "task" && toolData.groupId && toolData.taskId) {
      router.push(`/(user)/leader-tools/${toolData.groupId}/tasks/${toolData.taskId}`);
    } else {
      // Fallback to public tool page
      router.push(`/t/${shortId}`);
    }
  };

  // Handle long press — share action sheet
  const handleLongPress = () => {
    const toolUrl = DOMAIN_CONFIG.toolShareUrl(shortId);

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Copy Link", "Share"],
          cancelButtonIndex: 0,
        },
        async (buttonIndex) => {
          if (buttonIndex === 1) {
            await Clipboard.setStringAsync(toolUrl);
            Alert.alert("Link Copied", "Tool link copied to clipboard.");
          } else if (buttonIndex === 2) {
            await Share.share({
              message: toolUrl,
              url: toolUrl,
            });
          }
        }
      );
    } else {
      Share.share({ message: toolUrl });
    }
  };

  // Get display name
  const getDisplayName = (): string => {
    if (!toolData) return "Loading...";
    if (toolData.toolType === "runsheet") {
      return `${toolData.groupName} | Run Sheet`;
    }
    if (toolData.toolType === "resource") {
      return `${toolData.groupName} | ${toolData.resourceTitle || "Resource"}`;
    }
    if (toolData.toolType === "task") {
      const status = toolData.taskStatus ? ` (${toolData.taskStatus})` : "";
      return `${toolData.groupName} | Task: ${toolData.taskTitle || "Task"}${status}`;
    }
    return toolData.groupName || "Tool";
  };

  // Get icon
  const getIcon = (): keyof typeof Ionicons.glyphMap => {
    if (!toolData) return "link-outline";
    if (toolData.toolType === "runsheet") return "list-outline";
    if (toolData.toolType === "resource") {
      return (toolData.resourceIcon as keyof typeof Ionicons.glyphMap) || "document-text-outline";
    }
    if (toolData.toolType === "task") return "checkmark-circle-outline";
    return "link-outline";
  };

  // Loading skeleton
  if (isLoading) {
    return (
      <View style={[styles.container, embedded && styles.containerEmbedded]}>
        <View style={styles.skeleton}>
          <View style={styles.skeletonIcon} />
          <View style={styles.skeletonText} />
        </View>
      </View>
    );
  }

  // Error — hide card
  if (error || !toolData) {
    return null;
  }

  return (
    <Pressable
      style={[styles.container, !isMyMessage && styles.containerLeft, embedded && styles.containerEmbedded]}
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={300}
    >
      <View style={styles.content}>
        <Ionicons name={getIcon()} size={18} color="#555" style={styles.icon} />
        <Text style={styles.label} numberOfLines={1}>
          {getDisplayName()}
        </Text>
        <Ionicons name="chevron-forward" size={16} color="#999" />
      </View>
    </Pressable>
  );
}

// On native, messageContent uses maxWidth (not a definite width), so children
// can't resolve percentage widths. Use a pixel-based width for the card.
const CARD_WIDTH = Dimensions.get('window').width * 0.7;

const styles = StyleSheet.create({
  container: {
    width: CARD_WIDTH,
    alignSelf: 'flex-end',
    marginVertical: 4,
  },
  containerLeft: {
    alignSelf: 'flex-start',
  },
  containerEmbedded: {
    marginVertical: 0,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F7FF',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E0ECFA',
  },
  icon: {
    marginRight: 8,
  },
  label: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  // Skeleton
  skeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  skeletonIcon: {
    width: 18,
    height: 18,
    borderRadius: 4,
    backgroundColor: '#E5E5E5',
    marginRight: 8,
  },
  skeletonText: {
    height: 14,
    width: 160,
    borderRadius: 4,
    backgroundColor: '#E5E5E5',
  },
});
