/**
 * GithubCreditRow — quiet footer on the conversation list where contributors
 * save their GitHub username so shipped changes show up on their GitHub
 * profile (co-author credit on the merged commits).
 *
 * Deliberately understated: a one-line row once a username is set, a small
 * card with an inline input when it isn't. It must not compete with the
 * conversation list above it.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { formatError } from "@/utils/error-handling";
import { useGithubUsername, useSetGithubUsername } from "../hooks/useGithubUsername";

export function GithubCreditRow() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const username = useGithubUsername();
  const setGithubUsername = useSetGithubUsername();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Still loading — keep the footer empty rather than flashing the card in.
  if (username === undefined) return null;

  // Be forgiving about pasted handles like "@octocat".
  const cleaned = draft.trim().replace(/^@/, "");
  // Saving "" clears an existing username; with none set there's nothing to save.
  const canSave = !saving && (cleaned.length > 0 || !!username);

  const startEditing = () => {
    setDraft(username ?? "");
    setErrorText(null);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setErrorText(null);
    try {
      await setGithubUsername({ username: cleaned });
      setEditing(false);
      setDraft("");
    } catch (error) {
      // Surface the real reason — ConvexError explains the username rules,
      // and network failures shouldn't masquerade as validation errors.
      setErrorText(formatError(error));
    } finally {
      setSaving(false);
    }
  };

  const bottomPad = Math.max(insets.bottom, 12);

  if (!editing && username) {
    return (
      <TouchableOpacity
        style={[styles.setRow, { paddingBottom: bottomPad }]}
        onPress={startEditing}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`GitHub credit: @${username}. Tap to change your username.`}
      >
        <Ionicons name="logo-github" size={14} color={colors.textTertiary} />
        <Text
          style={[styles.setRowText, { color: colors.textTertiary }]}
          numberOfLines={1}
        >
          @{username} · getting co-author credit
        </Text>
        <Ionicons name="create-outline" size={14} color={colors.textTertiary} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.cardWrap, { paddingBottom: bottomPad }]}>
      <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>
          Get credit on GitHub
        </Text>
        <Text style={[styles.cardText, { color: colors.textSecondary }]}>
          Add your username and your shipped changes appear on your GitHub
          profile.
        </Text>
        <View style={styles.inputRow}>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.surface,
                borderColor: errorText ? colors.error : colors.border,
                color: colors.text,
              },
            ]}
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              if (errorText) setErrorText(null);
            }}
            placeholder="GitHub username"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={40}
            returnKeyType="done"
            onSubmitEditing={handleSave}
          />
          <TouchableOpacity
            style={[
              styles.saveButton,
              { backgroundColor: primaryColor },
              !canSave && styles.saveButtonDisabled,
            ]}
            onPress={handleSave}
            disabled={!canSave}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.saveButtonText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>
        {errorText ? (
          <Text style={[styles.errorText, { color: colors.error }]}>{errorText}</Text>
        ) : null}
        {editing && username ? (
          <TouchableOpacity
            onPress={() => {
              setEditing(false);
              setErrorText(null);
              setDraft("");
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.cancelText, { color: colors.textTertiary }]}>
              Cancel
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  setRowText: { fontSize: 13, flexShrink: 1 },
  cardWrap: { paddingHorizontal: 16, paddingTop: 8 },
  card: { borderRadius: 12, padding: 12, gap: 6 },
  cardTitle: { fontSize: 13, fontWeight: "600" },
  cardText: { fontSize: 12, lineHeight: 17 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  saveButton: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 9,
    minWidth: 64,
  },
  saveButtonDisabled: { opacity: 0.5 },
  saveButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
  errorText: { fontSize: 12, marginTop: 2 },
  cancelText: { fontSize: 12, marginTop: 2 },
});
