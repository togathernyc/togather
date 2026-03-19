import React, { useCallback, useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useAuthenticatedQuery, useAuthenticatedMutation, useAuthenticatedAction, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { ChipConfigEditor } from "./ChipConfigEditor";
import { normalizeRoleName } from "../utils/runSheetUtils";
import { DragHandle } from "@components/ui/DragHandle";
import { useTheme } from "@hooks/useTheme";

// Types for run sheet data
interface RunSheetItem {
  notes: Array<{
    category: string;
    content: string;
  }>;
}

interface ServiceType {
  id: string;
  name: string;
}

interface Props {
  groupId: Id<"groups">;
}

// Type for group data with runSheetConfig
interface GroupWithRunSheetConfig {
  runSheetConfig?: {
    defaultServiceTypeIds?: string[];
    defaultView?: string;
    chipConfig?: {
      hidden: string[];
      order: string[];
    };
  };
}

export function RunSheetToolSettings({ groupId }: Props) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const themeColor = primaryColor || DEFAULT_PRIMARY_COLOR;
  const [availableServiceTypes, setAvailableServiceTypes] = useState<ServiceType[]>([]);
  const [defaultServiceTypeIds, setDefaultServiceTypeIds] = useState<string[]>([]);
  const [loadingServiceTypes, setLoadingServiceTypes] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [chipConfig, setChipConfig] = useState<{
    hidden: string[];
    order: string[];
  }>({ hidden: [], order: [] });
  const [allCategories, setAllCategories] = useState<Set<string>>(new Set());
  const [loadingRunSheet, setLoadingRunSheet] = useState(false);

  // Fetch group data (needs authentication to access runSheetConfig)
  const groupData = useAuthenticatedQuery(
    api.functions.groups.queries.getById,
    { groupId }
  ) as GroupWithRunSheetConfig | undefined | null;

  // Mutation to update run sheet config
  const updateRunSheetConfig = useAuthenticatedMutation(
    api.functions.groups.mutations.updateRunSheetConfig
  );

  // Action to get available service types
  const getAvailableServiceTypes = useAuthenticatedAction(
    api.functions.pcoServices.runSheet.getAvailableServiceTypes
  );

  // Action to get run sheet data (to extract categories)
  const getRunSheet = useAuthenticatedAction(
    api.functions.pcoServices.runSheet.getRunSheet
  );

  // Extract available categories from allCategories with normalization
  // This ensures that variants like "Video -PVP" and "Video - Pro 7" both show as "Video"
  const availableCategories = useMemo(() => {
    const normalized = new Set<string>();
    for (const cat of allCategories) {
      normalized.add(normalizeRoleName(cat));
    }
    return Array.from(normalized).sort();
  }, [allCategories]);

  // Load existing config when group data is available
  useEffect(() => {
    if (groupData?.runSheetConfig?.defaultServiceTypeIds) {
      setDefaultServiceTypeIds(groupData.runSheetConfig.defaultServiceTypeIds);
    }
  }, [groupData?.runSheetConfig?.defaultServiceTypeIds]);

  // Load existing chipConfig from group data
  useEffect(() => {
    if (groupData?.runSheetConfig?.chipConfig) {
      setChipConfig(groupData.runSheetConfig.chipConfig);
    }
  }, [groupData?.runSheetConfig?.chipConfig]);

  // Fetch available service types
  useEffect(() => {
    const fetchServiceTypes = async () => {
      if (!groupData) return;

      setLoadingServiceTypes(true);
      try {
        const serviceTypes = await getAvailableServiceTypes({ groupId });
        setAvailableServiceTypes(serviceTypes || []);
      } catch (error) {
        console.error("Failed to fetch service types:", error);
        setAvailableServiceTypes([]);
      } finally {
        setLoadingServiceTypes(false);
      }
    };

    fetchServiceTypes();
  }, [groupId, groupData, getAvailableServiceTypes]);

  // Fetch run sheet data from ALL selected service types to extract categories
  useEffect(() => {
    let cancelled = false;

    const fetchAllCategories = async () => {
      if (!defaultServiceTypeIds.length && !availableServiceTypes.length) return;

      setLoadingRunSheet(true);
      const serviceTypeIds = defaultServiceTypeIds.length > 0
        ? defaultServiceTypeIds
        : [availableServiceTypes[0]?.id].filter(Boolean);

      const allCats = new Set<string>();

      for (const serviceTypeId of serviceTypeIds) {
        // Check if effect was cancelled before each async operation
        if (cancelled) return;

        try {
          const sheet = await getRunSheet({ groupId, serviceTypeId });
          // Check again after async operation
          if (cancelled) return;

          if (sheet?.items) {
            sheet.items.forEach((item: RunSheetItem) => {
              item.notes.forEach((note) => {
                if (note.category) {
                  // Normalize category before adding to ensure consistency
                  // This ensures "Video -PVP" and "Video - Pro 7" both become "Video"
                  allCats.add(normalizeRoleName(note.category));
                }
              });
            });
          }
        } catch (error) {
          console.error(`Failed to fetch run sheet for ${serviceTypeId}:`, error);
        }
      }

      // Only update state if not cancelled
      if (!cancelled) {
        setAllCategories(allCats);
        setLoadingRunSheet(false);
      }
    };

    fetchAllCategories();

    // Cleanup function to cancel stale requests
    return () => {
      cancelled = true;
    };
  }, [groupId, defaultServiceTypeIds, availableServiceTypes, getRunSheet]);

  const handleToggleServiceType = useCallback((serviceTypeId: string) => {
    setDefaultServiceTypeIds((prev) => {
      if (prev.includes(serviceTypeId)) {
        return prev.filter((id) => id !== serviceTypeId);
      }
      return [...prev, serviceTypeId];
    });
    setHasChanges(true);
  }, []);

  // Handle chip config change
  const handleChipConfigChange = useCallback((newConfig: { hidden: string[]; order: string[] }) => {
    setChipConfig(newConfig);
    setHasChanges(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!hasChanges) return;

    try {
      await updateRunSheetConfig({
        groupId,
        runSheetConfig: {
          defaultServiceTypeIds,
          defaultView: groupData?.runSheetConfig?.defaultView,
          chipConfig,
        },
      });
      setHasChanges(false);
    } catch (error) {
      console.error("Failed to save run sheet config:", error);
    }
  }, [groupId, defaultServiceTypeIds, groupData?.runSheetConfig?.defaultView, chipConfig, updateRunSheetConfig, hasChanges]);

  if (!groupData) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.backgroundSecondary }]}>
        <ActivityIndicator color={themeColor} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}
      contentContainerStyle={styles.content}
    >
      <DragHandle />
      {/* Service Type Selection */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Default Service Types
        </Text>
        <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
          Select which service types to show by default in the Run Sheet
        </Text>

        {loadingServiceTypes ? (
          <ActivityIndicator style={styles.loader} color={themeColor} />
        ) : availableServiceTypes.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
            No PCO service types configured. Set up auto-channels first.
          </Text>
        ) : (
          <View style={styles.serviceTypeList}>
            {availableServiceTypes.map((serviceType) => {
              const isSelected = defaultServiceTypeIds.includes(serviceType.id);
              return (
                <Pressable
                  key={serviceType.id}
                  style={[styles.serviceTypeRow, { borderBottomColor: colors.border }]}
                  onPress={() => handleToggleServiceType(serviceType.id)}
                >
                  <Ionicons
                    name={isSelected ? "checkbox" : "square-outline"}
                    size={22}
                    color={isSelected ? themeColor : colors.textTertiary}
                  />
                  <Text
                    style={[
                      styles.serviceTypeName,
                      { color: isSelected ? colors.text : colors.textTertiary },
                    ]}
                  >
                    {serviceType.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {/* Chip Configuration */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Filter Chips
        </Text>
        <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
          Configure which filter chips appear and their order
        </Text>
        {loadingRunSheet ? (
          <ActivityIndicator style={styles.loader} color={themeColor} />
        ) : availableCategories.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
            No categories found. Categories will appear after loading a run sheet with notes.
          </Text>
        ) : (
          <ChipConfigEditor
            availableCategories={availableCategories}
            config={chipConfig}
            onChange={handleChipConfigChange}
          />
        )}
      </View>

      {/* Save Button */}
      {hasChanges && (
        <Pressable
          style={[styles.saveButton, { backgroundColor: themeColor }]}
          onPress={handleSave}
        >
          <Text style={[styles.saveButtonText, { color: colors.textInverse }]}>Save Changes</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
  },
  sectionDescription: {
    fontSize: 14,
    marginBottom: 16,
  },
  loader: {
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    fontStyle: "italic",
    marginTop: 8,
  },
  serviceTypeList: {
    marginTop: 8,
  },
  serviceTypeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  serviceTypeName: {
    fontSize: 16,
    flex: 1,
  },
  saveButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
