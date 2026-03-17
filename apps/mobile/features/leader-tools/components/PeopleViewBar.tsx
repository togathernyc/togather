import React from "react";
import {
  View,
  ScrollView,
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import { Id } from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

// ============================================================================
// Types
// ============================================================================

interface PeopleViewBarProps {
  communityId: Id<"communities">;
  activeViewId: string | null;
  onViewSelect: (viewId: string, view: any) => void;
  onCreateView: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function PeopleViewBar({
  communityId,
  activeViewId,
  onViewSelect,
  onCreateView,
}: PeopleViewBarProps) {
  const { primaryColor } = useCommunityTheme();

  const views = useAuthenticatedQuery(
    api.functions.peopleSavedViews.list,
    { communityId },
  );

  const isLoading = views === undefined;

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="small" color={primaryColor} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {views.map((view: any) => {
          const isActive = activeViewId === view._id;
          return (
            <Pressable
              key={view._id}
              onPress={() => onViewSelect(view._id, view)}
              style={[
                styles.chip,
                isActive
                  ? { backgroundColor: primaryColor, borderColor: primaryColor }
                  : styles.chipInactive,
              ]}
            >
              {view.isDefault && (
                <Ionicons
                  name="lock-closed"
                  size={12}
                  color={isActive ? "#FFFFFF" : "#9CA3AF"}
                  style={styles.lockIcon}
                />
              )}
              <Text
                style={[
                  styles.chipText,
                  isActive ? styles.chipTextActive : styles.chipTextInactive,
                ]}
                numberOfLines={1}
              >
                {view.name}
              </Text>
              {view.visibility === "shared" && !view.isDefault && (
                <Ionicons
                  name="people-outline"
                  size={12}
                  color={isActive ? "#FFFFFF" : "#9CA3AF"}
                  style={styles.sharedIcon}
                />
              )}
            </Pressable>
          );
        })}

        {/* Add view button */}
        <Pressable onPress={onCreateView} style={styles.addButton}>
          <Ionicons name="add" size={18} color="#6B7280" />
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
    height: 40,
    justifyContent: "center",
  },
  scrollContent: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipInactive: {
    backgroundColor: "#F3F4F6",
    borderColor: "#E5E7EB",
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500" as const,
  },
  chipTextActive: {
    color: "#FFFFFF",
  },
  chipTextInactive: {
    color: "#374151",
  },
  lockIcon: {
    marginRight: 4,
  },
  sharedIcon: {
    marginLeft: 4,
  },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderStyle: "dashed",
    justifyContent: "center",
    alignItems: "center",
  },
});
