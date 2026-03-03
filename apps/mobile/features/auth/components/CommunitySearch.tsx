// CommunitySearch component - displays community search UI

import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ProgrammaticTextInput } from "@components/ui";
import { CommunitySearchResult } from "../types";

interface CommunitySearchProps {
  query: string;
  results: CommunitySearchResult[];
  searching: boolean;
  onSearch: (query: string) => void;
  onSelect: (community: CommunitySearchResult) => void;
  onSignUp: () => void;
}

// Search icon component
function CommunitySearchIcon() {
  return (
    <View style={styles.iconWrapper}>
      <Ionicons name="search" size={120} color="#000" />
    </View>
  );
}

export function CommunitySearch({
  query,
  results,
  searching,
  onSearch,
  onSelect,
  onSignUp,
}: CommunitySearchProps) {
  return (
    <View style={styles.container}>
      {/* Togather branding at top */}
      <Text style={styles.brandTitle}>Togather</Text>

      {/* Large icon in the middle */}
      <CommunitySearchIcon />

      {/* Welcome heading */}
      <Text style={styles.welcomeTitle}>Welcome!</Text>

      {/* Description text */}
      <Text style={styles.description}>
        Find your community to login and join your community
      </Text>

      {/* Search bar styled as button */}
      <TouchableOpacity
        style={styles.searchButton}
        activeOpacity={0.8}
        onPress={() => {
          // Focus will be handled by the TextInput inside
        }}
      >
        <View style={styles.searchButtonContent}>
          <Ionicons
            name="search"
            size={20}
            color="#fff"
            style={styles.searchIcon}
          />
          <ProgrammaticTextInput
            style={[styles.searchInput, { color: "#fff" }]}
            placeholder="Search for Your Community"
            placeholderTextColor="#fff"
            value={query}
            onChangeText={onSearch}
            autoCapitalize="none"
            testID="signin-community-search"
            programmaticCheckInterval={400}
            minProgrammaticLength={2}
          />
          {searching && (
            <ActivityIndicator
              size="small"
              color="#fff"
              style={styles.searchLoader}
            />
          )}
        </View>
      </TouchableOpacity>

      {results.length > 0 && (
        <View style={styles.resultsContainer}>
          <Text style={styles.resultsLabel}>Select your community:</Text>
          {results.map((item) => (
            <TouchableOpacity
              key={String(item.id)}
              style={styles.communityResultItem}
              onPress={() => onSelect(item)}
            >
              <Text style={styles.communityResultName}>{item.name}</Text>
              {item.subdomain && (
                <Text style={styles.communityResultSubdomain}>
                  {item.subdomain}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {query.length >= 2 && results.length === 0 && !searching && (
        <Text style={styles.noResults}>
          No communities found. Try a different search.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    maxWidth: 500,
    alignSelf: "center",
    width: "100%",
    backgroundColor: "#fff",
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 20,
    marginBottom: 40,
    textAlign: "center",
    color: "#333",
  },
  iconWrapper: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 30,
  },
  welcomeTitle: {
    fontSize: 32,
    fontWeight: "bold",
    marginBottom: 12,
    textAlign: "center",
    color: "#000",
  },
  description: {
    fontSize: 16,
    color: "#333",
    marginBottom: 32,
    textAlign: "center",
    lineHeight: 22,
  },
  searchButton: {
    backgroundColor: "#4A4A4A", // Dark gray to match mock
    borderRadius: 12,
    marginBottom: 20,
    overflow: "hidden",
  },
  searchButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: "#fff",
    padding: 0,
  },
  searchLoader: {
    marginLeft: 8,
  },
  resultsContainer: {
    marginTop: 8,
    marginBottom: 20,
  },
  resultsLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
  },
  communityResultItem: {
    backgroundColor: "#f5f5f5",
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  communityResultName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 4,
  },
  communityResultSubdomain: {
    fontSize: 14,
    color: "#666",
  },
  noResults: {
    color: "#666",
    fontSize: 14,
    textAlign: "center",
    marginTop: 16,
    fontStyle: "italic",
  },
  linkButton: {
    marginTop: 16,
    alignItems: "center",
  },
  linkText: {
    color: "#007AFF",
    fontSize: 14,
  },
});
