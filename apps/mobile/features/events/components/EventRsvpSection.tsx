import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

// ============================================================================
// Types
// ============================================================================

export interface RsvpOption {
  id: number;
  label: string;
  enabled: boolean;
}

interface FloatingRsvpButtonsProps {
  options: RsvpOption[];
  loadingOptionId: number | null;
  onSelect: (id: number) => void;
  insets: { bottom: number };
  tabBarOffset?: number;
}

interface FloatingRsvpCardProps {
  response: { optionId: number };
  options: RsvpOption[];
  onEdit: () => void;
  insets: { bottom: number };
  tabBarOffset?: number;
}

interface RsvpEditModalProps {
  visible: boolean;
  onClose: () => void;
  options: RsvpOption[];
  currentOptionId: number | null;
  loadingOptionId: number | null;
  onSelect: (optionId: number) => Promise<void>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get emoji for an RSVP option label.
 * Labels may include emojis (e.g., "Going 👍") or be plain (e.g., "Going").
 * This function first tries to extract an emoji from the label,
 * then falls back to keyword-based matching.
 */
export function getEmojiForLabel(label: string): string {
  // Try to extract emoji from the end of the label
  const emojiRegex = /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)$/u;
  const match = label.match(emojiRegex);
  if (match) {
    return match[0];
  }

  // Fallback to keyword-based matching for labels without emojis
  const lowerLabel = label.toLowerCase();
  if (lowerLabel.includes("going") && !lowerLabel.includes("can't")) return "👍";
  if (lowerLabel.includes("maybe")) return "🤔";
  if (lowerLabel.includes("can't") || lowerLabel.includes("no")) return "😢";
  if (lowerLabel.includes("yes")) return "👍";
  return "👍"; // default
}

/**
 * Get gradient colors for an RSVP option label.
 */
export function getGradientForLabel(_label: string): [string, string] {
  // All buttons use the brand accent color
  return [DEFAULT_PRIMARY_COLOR, DEFAULT_PRIMARY_COLOR];
}

/**
 * Get clean display label (strip emoji if already included in label).
 */
export function getCleanLabel(label: string): string {
  // Remove trailing emoji if present (e.g., "Going 👍" -> "Going")
  return label.replace(/\s*(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)+\s*$/u, "").trim();
}

// ============================================================================
// Components
// ============================================================================

/**
 * Floating RSVP buttons for initial response selection
 */
export function FloatingRsvpButtons({
  options,
  loadingOptionId,
  onSelect,
  insets,
  tabBarOffset = 0,
}: FloatingRsvpButtonsProps) {
  const enabledOptions = options.filter((opt) => opt.enabled).slice(0, 3);

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 20, bottom: tabBarOffset }]}>
      <View style={styles.buttonRow}>
        {enabledOptions.map((option) => {
          const emoji = getEmojiForLabel(option.label);
          const gradient = getGradientForLabel(option.label);
          const displayLabel = getCleanLabel(option.label);
          const isLoading = loadingOptionId === option.id;

          return (
            <TouchableOpacity
              key={option.id}
              testID={`floating-rsvp-${option.id}`}
              onPress={() => onSelect(option.id)}
              disabled={loadingOptionId !== null}
              activeOpacity={0.8}
            >
              <View style={[styles.circleButton, { backgroundColor: gradient[0] }]}>
                {isLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.emoji}>{emoji}</Text>
                )}
              </View>
              <Text style={styles.buttonLabel}>{displayLabel}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Floating card showing current RSVP status with edit option
 */
export function FloatingRsvpCard({
  response,
  options,
  onEdit,
  insets,
  tabBarOffset = 0,
}: FloatingRsvpCardProps) {
  const selectedOption = options.find((opt) => opt.id === response.optionId);
  const emoji = selectedOption ? getEmojiForLabel(selectedOption.label) : "👍";
  const label = selectedOption ? getCleanLabel(selectedOption.label) : "Going";

  return (
    <View style={[styles.cardContainer, { paddingBottom: insets.bottom + 20, bottom: tabBarOffset }]}>
      <TouchableOpacity
        testID="floating-rsvp-card"
        style={styles.card}
        onPress={onEdit}
        activeOpacity={0.7}
      >
        <View style={styles.cardContent}>
          <Text style={styles.cardEmoji}>{emoji}</Text>
          <View style={styles.cardTextContent}>
            <Text style={styles.statusLabel}>{label}</Text>
            <Text style={styles.editPrompt}>Edit your RSVP</Text>
          </View>
          <Ionicons name="create-outline" size={20} color={DEFAULT_PRIMARY_COLOR} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

/**
 * Modal for editing RSVP response
 */
export function RsvpEditModal({
  visible,
  onClose,
  options,
  currentOptionId,
  loadingOptionId,
  onSelect,
}: RsvpEditModalProps) {
  const handleSelect = async (optionId: number) => {
    await onSelect(optionId);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={styles.modalContent}>
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change your RSVP</Text>
              <TouchableOpacity onPress={onClose}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            <View style={styles.modalOptions}>
              {options
                .filter((option) => option.enabled)
                .map((option) => {
                  const isSelected = currentOptionId === option.id;
                  const isLoading = loadingOptionId === option.id;

                  return (
                    <TouchableOpacity
                      key={option.id}
                      testID={`modal-rsvp-option-${option.id}`}
                      style={[
                        styles.modalOption,
                        isSelected && styles.modalOptionSelected,
                      ]}
                      onPress={() => handleSelect(option.id)}
                      disabled={loadingOptionId !== null}
                    >
                      <Text
                        style={[
                          styles.modalOptionLabel,
                          isSelected && styles.modalOptionLabelSelected,
                        ]}
                      >
                        {option.label}
                      </Text>
                      {isLoading ? (
                        <ActivityIndicator size="small" color={DEFAULT_PRIMARY_COLOR} />
                      ) : (
                        isSelected && (
                          <Ionicons
                            name="checkmark-circle"
                            size={20}
                            color={DEFAULT_PRIMARY_COLOR}
                          />
                        )
                      )}
                    </TouchableOpacity>
                  );
                })}
            </View>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  // Floating buttons
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
  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  circleButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  emoji: {
    fontSize: 28,
  },
  buttonLabel: {
    fontSize: 12,
    color: "#666",
    textAlign: "center",
    marginTop: 6,
    fontWeight: "500",
  },

  // Floating card
  cardContainer: {
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
  card: {
    backgroundColor: "#F8F0FF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: DEFAULT_PRIMARY_COLOR,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 3,
  },
  cardContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  cardEmoji: {
    fontSize: 28,
  },
  cardTextContent: {
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
    color: "#666",
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  modalOptions: {
    gap: 12,
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: "#f8f8f8",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "transparent",
  },
  modalOptionSelected: {
    backgroundColor: "#F8F0FF",
    borderColor: DEFAULT_PRIMARY_COLOR,
  },
  modalOptionLabel: {
    fontSize: 16,
    color: "#333",
  },
  modalOptionLabelSelected: {
    color: DEFAULT_PRIMARY_COLOR,
    fontWeight: "600",
  },
});
