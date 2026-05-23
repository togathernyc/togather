/**
 * TeamCreateScreen — the create-team flow (ADR-025 §6).
 *
 * Reached from the Rostering hub's Teams view ("+ New team"). Collects a
 * team name, an optional description, and a "give this team a chat channel"
 * toggle (default ON). On submit it calls `createServingTeam` and navigates
 * to the new Team detail screen so the leader can add roles.
 *
 * Route: /rostering/[group_id]/team/new
 *
 * Backend: scheduling.teams.createServingTeam.
 */
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

export function TeamCreateScreen() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const groupId = group_id as Id<"groups">;

  const createServingTeam = useAuthenticatedMutation(
    api.functions.scheduling.teams.createServingTeam,
  );

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [withChannel, setWithChannel] = useState(true);
  const [creating, setCreating] = useState(false);

  const canCreate = name.trim().length > 0 && !creating;

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const handleCreate = useCallback(async () => {
    if (!canCreate) return;
    setCreating(true);
    try {
      const result = await createServingTeam({
        groupId,
        name: name.trim(),
        description: description.trim() || undefined,
        withChannel,
      });
      // Replace this screen with the new team's detail screen so backing out
      // returns to the Teams list, not the create form.
      router.replace(
        `/rostering/${groupId}/team/${result.teamId}` as never,
      );
    } catch (e: any) {
      Alert.alert("Couldn't create team", e?.message ?? "Please try again.");
      setCreating(false);
    }
  }, [
    canCreate,
    createServingTeam,
    groupId,
    name,
    description,
    withChannel,
    router,
  ]);

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.surface },
      ]}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: colors.surface, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity onPress={handleBack} hitSlop={12} style={styles.back}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          New team
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
      >
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          Team name
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Worship, Hospitality, Communion Prep"
          placeholderTextColor={colors.inputPlaceholder}
          maxLength={50}
          autoFocus
          style={[
            styles.input,
            {
              color: colors.text,
              borderColor: colors.inputBorder,
              backgroundColor: colors.inputBackground,
            },
          ]}
        />

        <Text
          style={[styles.label, { color: colors.textSecondary, marginTop: 24 }]}
        >
          Description (optional)
        </Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="What this team does"
          placeholderTextColor={colors.inputPlaceholder}
          multiline
          maxLength={280}
          style={[
            styles.input,
            styles.descriptionInput,
            {
              color: colors.text,
              borderColor: colors.inputBorder,
              backgroundColor: colors.inputBackground,
            },
          ]}
        />

        <View
          style={[styles.channelCard, { backgroundColor: colors.surfaceSecondary }]}
        >
          <View style={styles.channelTop}>
            <Ionicons
              name="chatbubbles-outline"
              size={20}
              color={colors.text}
            />
            {/* Layout lives on this static-styled inner View — a Pressable
                function-style `style` silently drops layout on web. */}
            <Text style={[styles.channelTitle, { color: colors.text }]}>
              Give this team a chat channel
            </Text>
            <Switch value={withChannel} onValueChange={setWithChannel} />
          </View>
          <Text style={[styles.channelHint, { color: colors.textTertiary }]}>
            {withChannel
              ? "The team gets a chat channel in the inbox to coordinate."
              : "No chat channel — this team is for rostering only. You can add one later."}
          </Text>
        </View>

        <Pressable
          onPress={handleCreate}
          disabled={!canCreate}
          style={[
            styles.createBtn,
            { backgroundColor: canCreate ? primaryColor : colors.border },
          ]}
        >
          {creating ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.createBtnText}>Create team</Text>
          )}
        </Pressable>

        <Text style={[styles.afterHint, { color: colors.textSecondary }]}>
          You'll add roles to the team next.
        </Text>
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  headerSpacer: {
    width: 36,
  },
  scrollContent: {
    padding: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  input: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  descriptionInput: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  channelCard: {
    borderRadius: 12,
    padding: 14,
    marginTop: 24,
    gap: 8,
  },
  channelTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  channelTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
  },
  channelHint: {
    fontSize: 13,
    lineHeight: 18,
  },
  createBtn: {
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
    marginTop: 28,
  },
  createBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  afterHint: {
    fontSize: 13,
    textAlign: "center",
    marginTop: 14,
  },
});
