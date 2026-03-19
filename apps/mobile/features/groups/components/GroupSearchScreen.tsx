import React, { useState, useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, Alert, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ProgrammaticTextInput } from "@components/ui";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { GroupSearchList } from "./GroupSearchList";
import { useGroupSearch, useGroupTypes } from "../hooks";

// Try to import expo-location, but handle gracefully if not available
let Location: typeof import("expo-location") | null = null;
try {
  Location = require("expo-location");
} catch {
  // expo-location not available
}

export function GroupSearchScreen() {
  const router = useRouter();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const { searchQuery, setSearchQuery, debouncedQuery, groupsList, isLoading } =
    useGroupSearch(selectedType);
  const [_zipCode, setZipCode] = useState("");
  const [isLocationLoading, setIsLocationLoading] = useState(false);

  // Fetch group types from Convex
  const { data: groupTypes } = useGroupTypes();

  // Build filter options from fetched group types
  const filterOptions = useMemo(() => {
    const options: Array<{ value: string | null; label: string }> = [
      { value: null, label: "All" },
    ];
    if (groupTypes) {
      for (const gt of groupTypes) {
        options.push({ value: gt.id, label: gt.name });
      }
    }
    return options;
  }, [groupTypes]);

  const handleLocationPress = async () => {
    if (!Location) {
      Alert.alert(
        "Location Not Available",
        "Location services are not available. Please enter a zip code manually."
      );
      return;
    }

    setIsLocationLoading(true);
    try {
      // Request location permissions
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission Required",
          "Location permission is required to search by location."
        );
        setIsLocationLoading(false);
        return;
      }

      // Get current location
      const location = await Location.getCurrentPositionAsync({});
      
      // Reverse geocode to get zip code
      const geocode = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      if (geocode && geocode.length > 0 && geocode[0].postalCode) {
        const zip = geocode[0].postalCode;
        setZipCode(zip);
        setSearchQuery(zip);
      } else {
        Alert.alert(
          "Location Error",
          "Could not determine zip code from your location. Please enter a zip code manually."
        );
      }
    } catch (error) {
      console.error("Location error:", error);
      Alert.alert(
        "Location Error",
        "Failed to get your location. Please enter a zip code manually."
      );
    } finally {
      setIsLocationLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.push("/inbox");
            }
          }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Group Search</Text>
      </View>

      <View style={[styles.searchContainer, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <View style={[styles.searchInputContainer, { backgroundColor: colors.surfaceSecondary }]}>
          <Ionicons name="search" size={20} color={colors.textTertiary} style={styles.searchIcon} />
          <ProgrammaticTextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Keyword or zip code"
            placeholderTextColor={colors.inputPlaceholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
          <TouchableOpacity
            testID="location-button"
            style={styles.locationButton}
            onPress={handleLocationPress}
            disabled={isLocationLoading}
          >
            {isLocationLoading ? (
              <Ionicons name="hourglass" size={20} color={colors.textSecondary} />
            ) : (
              <Ionicons name="locate" size={20} color={colors.textSecondary} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Filter Row */}
      <View style={[styles.filterContainer, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScrollContent}
        >
          {filterOptions.map((option) => {
            const isSelected = selectedType === option.value;
            return (
              <TouchableOpacity
                key={option.value ?? "all"}
                style={[
                  styles.filterChip,
                  { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                  isSelected && { backgroundColor: primaryColor, borderColor: primaryColor },
                ]}
                onPress={() => setSelectedType(option.value)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    { color: colors.textSecondary },
                    isSelected && styles.filterChipTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <GroupSearchList
        groups={groupsList}
        isLoading={isLoading}
        searchQuery={searchQuery}
        debouncedQuery={debouncedQuery}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 24,
    fontWeight: "bold",
  },
  searchContainer: {
    padding: 12,
    borderBottomWidth: 1,
  },
  searchInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: Platform.OS === "web" ? 8 : 4,
  },
  locationButton: {
    padding: 4,
    marginLeft: 8,
  },
  filterContainer: {
    borderBottomWidth: 1,
    paddingVertical: 12,
  },
  filterScrollContent: {
    paddingHorizontal: 16,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  filterChipSelected: {
    // Dynamic styles applied inline
  },
  filterChipText: {
    fontSize: 14,
    fontWeight: "500",
  },
  filterChipTextSelected: {
    color: "#fff",
    fontWeight: "600",
  },
});
