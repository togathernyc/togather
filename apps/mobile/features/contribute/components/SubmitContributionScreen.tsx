/**
 * SubmitContributionScreen — report a bug or feature idea (ADR-029 Phase 1).
 *
 * Deliberately non-technical: contributors describe what happened (or what
 * they wish happened) in their own words; the AI spec agent does the
 * investigation. Screenshots are omitted in v1 — the existing chat upload
 * flow returns r2: storage paths, not the public URLs this contract expects.
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
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { formatError } from "@/utils/error-handling";
import { useSubmitContribution } from "../hooks/useContributionMutations";
import type { ContributionKind } from "../types";

export function SubmitContributionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const submit = useSubmitContribution();

  const [kind, setKind] = useState<ContributionKind>("bug");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [repro, setRepro] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const id = await submit({
        kind,
        title: title.trim(),
        body: body.trim(),
        ...(repro.trim() ? { repro: repro.trim() } : {}),
      });
      // Land on the new item's detail screen instead of back on the form.
      router.replace(`/(user)/contribute/${id}`);
    } catch (error) {
      Alert.alert("Couldn't submit", formatError(error));
      setSubmitting(false);
    }
  };

  const inputStyle = [
    styles.input,
    {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      color: colors.text,
    },
  ];

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
          Report a bug or idea
        </Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          What kind of report is this?
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

        <Text style={[styles.label, { color: colors.textSecondary }]}>Title</Text>
        <TextInput
          style={inputStyle}
          value={title}
          onChangeText={setTitle}
          placeholder={
            kind === "bug" ? "e.g. Event photos won't open" : "e.g. Let me RSVP for my kids"
          }
          placeholderTextColor={colors.textTertiary}
          maxLength={120}
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>
          {kind === "bug" ? "What happened, and what did you expect?" : "What should happen?"}
        </Text>
        <TextInput
          style={[...inputStyle, styles.multiline]}
          value={body}
          onChangeText={setBody}
          placeholder={
            kind === "bug"
              ? "Describe what went wrong in your own words — no technical detail needed."
              : "Describe the idea and why it would help — no technical detail needed."
          }
          placeholderTextColor={colors.textTertiary}
          multiline
          textAlignVertical="top"
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>
          How to see it (optional)
        </Text>
        <TextInput
          style={[...inputStyle, styles.multiline]}
          value={repro}
          onChangeText={setRepro}
          placeholder="Where in the app would we look? e.g. Open a group, tap Events, then…"
          placeholderTextColor={colors.textTertiary}
          multiline
          textAlignVertical="top"
        />

        <Text style={[styles.hint, { color: colors.textTertiary }]}>
          After you submit, the AI drafts a plan for the change and you'll be
          asked to confirm it says what you meant before anything is built.
        </Text>

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
            <Text style={styles.submitButtonText}>Submit</Text>
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
  label: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 20,
    marginBottom: 6,
  },
  kindToggle: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 4,
    gap: 4,
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
  },
  multiline: { minHeight: 110, paddingTop: 10 },
  hint: { fontSize: 13, lineHeight: 19, marginTop: 20 },
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
