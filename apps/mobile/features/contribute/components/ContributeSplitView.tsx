/**
 * ContributeSplitView — desktop-web two-pane layout for the contributor
 * dashboard (ADR-029 Phase 1.5).
 *
 * Left: the persistent conversation sidebar (the ContributeListScreen —
 * segments, Mine/Everyone toggle, conversation rows). Right: the selected
 * conversation's thread (ContributionDetailScreen), or a "Select a
 * conversation" placeholder.
 *
 * Mirrors the inbox desktop split (app/inbox/_layout.tsx) but keeps selection
 * as LOCAL state: tapping a row highlights it and swaps the right pane
 * without navigating, so the sidebar never unmounts. Both /(user)/dev
 * and /(user)/dev/[id] render this on wide web (see those routes);
 * [id] seeds `initialId` so deep links open with that conversation showing.
 * On phones the routes keep today's two-screen flow and this component is
 * never mounted.
 */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
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
  const { colors } = useTheme();
  const [selectedId, setSelectedId] = useState<Id<"devBugs"> | null>(
    initialId ?? null,
  );

  // Re-seed when the route param changes without a remount — e.g. the submit
  // flow replaces to /(user)/dev/[newId] after creating a conversation.
  useEffect(() => {
    if (initialId) setSelectedId(initialId);
  }, [initialId]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Sidebar: conversation list; row taps update local selection. */}
      <View style={styles.sidebar}>
        <ContributeListScreen
          selectedId={selectedId}
          onSelectConversation={setSelectedId}
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
