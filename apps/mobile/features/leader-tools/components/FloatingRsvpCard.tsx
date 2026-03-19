import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";

interface RsvpOption {
  id: number;
  label: string;
  enabled: boolean;
}

interface MyRsvp {
  optionId: number;
}

interface FloatingRsvpCardProps {
  response: MyRsvp;
  options: RsvpOption[];
  onEdit: () => void;
}

// Map RSVP option labels to emojis
const EMOJI_MAP: Record<string, string> = {
  Going: "👍",
  Maybe: "🤔",
  "Can't Go": "😢",
  Yes: "👍",
  No: "😢",
};

export function FloatingRsvpCard({
  response,
  options,
  onEdit,
}: FloatingRsvpCardProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { primaryColor } = useCommunityTheme();

  const selectedOption = options.find((opt) => opt.id === response.optionId);
  const emoji = selectedOption ? EMOJI_MAP[selectedOption.label] || "👍" : "👍";
  const label = selectedOption?.label || "Going";

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 20, backgroundColor: colors.surface, borderTopColor: colors.border }]}>
      <TouchableOpacity
        testID="floating-rsvp-card"
        style={[styles.card, { borderColor: primaryColor, backgroundColor: colors.surfaceSecondary }]}
        onPress={onEdit}
        activeOpacity={0.7}
      >
        <View style={styles.content}>
          <Text style={styles.emoji}>{emoji}</Text>
          <View style={styles.textContent}>
            <Text style={[styles.statusLabel, { color: primaryColor }]}>{label}</Text>
            <Text style={[styles.editPrompt, { color: colors.textSecondary }]}>Edit your RSVP</Text>
          </View>
          <Ionicons name="create-outline" size={20} color={primaryColor} />
        </View>
      </TouchableOpacity>
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
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: DEFAULT_PRIMARY_COLOR,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 3,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  emoji: {
    fontSize: 28,
  },
  textContent: {
    flex: 1,
  },
  statusLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: DEFAULT_PRIMARY_COLOR,
    marginBottom: 2,
  },
  editPrompt: {
    fontSize: 13,
  },
});
