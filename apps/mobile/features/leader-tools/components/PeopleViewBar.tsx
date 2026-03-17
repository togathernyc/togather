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
  onViewDeselect: () => void;
  onDeleteView: (viewId: string, viewName: string, isShared: boolean) => void;
  onCreateView: () => void;
  isAdmin?: boolean;
  specialViews?: Array<{
    id: string;
    name: string;
    icon?: keyof typeof Ionicons.glyphMap;
  }>;
}

// ============================================================================
// Component
// ============================================================================

export function PeopleViewBar({
  communityId,
  activeViewId,
  onViewSelect,
  onViewDeselect,
  onDeleteView,
  onCreateView,
  isAdmin,
  specialViews = [],
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
        {specialViews.map((view) => {
          const isActive = activeViewId === view.id;
          return (
            <View key={view.id} style={styles.chipWrapper}>
              <Pressable
                onPress={() => {
                  if (isActive) {
                    onViewDeselect();
                  } else {
                    onViewSelect(view.id, { ...view, isSpecial: true });
                  }
                }}
                style={[
                  styles.chip,
                  isActive
                    ? { backgroundColor: primaryColor, borderColor: primaryColor }
                    : styles.chipInactive,
                ]}
              >
                {view.icon ? (
                  <Ionicons
                    name={view.icon}
                    size={12}
                    color={isActive ? "#FFFFFF" : "#9CA3AF"}
                    style={styles.lockIcon}
                  />
                ) : null}
                <Text
                  style={[
                    styles.chipText,
                    isActive ? styles.chipTextActive : styles.chipTextInactive,
                  ]}
                  numberOfLines={1}
                >
                  {view.name}
                </Text>
              </Pressable>
            </View>
          );
        })}

        {views.map((view: any) => {
          const isActive = activeViewId === view._id;
          return (
            <View key={view._id} style={styles.chipWrapper}>
              <Pressable
                onPress={() => {
                  if (isActive) {
                    onViewDeselect();
                  } else {
                    onViewSelect(view._id, view);
                  }
                }}
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
              {!view.isDefault && (view.visibility !== "shared" || isAdmin) && (
                <Pressable
                  onPress={() => onDeleteView(view._id, view.name, view.visibility === "shared")}
                  style={styles.deleteIcon}
                >
                  <Ionicons
                    name="close-circle"
                    size={14}
                    color={isActive ? primaryColor : "#9CA3AF"}
                  />
                </Pressable>
              )}
            </View>
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
  chipWrapper: {
    flexDirection: "row",
    alignItems: "center",
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
  deleteIcon: {
    marginLeft: -4,
    padding: 2,
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
