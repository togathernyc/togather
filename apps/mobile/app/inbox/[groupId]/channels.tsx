/**
 * Channel Directory Route
 *
 * Route: /inbox/[groupId]/channels
 *
 * W17 — the fractal intermediary page for a group: "Your channels" (with a
 * muted indicator, tap through to the chat) and "Channels you can join"
 * (discoverable custom channels — Join for open joinMode, Request for
 * approval_required, showing a disabled "Requested" state once a request is
 * pending). Leaders get a footer link to the existing create-channel screen.
 *
 * Reached from the group page's CHANNELS card ("See all channels", flag-gated
 * on whatsapp-shell) and, per the redesign brief, the inbox's "N more
 * channels" collapse row. The route itself is harmless when unlinked, so it
 * isn't flag-gated — only its entry points are (per the redesign's rollout
 * rule: new routes are safe to ship unlinked).
 */
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  useQuery,
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { errorMessage } from "@/utils/error-handling";
import { useGroupChannels } from "@features/groups/hooks/useGroupChannels";

type JoinableChannel = {
  channelId: Id<"chatChannels">;
  name: string;
  memberCount: number;
  joinMode: "open" | "approval_required";
  hasPendingRequest: boolean;
};

export default function ChannelDirectoryScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();

  // Reused from ChannelsSection — the group's channel list, offline-cached.
  const { channels } = useGroupChannels(groupId ?? "");
  const yourChannels = (channels ?? []).filter((c: any) => c.isMember);

  // Leader gate for the footer "Create channel" link — mirrors the check
  // create.tsx and ChannelsSection use elsewhere on this group.
  const group = useQuery(
    api.functions.groups.index.getById,
    groupId && token ? { groupId: groupId as Id<"groups">, token } : "skip",
  );
  const isLeader = (group as any)?.userRole === "leader";

  // "Channels you can join" — discoverable custom channels the user hasn't
  // joined yet. New backend contract (apps/convex/functions/messaging/
  // channels.ts, implemented in parallel): listJoinableChannels({groupId}).
  const joinable = useAuthenticatedQuery(
    api.functions.messaging.channels.listJoinableChannels,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  ) as JoinableChannel[] | undefined;

  const joinChannelMutation = useAuthenticatedMutation(
    api.functions.messaging.channels.joinDiscoverableChannel,
  );

  // Local optimistic status per channelId — the reactive `joinable` query
  // will eventually reflect the same thing (hasPendingRequest / the channel
  // dropping off the list once joined), but this keeps the button responsive
  // in the meantime instead of flashing back to "Join"/"Request" between the
  // mutation resolving and the query re-running.
  const [localStatus, setLocalStatus] = useState<
    Record<string, "joining" | "joined" | "requesting" | "requested">
  >({});

  const handleJoinOrRequest = useCallback(
    async (channel: JoinableChannel) => {
      const id = channel.channelId as string;
      const isRequest = channel.joinMode === "approval_required";
      setLocalStatus((prev) => ({
        ...prev,
        [id]: isRequest ? "requesting" : "joining",
      }));
      try {
        const result = await joinChannelMutation({ channelId: channel.channelId });
        setLocalStatus((prev) => ({
          ...prev,
          [id]: result.status === "requested" ? "requested" : "joined",
        }));
      } catch (e: any) {
        setLocalStatus((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        Alert.alert(
          "Couldn't join channel",
          errorMessage(e, "Please try again."),
        );
      }
    },
    [joinChannelMutation],
  );

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/inbox/${groupId}/general` as any);
    }
  };

  const handleOpenYourChannel = useCallback(
    (slug: string) => {
      router.push(`/inbox/${groupId}/${slug}` as any);
    },
    [router, groupId],
  );

  const handleCreateChannel = useCallback(() => {
    router.push(`/inbox/${groupId}/create` as any);
  }, [router, groupId]);

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.surfaceSecondary }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Channels</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Your channels */}
        <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
          YOUR CHANNELS
        </Text>
        {channels === undefined ? (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={primaryColor} />
            </View>
          </View>
        ) : yourChannels.length === 0 ? (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              You're not in any channels in this group yet.
            </Text>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            {yourChannels.map((channel: any, idx: number) => {
              const isMuted = channel.isMuted === true;
              return (
                <TouchableOpacity
                  key={channel._id}
                  activeOpacity={0.7}
                  onPress={() => handleOpenYourChannel(channel.slug)}
                  style={[
                    styles.row,
                    idx > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.rowInfo}>
                    <View style={styles.rowNameLine}>
                      <Text
                        style={[styles.rowName, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {channel.name}
                      </Text>
                      {isMuted && (
                        <Ionicons
                          name="notifications-off-outline"
                          size={14}
                          color={colors.textTertiary}
                          style={styles.mutedIcon}
                        />
                      )}
                    </View>
                    <Text
                      style={[styles.rowSubtitle, { color: colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {channel.memberCount} member{channel.memberCount !== 1 ? "s" : ""}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Channels you can join */}
        <Text style={[styles.sectionHeader, styles.sectionHeaderSpaced, { color: colors.textSecondary }]}>
          CHANNELS YOU CAN JOIN
        </Text>
        {joinable === undefined ? (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={primaryColor} />
            </View>
          </View>
        ) : joinable.length === 0 ? (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No channels open to join right now.
            </Text>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            {joinable.map((channel, idx) => {
              const id = channel.channelId as string;
              const status = localStatus[id];
              const isRequestMode = channel.joinMode === "approval_required";
              const alreadyRequested =
                status === "requested" || (channel.hasPendingRequest && status !== "joined");
              const isBusy = status === "joining" || status === "requesting";
              const isJoined = status === "joined";
              const label = isJoined
                ? "Joined"
                : alreadyRequested
                  ? "Requested"
                  : isRequestMode
                    ? "Request"
                    : "Join";
              const disabled = isBusy || isJoined || alreadyRequested;
              return (
                <View
                  key={channel.channelId}
                  style={[
                    styles.row,
                    idx > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.rowInfo}>
                    <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                      {channel.name}
                    </Text>
                    <Text
                      style={[styles.rowSubtitle, { color: colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {channel.memberCount} member{channel.memberCount !== 1 ? "s" : ""}
                      {isRequestMode ? " · Approval required" : ""}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleJoinOrRequest(channel)}
                    disabled={disabled}
                    style={[
                      styles.joinButton,
                      {
                        backgroundColor: disabled
                          ? colors.surfaceSecondary
                          : primaryColor + "15",
                        borderColor: disabled ? colors.border : primaryColor,
                      },
                    ]}
                  >
                    {isBusy ? (
                      <ActivityIndicator size="small" color={primaryColor} />
                    ) : (
                      <Text
                        style={[
                          styles.joinButtonText,
                          { color: disabled ? colors.textTertiary : primaryColor },
                        ]}
                      >
                        {label}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {/* Leader-only footer link to the existing create-channel screen. */}
        {isLeader && (
          <TouchableOpacity
            style={[styles.createCard, { backgroundColor: colors.surface }]}
            onPress={handleCreateChannel}
            activeOpacity={0.7}
          >
            <Ionicons name="add-circle-outline" size={20} color={primaryColor} />
            <Text style={[styles.createLabel, { color: primaryColor }]}>
              Add channel
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  headerRight: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  sectionHeaderSpaced: {
    marginTop: 24,
  },
  card: {
    borderRadius: 12,
    overflow: "hidden",
  },
  loadingRow: {
    paddingVertical: 24,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    paddingHorizontal: 16,
    paddingVertical: 20,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 56,
    gap: 12,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowNameLine: {
    flexDirection: "row",
    alignItems: "center",
  },
  rowName: {
    fontSize: 16,
    fontWeight: "600",
  },
  mutedIcon: {
    marginLeft: 6,
  },
  rowSubtitle: {
    marginTop: 2,
    fontSize: 13,
  },
  joinButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 76,
    alignItems: "center",
    justifyContent: "center",
  },
  joinButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },
  createCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    justifyContent: "center",
  },
  createLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
});
