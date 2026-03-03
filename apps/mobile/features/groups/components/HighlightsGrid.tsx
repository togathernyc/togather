import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from "react-native";
import { AppImage } from "@components/ui";
import { GroupHighlight } from "../types";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const PADDING = 16;
const GAP = 8;
const GRID_WIDTH = SCREEN_WIDTH - PADDING * 2;
const IMAGE_SIZE = (GRID_WIDTH - GAP) / 2;

interface HighlightsGridProps {
  highlights: GroupHighlight[];
  onImagePress?: (highlight: GroupHighlight) => void;
}

export function HighlightsGrid({
  highlights,
  onImagePress,
}: HighlightsGridProps) {
  if (!highlights || highlights.length === 0) {
    return null;
  }

  // Take first 4 highlights for 2x2 grid
  const displayHighlights = highlights.slice(0, 4);

  const renderImage = (highlight: GroupHighlight, index: number) => {
    const imageUrl = highlight.image_url;
    const isLastInRow = index % 2 === 1;
    const isLastRow = index >= 2;

    return (
      <TouchableOpacity
        key={highlight.id || index}
        style={[
          styles.imageContainer,
          !isLastInRow && styles.imageContainerLeft,
          !isLastRow && styles.imageContainerTop,
        ]}
        onPress={() => onImagePress?.(highlight)}
        activeOpacity={0.8}
      >
        <AppImage
          source={imageUrl}
          style={styles.image}
          resizeMode="cover"
          placeholder={{
            type: "icon",
            icon: "image-outline",
            iconSize: 24,
            iconColor: "#999",
          }}
        />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>HIGHLIGHTS</Text>
      <View style={styles.grid}>
        {displayHighlights.map((highlight, index) =>
          renderImage(highlight, index)
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#F5F5F5",
    paddingHorizontal: PADDING,
    paddingVertical: 16,
    marginTop: 0,
  },
  header: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -GAP / 2,
  },
  imageContainer: {
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    marginHorizontal: GAP / 2,
    marginBottom: GAP,
  },
  imageContainerLeft: {
    marginRight: GAP / 2,
  },
  imageContainerTop: {
    marginBottom: GAP,
  },
  image: {
    width: "100%",
    height: "100%",
    borderRadius: 12,
    backgroundColor: "#E0E0E0",
  },
  placeholder: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#D0D0D0",
  },
  placeholderText: {
    fontSize: 12,
    color: "#999",
    fontWeight: "500",
  },
});

