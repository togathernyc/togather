/**
 * Active state picker for a channel.
 *
 * Route: /inbox/[groupId]/[channelSlug]/info/active-state
 *
 * Explicit Active / Disabled choice with consequence text under each
 * option — NOT a single-tap toggle. Wires to whichever toggle mutation
 * exists per channel type:
 *   - "leaders":      toggleLeadersChannel
 *   - "reach_out":    toggleReachOutChannel
 *   - "custom":       setCustomChannelLeaderEnabled
 *   - "pco_services": togglePcoChannel
 *   - "main":         toggleMainChannel  (the General row in the group
 *                     page CHANNELS card always navigates to chat, so
 *                     this path isn't currently reachable from the UI,
 *                     but is wired for completeness)
 *
 * Reach Out: when the Leaders channel is disabled at the group level,
 * the "Active" option is itself disabled and we surface a hint at the
 * top so the user knows what to fix first.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import {
  useQuery,
  api,
  useAuthenticatedMutation,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";

export default function ChannelActiveStateRoute() {
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
    // includeArchived: this picker is the place a leader re-enables a
    // disabled channel — must work even when `isArchived` is true (the
    // legacy-disable state for Leaders/Reach Out/main).
    token && groupId && channelSlug
      ? {
          token,
          groupId: groupId as Id<"groups">,
          slug: channelSlug,
          includeArchived: true,
        }
      : "skip",
  );

  const groupChannels = useQuery(
    api.functions.messaging.channels.listGroupChannels,
    token && groupId
      ? { token, groupId: groupId as Id<"groups">, includeArchived: true }
      : "skip",
  );

  const toggleLeadersChannelMutation = useAuthenticatedMutation(
    api.functions.messaging.channels.toggleLeadersChannel,
  );
  const toggleReachOutChannelMutation = useAuthenticatedMutation(
    api.functions.messaging.channels.toggleReachOutChannel,
  );
  const toggleMainChannelMutation = useAuthenticatedMutation(
    api.functions.messaging.channels.toggleMainChannel,
  );
  const togglePcoChannelMutation = useAuthenticatedMutation(
    api.functions.messaging.channels.togglePcoChannel,
  );
  const setCustomChannelLeaderEnabledMutation = useAuthenticatedMutation(
    api.functions.messaging.channels.setCustomChannelLeaderEnabled,
  );

  const [submitting, setSubmitting] = useState(false);

  const channelType = channel?.channelType;
  const currentEnabled = useMemo(() => {
    if (!channel) return false;
    return !channel.isArchived && (channel as any).isEnabled !== false;
  }, [channel]);

  const leadersChannel = groupChannels?.find(
    (c: any) => c.channelType === "leaders",
  );
  const leadersEnabled =
    !!leadersChannel && !leadersChannel.isArchived && leadersChannel.isEnabled !== false;

  const isReachOutAndLeadersOff = channelType === "reach_out" && !leadersEnabled;

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/inbox/${groupId}/${channelSlug}/info` as any);
    }
  }, [router, groupId, channelSlug]);

  const setActive = useCallback(
    async (next: boolean) => {
      if (!channel || !channelType || !groupId) return;
      if (next === currentEnabled) {
        // Already in this state.
        return;
      }
      setSubmitting(true);
      try {
        if (channelType === "leaders") {
          await toggleLeadersChannelMutation({
            groupId: groupId as Id<"groups">,
            enabled: next,
          });
        } else if (channelType === "reach_out") {
          await toggleReachOutChannelMutation({
            groupId: groupId as Id<"groups">,
            enabled: next,
          });
        } else if (channelType === "main") {
          await toggleMainChannelMutation({
            groupId: groupId as Id<"groups">,
            enabled: next,
          });
        } else if (channelType === "pco_services") {
          await togglePcoChannelMutation({
            channelId: channel._id,
            enabled: next,
            managingGroupId: groupId as Id<"groups">,
          });
        } else {
          // custom
          await setCustomChannelLeaderEnabledMutation({
            channelId: channel._id,
            enabled: next,
            managingGroupId: groupId as Id<"groups">,
          });
        }
        if (router.canGoBack()) {
          router.back();
        }
      } catch (e: any) {
        Alert.alert("Error", e?.message || "Failed to update channel");
      } finally {
        setSubmitting(false);
      }
    },
    [
      channel,
      channelType,
      groupId,
      currentEnabled,
      toggleLeadersChannelMutation,
      toggleReachOutChannelMutation,
      toggleMainChannelMutation,
      togglePcoChannelMutation,
      setCustomChannelLeaderEnabledMutation,
      router,
    ],
  );

  if (channel === undefined) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, backgroundColor: colors.surface },
        ]}
      >
        <Header onBack={handleBack} colors={colors} />
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={primaryColor} />
        </View>
      </View>
    );
  }

  if (!channel) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, backgroundColor: colors.surface },
        ]}
      >
        <Header onBack={handleBack} colors={colors} />
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            This channel is no longer available.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.surface },
      ]}
    >
      <Header onBack={handleBack} colors={colors} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {isReachOutAndLeadersOff && (
          <View
            style={[
              styles.hintCard,
              { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
            ]}
          >
            <Ionicons name="information-circle" size={18} color={colors.textSecondary} />
            <Text style={[styles.hintText, { color: colors.textSecondary }]}>
              Requires Leaders channel to be active
            </Text>
          </View>
        )}

        <Option
          colors={colors}
          primaryColor={primaryColor}
          selected={currentEnabled}
          disabled={submitting || isReachOutAndLeadersOff}
          label="Active"
          consequence={consequenceFor(channelType ?? "", true)}
          onPress={() => setActive(true)}
        />
        <Option
          colors={colors}
          primaryColor={primaryColor}
          selected={!currentEnabled}
          disabled={submitting}
          label="Disabled"
          consequence={consequenceFor(channelType ?? "", false)}
          onPress={() => setActive(false)}
        />

        {submitting && (
          <View style={styles.submittingRow}>
            <ActivityIndicator size="small" color={primaryColor} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function consequenceFor(channelType: string, active: boolean): string {
  if (channelType === "leaders") {
    return active
      ? "Leaders channel is visible to leaders and admins of this group."
      : "Leaders channel is hidden. Reach Out also requires this to be active.";
  }
  if (channelType === "reach_out") {
    return active
      ? "Reach Out is available to leaders for one-on-one outreach."
      : "Reach Out is hidden. Leaders won't see it in their tabs.";
  }
  if (channelType === "main") {
    return active
      ? "General is visible to all members."
      : "General is hidden. Members will not be able to use it until you turn it back on.";
  }
  if (channelType === "pco_services") {
    return active
      ? "PCO synced channel is visible to its members."
      : "PCO synced channel is hidden. Memberships are kept in case you re-enable it later.";
  }
  // custom
  return active
    ? "Custom channel is visible to its members."
    : "Channel is hidden from members. No one is removed.";
}

function Option({
  colors,
  primaryColor,
  selected,
  disabled,
  label,
  consequence,
  onPress,
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  primaryColor: string;
  selected: boolean;
  disabled: boolean;
  label: string;
  consequence: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.optionCard,
        {
          backgroundColor: pressed ? colors.selectedBackground : colors.surfaceSecondary,
          borderColor: selected ? primaryColor : "transparent",
          opacity: disabled && !selected ? 0.5 : 1,
        },
      ]}
    >
      <View style={styles.optionRow}>
        <View
          style={[
            styles.radio,
            {
              borderColor: selected ? primaryColor : colors.border,
            },
          ]}
        >
          {selected && (
            <View style={[styles.radioInner, { backgroundColor: primaryColor }]} />
          )}
        </View>
        <Text style={[styles.optionLabel, { color: colors.text }]}>{label}</Text>
      </View>
      <Text style={[styles.optionConsequence, { color: colors.textSecondary }]}>
        {consequence}
      </Text>
    </Pressable>
  );
}

function Header({
  onBack,
  colors,
}: {
  onBack: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <View
      style={[
        styles.headerBar,
        {
          backgroundColor: colors.surface,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <TouchableOpacity onPress={onBack} style={styles.headerBackButton} hitSlop={12}>
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: colors.text }]}>Active state</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingVertical: 24, paddingHorizontal: 12, gap: 12 },
  centered: {
    paddingVertical: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
  },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBackButton: {
    padding: 4,
    marginRight: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  headerSpacer: { width: 36 },
  hintCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hintText: { fontSize: 13, flex: 1 },
  optionCard: {
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  optionLabel: {
    fontSize: 17,
    fontWeight: "600",
  },
  optionConsequence: {
    marginTop: 8,
    marginLeft: 34,
    fontSize: 13,
    lineHeight: 18,
  },
  submittingRow: {
    alignItems: "center",
    paddingTop: 16,
  },
});
