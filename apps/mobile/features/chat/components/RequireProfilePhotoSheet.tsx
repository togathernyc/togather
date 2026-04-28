/**
 * RequireProfilePhotoSheet
 *
 * Modal shown when the current user tries to start or accept a chat without a
 * profile photo. Togather requires profile photos for chat so members can
 * recognize each other. The "Add photo" CTA routes to the existing edit-profile
 * screen at `/(user)/edit-profile` (which embeds an ImagePicker in
 * `EditProfileForm`); the user returns and re-taps the original action after
 * uploading.
 *
 * Used by:
 *   - Creator path: `app/inbox/new.tsx` (Start chat / Create chat)
 *   - Recipient path: `ChatRequestBanner.tsx` (Accept)
 *
 * Backend enforces this defense-in-depth via `PROFILE_PHOTO_REQUIRED` thrown
 * from chat-creation/accept mutations — callers should wrap mutations in
 * try/catch and re-show this sheet on that error string.
 */
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal as RNModal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

interface RequireProfilePhotoSheetProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Optional override of the destination route. Defaults to the project's
   * existing edit-profile screen, which already embeds an `ImagePicker`.
   */
  uploadRoute?: string;
}

export function RequireProfilePhotoSheet({
  visible,
  onClose,
  uploadRoute = "/(user)/edit-profile",
}: RequireProfilePhotoSheetProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  const handleAddPhoto = () => {
    onClose();
    // Tiny delay so the modal dismiss animation doesn't conflict with the
    // route push on iOS (otherwise the push can sometimes get swallowed).
    setTimeout(() => {
      router.push(uploadRoute as any);
    }, 50);
  };

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View
            style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          />
        </TouchableWithoutFeedback>
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.surface },
            Platform.select({
              web: { boxShadow: "0px 4px 20px rgba(0, 0, 0, 0.15)" },
              default: {
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.15,
                shadowRadius: 20,
                elevation: 5,
              },
            }),
          ]}
          accessibilityRole="alert"
        >
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: primaryColor + "1A" },
            ]}
          >
            <Ionicons name="camera-outline" size={28} color={primaryColor} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>
            Add a profile photo to chat
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Togather requires a profile photo to start or accept chats. This
            helps members recognize each other.
          </Text>

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: primaryColor }]}
            onPress={handleAddPhoto}
            accessibilityRole="button"
            accessibilityLabel="Add photo"
          >
            <Text style={styles.primaryButtonText}>Add photo</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Maybe later"
          >
            <Text
              style={[
                styles.secondaryButtonText,
                { color: colors.textSecondary },
              ]}
            >
              Maybe later
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </RNModal>
  );
}

/**
 * Detect the backend's profile-photo error strings so callers can re-surface
 * the sheet (or a toast for the recipient case) when a mutation fails.
 *
 * Returns:
 *   - "self": current user is missing a photo → show the sheet
 *   - "recipient": one of the selected recipients is missing one → toast
 *   - null: not a profile-photo error
 */
export function classifyProfilePhotoError(
  error: unknown,
): "self" | "recipient" | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("RECIPIENT_PROFILE_PHOTO_REQUIRED")) return "recipient";
  if (message.includes("PROFILE_PHOTO_REQUIRED")) return "self";
  return null;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 18,
    padding: 24,
    alignItems: "center",
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 20,
  },
  primaryButton: {
    width: "100%",
    minHeight: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  secondaryButton: {
    width: "100%",
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "500",
  },
});
