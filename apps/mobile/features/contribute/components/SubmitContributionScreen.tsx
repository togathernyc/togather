/**
 * SubmitContributionScreen — start a conversation with the AI builder
 * (ADR-029 Phase 1.5, chat-first filing).
 *
 * Deliberately non-technical and low-friction: contributors pick bug vs.
 * feature, then just describe the thing in one message and optionally attach
 * screenshots — no title/repro form. The AI spec agent investigates, writes a
 * headline, and replies in the conversation thread.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { formatError } from "@/utils/error-handling";
import { notify } from "@/utils/platformAlert";
import { useSubmitContribution } from "../hooks/useContributionMutations";
import { useImageAttachments } from "../hooks/useImageAttachments";
import { AttachmentStrip } from "./AttachmentStrip";
import type { ContributionKind } from "../types";

export function SubmitContributionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const submit = useSubmitContribution();
  const images = useImageAttachments();

  const [kind, setKind] = useState<ContributionKind>("bug");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const hasContent =
    message.trim().length > 0 || images.storagePaths.length > 0;
  const canSubmit = hasContent && !submitting && !images.uploading;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const id = await submit({
        kind,
        body: message.trim(),
        ...(images.storagePaths.length > 0
          ? { screenshotUrls: images.storagePaths }
          : {}),
      });
      // Land on the new item's detail screen instead of back on the form.
      router.replace(`/(user)/dev/${id}`);
    } catch (error) {
      notify("Couldn't submit", formatError(error));
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          New conversation
        </Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.intro, { color: colors.textSecondary }]}>
          Just describe it in your own words — what you saw or what you want.
          Add screenshots if they help. The AI reads it, drafts a plan, and
          replies here so you can chat it through.
        </Text>

        <View style={[styles.kindToggle, { backgroundColor: colors.surfaceSecondary }]}>
          {(
            [
              { value: "bug", label: "Bug", icon: "bug-outline" },
              { value: "feature", label: "Feature idea", icon: "bulb-outline" },
            ] as const
          ).map((option) => {
            const selected = kind === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.kindOption,
                  selected && { backgroundColor: colors.surface, borderColor: primaryColor },
                ]}
                onPress={() => setKind(option.value)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={option.icon}
                  size={16}
                  color={selected ? primaryColor : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.kindOptionText,
                    { color: selected ? primaryColor : colors.textSecondary },
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
          value={message}
          onChangeText={setMessage}
          placeholder={
            kind === "bug"
              ? "What went wrong? Where did you see it? No technical detail needed."
              : "What should happen, and why would it help? No technical detail needed."
          }
          placeholderTextColor={colors.textTertiary}
          multiline
          textAlignVertical="top"
          autoFocus
        />

        <AttachmentStrip attachments={images.attachments} onRemove={images.remove} />

        <TouchableOpacity
          style={styles.attachButton}
          onPress={images.pick}
          activeOpacity={0.7}
        >
          <Ionicons name="image-outline" size={18} color={primaryColor} />
          <Text style={[styles.attachButtonText, { color: primaryColor }]}>
            Add screenshots
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.submitButton,
            { backgroundColor: primaryColor },
            !canSubmit && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          activeOpacity={0.8}
        >
          {submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.submitButtonText}>
              {images.uploading ? "Uploading…" : "Start conversation"}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  backBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  scroll: { padding: 16, paddingBottom: 48 },
  intro: { fontSize: 14, lineHeight: 21, marginBottom: 18 },
  kindToggle: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 4,
    gap: 4,
    marginBottom: 16,
  },
  kindOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "transparent",
  },
  kindOptionText: { fontSize: 14, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 140,
    paddingTop: 10,
  },
  attachButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingVertical: 10,
    marginTop: 4,
  },
  attachButtonText: { fontSize: 14, fontWeight: "600" },
  submitButton: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 16,
  },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
});
