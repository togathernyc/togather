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
 * on whatsapp-shell) and the inbox's "N more channels" collapse row. The
 * route also guards itself (defense in depth): deep links or stale
 * navigation state bypass flag-gated entry points, so the wrapper below
 * redirects when the shell is off. Because this screen only ever mounts
 * flag-on, it's styled unconditionally to
 * `docs/plans/church-migration-ui-redesign/WHATSAPP-DESIGN-SYSTEM.md` §3.1
 * (full-bleed rows — this is a discovery list, not a settings surface) /
 * §8 ("Directory" checklist) using the `components/wa/*` kit: `WaRow` +
 * `WaSeparator` rows on `bg.plain`, `WaSectionLabel` section headers, and
 * Join/Request rendered as small accent text-buttons trailing each row.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
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
import { useWhatsappShellState } from "@hooks/useWhatsappShell";
import { WaRow, WaSeparator, WaSectionLabel, WA_ROW_LEADING_PADDING } from "@components/wa";

type JoinableChannel = {
  channelId: Id<"chatChannels">;
  name: string;
  memberCount: number;
  joinMode: "open" | "approval_required";
  hasPendingRequest: boolean;
};

export default function ChannelDirectoryRoute() {
  // Defense in depth: honor the flag at the route itself, not just its
  // flag-gated entry points (deep links can bypass entries). Wrapper keeps
  // the screen's hook order intact across flag flips.
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { enabled, loaded } = useWhatsappShellState();
  if (!loaded) return null;
  if (!enabled) {
    return <Redirect href={(groupId ? `/inbox/${groupId}` : "/inbox") as any} />;
  }
  return <ChannelDirectoryScreen />;
}

function ChannelDirectoryScreen() {
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
  const isLeader = group?.userRole === "leader";

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

  // Drop optimistic entries once the live query confirms them, so the
  // reactive data stays the steady-state source of truth (e.g. a leader
  // declining a request re-enables the Request button without a remount).
  useEffect(() => {
    if (!joinable) return;
    setLocalStatus((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, status] of Object.entries(prev)) {
        const row = joinable.find((c) => (c.channelId as string) === id);
        const confirmed =
          (status === "requested" && row?.hasPendingRequest === true) ||
          (status === "joined" && !row);
        if (confirmed) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [joinable]);

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
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.navBarBackground, borderBottomColor: colors.separator }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton} hitSlop={12}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Channels</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Your channels — full-bleed §3.1 rows (§8 Directory checklist:
            "even though content is discovery, not chat"). */}
        <View style={styles.sectionLabelWrapper}>
          <WaSectionLabel>Your channels</WaSectionLabel>
        </View>
        {channels === undefined ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={primaryColor} />
          </View>
        ) : yourChannels.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            You're not in any channels in this group yet.
          </Text>
        ) : (
          <View>
            {yourChannels.map((channel: any, idx: number) => (
              <React.Fragment key={channel._id}>
                {idx > 0 && <WaSeparator />}
                <WaRow
                  title={channel.name}
                  subtitle={`${channel.memberCount} member${channel.memberCount !== 1 ? "s" : ""}`}
                  showMutedDot={channel.isMuted === true}
                  showChevron
                  height={60}
                  onPress={() => handleOpenYourChannel(channel.slug)}
                />
              </React.Fragment>
            ))}
          </View>
        )}

        {/* Channels you can join — Join/Request render as small accent
            text-buttons trailing the row (§8: not a chip). */}
        <View style={[styles.sectionLabelWrapper, styles.sectionHeaderSpaced]}>
          <WaSectionLabel>Channels you can join</WaSectionLabel>
        </View>
        {joinable === undefined ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={primaryColor} />
          </View>
        ) : joinable.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No channels open to join right now.
          </Text>
        ) : (
          <View>
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
                <React.Fragment key={channel.channelId}>
                  {idx > 0 && <WaSeparator />}
                  <WaRow
                    title={channel.name}
                    subtitle={`${channel.memberCount} member${channel.memberCount !== 1 ? "s" : ""}${isRequestMode ? " · Approval required" : ""}`}
                    height={60}
                    rightAccessory={
                      isBusy ? (
                        <ActivityIndicator size="small" color={primaryColor} />
                      ) : (
                        <Pressable
                          onPress={() => handleJoinOrRequest(channel)}
                          disabled={disabled}
                          hitSlop={8}
                        >
                          <Text
                            style={[
                              styles.joinButtonText,
                              { color: disabled ? colors.textTertiary : primaryColor },
                            ]}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      )
                    }
                  />
                </React.Fragment>
              );
            })}
          </View>
        )}

        {/* Leader-only footer link to the existing create-channel screen. */}
        {isLeader && (
          <TouchableOpacity
            style={styles.createRow}
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
  // No horizontal padding here — WaRow/WaSectionLabel bring their own §3.1
  // edge padding (16pt), so an outer padded container would double it.
  scrollContent: {
    paddingTop: 12,
    paddingBottom: 32,
  },
  sectionLabelWrapper: {
    marginBottom: 8,
  },
  sectionHeaderSpaced: {
    marginTop: 24,
  },
  loadingRow: {
    paddingVertical: 24,
    paddingHorizontal: WA_ROW_LEADING_PADDING,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    paddingHorizontal: WA_ROW_LEADING_PADDING,
    paddingVertical: 20,
    textAlign: "center",
  },
  // §3.2 "Plain text action" convention (§1.3) — small accent text, no
  // border/fill, per this screen's explicit restyle instruction.
  joinButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
    paddingHorizontal: WA_ROW_LEADING_PADDING,
    paddingVertical: 14,
  },
  createLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
});
