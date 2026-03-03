/**
 * Toolbar Settings Screen
 * Allows leaders to configure which tools appear in the leader toolbar.
 */
import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Switch,
  Pressable,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { UserRoute } from "@components/guards/UserRoute";
import { DragHandle } from "@components/ui/DragHandle";
import { useAuth } from "@providers/AuthProvider";
import {
  useQuery,
  api,
  useAuthenticatedMutation,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import {
  TOOLBAR_TOOLS,
  DEFAULT_TOOLS,
  ALL_TOOL_IDS,
  createResourceToolId,
  type ToolDefinition,
} from "@features/chat/constants/toolbarTools";

// Convert TOOLBAR_TOOLS record to array for iteration
const ALL_TOOLS: readonly ToolDefinition[] = ALL_TOOL_IDS.map(
  (id) => TOOLBAR_TOOLS[id]
);

// Tools that have dedicated settings pages
const TOOLS_WITH_SETTINGS = ["runsheet", "followup"];

// Unified item type for both tools and resources
type UnifiedToolbarItem = {
  id: string;              // "attendance" or "resource:xyz"
  icon: string;
  label: string;
  isResource: boolean;
  resourceId?: string;     // For resources
  visibilityBadge?: string; // "All" or "New (7d)" for resources
  hasSettings: boolean;    // true for "runsheet" or any resource
  requiresPco?: boolean;
};

export default function ToolbarSettingsScreen() {
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const groupId = group_id as Id<"groups">;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  // Query group data (includes leaderToolbarTools and userRole)
  const group = useQuery(
    api.functions.groups.queries.getById,
    token && groupId ? { token, groupId } : "skip"
  );

  // Query if group has PCO channels
  const hasPcoChannels = useQuery(
    api.functions.messaging.channels.hasAutoChannels,
    token && groupId ? { token, groupId } : "skip"
  );

  // Query resources for the group
  const resources = useQuery(
    api.functions.groupResources.index.listByGroup,
    token && groupId ? { groupId, token } : "skip"
  );

  // Mutation to update tools
  const updateTools = useAuthenticatedMutation(
    api.functions.groups.index.updateLeaderToolbarTools
  );

  // Mutation to update visibility settings
  const updateVisibility = useAuthenticatedMutation(
    api.functions.groups.index.updateToolbarVisibility
  );

  // Local state for editing
  const [tools, setTools] = useState<string[]>([]);
  const [showToolbarToMembers, setShowToolbarToMembers] = useState(false);
  const [toolVisibility, setToolVisibility] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  // Type for group with visibility settings
  type GroupWithVisibility = typeof group & {
    leaderToolbarTools?: string[];
    showToolbarToMembers?: boolean;
    toolVisibility?: Record<string, string>;
  };

  // Initialize tools and visibility from group data
  // leaderToolbarTools is only returned for members/admins (conditional in getById query)
  useEffect(() => {
    if (group) {
      const groupWithSettings = group as GroupWithVisibility;
      setTools(groupWithSettings.leaderToolbarTools ?? DEFAULT_TOOLS);
      setShowToolbarToMembers(groupWithSettings.showToolbarToMembers ?? false);
      setToolVisibility(groupWithSettings.toolVisibility ?? {});
      setHasChanges(false);
    }
  }, [group]);

  // Check if user has access (leader/admin)
  const canAccess = group?.userRole === "leader" || group?.userRole === "admin";

  // Handle back navigation
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push(`/groups/${groupId}`);
    }
  };

  // Toggle tool visibility
  const toggleTool = useCallback((toolId: string) => {
    setTools((current) => {
      if (current.includes(toolId)) {
        // Remove tool
        return current.filter((id) => id !== toolId);
      } else {
        // Add tool at end
        return [...current, toolId];
      }
    });
    setHasChanges(true);
  }, []);

  // Move tool up in the tools array by its ID
  const moveUp = useCallback((toolId: string) => {
    setTools((current) => {
      const index = current.indexOf(toolId);
      if (index <= 0) return current;
      const newTools = [...current];
      [newTools[index - 1], newTools[index]] = [
        newTools[index],
        newTools[index - 1],
      ];
      return newTools;
    });
    setHasChanges(true);
  }, []);

  // Move tool down in the tools array by its ID
  const moveDown = useCallback((toolId: string) => {
    setTools((current) => {
      const index = current.indexOf(toolId);
      if (index === -1 || index === current.length - 1) return current;
      const newTools = [...current];
      [newTools[index], newTools[index + 1]] = [
        newTools[index + 1],
        newTools[index],
      ];
      return newTools;
    });
    setHasChanges(true);
  }, []);

  // Toggle show toolbar to members
  const handleToggleShowToMembers = useCallback((value: boolean) => {
    setShowToolbarToMembers(value);
    setHasChanges(true);
  }, []);

  // Handle per-tool visibility change
  const handleToolVisibilityChange = useCallback((toolId: string, visibility: string) => {
    setToolVisibility((current) => ({
      ...current,
      [toolId]: visibility,
    }));
    setHasChanges(true);
  }, []);

  // Save changes
  const handleSave = useCallback(async () => {
    if (!groupId) return;
    setSaving(true);
    try {
      // Save tools and visibility in parallel
      await Promise.all([
        updateTools({ groupId, tools }),
        updateVisibility({ groupId, showToolbarToMembers, toolVisibility }),
      ]);
      setHasChanges(false);
      router.back();
    } catch (error) {
      console.error("Failed to save toolbar settings:", error);
    } finally {
      setSaving(false);
    }
  }, [groupId, tools, showToolbarToMembers, toolVisibility, updateTools, updateVisibility, router]);

  // Filter tools that can be shown (hide PCO-requiring tools if no PCO channels)
  // NOTE: This must be a useMemo to ensure hooks are called in consistent order
  const availableTools = useMemo(() => {
    return ALL_TOOLS.filter((tool) => {
      if (tool.requiresPco && !hasPcoChannels) return false;
      return true;
    });
  }, [hasPcoChannels]);

  // Create unified list of all toolbar items (tools + resources)
  const allUnifiedItems = useMemo((): UnifiedToolbarItem[] => {
    const items: UnifiedToolbarItem[] = [];

    // Add built-in tools
    const displayNames = (group as any)?.toolDisplayNames as Record<string, string> | undefined;
    for (const tool of availableTools) {
      items.push({
        id: tool.id,
        icon: tool.icon,
        label: displayNames?.[tool.id] || tool.label,
        isResource: false,
        hasSettings: TOOLS_WITH_SETTINGS.includes(tool.id),
        requiresPco: tool.requiresPco,
      });
    }

    // Add resources
    if (resources) {
      for (const resource of resources) {
        const toolId = createResourceToolId(resource._id);
        items.push({
          id: toolId,
          icon: resource.icon || "document-outline",
          label: resource.title,
          isResource: true,
          resourceId: resource._id,
          visibilityBadge:
            resource.visibility.type === "everyone"
              ? "All"
              : `New (${resource.visibility.daysWithin}d)`,
          hasSettings: true,
        });
      }
    }

    return items;
  }, [availableTools, resources]);

  // Split into enabled (in order) and disabled items
  const { enabledItems, disabledItems } = useMemo(() => {
    const enabled: UnifiedToolbarItem[] = [];
    const disabled: UnifiedToolbarItem[] = [];

    // First, add enabled items in the order they appear in tools array
    for (const toolId of tools) {
      const item = allUnifiedItems.find((i) => i.id === toolId);
      if (item) {
        enabled.push(item);
      }
    }

    // Then, add disabled items (not in tools array)
    for (const item of allUnifiedItems) {
      if (!tools.includes(item.id)) {
        disabled.push(item);
      }
    }

    return { enabledItems: enabled, disabledItems: disabled };
  }, [tools, allUnifiedItems]);

  // Handle settings navigation
  const handleSettingsPress = useCallback(
    (item: UnifiedToolbarItem) => {
      if (item.isResource && item.resourceId) {
        router.push(`/(user)/leader-tools/${groupId}/resources/${item.resourceId}`);
      } else if (item.hasSettings) {
        router.push(`/(user)/leader-tools/${groupId}/tool-settings/${item.id}`);
      }
    },
    [router, groupId]
  );

  // Loading state
  if (!group_id) {
    return (
      <UserRoute>
        <View style={styles.container}>
          <Text style={styles.errorText}>Group not found</Text>
        </View>
      </UserRoute>
    );
  }

  if (group === undefined) {
    return (
      <UserRoute>
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator size="large" />
        </View>
      </UserRoute>
    );
  }

  // Access denied
  if (!canAccess) {
    return (
      <UserRoute>
        <View style={[styles.container, styles.centered]}>
          <Text style={styles.errorText}>
            You don't have permission to access this page.
          </Text>
          <TouchableOpacity style={styles.button} onPress={handleBack}>
            <Text style={styles.buttonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </UserRoute>
    );
  }

  return (
    <UserRoute>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <DragHandle />
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Toolbar Settings</Text>
          {hasChanges ? (
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              style={styles.saveButtonContainer}
            >
              <Text style={styles.saveButton}>
                {saving ? "Saving..." : "Save"}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.headerSpacer} />
          )}
        </View>

        <ScrollView style={styles.content}>
          {/* Unified Toolbar Items Section */}
          <Text style={styles.sectionTitle}>Toolbar Items</Text>
          <Text style={styles.sectionDescription}>
            Select which tools and resources to show in the toolbar. Use arrows
            to reorder.
          </Text>

          {/* Enabled items (in order) */}
          {enabledItems.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.subsectionTitle}>Visible (in order)</Text>
              {enabledItems.map((item, index) => (
                <View key={item.id} style={styles.toolRow}>
                  <View style={styles.toolInfo}>
                    <Ionicons
                      name={item.icon as keyof typeof Ionicons.glyphMap}
                      size={20}
                      color="#333"
                    />
                    <Text style={styles.toolLabel}>{item.label}</Text>
                    {item.visibilityBadge && (
                      <View style={styles.visibilityBadgeInline}>
                        <Text style={styles.visibilityBadgeText}>
                          {item.visibilityBadge}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.toolActions}>
                    <TouchableOpacity
                      onPress={() => moveUp(item.id)}
                      disabled={index === 0}
                      style={styles.arrowButton}
                    >
                      <Ionicons
                        name="chevron-up"
                        size={20}
                        color={index === 0 ? "#ccc" : "#666"}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => moveDown(item.id)}
                      disabled={index === enabledItems.length - 1}
                      style={styles.arrowButton}
                    >
                      <Ionicons
                        name="chevron-down"
                        size={20}
                        color={index === enabledItems.length - 1 ? "#ccc" : "#666"}
                      />
                    </TouchableOpacity>
                    {item.hasSettings && (
                      <Pressable
                        onPress={() => handleSettingsPress(item)}
                        style={styles.gearButton}
                      >
                        <Ionicons name="settings-outline" size={18} color="#737373" />
                      </Pressable>
                    )}
                    <Switch value={true} onValueChange={() => toggleTool(item.id)} />
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Disabled items */}
          {disabledItems.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.subsectionTitle}>Hidden</Text>
              {disabledItems.map((item) => (
                <View key={item.id} style={styles.toolRow}>
                  <View style={styles.toolInfo}>
                    <Ionicons
                      name={item.icon as keyof typeof Ionicons.glyphMap}
                      size={20}
                      color="#999"
                    />
                    <Text style={[styles.toolLabel, styles.disabledLabel]}>
                      {item.label}
                    </Text>
                    {item.visibilityBadge && (
                      <View style={[styles.visibilityBadgeInline, styles.visibilityBadgeDisabled]}>
                        <Text style={[styles.visibilityBadgeText, styles.visibilityBadgeTextDisabled]}>
                          {item.visibilityBadge}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.toolActions}>
                    {item.hasSettings && (
                      <Pressable
                        onPress={() => handleSettingsPress(item)}
                        style={styles.gearButton}
                      >
                        <Ionicons name="settings-outline" size={18} color="#bbb" />
                      </Pressable>
                    )}
                    <Switch value={false} onValueChange={() => toggleTool(item.id)} />
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Empty state info */}
          {enabledItems.length === 0 && disabledItems.length === 0 && (
            <Text style={styles.emptyText}>
              No tools or resources available.
            </Text>
          )}

          {/* Create Resource Button */}
          <View style={styles.section}>
            <Pressable
              style={styles.addResourceButton}
              onPress={() =>
                router.push(`/(user)/leader-tools/${groupId}/resources/new`)
              }
            >
              <Ionicons name="add-circle-outline" size={20} color="#007AFF" />
              <Text style={styles.addResourceText}>Create Resource</Text>
            </Pressable>
          </View>

          {/* Visibility Settings Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Toolbar Visibility</Text>

            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Text style={styles.toggleLabel}>Show toolbar to members</Text>
                <Text style={styles.toggleDescription}>
                  When enabled, non-leader members can see selected tools
                </Text>
              </View>
              <Switch
                value={showToolbarToMembers}
                onValueChange={handleToggleShowToMembers}
              />
            </View>

            {showToolbarToMembers && enabledItems.filter((i) => !i.isResource).length > 0 && (
              <View style={styles.perToolVisibility}>
                <Text style={styles.subsectionTitle}>Tool Visibility</Text>
                <Text style={styles.visibilityHint}>
                  Control which tools members can see
                </Text>
                {enabledItems
                  .filter((item) => !item.isResource)
                  .map((item) => {
                    const toolDef = TOOLBAR_TOOLS[item.id as keyof typeof TOOLBAR_TOOLS];
                    // Get current visibility, fall back to tool's default or "leaders"
                    const currentVisibility =
                      toolVisibility[item.id] ??
                      (toolDef as ToolDefinition | undefined)?.defaultVisibility ??
                      "leaders";
                    const isEveryone = currentVisibility === "everyone";

                    return (
                      <View key={item.id} style={styles.toolVisibilityRow}>
                        <View style={styles.toolVisibilityInfo}>
                          <Ionicons
                            name={item.icon as keyof typeof Ionicons.glyphMap}
                            size={18}
                            color="#666"
                          />
                          <Text style={styles.toolVisibilityLabel}>{item.label}</Text>
                        </View>
                        <View style={styles.segmentedControl}>
                          <TouchableOpacity
                            style={[
                              styles.segmentButton,
                              styles.segmentButtonLeft,
                              !isEveryone && styles.segmentButtonActive,
                            ]}
                            onPress={() => handleToolVisibilityChange(item.id, "leaders")}
                          >
                            <Text
                              style={[
                                styles.segmentButtonText,
                                !isEveryone && styles.segmentButtonTextActive,
                              ]}
                            >
                              Leaders
                            </Text>
                          </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.segmentButton,
                            styles.segmentButtonRight,
                            isEveryone && styles.segmentButtonActive,
                          ]}
                          onPress={() => handleToolVisibilityChange(item.id, "everyone")}
                        >
                          <Text
                            style={[
                              styles.segmentButtonText,
                              isEveryone && styles.segmentButtonTextActive,
                            ]}
                          >
                            Everyone
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </UserRoute>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    textAlign: "center",
  },
  headerSpacer: {
    width: 60,
  },
  saveButtonContainer: {
    minWidth: 60,
    alignItems: "flex-end",
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 8,
    color: "#333",
  },
  sectionDescription: {
    fontSize: 14,
    color: "#666",
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
  },
  subsectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#999",
    marginBottom: 12,
    textTransform: "uppercase",
  },
  toolRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  toolInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  toolLabel: {
    fontSize: 16,
    color: "#333",
  },
  disabledLabel: {
    color: "#999",
  },
  toolActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  arrowButton: {
    padding: 4,
  },
  gearButton: {
    padding: 4,
  },
  saveButton: {
    fontSize: 16,
    fontWeight: "600",
    color: "#007AFF",
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: "#007AFF",
    borderRadius: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  errorText: {
    fontSize: 16,
    color: "#666",
    marginBottom: 16,
    textAlign: "center",
    marginTop: 40,
  },
  emptyText: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    marginTop: 24,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 16,
  },
  toggleLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 4,
  },
  toggleDescription: {
    fontSize: 13,
    color: "#666",
  },
  perToolVisibility: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  visibilityHint: {
    fontSize: 13,
    color: "#666",
    marginBottom: 12,
  },
  toolVisibilityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  toolVisibilityInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toolVisibilityLabel: {
    fontSize: 15,
    color: "#333",
  },
  segmentedControl: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    overflow: "hidden",
  },
  segmentButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  segmentButtonLeft: {
    borderRightWidth: 1,
    borderRightColor: "#e0e0e0",
  },
  segmentButtonRight: {
    // No additional styles needed
  },
  segmentButtonActive: {
    backgroundColor: "#007AFF",
  },
  segmentButtonText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#666",
  },
  segmentButtonTextActive: {
    color: "#fff",
  },
  // Visibility badge styles
  visibilityBadgeText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#666",
  },
  visibilityBadgeInline: {
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 4,
  },
  visibilityBadgeDisabled: {
    backgroundColor: "#f5f5f5",
  },
  visibilityBadgeTextDisabled: {
    color: "#aaa",
  },
  addResourceButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 4,
  },
  addResourceText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#007AFF",
  },
});
