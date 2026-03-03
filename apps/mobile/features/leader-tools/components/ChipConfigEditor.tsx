import React, { useCallback, useState, useEffect } from "react";
import { View, Text, StyleSheet, Switch, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";

interface ChipConfig {
  hidden: string[];
  order: string[];
}

interface Props {
  availableCategories: string[];
  config?: ChipConfig;
  onChange: (config: ChipConfig) => void;
}

export function ChipConfigEditor({ availableCategories, config, onChange }: Props) {
  const { primaryColor } = useCommunityTheme();
  const themeColor = primaryColor || DEFAULT_PRIMARY_COLOR;

  // Initialize local state from config
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(
    new Set(config?.hidden || [])
  );
  const [orderedCategories, setOrderedCategories] = useState<string[]>(
    config?.order || []
  );

  // Sync with prop changes
  useEffect(() => {
    setHiddenCategories(new Set(config?.hidden || []));
    setOrderedCategories(config?.order || []);
  }, [config]);

  // Get visible categories in order
  const getVisibleCategories = useCallback(() => {
    // Start with the ordered ones
    const ordered = orderedCategories.filter(
      (cat) => availableCategories.includes(cat) && !hiddenCategories.has(cat)
    );
    // Add any new categories not in the order list
    const newCategories = availableCategories.filter(
      (cat) => !orderedCategories.includes(cat) && !hiddenCategories.has(cat)
    );
    return [...ordered, ...newCategories];
  }, [orderedCategories, availableCategories, hiddenCategories]);

  const handleToggleVisibility = useCallback((category: string) => {
    setHiddenCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }

      // Notify parent of change
      const newConfig: ChipConfig = {
        hidden: Array.from(newSet),
        order: orderedCategories,
      };
      onChange(newConfig);

      return newSet;
    });
  }, [orderedCategories, onChange]);

  const handleMoveUp = useCallback((category: string) => {
    const visibleCats = getVisibleCategories();
    const index = visibleCats.indexOf(category);
    if (index <= 0) return;

    const newOrder = [...visibleCats];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];

    setOrderedCategories(newOrder);

    const newConfig: ChipConfig = {
      hidden: Array.from(hiddenCategories),
      order: newOrder,
    };
    onChange(newConfig);
  }, [getVisibleCategories, hiddenCategories, onChange]);

  const handleMoveDown = useCallback((category: string) => {
    const visibleCats = getVisibleCategories();
    const index = visibleCats.indexOf(category);
    if (index < 0 || index >= visibleCats.length - 1) return;

    const newOrder = [...visibleCats];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];

    setOrderedCategories(newOrder);

    const newConfig: ChipConfig = {
      hidden: Array.from(hiddenCategories),
      order: newOrder,
    };
    onChange(newConfig);
  }, [getVisibleCategories, hiddenCategories, onChange]);

  const visibleCategories = getVisibleCategories();
  const hiddenCategoriesList = availableCategories.filter((cat) =>
    hiddenCategories.has(cat)
  );

  if (availableCategories.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          No categories available. Categories will appear after loading a run sheet.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Visible Categories */}
      {visibleCategories.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.subsectionTitle}>
            Visible (in order)
          </Text>
          {visibleCategories.map((category, index) => (
            <View
              key={category}
              style={styles.categoryRow}
            >
              <Text style={styles.categoryName}>
                {category}
              </Text>
              <View style={styles.controls}>
                <Pressable
                  style={styles.arrowButton}
                  onPress={() => handleMoveUp(category)}
                  disabled={index === 0}
                >
                  <Ionicons
                    name="chevron-up"
                    size={20}
                    color={index === 0 ? "#ccc" : "#666"}
                  />
                </Pressable>
                <Pressable
                  style={styles.arrowButton}
                  onPress={() => handleMoveDown(category)}
                  disabled={index === visibleCategories.length - 1}
                >
                  <Ionicons
                    name="chevron-down"
                    size={20}
                    color={index === visibleCategories.length - 1 ? "#ccc" : "#666"}
                  />
                </Pressable>
                <Switch
                  value={true}
                  onValueChange={() => handleToggleVisibility(category)}
                  trackColor={{ false: "#e0e0e0", true: themeColor }}
                />
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Hidden Categories */}
      {hiddenCategoriesList.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.subsectionTitle}>
            Hidden
          </Text>
          {hiddenCategoriesList.map((category) => (
            <View
              key={category}
              style={styles.categoryRow}
            >
              <Text style={styles.categoryNameHidden}>
                {category}
              </Text>
              <View style={styles.controls}>
                <Switch
                  value={false}
                  onValueChange={() => handleToggleVisibility(category)}
                  trackColor={{ false: "#e0e0e0", true: themeColor }}
                />
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
  },
  emptyContainer: {
    padding: 16,
  },
  emptyText: {
    fontSize: 14,
    fontStyle: "italic",
    textAlign: "center",
    color: "#999",
  },
  section: {
    marginBottom: 16,
  },
  subsectionTitle: {
    fontSize: 12,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    color: "#999",
  },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  categoryName: {
    fontSize: 16,
    flex: 1,
    color: "#333",
  },
  categoryNameHidden: {
    fontSize: 16,
    flex: 1,
    color: "#999",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  arrowButton: {
    padding: 4,
  },
});
