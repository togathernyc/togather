/**
 * FeatureFlagsContent
 *
 * Superuser-only screen for flipping the APP-WIDE feature flags stored
 * in the Convex `featureFlags` table. One row per flag, each with:
 *   - the flag key + optional description
 *   - a Switch that calls `setFeatureFlag` on change
 *   - the last-updated timestamp
 *
 * Flags are global, not community-scoped — community primary admins
 * cannot see or flip them. The route is gated on `user.is_superuser ||
 * user.is_staff`; non-superusers see a permission-denied state.
 *
 * Flags are created lazily — the first call to `setFeatureFlag(key, ...)`
 * inserts the row. To show a flag here before it's been flipped for the
 * first time, the `KNOWN_FLAGS` table below seeds the list with metadata
 * so superusers can see what flags exist even when they're still
 * default-off.
 */
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { useQuery, useMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

/**
 * Source-of-truth catalog of flags that exist in the codebase. Prevents the
 * admin screen from showing a blank "no flags yet" state until someone flips
 * something — and gives non-engineering admins a description of what each
 * flag controls.
 */
const KNOWN_FLAGS: Array<{ key: string; description: string }> = [
  {
    key: "direct-messages",
    description:
      "1:1 direct messages and ad-hoc group chats. Enables the compose button on the inbox, the start-chat picker, and the request-flow inbox.",
  },
];

type FlagRow = {
  _id: Id<"featureFlags">;
  key: string;
  enabled: boolean;
  description: string | null;
  updatedAt: number;
  updatedById: Id<"users"> | null;
};

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function FeatureFlagsContent() {
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();

  const isSuperuser = user?.is_superuser === true || user?.is_staff === true;

  const flags = useQuery(
    api.functions.admin.featureFlags.listFeatureFlags,
    token && isSuperuser ? { token } : "skip",
  ) as FlagRow[] | undefined;

  const setFlag = useMutation(api.functions.admin.featureFlags.setFeatureFlag);

  const [pendingKey, setPendingKey] = useState<string | null>(null);

  // Merge backend rows with the KNOWN_FLAGS catalog so superusers see flags
  // that haven't been flipped yet.
  const merged = useMemo(() => {
    const byKey = new Map<string, FlagRow & { isSeed: boolean }>();
    for (const known of KNOWN_FLAGS) {
      byKey.set(known.key, {
        _id: undefined as unknown as Id<"featureFlags">,
        key: known.key,
        enabled: false,
        description: known.description,
        updatedAt: 0,
        updatedById: null,
        isSeed: true,
      });
    }
    if (flags) {
      for (const f of flags) {
        const known = KNOWN_FLAGS.find((k) => k.key === f.key);
        byKey.set(f.key, {
          ...f,
          description: f.description ?? known?.description ?? null,
          isSeed: false,
        });
      }
    }
    return Array.from(byKey.values()).sort((a, b) =>
      a.key.localeCompare(b.key),
    );
  }, [flags]);

  const onToggle = async (row: (typeof merged)[number], next: boolean) => {
    if (!token || !isSuperuser || pendingKey) return;
    setPendingKey(row.key);
    try {
      await setFlag({
        token,
        key: row.key,
        enabled: next,
        ...(row.description ? { description: row.description } : {}),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to update flag";
      Alert.alert("Couldn't update flag", message);
    } finally {
      setPendingKey(null);
    }
  };

  if (!isSuperuser) {
    return (
      <View
        style={[
          styles.container,
          styles.centered,
          { backgroundColor: colors.surface },
        ]}
      >
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          Feature flags are managed by Togather staff. You don't have access.
        </Text>
      </View>
    );
  }

  if (flags === undefined) {
    return (
      <View
        style={[
          styles.container,
          styles.centered,
          { backgroundColor: colors.surface },
        ]}
      >
        <ActivityIndicator size="small" color={primaryColor} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.surface }]}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + 24 },
      ]}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={() => {}} tintColor={primaryColor} />
      }
    >
      <Text style={[styles.intro, { color: colors.textSecondary }]}>
        App-wide feature flags. Changes take effect immediately for every
        user across every community.
      </Text>
      {merged.map((row) => (
        <View
          key={row.key}
          style={[styles.row, { borderColor: colors.border }]}
        >
          <View style={styles.rowMain}>
            <Text style={[styles.key, { color: colors.text }]}>{row.key}</Text>
            {row.description ? (
              <Text
                style={[styles.description, { color: colors.textSecondary }]}
              >
                {row.description}
              </Text>
            ) : null}
            <Text
              style={[styles.updatedAt, { color: colors.textSecondary }]}
            >
              {row.isSeed
                ? "Never flipped"
                : `Updated ${formatRelative(row.updatedAt)}`}
            </Text>
          </View>
          <View style={styles.rowAction}>
            {pendingKey === row.key ? (
              <ActivityIndicator size="small" color={primaryColor} />
            ) : (
              <Switch
                value={row.enabled}
                onValueChange={(next) => onToggle(row, next)}
                trackColor={{ false: colors.border, true: primaryColor }}
                disabled={pendingKey !== null}
              />
            )}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  empty: {
    fontSize: 15,
    textAlign: "center",
  },
  intro: {
    fontSize: 14,
    marginBottom: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
  },
  rowAction: {
    width: 56,
    alignItems: "flex-end",
  },
  key: {
    fontSize: 16,
    fontWeight: "600",
  },
  description: {
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  updatedAt: {
    fontSize: 11,
    marginTop: 6,
  },
});
