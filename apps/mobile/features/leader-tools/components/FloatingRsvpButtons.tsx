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
import { useTheme } from "@hooks/useTheme";

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

// Map RSVP option labels to gradient colors (function because it needs theme colors)
function getRsvpColorMap(colors: { warning: string; textSecondary: string; buttonPrimary: string }): Record<string, string[]> {
  return {
    Going: [DEFAULT_PRIMARY_COLOR, DEFAULT_PRIMARY_COLOR],
    Maybe: [colors.warning, colors.warning],
    "Can't Go": [colors.textSecondary, colors.buttonPrimary],
    Yes: [DEFAULT_PRIMARY_COLOR, DEFAULT_PRIMARY_COLOR],
    No: [colors.textSecondary, colors.buttonPrimary],
  };
}

export function FloatingRsvpButtons({
  options,
  loadingOptionId,
  onSelect,
}: FloatingRsvpButtonsProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const enabledOptions = options.filter((option) => option.enabled);

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 20, backgroundColor: colors.surface, borderTopColor: colors.border }]}>
      <View style={styles.buttonsRow}>
        {enabledOptions.map((option) => {
          const emoji = EMOJI_MAP[option.label] || "👍";
          const buttonColors = getRsvpColorMap(colors)[option.label] || [DEFAULT_PRIMARY_COLOR, DEFAULT_PRIMARY_COLOR];
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
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={styles.emoji}>{emoji}</Text>
                )}
              </View>
              <Text style={[styles.label, { color: colors.text }]}>{option.label}</Text>
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
    borderTopWidth: 1,
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
  },
});
