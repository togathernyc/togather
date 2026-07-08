import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CustomModal } from "@/components/ui/Modal";
import { useTheme } from "@hooks/useTheme";

interface ArchiveCommunityModalProps {
  visible: boolean;
  communityName: string;
  onCancel: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
}

/**
 * Destructive confirmation for archiving (closing) a whole community. Requires
 * the admin to type the community's exact name before the Archive button
 * enables — a deliberate friction gate because archiving is permanent and
 * locks everyone (including them) out.
 */
export function ArchiveCommunityModal({
  visible,
  communityName,
  onCancel,
  onConfirm,
  isLoading = false,
}: ArchiveCommunityModalProps) {
  const { colors } = useTheme();
  const [typedName, setTypedName] = useState("");

  // Reset the field whenever the modal is (re)opened so a prior attempt's text
  // never lingers.
  useEffect(() => {
    if (visible) setTypedName("");
  }, [visible]);

  const matches =
    typedName.trim().toLowerCase() === communityName.trim().toLowerCase() &&
    communityName.trim().length > 0;
  const canArchive = matches && !isLoading;

  return (
    <CustomModal
      visible={visible}
      onClose={onCancel}
      withoutCloseBtn
      contentPadding="24"
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Ionicons name="warning" size={48} color={colors.error} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>
            Archive {communityName}?
          </Text>

          <Text style={[styles.description, { color: colors.textSecondary }]}>
            This closes the community permanently. No one — including you — will
            be able to log in, and it will disappear from search. This cannot be
            undone from the app.
          </Text>

          <Text style={[styles.prompt, { color: colors.textSecondary }]}>
            Type <Text style={[styles.promptName, { color: colors.text }]}>{communityName}</Text> to confirm.
          </Text>

          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.inputBackground,
                color: colors.text,
                borderColor: matches ? colors.error : colors.inputBorder,
              },
            ]}
            value={typedName}
            onChangeText={setTypedName}
            placeholder={communityName}
            placeholderTextColor={colors.inputPlaceholder}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
          />

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.cancelButton, { backgroundColor: colors.surfaceSecondary }]}
              onPress={onCancel}
              disabled={isLoading}
            >
              <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.archiveButton,
                { backgroundColor: colors.error },
                !canArchive && styles.buttonDisabled,
              ]}
              onPress={onConfirm}
              disabled={!canArchive}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.archiveButtonText}>Archive Community</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </CustomModal>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: "center",
  },
  iconContainer: {
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
  },
  description: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 20,
  },
  prompt: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 8,
    alignSelf: "stretch",
  },
  promptName: {
    fontWeight: "700",
  },
  input: {
    alignSelf: "stretch",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    fontSize: 16,
    marginBottom: 24,
  },
  buttonRow: {
    flexDirection: "row",
    alignSelf: "stretch",
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  archiveButton: {
    flex: 1,
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  archiveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
