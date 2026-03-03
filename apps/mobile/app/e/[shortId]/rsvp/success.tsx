import React, { useEffect } from "react";
import { View, Text, StyleSheet, Image, ImageSourcePropType } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Import GIF animations
const starStrikeGif = require("../../../../assets/star-strike.gif");
const raisedEyebrowGif = require("../../../../assets/raised-eyebrow.gif");
const sadGif = require("../../../../assets/sad.gif");

interface AnimationConfig {
  gif: ImageSourcePropType;
  message: string;
}

function getRsvpAnimationConfig(optionLabel: string): AnimationConfig {
  const label = optionLabel.toLowerCase();

  // Check for "going" but not "can't go"
  if (label.includes("going") && !label.includes("can't") && !label.includes("cannot")) {
    return {
      gif: starStrikeGif,
      message: "You're Going!",
    };
  }

  // Check for "maybe" or similar
  if (label.includes("maybe") || label.includes("interested") || label.includes("tentative")) {
    return {
      gif: raisedEyebrowGif,
      message: "Let us know soon",
    };
  }

  // Default for "can't go", "no", "not going", etc.
  return {
    gif: sadGif,
    message: "Sad you can't make it",
  };
}

export default function RsvpSuccessScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { shortId, optionLabel } = useLocalSearchParams<{
    shortId: string;
    optionLabel: string;
  }>();

  const config = getRsvpAnimationConfig(optionLabel || "going");

  // Auto-redirect back to event page after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace(`/e/${shortId}`);
    }, 3000);

    return () => clearTimeout(timer);
  }, [router, shortId]);

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.content}>
        <Image source={config.gif} style={styles.gif} />
        <Text style={styles.message}>{config.message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    alignItems: "center",
    paddingHorizontal: 40,
  },
  gif: {
    width: 160,
    height: 160,
    marginBottom: 24,
  },
  message: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#333",
    textAlign: "center",
  },
});
