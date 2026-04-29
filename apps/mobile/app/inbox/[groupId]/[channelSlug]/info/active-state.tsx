/**
 * Active State Picker
 *
 * Route: /inbox/[groupId]/[channelSlug]/info/active-state
 *
 * Two explicit options (Active / Disabled) with consequence text under
 * each — leaders flip channels off without losing message history.
 *
 * Backend dispatch:
 *   - PCO auto channels (`pco_services`) use `togglePcoChannel` because
 *     they need extra side-effects (sync config + rotation kick-off).
 *   - Everything else (custom, leaders, reach_out) uses the unified
 *     `setChannelEnabled` mutation. The backend handles cascades:
 *     disabling Leaders auto-disables Reach Out; enabling Reach Out
 *     requires Leaders to be active.
 *
 * Reach Out hint: when this channel is reach_out and the Leaders channel
 * is currently disabled, we show a hint banner and disable the "Active"
 * option (you can still flip back to Disabled).
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useQuery, useMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

import { GroupCard, InfoHeader, PickerRow, infoStyles } from "./_shared";

export default function ActiveStateScreen() {
  const { groupId, channelSlug } = useLocalSearchParams<{
    groupId: string;
    channelSlug: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { colors, isDark } = useTheme();
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

  // Sibling channels — used for the reach_out -> leaders dependency hint.
  const siblingChannels = useQuery(
    api.functions.messaging.channels.listGroupChannels,
    token && groupId && channel?.channelType === "reach_out"
      ? { token, groupId: groupId as Id<"groups"> }
      : "skip",
  );

  const setChannelEnabledMutation = useMutation(
    api.functions.messaging.channels.setChannelEnabled,
  );
  const togglePcoChannelMutation = useMutation(
    api.functions.messaging.channels.togglePcoChannel,
  );

  const [submitting, setSubmitting] = useState<"active" | "disabled" | null>(null);

  // Unified read of "is currently enabled" — covers both the new `enabled`
  // field and legacy `isEnabled` for docs not yet touched by the cleanup
  // migration. Mirrors `channelIsLeaderEnabled` in convex/lib/helpers.ts.
  const isCurrentlyActive = useMemo(() => {
    if (!channel) return true;
    const ch = channel as { enabled?: boolean; isEnabled?: boolean };
    if (ch.enabled !== undefined) return ch.enabled !== false;
    return ch.isEnabled !== false;
  }, [channel]);

  const leadersDisabled = useMemo(() => {
    if (channel?.channelType !== "reach_out" || !siblingChannels) return false;
    const leaders = siblingChannels.find((c) => c.channelType === "leaders");
    if (!leaders) return false;
    return leaders.isEnabled === false;
  }, [channel, siblingChannels]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/inbox/${groupId}/${channelSlug}/info` as any);
    }
  }, [router, groupId, channelSlug]);

  const dispatchToggle = useCallback(
    async (enabled: boolean) => {
      if (!token || !channel) return;
      if (channel.channelType === "pco_services") {
        await togglePcoChannelMutation({
          token,
          channelId: channel._id,
          enabled,
        });
        return;
      }
      await setChannelEnabledMutation({
        token,
        channelId: channel._id,
        enabled,
      });
    },
    [token, channel, togglePcoChannelMutation, setChannelEnabledMutation],
  );

  const handleSelect = useCallback(
    async (target: "active" | "disabled") => {
      const targetEnabled = target === "active";
      if (
        channel?.channelType === "reach_out" &&
        targetEnabled &&
        leadersDisabled
      ) {
        // Guarded by the disabled prop on the row; defensive belt-and-suspenders.
        return;
      }
      if (targetEnabled === isCurrentlyActive) return;
      setSubmitting(target);
      try {
        await dispatchToggle(targetEnabled);
        // Pop back to info on success — value will refresh from the query.
        if (router.canGoBack()) {
          router.back();
        }
      } catch (error) {
        const msg =
          error instanceof Error
            ? error.message
            : "Failed to update channel state.";
        Alert.alert("Error", msg);
      } finally {
        setSubmitting(null);
      }
    },
    [channel, isCurrentlyActive, leadersDisabled, dispatchToggle, router],
  );

  if (!channel) {
    return (
      <View style={[infoStyles.container, { backgroundColor: colors.surface }]}>
        <InfoHeader title="Active state" onBack={handleBack} colors={colors} />
        <View style={infoStyles.centered}>
          <ActivityIndicator size="small" color={primaryColor} />
        </View>
      </View>
    );
  }

  const showLeadersHint = channel.channelType === "reach_out" && leadersDisabled;
  const activeOptionDisabled = showLeadersHint || submitting !== null;

  return (
    <View style={[infoStyles.container, { backgroundColor: colors.surface }]}>
      <InfoHeader title="Active state" onBack={handleBack} colors={colors} />
      <ScrollView
        style={infoStyles.scroll}
        contentContainerStyle={[
          infoStyles.scrollContent,
          { paddingBottom: insets.bottom + 32, paddingTop: 16 },
        ]}
      >
        <Text style={[infoStyles.sectionIntro, { color: colors.textSecondary }]}>
          Choose whether #{channel.name} appears in members' inboxes.
        </Text>

        {showLeadersHint ? (
          <View
            style={[
              infoStyles.hintBanner,
              {
                backgroundColor: isDark ? "rgba(255,159,10,0.12)" : "#FFF7E6",
              },
            ]}
          >
            <Ionicons
              name="information-circle"
              size={16}
              color={colors.warning}
              style={{ marginTop: 1 }}
            />
            <Text style={[infoStyles.hintBannerText, { color: colors.text }]}>
              Reach Out requires the Leaders channel to be active. Re-enable
              Leaders first to turn this back on.
            </Text>
          </View>
        ) : null}

        <GroupCard colors={colors}>
          <PickerRow
            colors={colors}
            primaryColor={primaryColor}
            label="Active"
            description="Channel is visible to members."
            selected={isCurrentlyActive}
            disabled={activeOptionDisabled}
            onPress={() => handleSelect("active")}
          />
          <PickerRow
            colors={colors}
            primaryColor={primaryColor}
            label="Disabled"
            description="Members won't see this channel in their inbox or the group page. Messages are preserved."
            selected={!isCurrentlyActive}
            disabled={submitting !== null}
            onPress={() => handleSelect("disabled")}
          />
        </GroupCard>
      </ScrollView>
    </View>
  );
}
