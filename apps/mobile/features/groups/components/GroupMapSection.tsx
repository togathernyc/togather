import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Group } from "../types";
import { useTheme } from "@hooks/useTheme";

interface GroupMapSectionProps {
  group: Group;
}

/**
 * GroupMapSection component displays the group location.
 * Shows location text with a map icon and allows opening in maps app.
 */
export function GroupMapSection({ group }: GroupMapSectionProps) {
  const { colors } = useTheme();
  // Prioritize structured address fields over legacy location field
  // Use full_address if available, otherwise construct from structured fields, fallback to location
  const location = 
    group.full_address ||
    (group.address_line1 || group.city || group.state || group.zip_code
      ? [
          group.address_line1,
          group.address_line2,
          [group.city, group.state].filter(Boolean).join(", "),
          group.zip_code,
        ]
          .filter(Boolean)
          .join(", ")
      : null) ||
    group.location;

  // Don't render if no location
  if (!location || location.trim() === "") {
    return null;
  }

  // Google Maps URL for opening in app/browser
  const encodedLocation = encodeURIComponent(location);
  const mapsUrl =
    Platform.OS === "ios"
      ? `maps://maps.apple.com/?q=${encodedLocation}`
      : `https://www.google.com/maps/search/?api=1&query=${encodedLocation}`;

  const handleMapPress = async () => {
    try {
      const canOpen = await Linking.canOpenURL(mapsUrl);
      if (canOpen) {
        await Linking.openURL(mapsUrl);
      } else {
        // Fallback to web URL
        await Linking.openURL(
          `https://www.google.com/maps/search/?api=1&query=${encodedLocation}`
        );
      }
    } catch (error) {
      console.error("Error opening maps:", error);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <Text style={[styles.header, { color: colors.text }]}>LOCATION</Text>
      <TouchableOpacity
        style={[styles.mapContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={handleMapPress}
        activeOpacity={0.8}
      >
        <View style={[styles.mapPlaceholder, { backgroundColor: colors.surfaceSecondary }]}>
          <Ionicons name="map" size={48} color={colors.link} />
          <View style={styles.locationInfo}>
            <View style={styles.locationRow}>
              <Ionicons name="location" size={20} color={colors.link} />
              <Text style={[styles.locationText, { color: colors.text }]} numberOfLines={2}>
                {location}
              </Text>
            </View>
            <View style={[styles.openMapsButton, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.openMapsText, { color: colors.link }]}>Open in Maps</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.link} />
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginTop: 0,
  },
  header: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  mapContainer: {
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
  },
  mapPlaceholder: {
    width: "100%",
    minHeight: 150,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  locationInfo: {
    width: "100%",
    marginTop: 12,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  locationText: {
    fontSize: 14,
    fontWeight: "500",
    marginLeft: 8,
    flex: 1,
  },
  openMapsButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    alignSelf: "center",
  },
  openMapsText: {
    fontSize: 14,
    fontWeight: "600",
    marginRight: 4,
  },
});

