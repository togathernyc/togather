/**
 * ContributeSplitView — desktop-web two-pane layout for the contributor
 * dashboard (ADR-029 Phase 1.5).
 *
 * Left: the persistent conversation sidebar (the ContributeListScreen —
 * segments, Mine/Everyone toggle, conversation rows). Right: the selected
 * conversation's thread (ContributionDetailScreen), or a "Select a
 * conversation" placeholder.
 *
 * Mirrors the inbox desktop split (app/inbox/_layout.tsx). The URL is the
 * source of truth for the selection: tapping a row `router.replace`s to
 * /(user)/dev/[id] (so refresh, resize, and shared links keep the same
 * conversation), and the [id] route feeds the param back in as `initialId`.
 * Local state is only a fast path so the right pane swaps immediately,
 * before navigation settles. Both /(user)/dev and /(user)/dev/[id] render
 * this on wide web (see those routes). On phones the routes keep today's
 * two-screen flow and this component is never mounted.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import type { Id } from "@services/api/convex";
import { ContributeListScreen } from "./ContributeListScreen";
import { ContributionDetailScreen } from "./ContributionDetailScreen";

export interface ContributeSplitViewProps {
  /** Conversation to preselect (from a /(user)/dev/[id] deep link). */
  initialId?: Id<"devBugs"> | null;
}

export function ContributeSplitView({ initialId }: ContributeSplitViewProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const [selectedId, setSelectedId] = useState<Id<"devBugs"> | null>(
    initialId ?? null,
  );

  // Re-seed from the URL param — the single source of truth — whether it
  // changed via a row tap below, the submit flow replacing to the new
  // conversation, or a remount (refresh / resize across the breakpoint).
  useEffect(() => {
    if (initialId) setSelectedId(initialId);
  }, [initialId]);

  const handleSelect = useCallback(
    (id: Id<"devBugs">) => {
      // Fast path: swap the pane immediately, then sync the URL so the
      // selection survives refresh and resize.
      setSelectedId(id);
      router.replace(`/(user)/dev/${id}`);
    },
    [router],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Sidebar: conversation list; row taps select + update the URL. */}
      <View style={styles.sidebar}>
        <ContributeListScreen
          embedded
          selectedId={selectedId}
          onSelectConversation={handleSelect}
        />
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* Main panel: the selected conversation's thread. Keyed by id so
          per-conversation state (draft, attachments) resets on switch,
          matching what navigation gives the phone flow. */}
      <View style={styles.mainPanel}>
        {selectedId ? (
          <ContributionDetailScreen key={selectedId} id={selectedId} embedded />
        ) : (
          <View
            style={[
              styles.placeholder,
              { backgroundColor: colors.backgroundSecondary },
            ]}
          >
            <Ionicons
              name="chatbubbles-outline"
              size={48}
              color={colors.iconSecondary}
            />
            <Text style={[styles.placeholderText, { color: colors.textTertiary }]}>
              Select a conversation
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: "row",
  },
  sidebar: {
    width: 340,
  },
  divider: {
    width: 1,
  },
  mainPanel: {
    flex: 1,
  },
  placeholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderText: {
    marginTop: 12,
    fontSize: 16,
  },
});
