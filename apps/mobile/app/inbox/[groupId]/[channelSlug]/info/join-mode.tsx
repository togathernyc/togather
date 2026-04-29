/**
 * Join Mode Picker
 *
 * Route: /inbox/[groupId]/[channelSlug]/info/join-mode
 *
 * Two explicit options (Open / Approval required) with consequence text
 * under each — NOT a single-tap toggle. Per the design spec, leaders
 * should see what each mode does before changing it.
 *
 * Backend: api.functions.messaging.channelInvites.updateJoinMode
 */
import React, { useCallback, useState } from "react";
import { View, ActivityIndicator, ScrollView, Alert, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useQuery, useMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

import { GroupCard, InfoHeader, PickerRow, infoStyles } from "./_shared";

export default function JoinModeScreen() {
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

  const inviteInfo = useQuery(
    api.functions.messaging.channelInvites.getInviteInfo,
    token && channel?._id ? { token, channelId: channel._id } : "skip",
  );

  const updateJoinModeMutation = useMutation(
    api.functions.messaging.channelInvites.updateJoinMode,
  );

  const [submitting, setSubmitting] = useState<"open" | "approval_required" | null>(
    null,
  );

  const currentMode: "open" | "approval_required" =
    (inviteInfo?.joinMode as "open" | "approval_required" | undefined) ?? "open";

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/inbox/${groupId}/${channelSlug}/info` as any);
    }
  }, [router, groupId, channelSlug]);

  const handleSelect = useCallback(
    async (next: "open" | "approval_required") => {
      if (!token || !channel?._id || next === currentMode) return;
      setSubmitting(next);
      try {
        await updateJoinModeMutation({
          token,
          channelId: channel._id,
          joinMode: next,
        });
        // Pop back to the info screen on success — picker pattern parity
        // with iOS settings menus.
        handleBack();
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Failed to update join mode.";
        Alert.alert("Error", msg);
      } finally {
        setSubmitting(null);
      }
    },
    [token, channel, currentMode, updateJoinModeMutation, handleBack],
  );

  if (!channel || !inviteInfo) {
    return (
      <View style={[infoStyles.container, { backgroundColor: colors.surface }]}>
        <InfoHeader title="Join mode" onBack={handleBack} colors={colors} />
        <View style={infoStyles.centered}>
          <ActivityIndicator size="small" color={primaryColor} />
        </View>
      </View>
    );
  }

  return (
    <View style={[infoStyles.container, { backgroundColor: colors.surface }]}>
      <InfoHeader title="Join mode" onBack={handleBack} colors={colors} />
      <ScrollView
        style={infoStyles.scroll}
        contentContainerStyle={[
          infoStyles.scrollContent,
          { paddingBottom: insets.bottom + 32, paddingTop: 16 },
        ]}
      >
        <Text style={[infoStyles.sectionIntro, { color: colors.textSecondary }]}>
          Choose how new members join #{channel.name}.
        </Text>
        <GroupCard colors={colors}>
          <PickerRow
            colors={colors}
            primaryColor={primaryColor}
            label="Open"
            description="Any channel-eligible member can add others. Invite links grant instant access."
            selected={currentMode === "open"}
            disabled={submitting !== null}
            onPress={() => handleSelect("open")}
          />
          <PickerRow
            colors={colors}
            primaryColor={primaryColor}
            label="Approval required"
            description="Adds and invite links create requests. Leaders approve."
            selected={currentMode === "approval_required"}
            disabled={submitting !== null}
            onPress={() => handleSelect("approval_required")}
          />
        </GroupCard>
      </ScrollView>
    </View>
  );
}
