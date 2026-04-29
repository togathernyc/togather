import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Group } from "../types";
import { formatCadence } from "../utils";
import { AppImageBackground } from "@components/ui/AppImageBackground";
import { useTheme } from "@hooks/useTheme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const HEADER_HEIGHT = SCREEN_WIDTH * 0.6; // 60% of screen width for aspect ratio

interface GroupHeaderProps {
  group: Group;
  /**
   * Tap handler for the (i) info button in the top-right of the hero.
   * Replaces the legacy 3-dot menu, whose actions now live in the
   * "GROUP ACTIONS" card at the bottom of the screen.
   */
  onInfoPress?: () => void;
  /** When false, the (i) button is hidden (e.g. non-member view). */
  showInfo?: boolean;
}

export function GroupHeader({ group, onInfoPress, showInfo = true }: GroupHeaderProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const previewUrl = group.preview || group.image_url;
  const hasImage = !!previewUrl;
  // Ensure group name always has a value
  const groupName = group?.title || group?.name || "Group";
  const cadence = formatCadence(group);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/groups");
    }
  };

  const iconColor = hasImage ? "#ffffff" : colors.text;
  const textColor = hasImage ? "#ffffff" : colors.text;

  const content = (
    <View style={styles.contentContainer}>
      {/* Top bar with back button and menu */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color={iconColor} />
        </TouchableOpacity>
        <View style={styles.topBarSpacer} />
        {showInfo && onInfoPress && (
          <TouchableOpacity
            style={styles.menuButton}
            onPress={onInfoPress}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Group info"
          >
            <Ionicons
              name="information-circle-outline"
              size={28}
              color={iconColor}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Group name and cadence */}
      <View style={styles.textContainer}>
        <Text 
          style={[
            styles.groupName, 
            { color: textColor },
            !hasImage && styles.groupNameNoImage
          ]} 
          numberOfLines={2}
        >
          {groupName}
        </Text>
        {cadence && (
          <Text 
            style={[
              styles.cadence, 
              { color: textColor },
              !hasImage && styles.cadenceNoImage
            ]} 
            numberOfLines={1}
          >
            {cadence}
          </Text>
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {hasImage ? (
        <AppImageBackground
          source={previewUrl}
          style={styles.imageBackground}
          imageStyle={styles.imageStyle}
          optimizedWidth={800}
        >
          <View style={styles.gradientOverlay}>
            {content}
          </View>
        </AppImageBackground>
      ) : (
        <View style={[styles.placeholderContainer, { backgroundColor: colors.border }]}>
          <View style={styles.gradient}>
            {content}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: HEADER_HEIGHT,
  },
  imageBackground: {
    width: "100%",
    height: "100%",
  },
  imageStyle: {
    resizeMode: "cover",
  },
  placeholderContainer: {
    width: "100%",
    height: "100%",
    backgroundColor: "#E0E0E0", // Placeholder gradient - stays as design constant
  },
  gradient: {
    flex: 1,
    justifyContent: "space-between",
    paddingTop: Platform.OS === "ios" ? 50 : 20,
    paddingBottom: 20,
    paddingHorizontal: 16,
  },
  gradientOverlay: {
    flex: 1,
    justifyContent: "space-between",
    paddingTop: Platform.OS === "ios" ? 50 : 20,
    paddingBottom: 20,
    paddingHorizontal: 16,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  contentContainer: {
    flex: 1,
    justifyContent: "space-between",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    padding: 8,
  },
  topBarSpacer: {
    flex: 1,
  },
  menuButton: {
    padding: 8,
  },
  textContainer: {
    paddingBottom: 8,
  },
  groupName: {
    fontSize: 28,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 8,
    textShadowColor: "rgba(0, 0, 0, 0.3)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  groupNameNoImage: {
    textShadowColor: "transparent",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 0,
  },
  cadence: {
    fontSize: 16,
    fontWeight: "500",
    color: "#ffffff",
    textShadowColor: "rgba(0, 0, 0, 0.3)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  cadenceNoImage: {
    textShadowColor: "transparent",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 0,
  },
});

