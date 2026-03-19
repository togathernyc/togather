/**
 * Resources List Screen - Leader view for managing group resources
 *
 * Lists all resources for a group with options to add, edit, or reorder them.
 * Leaders can see visibility settings and section counts for each resource.
 */
import { useLocalSearchParams, router, Stack } from "expo-router";
import {
  View,
  ScrollView,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { DragHandle } from "@components/ui/DragHandle";
import { useTheme } from "@hooks/useTheme";

// ============================================================================
// Types
// ============================================================================

interface Resource {
  _id: Id<"groupResources">;
  title: string;
  icon?: string;
  visibility: {
    type: "everyone" | "joined_within" | "channel_members";
    daysWithin?: number;
    channelIds?: string[];
  };
  sections: Array<{
    id: string;
    title: string;
    order: number;
  }>;
  order: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format visibility for display
 */
function formatVisibility(visibility: Resource["visibility"]): string {
  if (visibility.type === "everyone") {
    return "Everyone";
  }
  if (visibility.type === "channel_members") {
    const count = visibility.channelIds?.length ?? 0;
    return `${count} channel${count !== 1 ? "s" : ""}`;
  }
  return `New members (${visibility.daysWithin}d)`;
}

// ============================================================================
// Main Component
// ============================================================================

export default function ResourcesListScreen() {
  const { colors } = useTheme();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();

  const resources = useAuthenticatedQuery(
    api.functions.groupResources.index.listByGroup,
    group_id ? { groupId: group_id as Id<"groups"> } : "skip"
  );

  // Loading state
  if (resources === undefined) {
    return (
      <View style={styles.container}>
        <DragHandle />
        <Stack.Screen options={{ title: "Resources" }} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
          <Text style={styles.loadingText}>Loading resources...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <DragHandle />
      <Stack.Screen options={{ title: "Resources" }} />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Resource List */}
        {resources?.map((resource) => (
          <Pressable
            key={resource._id}
            style={styles.resourceItem}
            onPress={() =>
              router.push(
                `/(user)/leader-tools/${group_id}/resources/${resource._id}`
              )
            }
          >
            <View style={styles.resourceInfo}>
              <Ionicons
                name={
                  (resource.icon ||
                    "document-outline") as keyof typeof Ionicons.glyphMap
                }
                size={24}
                color={colors.text}
              />
              <View style={styles.resourceText}>
                <Text style={styles.resourceTitle}>{resource.title}</Text>
                <Text style={styles.resourceMeta}>
                  {resource.sections.length} section
                  {resource.sections.length !== 1 ? "s" : ""} ·{" "}
                  {formatVisibility(resource.visibility)}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.iconSecondary} />
          </Pressable>
        ))}

        {/* Empty state */}
        {resources?.length === 0 && (
          <View style={styles.emptyContainer}>
            <Ionicons name="document-text-outline" size={48} color={colors.iconSecondary} />
            <Text style={styles.emptyTitle}>No resources yet</Text>
            <Text style={styles.emptyText}>
              Create resources like welcome guides, FAQs, or helpful links for
              your group members.
            </Text>
          </View>
        )}

        {/* Add Resource Button */}
        <Pressable
          style={styles.addButton}
          onPress={() => router.push(`/(user)/leader-tools/${group_id}/resources/new`)}
        >
          <Ionicons name="add-circle-outline" size={24} color={colors.link} />
          <Text style={styles.addButtonText}>Add Resource</Text>
        </Pressable>
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
    backgroundColor: "#fff",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    color: "#666",
  },
  content: {
    padding: 16,
  },
  resourceItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: "#f9f9f9",
    borderRadius: 12,
    marginBottom: 12,
  },
  resourceInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  resourceText: {
    flex: 1,
  },
  resourceTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  resourceMeta: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  emptyText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 32,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderWidth: 2,
    borderColor: "#007AFF",
    borderStyle: "dashed",
    borderRadius: 12,
    marginTop: 8,
  },
  addButtonText: {
    fontSize: 16,
    color: "#007AFF",
    fontWeight: "600",
  },
});
