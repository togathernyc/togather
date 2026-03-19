/**
 * Resource Page - User-facing view for group resources
 *
 * Displays a resource page with its sections, including images and link previews.
 * Users navigate here when tapping on a resource in the toolbar.
 */
import { useLocalSearchParams, Stack } from "expo-router";
import {
  View,
  ScrollView,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ActionSheetIOS,
  Alert,
  Share,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthenticatedQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { DOMAIN_CONFIG } from "@togather/shared";
import * as Clipboard from "expo-clipboard";
import { useCallback } from "react";
import { ResourceSection } from "@components/ui";
import { DragHandle } from "@components/ui/DragHandle";
import { useTheme } from "@hooks/useTheme";

// ============================================================================
// Main Component
// ============================================================================

export default function ResourcePage() {
  const { colors } = useTheme();
  const { group_id, resource_id } = useLocalSearchParams<{
    group_id: string;
    resource_id: string;
  }>();

  const resource = useAuthenticatedQuery(
    api.functions.groupResources.index.getById,
    resource_id
      ? { resourceId: resource_id as Id<"groupResources"> }
      : "skip"
  );

  const getOrCreateToolLink = useAuthenticatedMutation(
    api.functions.toolShortLinks.index.getOrCreate
  );

  const handleShareResource = useCallback(async () => {
    if (!group_id || !resource_id) return;
    try {
      const shortId = await getOrCreateToolLink({
        groupId: group_id as Id<"groups">,
        toolType: "resource",
        resourceId: resource_id as Id<"groupResources">,
      });
      const toolUrl = DOMAIN_CONFIG.toolShareUrl(shortId);
      const title = resource?.title || "Resource";

      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ["Cancel", "Copy Link", "Share"],
            cancelButtonIndex: 0,
          },
          async (buttonIndex) => {
            if (buttonIndex === 1) {
              await Clipboard.setStringAsync(toolUrl);
              Alert.alert("Link Copied", "Resource link copied to clipboard.");
            } else if (buttonIndex === 2) {
              await Share.share({
                message: `${title}\n${toolUrl}`,
                url: toolUrl,
              });
            }
          }
        );
      } else {
        await Share.share({ message: `${title}\n${toolUrl}` });
      }
    } catch (err) {
      console.error("[ResourcePage] Share error:", err);
      Alert.alert("Error", "Failed to create share link.");
    }
  }, [group_id, resource_id, getOrCreateToolLink, resource?.title]);

  // Loading state
  if (resource === undefined) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <DragHandle />
        <Stack.Screen options={{ title: "Loading..." }} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading resource...</Text>
        </View>
      </View>
    );
  }

  // Not found state
  if (resource === null) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <DragHandle />
        <Stack.Screen options={{ title: "Not Found" }} />
        <View style={styles.errorContainer}>
          <Ionicons name="document-outline" size={48} color={colors.iconSecondary} />
          <Text style={[styles.errorTitle, { color: colors.text }]}>Resource not found</Text>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            This resource may have been removed or you don't have access to it.
          </Text>
        </View>
      </View>
    );
  }

  // Sort sections by order
  const sortedSections = [...resource.sections].sort(
    (a, b) => a.order - b.order
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <DragHandle />
      <Stack.Screen options={{ title: resource.title }} />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {resource.icon && (
              <Ionicons
                name={resource.icon as keyof typeof Ionicons.glyphMap}
                size={28}
                color={colors.text}
              />
            )}
            <Text style={[styles.title, { color: colors.text }]}>{resource.title}</Text>
          </View>
          <TouchableOpacity
            onPress={handleShareResource}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="share-outline" size={22} color={colors.icon} />
          </TouchableOpacity>
        </View>

        {/* Sections */}
        {sortedSections.map((section) => (
          <ResourceSection key={section.id} section={section} />
        ))}

        {/* Empty state */}
        {sortedSections.length === 0 && (
          <View style={styles.emptyContainer}>
            <Ionicons name="document-text-outline" size={48} color={colors.iconSecondary} />
            <Text style={[styles.emptyText, { color: colors.textTertiary }]}>No content yet</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    gap: 12,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  content: {
    padding: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    flex: 1,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 12,
  },
  emptyText: {
    fontSize: 16,
    textAlign: "center",
  },
});
