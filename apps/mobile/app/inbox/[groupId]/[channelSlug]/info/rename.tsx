/**
 * Rename Channel Modal
 *
 * Route: /inbox/[groupId]/[channelSlug]/info/rename
 *
 * Modal-presentation route: dismisses on save/cancel back to the info
 * screen. Uses the existing api.functions.messaging.channels.updateChannel
 * mutation (same one used elsewhere for channel name/description edits).
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useQuery, useMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

import { InfoHeader, infoStyles } from "./_shared";

const MAX_NAME_LENGTH = 80;

export default function RenameChannelModal() {
  const { groupId, channelSlug } = useLocalSearchParams<{
    groupId: string;
    channelSlug: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  const channel = useQuery(
    api.functions.messaging.channels.getChannelBySlug,
    token && groupId && channelSlug
      ? {
          token,
          groupId: groupId as Id<"groups">,
          slug: channelSlug,
        }
      : "skip",
  );

  const updateChannelMutation = useMutation(
    api.functions.messaging.channels.updateChannel,
  );

  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  // Seed the input with the current name on first load only — re-seeding on
  // every channel change would clobber the user's edits.
  useEffect(() => {
    if (!seeded && channel?.name) {
      setName(channel.name);
      setSeeded(true);
    }
  }, [seeded, channel?.name]);

  const handleClose = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/inbox/${groupId}/${channelSlug}/info` as any);
    }
  }, [router, groupId, channelSlug]);

  const handleSubmit = useCallback(async () => {
    if (!token || !channel) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Channel name can't be empty.");
      return;
    }
    if (trimmed === channel.name) {
      handleClose();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await updateChannelMutation({
        token,
        channelId: channel._id,
        name: trimmed,
      });
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't rename channel.");
    } finally {
      setSubmitting(false);
    }
  }, [token, channel, name, updateChannelMutation, handleClose]);

  if (!channel) {
    return (
      <View style={[infoStyles.container, { backgroundColor: colors.surface }]}>
        <InfoHeader title="Rename channel" onBack={handleClose} colors={colors} />
        <View style={infoStyles.centered}>
          <ActivityIndicator size="small" color={primaryColor} />
        </View>
      </View>
    );
  }

  return (
    <View style={[infoStyles.container, { backgroundColor: colors.surface }]}>
      <InfoHeader title="Rename channel" onBack={handleClose} colors={colors} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={infoStyles.scroll}
          contentContainerStyle={[
            infoStyles.scrollContent,
            {
              paddingBottom: insets.bottom + 32,
              paddingTop: 24,
              paddingHorizontal: 16,
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[infoStyles.sectionIntro, { color: colors.textSecondary, paddingHorizontal: 0, marginBottom: 12 }]}>
            Channel name
          </Text>
          <TextInput
            value={name}
            onChangeText={(v) => {
              setName(v);
              if (error) setError(null);
            }}
            placeholder="Channel name"
            placeholderTextColor={colors.inputPlaceholder}
            maxLength={MAX_NAME_LENGTH}
            autoFocus
            style={[
              infoStyles.renameInput,
              {
                color: colors.text,
                backgroundColor: colors.inputBackground,
                borderColor: colors.inputBorder,
              },
            ]}
          />
          {error ? (
            <Text
              style={[
                infoStyles.errorText,
                { color: colors.destructive, marginTop: 12, textAlign: "left" },
              ]}
            >
              {error}
            </Text>
          ) : null}
          <View style={infoStyles.modalActions}>
            <TouchableOpacity
              onPress={handleClose}
              disabled={submitting}
              style={[
                infoStyles.modalButton,
                { backgroundColor: colors.surfaceSecondary },
              ]}
            >
              <Text style={[infoStyles.modalButtonText, { color: colors.text }]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={submitting || !name.trim()}
              style={[
                infoStyles.modalButton,
                { backgroundColor: primaryColor },
                (submitting || !name.trim()) && { opacity: 0.5 },
              ]}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={[infoStyles.modalButtonText, { color: "#ffffff" }]}>
                  Save
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
