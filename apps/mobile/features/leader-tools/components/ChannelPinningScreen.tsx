/**
 * ChannelPinningScreen
 *
 * Allows leaders to pin channels and set their display order.
 * Pinned channels appear after main/leaders channels in the specified order.
 * Unpinned channels are sorted by most recent message.
 *
 * Features:
 * - Up/down buttons to reorder pinned channels
 * - Toggle pin/unpin for each channel
 * - Save button to persist changes
 */
import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { DragHandle } from "@components/ui/DragHandle";
import { useTheme } from "@hooks/useTheme";
import type { ThemeColors } from "@/theme/colors";

interface Channel {
  _id: Id<"chatChannels">;
  slug: string;
  channelType: string;
  name: string;
  memberCount: number;
  isPinned: boolean;
  lastMessageAt?: number;
}

interface ChannelPinningScreenProps {
  groupId: Id<"groups">;
  onSave?: () => void;
}

export function ChannelPinningScreen({
  groupId,
  onSave,
}: ChannelPinningScreenProps) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const [pinnedChannelSlugs, setPinnedChannelSlugs] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch channels for this group
  const channels = useAuthenticatedQuery(
    api.functions.messaging.channels.listGroupChannels,
    { groupId }
  );

  // Mutation to update pinned channels
  const updatePinnedChannelsMutation = useAuthenticatedMutation(
    api.functions.messaging.channels.updatePinnedChannels
  );

  // Get pinnable channels (exclude main and leaders)
  const pinnableChannels = useMemo(() => {
    if (!channels) return [];
    return channels.filter(
      (ch: Channel) => ch.channelType !== "main" && ch.channelType !== "leaders"
    );
  }, [channels]);

  // Initialize pinned slugs from server data (once only).
  // Reactive query updates must not overwrite unsaved local reordering.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (channels && !initializedRef.current) {
      const serverPinnedSlugs = channels
        .filter((ch: Channel) => ch.isPinned)
        .map((ch: Channel) => ch.slug);
      setPinnedChannelSlugs(serverPinnedSlugs);
      initializedRef.current = true;
    }
  }, [channels]);

  // Split channels into pinned and unpinned for display
  const { pinnedChannels, unpinnedChannels } = useMemo(() => {
    const pinned: Channel[] = [];
    const unpinned: Channel[] = [];

    for (const channel of pinnableChannels) {
      if (pinnedChannelSlugs.includes(channel.slug)) {
        pinned.push(channel);
      } else {
        unpinned.push(channel);
      }
    }

    // Sort pinned by their order in pinnedChannelSlugs
    pinned.sort((a, b) => {
      const aIndex = pinnedChannelSlugs.indexOf(a.slug);
      const bIndex = pinnedChannelSlugs.indexOf(b.slug);
      return aIndex - bIndex;
    });

    // Sort unpinned by most recent message
    unpinned.sort((a, b) => {
      const aTime = a.lastMessageAt ?? 0;
      const bTime = b.lastMessageAt ?? 0;
      return bTime - aTime; // DESC
    });

    return { pinnedChannels: pinned, unpinnedChannels: unpinned };
  }, [pinnableChannels, pinnedChannelSlugs]);

  // Move a pinned channel up in the list
  const handleMoveUp = useCallback((slug: string) => {
    setPinnedChannelSlugs((prev) => {
      const index = prev.indexOf(slug);
      if (index <= 0) return prev; // Already at top or not found
      const newSlugs = [...prev];
      // Swap with previous item
      [newSlugs[index - 1], newSlugs[index]] = [newSlugs[index], newSlugs[index - 1]];
      return newSlugs;
    });
    setHasChanges(true);
  }, []);

  // Move a pinned channel down in the list
  const handleMoveDown = useCallback((slug: string) => {
    setPinnedChannelSlugs((prev) => {
      const index = prev.indexOf(slug);
      if (index < 0 || index >= prev.length - 1) return prev; // At bottom or not found
      const newSlugs = [...prev];
      // Swap with next item
      [newSlugs[index], newSlugs[index + 1]] = [newSlugs[index + 1], newSlugs[index]];
      return newSlugs;
    });
    setHasChanges(true);
  }, []);

  // Toggle pin status
  const handleTogglePin = useCallback(
    (channel: Channel) => {
      setPinnedChannelSlugs((prev) => {
        if (prev.includes(channel.slug)) {
          // Unpin: remove from array
          return prev.filter((slug) => slug !== channel.slug);
        } else {
          // Pin: add to end of array
          return [...prev, channel.slug];
        }
      });
      setHasChanges(true);
    },
    []
  );

  // Save changes
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      // Filter out stale slugs (e.g. channel deleted while user had unsaved changes)
      const currentSlugs = new Set(channels?.map((ch: Channel) => ch.slug) ?? []);
      const validSlugs = pinnedChannelSlugs.filter((slug) => currentSlugs.has(slug));

      await updatePinnedChannelsMutation({
        groupId,
        pinnedChannelSlugs: validSlugs,
      });
      setHasChanges(false);
      Alert.alert("Success", "Channel pinning updated successfully.");
      onSave?.();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to update pinned channels.";
      Alert.alert("Error", message);
    } finally {
      setIsSaving(false);
    }
  }, [groupId, pinnedChannelSlugs, channels, updatePinnedChannelsMutation, onSave]);

  // Render pinned channel item with up/down buttons
  const renderPinnedItem = useCallback(
    (channel: Channel, index: number, total: number) => {
      const isFirst = index === 0;
      const isLast = index === total - 1;

      return (
        <View key={channel._id} style={styles.channelItem}>
          {/* Reorder buttons */}
          <View style={styles.reorderButtons}>
            <TouchableOpacity
              onPress={() => handleMoveUp(channel.slug)}
              disabled={isFirst}
              style={[styles.reorderButton, isFirst && styles.reorderButtonDisabled]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name="chevron-up"
                size={20}
                color={isFirst ? colors.iconSecondary : colors.textSecondary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleMoveDown(channel.slug)}
              disabled={isLast}
              style={[styles.reorderButton, isLast && styles.reorderButtonDisabled]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name="chevron-down"
                size={20}
                color={isLast ? colors.iconSecondary : colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          {/* Channel icon */}
          <View
            style={[
              styles.channelIcon,
              { backgroundColor: getChannelColor(channel.channelType, colors) + "15" },
            ]}
          >
            <Ionicons
              name={getChannelIcon(channel.channelType)}
              size={18}
              color={getChannelColor(channel.channelType, colors)}
            />
          </View>

          {/* Channel info */}
          <View style={styles.channelInfo}>
            <Text style={styles.channelName}>{channel.name}</Text>
            <Text style={styles.channelSubtitle}>
              {channel.memberCount} member{channel.memberCount !== 1 ? "s" : ""}
            </Text>
          </View>

          {/* Pin indicator */}
          <View style={[styles.pinnedBadge, { backgroundColor: primaryColor + "20" }]}>
            <Ionicons name="pin" size={14} color={primaryColor} />
          </View>

          {/* Unpin button */}
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleTogglePin(channel)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close-circle" size={24} color={colors.destructive} />
          </TouchableOpacity>
        </View>
      );
    },
    [primaryColor, handleTogglePin, handleMoveUp, handleMoveDown]
  );

  // Render unpinned channel item
  const renderUnpinnedItem = useCallback(
    (channel: Channel) => (
      <View key={channel._id} style={styles.channelItem}>
        {/* Empty space for alignment */}
        <View style={styles.reorderPlaceholder} />

        {/* Channel icon */}
        <View
          style={[
            styles.channelIcon,
            { backgroundColor: getChannelColor(channel.channelType, colors) + "15" },
          ]}
        >
          <Ionicons
            name={getChannelIcon(channel.channelType)}
            size={18}
            color={getChannelColor(channel.channelType, colors)}
          />
        </View>

        {/* Channel info */}
        <View style={styles.channelInfo}>
          <Text style={styles.channelName}>{channel.name}</Text>
          <Text style={styles.channelSubtitle}>
            {channel.memberCount} member{channel.memberCount !== 1 ? "s" : ""}
          </Text>
        </View>

        {/* Pin button */}
        <TouchableOpacity
          style={styles.pinButton}
          onPress={() => handleTogglePin(channel)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="pin-outline" size={22} color={primaryColor} />
          <Text style={[styles.pinButtonText, { color: primaryColor }]}>Pin</Text>
        </TouchableOpacity>
      </View>
    ),
    [handleTogglePin, primaryColor]
  );

  // Loading state
  if (channels === undefined) {
    return (
      <View style={styles.container}>
        <DragHandle />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={styles.loadingText}>Loading channels...</Text>
        </View>
      </View>
    );
  }

  // Empty state
  if (pinnableChannels.length === 0) {
    return (
      <View style={styles.container}>
        <DragHandle />
        <View style={styles.emptyContainer}>
          <Ionicons name="pin-outline" size={48} color={colors.iconSecondary} />
          <Text style={styles.emptyTitle}>No Channels to Pin</Text>
          <Text style={styles.emptySubtitle}>
            Create custom or PCO synced channels to enable pinning.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <DragHandle />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Instructions */}
        <View style={styles.instructionsBanner}>
          <Ionicons name="information-circle" size={20} color={primaryColor} />
          <Text style={styles.instructionsText}>
            Pinned channels appear at the top in your chosen order. Use arrows to
            reorder, or tap to pin/unpin.
          </Text>
        </View>

        {/* Pinned Section */}
        {pinnedChannels.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>PINNED</Text>
            <View style={styles.channelList}>
              {pinnedChannels.map((channel, index) =>
                renderPinnedItem(channel, index, pinnedChannels.length)
              )}
            </View>
          </>
        )}

        {/* Unpinned Section */}
        {unpinnedChannels.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>UNPINNED</Text>
            <View style={styles.channelList}>
              {unpinnedChannels.map(renderUnpinnedItem)}
            </View>
          </>
        )}
      </ScrollView>

      {/* Save Button */}
      {hasChanges && (
        <View style={styles.saveContainer}>
          <TouchableOpacity
            style={[styles.saveButton, { backgroundColor: primaryColor }]}
            onPress={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <>
                <Ionicons name="checkmark" size={20} color={colors.textInverse} />
                <Text style={styles.saveButtonText}>Save Changes</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// Helper to get channel color based on type
function getChannelColor(channelType: string, colors: ThemeColors): string {
  switch (channelType) {
    case "pco_services":
      return colors.link;
    case "custom":
      return colors.link;
    default:
      return colors.textSecondary;
  }
}

// Helper to get channel icon based on type
function getChannelIcon(channelType: string): keyof typeof Ionicons.glyphMap {
  switch (channelType) {
    case "pco_services":
      return "sync";
    case "custom":
      return "chatbubble";
    default:
      return "chatbubble-ellipses";
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#666",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginTop: 8,
  },
  instructionsBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E8F4FD",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    gap: 10,
  },
  instructionsText: {
    flex: 1,
    fontSize: 13,
    color: "#333",
    lineHeight: 18,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "600",
    color: "#888",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 8,
  },
  channelList: {
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
  },
  channelItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    paddingLeft: 8,
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E0E0E0",
  },
  reorderButtons: {
    width: 32,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  reorderButton: {
    padding: 2,
  },
  reorderButtonDisabled: {
    opacity: 0.3,
  },
  reorderPlaceholder: {
    width: 36,
  },
  channelIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  channelInfo: {
    flex: 1,
  },
  channelName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
  },
  channelSubtitle: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  pinnedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 8,
  },
  actionButton: {
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  pinButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#F0F0F0",
  },
  pinButtonText: {
    fontSize: 13,
    fontWeight: "500",
  },
  saveContainer: {
    padding: 16,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
