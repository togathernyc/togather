/**
 * Join mode picker for a custom channel.
 *
 * Route: /inbox/[groupId]/[channelSlug]/info/join-mode
 *
 * Explicit Open / Approval-required choice with consequence text. Replaces
 * the swap-icon toggle that used to live next to the invite-link banner on
 * the /members screen — leaders now reach this from a dedicated row in the
 * channel info Leader Controls card.
 *
 * Custom channels only: leaders/reach_out/main don't have an invite link,
 * and PCO channels are sync-driven. Backend will reject other types via
 * `updateJoinMode` even if we forget to gate at the UI.
 */
import React, { useCallback, useState } from "react";
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

type JoinMode = "open" | "approval_required";

export default function ChannelJoinModeRoute() {
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
          includeArchived: true,
        }
      : "skip",
  );

  const inviteInfo = useQuery(
    api.functions.messaging.channelInvites.getInviteInfo,
    token && channel?._id ? { token, channelId: channel._id } : "skip",
  );

  const updateJoinModeMutation = useAuthenticatedMutation(
    api.functions.messaging.channelInvites.updateJoinMode,
  );

  const [submitting, setSubmitting] = useState<JoinMode | null>(null);

  const currentMode: JoinMode =
    (inviteInfo?.joinMode as JoinMode | undefined) ?? "open";

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/inbox/${groupId}/${channelSlug}/info` as any);
    }
  }, [router, groupId, channelSlug]);

  const handleSelect = useCallback(
    async (mode: JoinMode) => {
      if (!channel?._id) return;
      if (mode === currentMode) {
        handleBack();
        return;
      }
      setSubmitting(mode);
      try {
        await updateJoinModeMutation({
          channelId: channel._id,
          joinMode: mode,
        });
        handleBack();
      } catch (e: any) {
        Alert.alert("Could not update", e?.message ?? "Try again.");
      } finally {
        setSubmitting(null);
      }
    },
    [channel?._id, currentMode, updateJoinModeMutation, handleBack],
  );

  if (channel === undefined) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, backgroundColor: colors.surface },
        ]}
      >
        <Header onBack={handleBack} colors={colors} title="Join mode" />
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
        <Header onBack={handleBack} colors={colors} title="Join mode" />
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            This channel is no longer available.
          </Text>
        </View>
      </View>
    );
  }

  const channelName = channel.name?.trim() || "Channel";

  const options: {
    mode: JoinMode;
    title: string;
    description: string;
  }[] = [
    {
      mode: "open",
      title: "Open",
      description:
        "Any channel-eligible member can add others. Invite links grant instant access.",
    },
    {
      mode: "approval_required",
      title: "Approval required",
      description:
        "Adds and invite-link clicks create requests. Leaders approve before someone joins.",
    },
  ];

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.surface },
      ]}
    >
      <Header onBack={handleBack} colors={colors} title="Join mode" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.helper, { color: colors.textSecondary }]}>
          Choose how new members join #{channelName}.
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
          {options.map((opt, idx) => {
            const selected = currentMode === opt.mode;
            const inFlight = submitting === opt.mode;
            return (
              <Pressable
                key={opt.mode}
                onPress={() => handleSelect(opt.mode)}
                disabled={!!submitting}
                style={({ pressed }) => [
                  styles.option,
                  idx > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.border,
                  },
                  pressed && { backgroundColor: colors.selectedBackground },
                ]}
              >
                <View style={styles.optionText}>
                  <Text style={[styles.optionTitle, { color: colors.text }]}>
                    {opt.title}
                  </Text>
                  <Text
                    style={[styles.optionDescription, { color: colors.textSecondary }]}
                  >
                    {opt.description}
                  </Text>
                </View>
                {inFlight ? (
                  <ActivityIndicator size="small" color={primaryColor} />
                ) : selected ? (
                  <View
                    style={[
                      styles.checkCircle,
                      { backgroundColor: primaryColor },
                    ]}
                  >
                    <Ionicons name="checkmark" size={16} color="#fff" />
                  </View>
                ) : (
                  <View
                    style={[
                      styles.uncheckCircle,
                      { borderColor: colors.border },
                    ]}
                  />
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function Header({
  onBack,
  colors,
  title,
}: {
  onBack: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
  title: string;
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
      <Text style={[styles.headerTitle, { color: colors.text }]}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, gap: 16 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { fontSize: 14 },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBackButton: { padding: 4 },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  headerSpacer: { width: 36 },
  helper: { fontSize: 13, lineHeight: 18 },
  card: { borderRadius: 12, overflow: "hidden" },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  optionText: { flex: 1, gap: 4 },
  optionTitle: { fontSize: 16, fontWeight: "600" },
  optionDescription: { fontSize: 13, lineHeight: 18 },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  uncheckCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
  },
});
