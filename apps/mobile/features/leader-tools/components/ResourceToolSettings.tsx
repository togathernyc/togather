/**
 * ResourceToolSettings - Settings component for creating/editing group resources
 *
 * This component is used for both creating and editing resources.
 * Features:
 * - Title input field
 * - Icon picker with common icons
 * - Visibility settings (everyone or new members)
 * - Sections list (reorderable, editable, deletable)
 * - Save/Delete buttons
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { useLocalSearchParams, router, Stack } from "expo-router";
import { useQuery, useMutation } from "convex/react";
import { api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { Ionicons } from "@expo/vector-icons";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { ResourceSectionEditor } from "./ResourceSectionEditor";
import { DragHandle } from "@components/ui/DragHandle";
import { useTheme } from "@hooks/useTheme";

// ============================================================================
// Constants
// ============================================================================

const ICON_OPTIONS = [
  "document-outline",
  "book-outline",
  "people-outline",
  "heart-outline",
  "star-outline",
  "school-outline",
  "information-circle-outline",
  "hand-right-outline",
  "megaphone-outline",
  "calendar-outline",
] as const;

type IconOption = (typeof ICON_OPTIONS)[number];

// ============================================================================
// Types
// ============================================================================

interface Section {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  linkUrl?: string;
  order: number;
}

// ============================================================================
// Component
// ============================================================================

export function ResourceToolSettings() {
  const { colors } = useTheme();
  const { group_id, resource_id } = useLocalSearchParams<{
    group_id: string;
    resource_id?: string;
  }>();
  const { token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const themeColor = primaryColor || DEFAULT_PRIMARY_COLOR;

  const isNew = !resource_id || resource_id === "new";

  // Form state
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState<IconOption>("document-outline");
  const [visibilityType, setVisibilityType] = useState<
    "everyone" | "joined_within" | "channel_members"
  >("everyone");
  const [daysWithin, setDaysWithin] = useState("7");
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Queries
  const existingResource = useQuery(
    api.functions.groupResources.index.getById,
    !isNew && token && resource_id
      ? { resourceId: resource_id as Id<"groupResources">, token }
      : "skip"
  );

  const channels = useQuery(
    api.functions.messaging.channels.getChannelsByGroup,
    token && group_id
      ? { token, groupId: group_id as Id<"groups"> }
      : "skip"
  );

  // Filter to only show non-DM, non-archived channels for the picker
  const pickableChannels = (channels ?? []).filter(
    (ch) => ch.channelType !== "dm" && !ch.isArchived
  );

  // Mutations
  const createMutation = useMutation(api.functions.groupResources.index.create);
  const updateMutation = useMutation(api.functions.groupResources.index.update);
  const deleteMutation = useMutation(api.functions.groupResources.index.remove);
  const addSectionMutation = useMutation(
    api.functions.groupResources.index.addSection
  );
  const reorderSectionsMutation = useMutation(
    api.functions.groupResources.index.reorderSections
  );

  // Initialize form from existing resource
  useEffect(() => {
    if (existingResource) {
      setTitle(existingResource.title);
      setIcon((existingResource.icon as IconOption) || "document-outline");
      setVisibilityType(existingResource.visibility.type);
      setDaysWithin(String(existingResource.visibility.daysWithin || 7));
      setSelectedChannelIds(
        (existingResource.visibility.channelIds as string[]) ?? []
      );
    }
  }, [existingResource]);

  // Get sections from existing resource (real-time updates from Convex)
  const sections: Section[] = existingResource?.sections || [];

  // Handle save
  const handleSave = useCallback(async () => {
    if (!token || !group_id || !title.trim()) {
      Alert.alert("Error", "Please enter a title");
      return;
    }

    if (visibilityType === "channel_members" && selectedChannelIds.length === 0) {
      Alert.alert("Error", "Please select at least one channel");
      return;
    }

    setSaving(true);

    const visibility = {
      type: visibilityType,
      ...(visibilityType === "joined_within"
        ? { daysWithin: parseInt(daysWithin) || 7 }
        : {}),
      ...(visibilityType === "channel_members" && selectedChannelIds.length > 0
        ? { channelIds: selectedChannelIds as Id<"chatChannels">[] }
        : {}),
    };

    try {
      if (isNew) {
        const newId = await createMutation({
          groupId: group_id as Id<"groups">,
          title: title.trim(),
          icon,
          visibility,
          token,
        });
        // Replace the current route with the edit route for the new resource
        router.replace(`/(user)/leader-tools/${group_id}/resources/${newId}`);
      } else {
        await updateMutation({
          resourceId: resource_id as Id<"groupResources">,
          title: title.trim(),
          icon,
          visibility,
          token,
        });
        router.back();
      }
    } catch (error) {
      console.error("[ResourceToolSettings] Save failed:", error);
      Alert.alert("Error", "Failed to save resource");
    } finally {
      setSaving(false);
    }
  }, [
    token,
    group_id,
    title,
    icon,
    visibilityType,
    daysWithin,
    selectedChannelIds,
    isNew,
    resource_id,
    createMutation,
    updateMutation,
  ]);

  // Handle delete
  const handleDelete = useCallback(() => {
    Alert.alert(
      "Delete Resource",
      "Are you sure you want to delete this resource? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (!token || !resource_id) return;
            try {
              await deleteMutation({
                resourceId: resource_id as Id<"groupResources">,
                token,
              });
              router.back();
            } catch (error) {
              console.error("[ResourceToolSettings] Delete failed:", error);
              Alert.alert("Error", "Failed to delete resource");
            }
          },
        },
      ]
    );
  }, [token, resource_id, deleteMutation]);

  // Handle add section
  const handleAddSection = useCallback(async () => {
    if (!token || !resource_id || isNew) return;

    try {
      await addSectionMutation({
        resourceId: resource_id as Id<"groupResources">,
        title: "New Section",
        token,
      });
    } catch (error) {
      console.error("[ResourceToolSettings] Add section failed:", error);
      Alert.alert("Error", "Failed to add section");
    }
  }, [token, resource_id, isNew, addSectionMutation]);

  // Handle reorder sections
  const sortedSections = [...sections].sort((a, b) => a.order - b.order);

  const handleMoveSection = useCallback(
    async (sectionId: string, direction: "up" | "down") => {
      if (!token || !resource_id || isNew) return;

      const sorted = [...sections].sort((a, b) => a.order - b.order);
      const index = sorted.findIndex((s) => s.id === sectionId);
      if (index < 0) return;

      if (direction === "up" && index <= 0) return;
      if (direction === "down" && index >= sorted.length - 1) return;

      const newOrder = sorted.map((s) => s.id);
      const swapIndex = direction === "up" ? index - 1 : index + 1;
      [newOrder[index], newOrder[swapIndex]] = [
        newOrder[swapIndex],
        newOrder[index],
      ];

      try {
        await reorderSectionsMutation({
          resourceId: resource_id as Id<"groupResources">,
          sectionIds: newOrder,
          token,
        });
      } catch (error) {
        console.error("[ResourceToolSettings] Reorder failed:", error);
        Alert.alert("Error", "Failed to reorder sections");
      }
    },
    [token, resource_id, isNew, sections, reorderSectionsMutation]
  );

  // Loading state for missing token or existing resource
  if (!token || (!isNew && existingResource === undefined)) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: isNew ? "New Resource" : "Edit Resource" }} />
        <ActivityIndicator color={themeColor} />
      </View>
    );
  }

  // Resource not found
  if (!isNew && existingResource === null) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Edit Resource" }} />
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>Resource not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <DragHandle />
      <Stack.Screen
        options={{ title: isNew ? "New Resource" : "Edit Resource" }}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title Input */}
        <Text style={[styles.label, { color: colors.text }]}>Title</Text>
        <TextInput
          style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBackground }]}
          value={title}
          onChangeText={setTitle}
          placeholder="Welcome, Roles, Resources..."
          placeholderTextColor={colors.textTertiary}
        />

        {/* Icon Picker */}
        <Text style={[styles.label, { color: colors.text }]}>Icon</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.iconPicker}
          contentContainerStyle={styles.iconPickerContent}
        >
          {ICON_OPTIONS.map((iconName) => (
            <Pressable
              key={iconName}
              style={[
                styles.iconOption,
                { backgroundColor: colors.surfaceSecondary },
                icon === iconName && [
                  styles.iconOptionSelected,
                  { borderColor: themeColor, backgroundColor: colors.selectedBackground },
                ],
              ]}
              onPress={() => setIcon(iconName)}
            >
              <Ionicons
                name={iconName}
                size={24}
                color={icon === iconName ? themeColor : colors.textSecondary}
              />
            </Pressable>
          ))}
        </ScrollView>

        {/* Visibility */}
        <Text style={[styles.label, { color: colors.text }]}>Who can see this?</Text>
        <View style={styles.visibilityOptions}>
          <Pressable
            style={[
              styles.visibilityOption,
              { backgroundColor: colors.surfaceSecondary },
              visibilityType === "everyone" && [
                styles.visibilityOptionSelected,
                { backgroundColor: themeColor },
              ],
            ]}
            onPress={() => setVisibilityType("everyone")}
          >
            <Text
              style={
                visibilityType === "everyone"
                  ? styles.visibilityTextSelected
                  : [styles.visibilityText, { color: colors.text }]
              }
            >
              Everyone
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.visibilityOption,
              { backgroundColor: colors.surfaceSecondary },
              visibilityType === "joined_within" && [
                styles.visibilityOptionSelected,
                { backgroundColor: themeColor },
              ],
            ]}
            onPress={() => setVisibilityType("joined_within")}
          >
            <Text
              style={
                visibilityType === "joined_within"
                  ? styles.visibilityTextSelected
                  : [styles.visibilityText, { color: colors.text }]
              }
            >
              New members
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.visibilityOption,
              { backgroundColor: colors.surfaceSecondary },
              visibilityType === "channel_members" && [
                styles.visibilityOptionSelected,
                { backgroundColor: themeColor },
              ],
            ]}
            onPress={() => setVisibilityType("channel_members")}
          >
            <Text
              style={
                visibilityType === "channel_members"
                  ? styles.visibilityTextSelected
                  : [styles.visibilityText, { color: colors.text }]
              }
            >
              Channels
            </Text>
          </Pressable>
        </View>

        {visibilityType === "joined_within" && (
          <View style={styles.daysRow}>
            <Text style={[styles.daysText, { color: colors.textSecondary }]}>Members who joined in the last</Text>
            <TextInput
              style={[styles.daysInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBackground }]}
              value={daysWithin}
              onChangeText={setDaysWithin}
              keyboardType="number-pad"
              maxLength={3}
            />
            <Text style={[styles.daysText, { color: colors.textSecondary }]}>days</Text>
          </View>
        )}

        {visibilityType === "channel_members" && (
          <View style={styles.channelPicker}>
            <Text style={[styles.channelPickerHint, { color: colors.textSecondary }]}>
              Only members of selected channels will see this resource
            </Text>
            {pickableChannels.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.textTertiary }]}>No channels available</Text>
            ) : (
              pickableChannels.map((channel) => {
                const isSelected = selectedChannelIds.includes(channel._id);
                return (
                  <Pressable
                    key={channel._id}
                    style={styles.channelRow}
                    onPress={() => {
                      setSelectedChannelIds((prev) =>
                        isSelected
                          ? prev.filter((id) => id !== channel._id)
                          : [...prev, channel._id]
                      );
                    }}
                  >
                    <View
                      style={[
                        styles.channelCheckbox,
                        { borderColor: colors.border },
                        isSelected && [
                          styles.channelCheckboxSelected,
                          { backgroundColor: themeColor, borderColor: themeColor },
                        ],
                      ]}
                    >
                      {isSelected && (
                        <Ionicons name="checkmark" size={14} color={colors.textInverse} />
                      )}
                    </View>
                    <Text style={[styles.channelName, { color: colors.text }]}>{channel.name}</Text>
                  </Pressable>
                );
              })
            )}
          </View>
        )}

        {/* Sections - only show for existing resources */}
        {!isNew && (
          <>
            <Text style={[styles.label, { color: colors.text }]}>Sections</Text>
            {sortedSections.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                No sections yet. Add a section to provide content.
              </Text>
            ) : (
              sortedSections.map((section, index) => (
                <View key={section.id} style={styles.sectionRow}>
                  {sortedSections.length > 1 && (
                    <View style={styles.reorderButtons}>
                      <TouchableOpacity
                        onPress={() => handleMoveSection(section.id, "up")}
                        disabled={index === 0}
                        style={[
                          styles.reorderButton,
                          index === 0 && styles.reorderButtonDisabled,
                        ]}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons
                          name="chevron-up"
                          size={20}
                          color={index === 0 ? colors.iconSecondary : colors.textSecondary}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleMoveSection(section.id, "down")}
                        disabled={index === sortedSections.length - 1}
                        style={[
                          styles.reorderButton,
                          index === sortedSections.length - 1 &&
                            styles.reorderButtonDisabled,
                        ]}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons
                          name="chevron-down"
                          size={20}
                          color={
                            index === sortedSections.length - 1
                              ? colors.iconSecondary
                              : colors.textSecondary
                          }
                        />
                      </TouchableOpacity>
                    </View>
                  )}
                  <View style={styles.sectionContent}>
                    <ResourceSectionEditor
                      key={section.id}
                      section={section}
                      resourceId={resource_id as Id<"groupResources">}
                      token={token}
                    />
                  </View>
                </View>
              ))
            )}
            <Pressable
              style={[styles.addSectionButton, { borderColor: themeColor }]}
              onPress={handleAddSection}
            >
              <Ionicons name="add" size={20} color={themeColor} />
              <Text style={[styles.addSectionText, { color: themeColor }]}>
                Add Section
              </Text>
            </Pressable>
          </>
        )}

        {/* Save Button */}
        <Pressable
          style={[
            styles.saveButton,
            { backgroundColor: themeColor },
            saving && styles.saveButtonDisabled,
          ]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={colors.textInverse} size="small" />
          ) : (
            <Text style={styles.saveButtonText}>
              {isNew ? "Create Resource" : "Save Changes"}
            </Text>
          )}
        </Pressable>

        {/* Delete Button */}
        {!isNew && (
          <Pressable style={styles.deleteButton} onPress={handleDelete}>
            <Text style={[styles.deleteButtonText, { color: colors.destructive }]}>Delete Resource</Text>
          </Pressable>
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
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  errorText: {
    fontSize: 16,
    textAlign: "center",
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  iconPicker: {
    marginBottom: 8,
  },
  iconPickerContent: {
    gap: 8,
    paddingRight: 16,
  },
  iconOption: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "transparent",
  },
  iconOptionSelected: {
    // backgroundColor and borderColor set dynamically
  },
  visibilityOptions: {
    flexDirection: "row",
    gap: 8,
  },
  visibilityOption: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  visibilityOptionSelected: {
    // backgroundColor set dynamically with themeColor
  },
  visibilityText: {
    fontWeight: "500",
  },
  visibilityTextSelected: {
    color: "#fff",
    fontWeight: "600",
  },
  daysRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  daysText: {
    fontSize: 14,
  },
  daysInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    width: 60,
    textAlign: "center",
    fontSize: 16,
  },
  emptyText: {
    fontSize: 14,
    fontStyle: "italic",
    textAlign: "center",
    padding: 16,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 0,
  },
  reorderButtons: {
    width: 28,
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
  sectionContent: {
    flex: 1,
  },
  addSectionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: 12,
    marginTop: 12,
  },
  addSectionText: {
    fontWeight: "600",
  },
  saveButton: {
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 24,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
  deleteButton: {
    padding: 16,
    alignItems: "center",
    marginTop: 12,
  },
  deleteButtonText: {
    fontWeight: "600",
  },
  channelPicker: {
    marginTop: 12,
    gap: 4,
  },
  channelPickerHint: {
    fontSize: 13,
    marginBottom: 8,
  },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  channelCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  channelCheckboxSelected: {
    // backgroundColor and borderColor set dynamically
  },
  channelName: {
    fontSize: 15,
  },
});
