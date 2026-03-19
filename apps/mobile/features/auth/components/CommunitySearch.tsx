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
import { useTheme } from "@hooks/useTheme";

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
  const { colors } = useTheme();
  return (
    <View style={styles.iconWrapper}>
      <Ionicons name="search" size={120} color={colors.text} />
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
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      {/* Togather branding at top */}
      <Text style={[styles.brandTitle, { color: colors.text }]}>Togather</Text>

      {/* Large icon in the middle */}
      <CommunitySearchIcon />

      {/* Welcome heading */}
      <Text style={[styles.welcomeTitle, { color: colors.text }]}>Welcome!</Text>

      {/* Description text */}
      <Text style={[styles.description, { color: colors.text }]}>
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
          <Text style={[styles.resultsLabel, { color: colors.text }]}>Select your community:</Text>
          {results.map((item) => (
            <TouchableOpacity
              key={String(item.id)}
              style={[styles.communityResultItem, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
              onPress={() => onSelect(item)}
            >
              <Text style={[styles.communityResultName, { color: colors.text }]}>{item.name}</Text>
              {item.subdomain && (
                <Text style={[styles.communityResultSubdomain, { color: colors.textSecondary }]}>
                  {item.subdomain}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {query.length >= 2 && results.length === 0 && !searching && (
        <Text style={[styles.noResults, { color: colors.textSecondary }]}>
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
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 20,
    marginBottom: 40,
    textAlign: "center",
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
  },
  description: {
    fontSize: 16,
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
    marginBottom: 12,
  },
  communityResultItem: {
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
  },
  communityResultName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  communityResultSubdomain: {
    fontSize: 14,
  },
  noResults: {
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
    fontSize: 14,
  },
});
