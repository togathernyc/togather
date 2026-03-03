import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppImage } from "@components/ui/AppImage";

interface NearbyGroup {
  id: string;
  name: string;
  description?: string | null;
  preview?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  isOnBreak: boolean;
  breakUntil?: string | number | null;
  groupTypeName?: string;
  groupTypeSlug?: string;
  memberCount: number;
  distanceMiles: number;
}

interface NearbyGroupCardProps {
  group: NearbyGroup;
  onPress: () => void;
}

/**
 * Card component for displaying a group in the nearme list
 *
 * Shows:
 * - Group preview image (or placeholder)
 * - Group name and type
 * - Distance badge
 * - Location (city, state)
 * - Member count
 */
export function NearbyGroupCard({ group, onPress }: NearbyGroupCardProps) {
  const locationText = [group.city, group.state].filter(Boolean).join(", ");

  return (
    <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.7}>
      {/* Preview Image */}
      <View style={styles.imageContainer}>
        <AppImage
          source={group.preview}
          style={styles.image}
          optimizedWidth={200}
          placeholder={{
            type: 'icon',
            icon: 'people',
          }}
        />
        {/* Distance Badge */}
        <View style={styles.distanceBadge}>
          <Text style={styles.distanceText}>{group.distanceMiles} mi</Text>
        </View>
      </View>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.name} numberOfLines={1}>
            {group.name}
          </Text>
          <View style={styles.typeBadge}>
            <Text style={styles.typeText}>{group.groupTypeName}</Text>
          </View>
        </View>

        {group.description && (
          <Text style={styles.description} numberOfLines={2}>
            {group.description}
          </Text>
        )}

        <View style={styles.footer}>
          {locationText && (
            <View style={styles.footerItem}>
              <Ionicons name="location-outline" size={14} color="#666" />
              <Text style={styles.footerText}>{locationText}</Text>
            </View>
          )}
          <View style={styles.footerItem}>
            <Ionicons name="people-outline" size={14} color="#666" />
            <Text style={styles.footerText}>
              {group.memberCount} member{group.memberCount !== 1 ? "s" : ""}
            </Text>
          </View>
        </View>

        {group.isOnBreak && (
          <View style={styles.breakBadge}>
            <Ionicons name="pause-circle-outline" size={14} color="#f39c12" />
            <Text style={styles.breakText}>
              On break{group.breakUntil ? ` until ${formatDate(group.breakUntil)}` : ""}
            </Text>
          </View>
        )}
      </View>

      {/* Arrow */}
      <View style={styles.arrow}>
        <Ionicons name="chevron-forward" size={20} color="#ccc" />
      </View>
    </TouchableOpacity>
  );
}

function formatDate(dateValue: string | number): string {
  try {
    const date = new Date(dateValue);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eee",
    overflow: "hidden",
  },
  imageContainer: {
    width: 100,
    height: 100,
    position: "relative",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  distanceBadge: {
    position: "absolute",
    bottom: 6,
    left: 6,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  distanceText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  content: {
    flex: 1,
    padding: 12,
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  name: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  typeBadge: {
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  typeText: {
    fontSize: 11,
    color: "#666",
    fontWeight: "500",
  },
  description: {
    fontSize: 13,
    color: "#666",
    lineHeight: 18,
    marginBottom: 6,
  },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  footerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  footerText: {
    fontSize: 12,
    color: "#666",
  },
  breakBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
    backgroundColor: "#fef9e7",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: "flex-start",
  },
  breakText: {
    fontSize: 12,
    color: "#f39c12",
  },
  arrow: {
    justifyContent: "center",
    paddingRight: 8,
  },
});
