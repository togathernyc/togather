/**
 * PositionSelector - Searchable multi-select component for PCO positions.
 *
 * Used in the filter-based PCO auto channels configuration to allow users
 * to select multiple positions from their Planning Center account.
 *
 * Features:
 * - SearchBar at the top for filtering positions
 * - FlatList showing positions with checkboxes
 * - Count display next to each position
 * - Selected positions shown as removable chips
 * - Empty state when no positions match search
 * - Loading state while positions load
 */
import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SearchBar } from "@components/ui";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

interface Position {
  name: string;
  teamId?: string | null;
  teamName?: string | null;
  serviceTypeId?: string | null;
  serviceTypeName?: string | null;
  displayName?: string;
  count: number;
}

interface PositionSelectorProps {
  positions: Position[];
  selected: Position[];
  onChange: (selected: Position[]) => void;
  loading?: boolean;
}

export function PositionSelector({
  positions,
  selected,
  onChange,
  loading = false,
}: PositionSelectorProps) {
  const { primaryColor } = useCommunityTheme();
  const [searchQuery, setSearchQuery] = useState("");

  // Filter positions based on search query
  // Searches both the position name and the full displayName
  const filteredPositions = useMemo(() => {
    if (!searchQuery.trim()) {
      return positions;
    }
    const query = searchQuery.toLowerCase();
    return positions.filter((position) => {
      const nameMatch = position.name.toLowerCase().includes(query);
      const displayMatch = position.displayName?.toLowerCase().includes(query);
      return nameMatch || displayMatch;
    });
  }, [positions, searchQuery]);

  // Get the unique identifier for a position (displayName or name)
  const getPositionKey = (position: Position) => position.displayName || position.name;

  // Check if a position is selected by comparing displayName (which includes context)
  const isPositionSelected = (position: Position) => {
    const key = getPositionKey(position);
    return selected.some((p) => getPositionKey(p) === key);
  };

  const handleTogglePosition = (position: Position) => {
    const key = getPositionKey(position);
    if (isPositionSelected(position)) {
      onChange(selected.filter((p) => getPositionKey(p) !== key));
    } else {
      onChange([...selected, position]);
    }
  };

  const handleRemovePosition = (position: Position) => {
    const key = getPositionKey(position);
    onChange(selected.filter((p) => getPositionKey(p) !== key));
  };

  const renderEmptyState = () => {
    if (loading) {
      return null;
    }
    return (
      <View style={styles.emptyState}>
        <Ionicons name="search-outline" size={48} color="#bdbdc1" />
        <Text style={styles.emptyStateTitle}>No positions found</Text>
        <Text style={styles.emptyStateMessage}>
          {searchQuery
            ? `No positions match "${searchQuery}"`
            : "No positions available"}
        </Text>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={primaryColor} />
        <Text style={styles.loadingText}>Loading positions...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Selected chips */}
      {selected.length > 0 && (
        <View style={styles.chipsContainer}>
          <Text style={styles.chipsLabel}>Selected positions:</Text>
          <View style={styles.chips}>
            {selected.map((position) => {
              // Display the displayName which includes team/service context
              const displayText = getPositionKey(position);
              return (
                <TouchableOpacity
                  key={displayText}
                  style={[
                    styles.chip,
                    { backgroundColor: primaryColor + "20" },
                  ]}
                  onPress={() => handleRemovePosition(position)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, { color: primaryColor }]}>
                    {displayText}
                  </Text>
                  <Ionicons name="close" size={14} color={primaryColor} />
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* Search bar */}
      <SearchBar
        placeholder="Search positions..."
        value={searchQuery}
        onChangeText={setSearchQuery}
        style={styles.searchBar}
      />

      {/* Position list */}
      <View style={styles.list}>
        {filteredPositions.length === 0 ? (
          renderEmptyState()
        ) : (
          filteredPositions.map((item) => {
            // Use displayName with team/service context, fallback to name
            const displayText = item.displayName || item.name;
            // Use displayName as the unique key for selection
            const positionKey = getPositionKey(item);
            const isSelected = isPositionSelected(item);
            return (
              <TouchableOpacity
                key={positionKey}
                style={styles.positionItem}
                onPress={() => handleTogglePosition(item)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                  size={24}
                  color={isSelected ? primaryColor : "#ccc"}
                />
                <View style={styles.positionInfo}>
                  <Text style={styles.positionName}>{displayText}</Text>
                  <Text style={styles.positionCount}>({item.count})</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  loadingText: {
    marginLeft: 8,
    fontSize: 14,
    color: "#666",
  },
  chipsContainer: {
    padding: 12,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    marginBottom: 12,
  },
  chipsLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 8,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
  },
  searchBar: {
    marginBottom: 8,
  },
  list: {
    flex: 1,
  },
  positionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    gap: 12,
  },
  positionInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 6,
  },
  positionName: {
    fontSize: 15,
    fontWeight: "500",
    color: "#333",
  },
  positionCount: {
    fontSize: 14,
    color: "#999",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    minHeight: 200,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginTop: 16,
    marginBottom: 4,
  },
  emptyStateMessage: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
});
