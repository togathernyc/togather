/**
 * useExpandedGroups - Manages expanded/collapsed state for inbox groups
 *
 * Allows users to "expand" groups to see all channels (not just unread ones).
 * State is persisted to AsyncStorage so it survives app restarts.
 */

import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "expandedInboxGroups";

/**
 * Hook to manage which groups are expanded in the inbox
 * @returns Object with expanded group IDs set and toggle functions
 */
export function useExpandedGroups() {
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    new Set()
  );
  const [isLoaded, setIsLoaded] = useState(false);

  // Load expanded groups from AsyncStorage on mount
  useEffect(() => {
    const loadExpandedGroups = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as string[];
          setExpandedGroupIds(new Set(parsed));
        }
      } catch (error) {
        console.error("[useExpandedGroups] Failed to load from storage:", error);
      } finally {
        setIsLoaded(true);
      }
    };

    loadExpandedGroups();
  }, []);

  // Save to AsyncStorage whenever the set changes
  const saveToStorage = useCallback(async (groupIds: Set<string>) => {
    try {
      const array = Array.from(groupIds);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(array));
    } catch (error) {
      console.error("[useExpandedGroups] Failed to save to storage:", error);
    }
  }, []);

  // Toggle a group's expanded state
  const toggleGroupExpanded = useCallback(
    (groupId: string) => {
      setExpandedGroupIds((prev) => {
        const next = new Set(prev);
        if (next.has(groupId)) {
          next.delete(groupId);
        } else {
          next.add(groupId);
        }
        // Save asynchronously
        saveToStorage(next);
        return next;
      });
    },
    [saveToStorage]
  );

  // Check if a group is expanded
  const isGroupExpanded = useCallback(
    (groupId: string) => {
      return expandedGroupIds.has(groupId);
    },
    [expandedGroupIds]
  );

  return {
    expandedGroupIds,
    toggleGroupExpanded,
    isGroupExpanded,
    isLoaded,
  };
}
