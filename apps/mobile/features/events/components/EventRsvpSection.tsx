import React, { useState, useEffect } from "react";
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
import { useTheme } from "@hooks/useTheme";

// Global default plus-ones cap. Mirrors MAX_GUESTS_PER_RSVP on the backend
// (apps/convex/lib/rsvpGuests.ts). Keep these in sync until we surface a
// per-event override in settings.
export const DEFAULT_MAX_GUESTS_PER_RSVP = 3;

/**
 * Heuristic — is this RSVP option the "Going" option?
 *
 * Must reject decline variants ("Not Going", "Can't Go") before falling
 * back to a "going" substring check. Keep in sync with isGoingOption in
 * apps/convex/lib/rsvpGuests.ts.
 */
export function isGoingOptionLabel(label: string | undefined | null): boolean {
  if (!label) return false;
  const lower = label.toLowerCase().trim();
  if (
    lower.includes("can't") ||
    lower.includes("cannot") ||
    lower.includes("not going") ||
    lower.includes("not attending") ||
    lower === "no"
  ) {
    return false;
  }
  return lower.includes("going");
}

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
  response: { optionId: number; guestCount?: number };
  options: RsvpOption[];
  onEdit: () => void;
  /**
   * Called when the user bumps the inline guest stepper on the card.
   * Submits the same optionId with an updated guestCount.
   */
  onGuestCountChange?: (guestCount: number) => Promise<void> | void;
  maxGuests?: number;
  insets: { bottom: number };
  tabBarOffset?: number;
}

interface RsvpEditModalProps {
  visible: boolean;
  onClose: () => void;
  options: RsvpOption[];
  currentOptionId: number | null;
  currentGuestCount?: number;
  loadingOptionId: number | null;
  onSelect: (optionId: number, guestCount: number) => Promise<void>;
  maxGuests?: number;
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
// Guest Stepper
// ============================================================================

interface GuestStepperProps {
  value: number;
  onChange: (next: number) => void;
  max: number;
  disabled?: boolean;
  /** Shown as the leading label, e.g. "Bringing guests" */
  label?: string;
  compact?: boolean;
}

/**
 * Reusable +/- stepper for choosing how many plus-ones to bring.
 * Clamped to [0, max]. Visual only — parent owns the value.
 */
export function GuestStepper({
  value,
  onChange,
  max,
  disabled = false,
  label = "Bringing guests",
  compact = false,
}: GuestStepperProps) {
  const { colors } = useTheme();
  const canDec = !disabled && value > 0;
  const canInc = !disabled && value < max;

  return (
    <View style={[stepperStyles.row, compact && stepperStyles.rowCompact]}>
      <Text
        style={[
          stepperStyles.label,
          { color: colors.textSecondary },
          compact && stepperStyles.labelCompact,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <View style={[stepperStyles.controls, { borderColor: colors.border }]}>
        <TouchableOpacity
          testID="guest-stepper-decrement"
          onPress={() => canDec && onChange(value - 1)}
          disabled={!canDec}
          style={[stepperStyles.button, !canDec && stepperStyles.buttonDisabled]}
          hitSlop={8}
        >
          <Ionicons
            name="remove"
            size={18}
            color={canDec ? DEFAULT_PRIMARY_COLOR : colors.iconSecondary}
          />
        </TouchableOpacity>
        <Text style={[stepperStyles.value, { color: colors.text }]}>{value}</Text>
        <TouchableOpacity
          testID="guest-stepper-increment"
          onPress={() => canInc && onChange(value + 1)}
          disabled={!canInc}
          style={[stepperStyles.button, !canInc && stepperStyles.buttonDisabled]}
          hitSlop={8}
        >
          <Ionicons
            name="add"
            size={18}
            color={canInc ? DEFAULT_PRIMARY_COLOR : colors.iconSecondary}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const stepperStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 8,
  },
  rowCompact: {
    paddingVertical: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    flexShrink: 1,
  },
  labelCompact: {
    fontSize: 13,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 999,
    overflow: "hidden",
  },
  button: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  value: {
    minWidth: 24,
    textAlign: "center",
    fontSize: 15,
    fontWeight: "600",
  },
});

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
  const { colors } = useTheme();
  const enabledOptions = options.filter((opt) => opt.enabled).slice(0, 3);

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 20, bottom: tabBarOffset, backgroundColor: colors.surface, borderTopColor: colors.border }]}>
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
              <Text style={[styles.buttonLabel, { color: colors.textSecondary }]}>{displayLabel}</Text>
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
  onGuestCountChange,
  maxGuests = DEFAULT_MAX_GUESTS_PER_RSVP,
  insets,
  tabBarOffset = 0,
}: FloatingRsvpCardProps) {
  const { colors } = useTheme();
  const selectedOption = options.find((opt) => opt.id === response.optionId);
  const emoji = selectedOption ? getEmojiForLabel(selectedOption.label) : "👍";
  const label = selectedOption ? getCleanLabel(selectedOption.label) : "Going";
  const isGoing = selectedOption ? isGoingOptionLabel(selectedOption.label) : false;
  const guestCount = response.guestCount ?? 0;
  const [pendingGuestCount, setPendingGuestCount] = useState<number | null>(null);

  // Clear local pending state once the query result catches up.
  useEffect(() => {
    if (pendingGuestCount !== null && pendingGuestCount === guestCount) {
      setPendingGuestCount(null);
    }
  }, [guestCount, pendingGuestCount]);

  const displayedGuestCount = pendingGuestCount ?? guestCount;

  const handleGuestChange = (next: number) => {
    if (!onGuestCountChange) return;
    setPendingGuestCount(next);
    Promise.resolve(onGuestCountChange(next)).catch(() => {
      // Roll back optimistic change on failure
      setPendingGuestCount(null);
    });
  };

  return (
    <View style={[styles.cardContainer, { paddingBottom: insets.bottom + 20, bottom: tabBarOffset, backgroundColor: colors.surface, borderTopColor: colors.border }]}>
      <View style={styles.card}>
        <TouchableOpacity
          testID="floating-rsvp-card"
          style={styles.cardContent}
          onPress={onEdit}
          activeOpacity={0.7}
        >
          <Text style={styles.cardEmoji}>{emoji}</Text>
          <View style={styles.cardTextContent}>
            <Text style={styles.statusLabel}>
              {label}
              {isGoing && displayedGuestCount > 0
                ? ` · +${displayedGuestCount} guest${displayedGuestCount === 1 ? "" : "s"}`
                : ""}
            </Text>
            <Text style={[styles.editPrompt, { color: colors.textSecondary }]}>Edit your RSVP</Text>
          </View>
          <Ionicons name="create-outline" size={20} color={DEFAULT_PRIMARY_COLOR} />
        </TouchableOpacity>
        {isGoing && onGuestCountChange && (
          <View style={styles.cardStepperRow}>
            <GuestStepper
              value={displayedGuestCount}
              onChange={handleGuestChange}
              max={maxGuests}
              label={displayedGuestCount === 0 ? "Bringing guests?" : "Guests"}
              compact
            />
          </View>
        )}
      </View>
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
  currentGuestCount = 0,
  loadingOptionId,
  onSelect,
  maxGuests = DEFAULT_MAX_GUESTS_PER_RSVP,
}: RsvpEditModalProps) {
  const { colors } = useTheme();
  // Staged selection — lets the user pick Going and adjust guest count
  // before committing.
  const [stagedOptionId, setStagedOptionId] = useState<number | null>(currentOptionId);
  const [stagedGuestCount, setStagedGuestCount] = useState<number>(currentGuestCount);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setStagedOptionId(currentOptionId);
      setStagedGuestCount(currentGuestCount);
      setSubmitting(false);
    }
  }, [visible, currentOptionId, currentGuestCount]);

  const stagedOption = options.find((o) => o.id === stagedOptionId) ?? null;
  const stagedIsGoing = stagedOption ? isGoingOptionLabel(stagedOption.label) : false;

  const handleStageOption = (optionId: number) => {
    if (loadingOptionId !== null || submitting) return;
    setStagedOptionId(optionId);
    // Reset guest count when switching away from Going
    const next = options.find((o) => o.id === optionId);
    if (!next || !isGoingOptionLabel(next.label)) {
      setStagedGuestCount(0);
    }
  };

  const hasChanges =
    stagedOptionId !== currentOptionId ||
    (stagedIsGoing && stagedGuestCount !== currentGuestCount);

  const handleConfirm = async () => {
    if (stagedOptionId === null || !hasChanges) {
      onClose();
      return;
    }
    setSubmitting(true);
    try {
      await onSelect(stagedOptionId, stagedIsGoing ? stagedGuestCount : 0);
      onClose();
    } finally {
      setSubmitting(false);
    }
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
        <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Change your RSVP</Text>
              <TouchableOpacity onPress={onClose}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalOptions}>
              {options
                .filter((option) => option.enabled)
                .map((option) => {
                  const isSelected = stagedOptionId === option.id;
                  const isLoading = loadingOptionId === option.id;

                  return (
                    <TouchableOpacity
                      key={option.id}
                      testID={`modal-rsvp-option-${option.id}`}
                      style={[
                        styles.modalOption,
                        isSelected && styles.modalOptionSelected,
                      ]}
                      onPress={() => handleStageOption(option.id)}
                      disabled={loadingOptionId !== null || submitting}
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

            {stagedIsGoing && (
              <View style={styles.modalStepperWrapper}>
                <GuestStepper
                  value={stagedGuestCount}
                  onChange={setStagedGuestCount}
                  max={maxGuests}
                  disabled={submitting}
                  label="Bringing guests"
                />
                <Text style={[styles.modalStepperHint, { color: colors.textSecondary }]}>
                  Add plus-ones so the host has an accurate headcount (up to {maxGuests}).
                </Text>
              </View>
            )}

            <TouchableOpacity
              testID="modal-rsvp-confirm"
              style={[
                styles.modalConfirmButton,
                (!hasChanges || submitting) && styles.modalConfirmButtonDisabled,
              ]}
              onPress={handleConfirm}
              disabled={!hasChanges || submitting || stagedOptionId === null}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalConfirmText}>
                  {hasChanges ? "Save RSVP" : "Close"}
                </Text>
              )}
            </TouchableOpacity>
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
    borderTopWidth: 1,
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
    borderTopWidth: 1,
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
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
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
    color: "#333", // Will be overridden dynamically for selected state
  },
  modalOptionLabelSelected: {
    color: DEFAULT_PRIMARY_COLOR,
    fontWeight: "600",
  },
  modalStepperWrapper: {
    marginTop: 16,
    paddingHorizontal: 4,
  },
  modalStepperHint: {
    fontSize: 12,
    marginTop: 4,
  },
  modalConfirmButton: {
    marginTop: 20,
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  modalConfirmButtonDisabled: {
    opacity: 0.5,
  },
  modalConfirmText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },

  // Card stepper row
  cardStepperRow: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(0, 0, 0, 0.06)",
    marginTop: -4,
  },
});
