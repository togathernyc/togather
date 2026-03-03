import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { GroupSearchItem } from "./GroupSearchItem";

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
  const isSearching = searchQuery !== debouncedQuery;
  const hasSearchQuery = searchQuery.trim().length > 0;

  // Show loading only when actively searching (query is being debounced)
  if (isSearching && hasSearchQuery) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#666" />
      </View>
    );
  }

  // Show empty state only when there's a search query and no results
  if (hasSearchQuery && groups.length === 0 && !isLoading) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No groups found</Text>
        <Text style={styles.emptySubtext}>Try a different search term</Text>
      </View>
    );
  }

  // Show loading state on initial load
  if (isLoading && !hasSearchQuery && groups.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#666" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.sectionHeader}>ALL GROUPS</Text>
      <FlatList
        data={groups}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <GroupSearchItem group={item} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          !hasSearchQuery && !isLoading ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No groups available</Text>
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
    backgroundColor: "#fff",
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "600",
    color: "#999",
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
    backgroundColor: "#fff",
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
    color: "#666",
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
  },
});
