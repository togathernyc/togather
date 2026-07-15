import React, { useEffect } from "react";
import { View, Text, StyleSheet, Image, ImageSourcePropType } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  GOING_RSVP_OPTION_ID,
  MAYBE_RSVP_OPTION_ID,
  CANT_GO_RSVP_OPTION_ID,
} from "@/features/events/components/EventRsvpSection";
import { SentryUtils } from "@providers/SentryProvider";
import { getMediaDiagnostics } from "@/features/chat/utils/fileTypes";
import { MediaDiagnosticsCard } from "@/components/dev/MediaDiagnosticsCard";

// Import GIF animations
const starStrikeGif = require("../../../../assets/star-strike.gif");
const raisedEyebrowGif = require("../../../../assets/raised-eyebrow.gif");
const sadGif = require("../../../../assets/sad.gif");

interface AnimationConfig {
  gif: ImageSourcePropType;
  message: string;
}

/**
 * Pick the animation by the RSVP option's id slot (1=Going, 2=Maybe,
 * 3=Can't Go) — labels are host-customizable, so they can't be used to
 * infer the option's meaning. Missing/unparseable ids default to Going,
 * matching the pre-existing fallback.
 */
function getRsvpAnimationConfig(optionId: string | undefined): AnimationConfig {
  const id = optionId ? parseInt(optionId, 10) : GOING_RSVP_OPTION_ID;

  if (id === MAYBE_RSVP_OPTION_ID) {
    return {
      gif: raisedEyebrowGif,
      message: "Let us know soon",
    };
  }

  if (id === CANT_GO_RSVP_OPTION_ID) {
    return {
      gif: sadGif,
      message: "Sad you can't make it",
    };
  }

  return {
    gif: starStrikeGif,
    message: "You're Going!",
  };
}

export default function RsvpSuccessScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { shortId, optionId } = useLocalSearchParams<{
    shortId: string;
    optionId: string;
  }>();

  const config = getRsvpAnimationConfig(optionId);

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
        <Image
          source={config.gif}
          style={styles.gif}
          onError={(e) => {
            try {
              SentryUtils.captureMessage('MEDIA_DIAG_GIF_ERROR', 'warning', {
                ...getMediaDiagnostics(),
                error: String(e?.nativeEvent?.error ?? 'unknown'),
              });
            } catch {
              // Never let diagnostics throw from a render callback
            }
          }}
          onLoad={() => {
            try {
              SentryUtils.addBreadcrumb('gif loaded', 'media', { screen: 'rsvp-success' });
            } catch {
              // Never let diagnostics throw from a render callback
            }
          }}
        />
        <MediaDiagnosticsCard label="rsvp-gif" />
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
