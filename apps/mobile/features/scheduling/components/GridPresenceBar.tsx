/**
 * GridPresenceBar
 *
 * Lightweight "others viewing this roster right now" affordance for the roster
 * grid (#477). While mounted it heartbeats on an interval and renders the live
 * `listViewers` query as a compact, overlapping stack of avatars; on unmount it
 * calls `leave` to drop out cleanly (the backend's 30s staleness window covers
 * a missed leave). Deliberately subtle so it doesn't clutter the toolbar — it
 * renders nothing when no one else is present.
 *
 * Backend: scheduling.presence.heartbeat / listViewers / leave. `gridKey` is the
 * rostering group's id as a string (the same id the grid screen holds). The
 * auth token is injected by the `useAuthenticated*` hooks.
 */
import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Avatar } from "@components/ui/Avatar";
import { useTheme } from "@hooks/useTheme";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";

/** Heartbeat cadence — well inside the backend's 30s staleness window. */
const HEARTBEAT_MS = 10_000;
/** Max avatars shown before collapsing into a "+N" chip. */
const MAX_AVATARS = 4;
const AV = 24;

type Viewer = {
  userId: Id<"users">;
  name: string;
  avatarUrl?: string | null;
  lastSeenAt: number;
};

export function GridPresenceBar({ groupId }: { groupId: Id<"groups"> }) {
  const { colors } = useTheme();
  const gridKey = groupId as string;

  const heartbeat = useAuthenticatedMutation(
    api.functions.scheduling.presence.heartbeat,
  );
  const leave = useAuthenticatedMutation(
    api.functions.scheduling.presence.leave,
  );

  const viewers = useAuthenticatedQuery(
    api.functions.scheduling.presence.listViewers,
    groupId ? { gridKey } : "skip",
  ) as Viewer[] | undefined;

  // Heartbeat immediately on mount, then on an interval. `leave` on unmount.
  // Keep the latest mutation refs so the effect runs once (stable interval) and
  // doesn't churn when the hook identities change.
  const heartbeatRef = useRef(heartbeat);
  heartbeatRef.current = heartbeat;
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  useEffect(() => {
    if (!groupId) return;
    const beat = () => {
      // Presence is best-effort — a dropped beat self-heals on the next one.
      heartbeatRef.current({ gridKey }).catch(() => {});
    };
    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    return () => {
      clearInterval(id);
      leaveRef.current({ gridKey }).catch(() => {});
    };
  }, [groupId, gridKey]);

  if (!viewers || viewers.length === 0) return null;

  const shown = viewers.slice(0, MAX_AVATARS);
  const overflow = viewers.length - shown.length;

  return (
    <View
      style={styles.wrap}
      accessibilityLabel={`${viewers.length} other${viewers.length === 1 ? "" : "s"} viewing`}
    >
      {shown.map((v, idx) => (
        <View
          key={v.userId}
          style={[
            styles.avatarRing,
            {
              borderColor: colors.surface,
              backgroundColor: colors.surface,
              marginLeft: idx === 0 ? 0 : -8,
              zIndex: shown.length - idx,
            },
          ]}
        >
          <Avatar name={v.name} imageUrl={v.avatarUrl ?? undefined} size={AV} />
        </View>
      ))}
      {overflow > 0 && (
        <View
          style={[
            styles.avatarRing,
            styles.overflow,
            { borderColor: colors.surface, backgroundColor: colors.surfaceSecondary, marginLeft: -8 },
          ]}
        >
          <Text style={[styles.overflowText, { color: colors.textSecondary }]}>
            +{overflow}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatarRing: {
    borderWidth: 1.5,
    borderRadius: 999,
    padding: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  overflow: {
    width: AV + 4,
    height: AV + 4,
  },
  overflowText: {
    fontSize: 11,
    fontWeight: "700",
  },
});
