/**
 * TeamSetupScreen
 *
 * Reached from a channel's "Set up as serving team" affordance. On first
 * setup it marks the channel as a team and offers a starter role set
 * inferred from the channel name — the leader accepts/edits/dismisses each
 * suggestion before it is written. Once roles exist, this is the roles
 * editor for the team.
 *
 * Route: /(user)/leader-tools/[group_id]/scheduling/team/[channel_id]
 * Params: channel_id, plus `channelName` for the header (the channel doc
 * itself is not re-fetched — `suggestStarterRoles` already returns the name).
 *
 * Backend: scheduling.teams.markChannelAsTeam,
 * scheduling.roles.suggestStarterRoles / listRoles / createRole.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { RolesEditor } from "./RolesEditor";
import { ROLE_COLORS } from "../utils/format";

type StarterRole = { name: string; defaultNeeded: number };
type Role = { _id: Id<"teamRoles">; name: string };

export function TeamSetupScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { channel_id, channelName: channelNameParam } = useLocalSearchParams<{
    channel_id: string;
    channelName?: string;
  }>();
  const channelId = channel_id as Id<"chatChannels">;

  const roles = useAuthenticatedQuery(
    api.functions.scheduling.roles.listRoles,
    channelId ? { channelId } : "skip",
  ) as Role[] | undefined;

  const suggestion = useAuthenticatedQuery(
    api.functions.scheduling.roles.suggestStarterRoles,
    channelId ? { channelId } : "skip",
  ) as { channelName: string | null; roles: StarterRole[] } | undefined;

  const markChannelAsTeam = useAuthenticatedMutation(
    api.functions.scheduling.teams.markChannelAsTeam,
  );
  const createRole = useAuthenticatedMutation(
    api.functions.scheduling.roles.createRole,
  );

  const [setupState, setSetupState] = useState<"pending" | "ready" | "error">(
    "pending",
  );
  const [seeding, setSeeding] = useState(false);
  // Starter suggestions the leader has dismissed (by index in the list).
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const channelName = suggestion?.channelName ?? channelNameParam ?? "this team";
  const hasRoles = (roles?.length ?? 0) > 0;

  // Mark the channel as a serving team on first visit. `markChannelAsTeam`
  // is idempotent — re-marking an existing team is a no-op patch.
  useEffect(() => {
    let cancelled = false;
    markChannelAsTeam({ channelId })
      .then(() => {
        if (!cancelled) setSetupState("ready");
      })
      .catch((e: any) => {
        if (!cancelled) {
          setSetupState("error");
          Alert.alert(
            "Couldn't set up team",
            e?.message ?? "Please try again.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const handleAcceptStarters = useCallback(async () => {
    if (!suggestion) return;
    const accepted = suggestion.roles.filter((_, i) => !dismissed.has(i));
    if (accepted.length === 0) return;
    setSeeding(true);
    try {
      for (let i = 0; i < accepted.length; i++) {
        await createRole({
          channelId,
          name: accepted[i].name,
          color: ROLE_COLORS[i % ROLE_COLORS.length],
          defaultNeeded: accepted[i].defaultNeeded,
        });
      }
    } catch (e: any) {
      Alert.alert("Couldn't add roles", e?.message ?? "Please try again.");
    } finally {
      setSeeding(false);
    }
  }, [suggestion, dismissed, createRole, channelId]);

  const showStarters =
    setupState === "ready" &&
    !hasRoles &&
    (suggestion?.roles.length ?? 0) > 0;

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.surface },
      ]}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: colors.surface, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity onPress={handleBack} hitSlop={12} style={styles.back}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Serving team
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {setupState === "pending" ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      ) : setupState === "error" ? (
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            Couldn't set up this serving team.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 32 },
          ]}
        >
          <Text style={[styles.intro, { color: colors.textSecondary }]}>
            {`#${channelName} is set up as a serving team. Define the roles `}
            this team fills — each event can need a different number of each.
          </Text>

          {showStarters && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                SUGGESTED ROLES
              </Text>
              <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>
                Based on the channel name. Tap to remove any you don't need.
              </Text>
              <View
                style={[
                  styles.starterGroup,
                  { backgroundColor: colors.surfaceSecondary },
                ]}
              >
                {suggestion!.roles.map((role, idx) => {
                  const isDismissed = dismissed.has(idx);
                  return (
                    <Pressable
                      key={`${role.name}-${idx}`}
                      onPress={() =>
                        setDismissed((prev) => {
                          const next = new Set(prev);
                          if (next.has(idx)) next.delete(idx);
                          else next.add(idx);
                          return next;
                        })
                      }
                      style={[
                        styles.starterRow,
                        idx > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: colors.border,
                        },
                      ]}
                    >
                      <Ionicons
                        name={isDismissed ? "ellipse-outline" : "checkmark-circle"}
                        size={22}
                        color={isDismissed ? colors.iconSecondary : colors.success}
                      />
                      <Text
                        style={[
                          styles.starterName,
                          {
                            color: isDismissed
                              ? colors.textSecondary
                              : colors.text,
                          },
                          isDismissed && styles.starterNameDismissed,
                        ]}
                      >
                        {role.name}
                      </Text>
                      <Text
                        style={[
                          styles.starterCount,
                          { color: colors.textSecondary },
                        ]}
                      >
                        Need {role.defaultNeeded}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                onPress={handleAcceptStarters}
                disabled={
                  seeding ||
                  dismissed.size === (suggestion?.roles.length ?? 0)
                }
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: colors.buttonPrimary },
                  (seeding ||
                    dismissed.size === (suggestion?.roles.length ?? 0)) && {
                    opacity: 0.6,
                  },
                  pressed && { opacity: 0.8 },
                ]}
              >
                {seeding ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text
                    style={[styles.primaryBtnText, { color: colors.textInverse }]}
                  >
                    Add{" "}
                    {(suggestion?.roles.length ?? 0) - dismissed.size} role
                    {(suggestion?.roles.length ?? 0) - dismissed.size === 1
                      ? ""
                      : "s"}
                  </Text>
                )}
              </Pressable>
              <Text style={[styles.orHint, { color: colors.textSecondary }]}>
                Or build the role list yourself below.
              </Text>
            </View>
          )}

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
              ROLES
            </Text>
            <RolesEditor channelId={channelId} />
          </View>
        </ScrollView>
      )}
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
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  headerSpacer: {
    width: 36,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    fontSize: 14,
  },
  scrollContent: {
    padding: 16,
  },
  intro: {
    fontSize: 14,
    lineHeight: 20,
  },
  section: {
    marginTop: 24,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  sectionHint: {
    fontSize: 13,
    marginBottom: 10,
    lineHeight: 18,
  },
  starterGroup: {
    borderRadius: 12,
    overflow: "hidden",
  },
  starterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  starterName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
  },
  starterNameDismissed: {
    textDecorationLine: "line-through",
  },
  starterCount: {
    fontSize: 13,
  },
  primaryBtn: {
    marginTop: 12,
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "600",
  },
  orHint: {
    fontSize: 13,
    textAlign: "center",
    marginTop: 12,
  },
});
