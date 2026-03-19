import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { GroupSearchItem } from "./GroupSearchItem";
import { useTheme } from "@hooks/useTheme";

interface GroupSearchListProps {
  groups: any[];
  isLoading: boolean;
  searchQuery: string;
  debouncedQuery: string;
}

export function GroupSearchList({
  groups,
  isLoading,
  searchQuery,
  debouncedQuery,
}: GroupSearchListProps) {
  const { colors } = useTheme();
  const isSearching = searchQuery !== debouncedQuery;
  const hasSearchQuery = searchQuery.trim().length > 0;

  // Show loading only when actively searching (query is being debounced)
  if (isSearching && hasSearchQuery) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.textSecondary} />
      </View>
    );
  }

  // Show empty state only when there's a search query and no results
  if (hasSearchQuery && groups.length === 0 && !isLoading) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No groups found</Text>
        <Text style={[styles.emptySubtext, { color: colors.textTertiary }]}>Try a different search term</Text>
      </View>
    );
  }

  // Show loading state on initial load
  if (isLoading && !hasSearchQuery && groups.length === 0) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.textSecondary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.sectionHeader, { color: colors.textTertiary }]}>ALL GROUPS</Text>
      <FlatList
        data={groups}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <GroupSearchItem group={item} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          !hasSearchQuery && !isLoading ? (
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No groups available</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    letterSpacing: 0.5,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: "center",
  },
});
