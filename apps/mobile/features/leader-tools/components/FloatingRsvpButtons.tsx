import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";

interface RsvpOption {
  id: number;
  label: string;
  enabled: boolean;
}

interface FloatingRsvpButtonsProps {
  options: RsvpOption[];
  loadingOptionId: number | null;
  onSelect: (optionId: number) => void;
}

// Map RSVP option labels to emojis
const EMOJI_MAP: Record<string, string> = {
  Going: "👍",
  Maybe: "🤔",
  "Can't Go": "😢",
  Yes: "👍",
  No: "😢",
};

// Map RSVP option labels to gradient colors
const COLOR_MAP: Record<string, string[]> = {
  Going: [DEFAULT_PRIMARY_COLOR, DEFAULT_PRIMARY_COLOR],
  Maybe: ["#FF9500", "#FF7A00"],
  "Can't Go": ["#666", "#444"],
  Yes: [DEFAULT_PRIMARY_COLOR, DEFAULT_PRIMARY_COLOR],
  No: ["#666", "#444"],
};

export function FloatingRsvpButtons({
  options,
  loadingOptionId,
  onSelect,
}: FloatingRsvpButtonsProps) {
  const insets = useSafeAreaInsets();

  const enabledOptions = options.filter((option) => option.enabled);

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 20 }]}>
      <View style={styles.buttonsRow}>
        {enabledOptions.map((option) => {
          const emoji = EMOJI_MAP[option.label] || "👍";
          const buttonColors = COLOR_MAP[option.label] || [DEFAULT_PRIMARY_COLOR, DEFAULT_PRIMARY_COLOR];
          const isLoading = loadingOptionId === option.id;

          return (
            <TouchableOpacity
              key={option.id}
              testID={`floating-rsvp-${option.id}`}
              onPress={() => onSelect(option.id)}
              disabled={loadingOptionId !== null}
              style={styles.buttonWrapper}
            >
              <View style={[styles.circleButton, { backgroundColor: buttonColors[0] }]}>
                {isLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.emoji}>{emoji}</Text>
                )}
              </View>
              <Text style={styles.label}>{option.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    paddingTop: 16,
    paddingHorizontal: 20,
  },
  buttonsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "flex-start",
    gap: 24,
  },
  buttonWrapper: {
    alignItems: "center",
    gap: 8,
  },
  circleButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.15,
    shadowRadius: 3.84,
    elevation: 5,
  },
  emoji: {
    fontSize: 32,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#333",
  },
});
