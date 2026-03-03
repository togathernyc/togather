/**
 * Feature Flags Developer Tools
 *
 * A developer tool for viewing and overriding feature flags.
 * Shows all PostHog feature flags with their current values and allows
 * developers to override flags locally for testing.
 *
 * Only accessible in dev/staging builds or when dev tools escape hatch is enabled.
 */

import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Platform,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePostHog } from "posthog-react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, Button } from "@components/ui";
import { useFeatureFlagOverrides } from "@/hooks/useFeatureFlag";
import { useDevToolsEscapeHatch } from "@/hooks/useDevToolsEscapeHatch";
import { Environment } from "@/services/environment";

type OverrideState = "on" | "default" | "off";

interface FlagItem {
  name: string;
  posthogValue: boolean | string | undefined;
  overrideState: OverrideState;
  effectiveValue: boolean | string;
  isOverridden: boolean;
}

export default function FeatureFlagsPage() {
  const insets = useSafeAreaInsets();
  const posthog = usePostHog();
  const { isEnabled: devToolsEnabled } = useDevToolsEscapeHatch();
  const {
    overrides,
    loading: overridesLoading,
    setOverride,
    clearAll,
    hasOverride,
    getOverride,
  } = useFeatureFlagOverrides();

  // Search/filter input
  const [searchQuery, setSearchQuery] = useState("");
  const [customFlagName, setCustomFlagName] = useState("");

  // Environment check - only show in dev/staging or when escape hatch is enabled
  const shouldShow = __DEV__ || Environment.isStaging() || devToolsEnabled;

  // Get all feature flags from PostHog
  const posthogFlags = useMemo(() => {
    if (!posthog) return {};
    try {
      // getFeatureFlags returns a record of flag names to values
      return posthog.getFeatureFlags() || {};
    } catch {
      return {};
    }
  }, [posthog]);

  // Build the list of flags with their states
  const flagItems = useMemo((): FlagItem[] => {
    const flagNames = new Set<string>();

    // Add all PostHog flags
    Object.keys(posthogFlags).forEach((name) => flagNames.add(name));

    // Add all overridden flags (in case they're not in PostHog response)
    Object.keys(overrides).forEach((name) => flagNames.add(name));

    // Build flag items
    const items: FlagItem[] = Array.from(flagNames).map((name) => {
      const posthogValue = posthogFlags[name];
      const isOverridden = hasOverride(name);
      const overrideValue = getOverride(name);

      let overrideState: OverrideState = "default";
      if (isOverridden) {
        overrideState = overrideValue ? "on" : "off";
      }

      // Calculate effective value
      let effectiveValue: boolean | string;
      if (isOverridden) {
        effectiveValue = overrideValue;
      } else if (typeof posthogValue === "boolean") {
        effectiveValue = posthogValue;
      } else if (typeof posthogValue === "string") {
        effectiveValue = posthogValue;
      } else {
        effectiveValue = false;
      }

      return {
        name,
        posthogValue,
        overrideState,
        effectiveValue,
        isOverridden,
      };
    });

    // Filter by search query
    const filtered = searchQuery
      ? items.filter((item) =>
          item.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : items;

    // Sort: overridden flags first, then alphabetically
    return filtered.sort((a, b) => {
      if (a.isOverridden && !b.isOverridden) return -1;
      if (!a.isOverridden && b.isOverridden) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [posthogFlags, overrides, hasOverride, getOverride, searchQuery]);

  // Handle toggle for a flag
  const handleToggle = useCallback(
    async (flagName: string, newState: OverrideState) => {
      if (newState === "default") {
        await setOverride(flagName, null);
      } else {
        await setOverride(flagName, newState === "on");
      }
    },
    [setOverride]
  );

  // Handle clear all with confirmation
  const handleClearAll = useCallback(() => {
    const overrideCount = Object.keys(overrides).length;
    if (overrideCount === 0) {
      Alert.alert("No Overrides", "There are no feature flag overrides to clear.");
      return;
    }

    Alert.alert(
      "Clear All Overrides",
      `Are you sure you want to clear all ${overrideCount} feature flag override(s)? Flags will return to their PostHog values.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: clearAll,
        },
      ]
    );
  }, [overrides, clearAll]);

  // Handle adding a custom flag for testing
  const handleAddCustomFlag = useCallback(() => {
    const trimmedName = customFlagName.trim();
    if (!trimmedName) {
      Alert.alert("Invalid Flag Name", "Please enter a flag name.");
      return;
    }

    // Check if flag already exists
    const exists =
      Object.prototype.hasOwnProperty.call(posthogFlags, trimmedName) ||
      hasOverride(trimmedName);
    if (exists) {
      Alert.alert(
        "Flag Exists",
        `The flag "${trimmedName}" already exists in the list.`
      );
      return;
    }

    // Add as a disabled override so it shows in the list
    setOverride(trimmedName, false);
    setCustomFlagName("");
  }, [customFlagName, posthogFlags, hasOverride, setOverride]);

  // Format PostHog value for display
  const formatPostHogValue = (value: boolean | string | undefined): string => {
    if (value === undefined) return "undefined";
    if (typeof value === "boolean") return value ? "true" : "false";
    return `"${value}"`;
  };

  // Format effective value for display
  const formatEffectiveValue = (value: boolean | string): string => {
    if (typeof value === "boolean") return value ? "true" : "false";
    return `"${value}"`;
  };

  if (!shouldShow) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>
          This page is only available in dev/staging builds.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Text style={styles.headerTitle}>Feature Flags</Text>
          <Text style={styles.headerSubtitle}>
            View and override feature flags for testing
          </Text>
        </View>

        {/* Search and Actions */}
        <Card style={styles.section}>
          <View style={styles.searchRow}>
            <View style={styles.searchContainer}>
              <Ionicons
                name="search"
                size={18}
                color="#999"
                style={styles.searchIcon}
              />
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search flags..."
                placeholderTextColor="#999"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => setSearchQuery("")}
                  style={styles.clearButton}
                >
                  <Ionicons name="close-circle" size={18} color="#999" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Add Custom Flag */}
          <View style={styles.customFlagRow}>
            <TextInput
              style={styles.customFlagInput}
              value={customFlagName}
              onChangeText={setCustomFlagName}
              placeholder="Add custom flag for testing..."
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={handleAddCustomFlag}
            />
            <TouchableOpacity
              onPress={handleAddCustomFlag}
              style={styles.addButton}
              disabled={!customFlagName.trim()}
            >
              <Ionicons
                name="add-circle"
                size={28}
                color={customFlagName.trim() ? "#007AFF" : "#ccc"}
              />
            </TouchableOpacity>
          </View>

          {/* Clear All Button */}
          <Button
            onPress={handleClearAll}
            variant="danger"
            disabled={Object.keys(overrides).length === 0}
            style={styles.clearAllButton}
          >
            Clear All Overrides ({Object.keys(overrides).length})
          </Button>
        </Card>

        {/* Stats */}
        <Card style={styles.section}>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{Object.keys(posthogFlags).length}</Text>
              <Text style={styles.statLabel}>PostHog Flags</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{Object.keys(overrides).length}</Text>
              <Text style={styles.statLabel}>Overrides</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{flagItems.length}</Text>
              <Text style={styles.statLabel}>Showing</Text>
            </View>
          </View>
        </Card>

        {/* Flag List */}
        {overridesLoading ? (
          <Card style={styles.section}>
            <Text style={styles.loadingText}>Loading overrides...</Text>
          </Card>
        ) : flagItems.length === 0 ? (
          <Card style={styles.section}>
            <View style={styles.emptyState}>
              <Ionicons name="flag-outline" size={48} color="#ccc" />
              <Text style={styles.emptyStateText}>
                {searchQuery
                  ? "No flags match your search"
                  : "No feature flags found"}
              </Text>
              <Text style={styles.emptyStateSubtext}>
                {searchQuery
                  ? "Try a different search term or add a custom flag"
                  : "Feature flags will appear here when configured in PostHog"}
              </Text>
            </View>
          </Card>
        ) : (
          flagItems.map((flag) => (
            <Card key={flag.name} style={styles.flagCard}>
              <View style={styles.flagHeader}>
                <Text style={styles.flagName} numberOfLines={1}>
                  {flag.name}
                </Text>
                {flag.isOverridden && (
                  <View style={styles.overrideBadge}>
                    <Text style={styles.overrideBadgeText}>OVERRIDE</Text>
                  </View>
                )}
              </View>

              <View style={styles.flagValues}>
                <View style={styles.valueRow}>
                  <Text style={styles.valueLabel}>PostHog:</Text>
                  <Text style={styles.valueText}>
                    {formatPostHogValue(flag.posthogValue)}
                  </Text>
                </View>
                <View style={styles.valueRow}>
                  <Text style={styles.valueLabel}>Effective:</Text>
                  <Text
                    style={[
                      styles.valueText,
                      styles.effectiveValue,
                      flag.effectiveValue === true && styles.valueEnabled,
                      flag.effectiveValue === false && styles.valueDisabled,
                    ]}
                  >
                    {formatEffectiveValue(flag.effectiveValue)}
                  </Text>
                </View>
              </View>

              {/* Three-way Toggle */}
              <View style={styles.toggleContainer}>
                <TouchableOpacity
                  style={[
                    styles.toggleOption,
                    flag.overrideState === "on" && styles.toggleOptionOn,
                  ]}
                  onPress={() => handleToggle(flag.name, "on")}
                >
                  <Text
                    style={[
                      styles.toggleOptionText,
                      flag.overrideState === "on" && styles.toggleOptionTextActive,
                    ]}
                  >
                    On
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.toggleOption,
                    flag.overrideState === "default" && styles.toggleOptionDefault,
                  ]}
                  onPress={() => handleToggle(flag.name, "default")}
                >
                  <Text
                    style={[
                      styles.toggleOptionText,
                      flag.overrideState === "default" &&
                        styles.toggleOptionTextDefault,
                    ]}
                  >
                    Default
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.toggleOption,
                    flag.overrideState === "off" && styles.toggleOptionOff,
                  ]}
                  onPress={() => handleToggle(flag.name, "off")}
                >
                  <Text
                    style={[
                      styles.toggleOptionText,
                      flag.overrideState === "off" && styles.toggleOptionTextActive,
                    ]}
                  >
                    Off
                  </Text>
                </TouchableOpacity>
              </View>
            </Card>
          ))
        )}

        {/* Info Card */}
        <Card style={[styles.section, styles.infoCard]}>
          <View style={styles.infoRow}>
            <Ionicons name="information-circle" size={20} color="#007AFF" />
            <Text style={styles.infoText}>
              Overrides are stored locally and take precedence over PostHog values
              in dev/staging builds. Changes take effect immediately.
            </Text>
          </View>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  header: {
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#333",
  },
  headerSubtitle: {
    fontSize: 15,
    color: "#666",
    marginTop: 4,
  },
  section: {
    marginBottom: 16,
    padding: 16,
  },
  searchRow: {
    marginBottom: 12,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: "#333",
  },
  clearButton: {
    padding: 4,
  },
  customFlagRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  customFlagInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#333",
    backgroundColor: "#fafafa",
    marginRight: 8,
  },
  addButton: {
    padding: 4,
  },
  clearAllButton: {
    marginTop: 4,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  statItem: {
    alignItems: "center",
    flex: 1,
  },
  statValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
  },
  statLabel: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: "#e0e0e0",
  },
  loadingText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    padding: 20,
  },
  emptyState: {
    alignItems: "center",
    padding: 24,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#666",
    marginTop: 12,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    marginTop: 4,
  },
  flagCard: {
    marginBottom: 12,
    padding: 16,
  },
  flagHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  flagName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  overrideBadge: {
    backgroundColor: "#FF9500",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  overrideBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
  },
  flagValues: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  valueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  valueLabel: {
    fontSize: 13,
    color: "#666",
  },
  valueText: {
    fontSize: 13,
    color: "#333",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  effectiveValue: {
    fontWeight: "600",
  },
  valueEnabled: {
    color: "#34C759",
  },
  valueDisabled: {
    color: "#FF3B30",
  },
  toggleContainer: {
    flexDirection: "row",
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    padding: 4,
  },
  toggleOption: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: "center",
  },
  toggleOptionOn: {
    backgroundColor: "#34C759",
  },
  toggleOptionDefault: {
    backgroundColor: "#fff",
    ...Platform.select({
      web: {
        boxShadow: "0px 2px 4px rgba(0, 0, 0, 0.1)",
      },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
      },
    }),
  },
  toggleOptionOff: {
    backgroundColor: "#FF3B30",
  },
  toggleOptionText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#666",
  },
  toggleOptionTextActive: {
    color: "#fff",
  },
  toggleOptionTextDefault: {
    color: "#333", // Dark text on white Default background
  },
  infoCard: {
    backgroundColor: "#f0f7ff",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: "#333",
    marginLeft: 8,
    lineHeight: 18,
  },
  errorText: {
    fontSize: 16,
    color: "#FF3B30",
    textAlign: "center",
    padding: 20,
  },
});
