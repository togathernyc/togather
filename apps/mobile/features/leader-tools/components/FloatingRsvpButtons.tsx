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

// Canonical labels are stored as "<text> <emoji>" (e.g. "Going 👍"), set by
// RsvpOptionsEditor. Parse the emoji off the end of the label so the circle
// matches what the user actually picked. Keep a default in case a legacy
// option slipped through without an emoji suffix.
const DEFAULT_EMOJI = "👍";
const EMOJI_REGEX = /\s*(\p{Emoji_Presentation}|\p{Emoji}️)$/u;

function parseLabel(label: string): { text: string; emoji: string } {
  const match = label.match(EMOJI_REGEX);
  if (match) {
    return { text: label.slice(0, match.index).trim(), emoji: match[1] };
  }
  return { text: label, emoji: "" };
}

// Map RSVP option text (without emoji) to button color. We only branch on
// a few known text tokens; everything else falls back to primary.
function getButtonColor(
  text: string,
  colors: { warning: string; textSecondary: string; buttonPrimary: string },
): string {
  const key = text.trim().toLowerCase();
  if (key === "going" || key === "yes") return DEFAULT_PRIMARY_COLOR;
  if (key === "maybe") return colors.warning;
  if (key === "can't go" || key === "cant go" || key === "no") return colors.textSecondary;
  return DEFAULT_PRIMARY_COLOR;
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
          const { text, emoji } = parseLabel(option.label);
          const circleColor = getButtonColor(text, colors);
          const isLoading = loadingOptionId === option.id;

          return (
            <TouchableOpacity
              key={option.id}
              testID={`floating-rsvp-${option.id}`}
              onPress={() => onSelect(option.id)}
              disabled={loadingOptionId !== null}
              style={styles.buttonWrapper}
            >
              <View style={[styles.circleButton, { backgroundColor: circleColor }]}>
                {isLoading ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={styles.emoji}>{emoji || DEFAULT_EMOJI}</Text>
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
