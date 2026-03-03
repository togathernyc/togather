import React, { useState, useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, Alert, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ProgrammaticTextInput } from "@components/ui";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
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
    <View style={styles.container}>
      <View style={styles.header}>
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
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Group Search</Text>
      </View>

      <View style={styles.searchContainer}>
        <View style={styles.searchInputContainer}>
          <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
          <ProgrammaticTextInput
            style={styles.searchInput}
            placeholder="Keyword or zip code"
            placeholderTextColor="#999"
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
              <Ionicons name="hourglass" size={20} color="#666" />
            ) : (
              <Ionicons name="locate" size={20} color="#666" />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Filter Row */}
      <View style={styles.filterContainer}>
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
                  isSelected && { backgroundColor: primaryColor, borderColor: primaryColor },
                ]}
                onPress={() => setSelectedType(option.value)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.filterChipText,
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
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
  },
  searchContainer: {
    padding: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  searchInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
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
    color: "#333",
    paddingVertical: Platform.OS === "web" ? 8 : 4,
  },
  locationButton: {
    padding: 4,
    marginLeft: 8,
  },
  filterContainer: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    paddingVertical: 12,
  },
  filterScrollContent: {
    paddingHorizontal: 16,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#e0e0e0",
    marginRight: 8,
  },
  filterChipSelected: {
    // Dynamic styles applied inline
  },
  filterChipText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#666",
  },
  filterChipTextSelected: {
    color: "#fff",
    fontWeight: "600",
  },
});
