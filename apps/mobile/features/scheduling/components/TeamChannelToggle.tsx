/**
 * TeamChannelToggle
 *
 * A small pill that shows a serving team's chat-channel state ("💬 Chat on /
 * off") and toggles it via `linkChannel` / `unlinkChannel`. Used by both the
 * NeededRolesModal and the EventEditorScreen so the confirm copy and the
 * mutation logic stay in one place.
 *
 * Tapping the pill prompts an `Alert.alert` confirm — the action affects
 * every event the team is on, so we want an explicit "yes". Errors are
 * surfaced via `Alert.alert`.
 *
 * Layout pattern: the Pressable wraps a static-styled inner View — RN-Web
 * silently drops layout on a Pressable's function-style `style` prop.
 *
 * Backend: scheduling.teams.linkChannel / unlinkChannel.
 */
import React, { useCallback, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { confirmAsync, notify } from "@/utils/platformAlert";

export function TeamChannelToggle({
  teamId,
  teamName,
  hasChannel,
  /**
   * Auto-synced channel member count, used in the "turn off" confirm so the
   * leader can see the human impact before unlinking.
   */
  channelMemberCount = 0,
}: {
  teamId: Id<"teams">;
  teamName: string;
  hasChannel: boolean;
  channelMemberCount?: number;
}) {
  const { colors } = useTheme();
  const linkChannel = useAuthenticatedMutation(
    api.functions.scheduling.teams.linkChannel,
  );
  const unlinkChannel = useAuthenticatedMutation(
    api.functions.scheduling.teams.unlinkChannel,
  );
  const [busy, setBusy] = useState(false);

  const performToggle = useCallback(
    async (turningOn: boolean) => {
      setBusy(true);
      try {
        if (turningOn) {
          await linkChannel({ teamId });
        } else {
          await unlinkChannel({ teamId });
        }
        // Convex queries re-fetch reactively — no manual refresh needed.
      } catch (e: any) {
        notify(
          turningOn ? "Couldn't turn on chat" : "Couldn't turn off chat",
          e?.data?.message ?? e?.message ?? "Couldn't update the team's chat channel",
        );
      } finally {
        setBusy(false);
      }
    },
    [linkChannel, unlinkChannel, teamId],
  );

  const handlePress = useCallback(async () => {
    if (busy) return;
    if (hasChannel) {
      const ok = await confirmAsync({
        title: `Turn off chat for ${teamName}?`,
        message: `The team's chat channel will be unlinked. ${channelMemberCount} auto-synced ${
          channelMemberCount === 1 ? "member is" : "members are"
        } removed from it; the channel itself stays in the inbox as a regular custom channel. You can turn chat back on later. This affects every event this team is on.`,
        confirmText: "Turn off",
        destructive: true,
      });
      if (ok) void performToggle(false);
    } else {
      const ok = await confirmAsync({
        title: `Turn on chat for ${teamName}?`,
        message:
          "A new chat channel will be created in the inbox. Membership auto-syncs from the team's event-plan assignments. This affects every event this team is on.",
        confirmText: "Turn on",
      });
      if (ok) void performToggle(true);
    }
  }, [busy, hasChannel, teamName, channelMemberCount, performToggle]);

  const tint = hasChannel ? colors.success : colors.textTertiary;
  const bg = hasChannel ? colors.success + "22" : colors.border;

  return (
    <Pressable
      onPress={handlePress}
      disabled={busy}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={
        hasChannel ? `Turn chat off for ${teamName}` : `Turn chat on for ${teamName}`
      }
    >
      <View style={[styles.pill, { backgroundColor: bg, opacity: busy ? 0.6 : 1 }]}>
        <Ionicons name="chatbubbles" size={12} color={tint} />
        <Text style={[styles.label, { color: tint }]}>Chat</Text>
        <View
          style={[
            styles.stateChip,
            { backgroundColor: hasChannel ? colors.success : colors.textTertiary },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.stateChipText}>{hasChannel ? "on" : "off"}</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
  },
  stateChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    minWidth: 28,
    minHeight: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  stateChipText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
    textTransform: "lowercase",
  },
});
