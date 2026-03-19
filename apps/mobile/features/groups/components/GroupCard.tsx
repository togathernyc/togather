import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { getGroupTypeLabel, getGroupTypeColors } from "../utils";
import { Group } from "../types";
import { AppImageBackground } from "@components/ui/AppImageBackground";
import { useTheme } from "@hooks/useTheme";

interface GroupCardProps {
  group: Group;
  user: any;
  onPress?: () => void;
}

export function GroupCard({ group, user, onPress }: GroupCardProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const typeLabel = getGroupTypeLabel(group.type || 1, user);
  const typeColors = getGroupTypeColors(group.type || 1);
  const previewUrl = group.preview || group.image_url;
  const hasImage = !!previewUrl;

  // Get the group ID for navigation - use Convex _id
  const getGroupId = useCallback(() => {
    return group._id;
  }, [group._id]);


  const handlePress = () => {
    if (onPress) {
      onPress();
    } else {
      // Use Convex _id for navigation, fallback to uuid/id for legacy
      const groupId = getGroupId();
      router.push(`/groups/${groupId}`);
    }
  };

  const locationOrName =
    group.location || group.title || group.name || "Untitled Group";

  const content = (
    <>
      {group.is_new && hasImage && (
        <View style={styles.newLabel}>
          <Text style={styles.newLabelText}>NEW</Text>
        </View>
      )}
      <View style={styles.groupInfo}>
        {/* Type tag in bottom-left */}
        {group.type !== 3 && typeLabel && (
          <View style={[styles.typeLabel, { backgroundColor: typeColors.bg }]}>
            <Text style={[styles.typeLabelText, { color: typeColors.color }]}>
              {typeLabel}
            </Text>
          </View>
        )}
        {group.type === 3 && group.status === 0 && (
          <View style={[styles.typeLabel, { backgroundColor: "#E6F3FF" }]}>
            <Text style={[styles.typeLabelText, { color: "#0A84FF" }]}>
              PENDING
            </Text>
          </View>
        )}
        {/* Location or group name at bottom - large, bold, uppercase */}
        {locationOrName && (
          <Text
            style={[
              styles.locationText,
              hasImage
                ? styles.locationTextWithImage
                : { color: colors.text },
            ]}
            numberOfLines={1}
          >
            {locationOrName.toUpperCase()}
          </Text>
        )}
      </View>
    </>
  );

  return (
    <Pressable
      style={({ pressed }) => [
        styles.groupItem,
        !hasImage && [styles.groupItemWithoutImage, { backgroundColor: colors.surfaceSecondary }],
        pressed && styles.groupItemPressed,
      ]}
      onPress={handlePress}
    >
      {hasImage ? (
        <AppImageBackground
          source={previewUrl}
          style={styles.groupImage}
          imageStyle={styles.groupImageStyle}
        >
          <View style={styles.gradientOverlay}>
            {content}
          </View>
        </AppImageBackground>
      ) : (
        <View style={styles.groupItemContent}>{content}</View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  groupItem: {
    width: "48%",
    height: 284,
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 12, // Consistent spacing between cards
    ...Platform.select({
      web: {
        boxShadow: "0px 2px 8px rgba(0, 0, 0, 0.1)",
      },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 3,
      },
    }),
  },
  groupItemWithoutImage: {
    // backgroundColor set dynamically via theme
  },
  groupItemPressed: {
    opacity: 0.8,
  },
  groupItemContent: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 16,
  },
  groupImage: {
    width: "100%",
    height: "100%",
    justifyContent: "flex-end",
  },
  groupImageStyle: {
    borderRadius: 16,
  },
  gradient: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 20,
  },
  gradientOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 20,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  newLabel: {
    position: "absolute",
    top: 20,
    left: 20,
    backgroundColor: "#ebf9ee",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 15,
  },
  newLabelText: {
    color: "#207936",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 15,
  },
  groupInfo: {
    position: "absolute",
    bottom: 16,
    left: 16,
    right: 16,
  },
  typeLabel: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 4,
    alignSelf: "flex-start",
  },
  typeLabelText: {
    fontSize: 10,
    fontWeight: "600",
    lineHeight: 15,
    textTransform: "none",
  },
  locationText: {
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 24,
    textTransform: "uppercase",
    marginTop: 0,
  },
  locationTextWithImage: {
    color: "#ffffff", // White text on dark gradient
  },
  locationTextWithoutImage: {
    // color set dynamically via theme
  },
});
