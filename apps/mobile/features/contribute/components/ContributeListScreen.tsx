/**
 * ContributeListScreen — conversations with the AI builder (ADR-029 Phase 1.5).
 *
 * The contributor's inbox: every report/idea is a conversation. Segments
 * split them by whose turn it is ("Your turn" = the contributor must act),
 * and maintainers can flip between their own conversations and everyone's.
 * Access is gated on the dev-assistant maintainer check (useDevAccess).
 */
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { SegmentedTabs } from "@components/ui/SegmentedTabs";
import { useDevAccess } from "../hooks/useDevAccess";
import { useAllContributions, useMyContributions } from "../hooks/useMyContributions";
import { GithubCreditRow } from "./GithubCreditRow";
import {
  conversationDotColor,
  displayTitle,
  isArchived,
  isInProgress,
  isYourTurn,
} from "../utils/status";
import type { Id } from "@services/api/convex";
import type { ContributionListItem } from "../types";

type Segment = "yourTurn" | "inProgress" | "done" | "archived";
type Owner = "mine" | "everyone";

const SEGMENT_OPTIONS: { key: Segment; label: string }[] = [
  { key: "yourTurn", label: "Your turn" },
  { key: "inProgress", label: "In progress" },
  { key: "done", label: "Done" },
  { key: "archived", label: "Archived" },
];

const OWNER_OPTIONS: { key: Owner; label: string }[] = [
  { key: "mine", label: "Mine" },
  { key: "everyone", label: "Everyone" },
];

const EMPTY_COPY: Record<Segment, { title: string; text: string }> = {
  yourTurn: {
    title: "Nothing needs you right now",
    text: "When the AI drafts a plan for your review or a change is ready to try out, it shows up here.",
  },
  inProgress: {
    title: "Nothing being built right now",
    text: "Fire something off — a bug or an idea — and once it's approved you'll watch it move through here as the AI builds, reviews, and ships it.",
  },
  done: {
    title: "Nothing wrapped up yet",
    text: "Once a conversation is finished — shipped into the app, or set aside — it lands here.",
  },
  archived: {
    title: "Nothing archived",
    text: "Conversations set aside — abandoned, or not doable — land here. You can restore any of them.",
  },
};

/** One-line preview of the latest thread message (or the original report). */
function snippetFor(item: ContributionListItem): string {
  if (item.lastMessageBody) {
    return item.lastMessageAuthorType === "assistant"
      ? `@Togather: ${item.lastMessageBody}`
      : item.lastMessageBody;
  }
  return item.body;
}

function ConversationRow({
  item,
  onPress,
  selected = false,
}: {
  item: ContributionListItem;
  onPress: () => void;
  selected?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[
        styles.row,
        { borderBottomColor: colors.borderLight },
        selected && [styles.rowSelected, { backgroundColor: colors.surfaceSecondary }],
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.dot, { backgroundColor: conversationDotColor(item) }]} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
            {displayTitle(item)}
          </Text>
          <Text style={[styles.rowTime, { color: colors.textTertiary }]}>
            {formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true })}
          </Text>
        </View>
        <Text style={[styles.rowSnippet, { color: colors.textSecondary }]} numberOfLines={1}>
          {snippetFor(item)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export interface ContributeListScreenProps {
  /**
   * Desktop-web split view (ContributeSplitView): row taps call this with the
   * conversation id instead of navigating to /(user)/dev/[id].
   */
  onSelectConversation?: (id: Id<"devBugs">) => void;
  /** Highlight this conversation's row as the active one (split view). */
  selectedId?: Id<"devBugs"> | null;
  /**
   * True when rendered as the split view's sidebar: hides the header back
   * button (the list is the persistent left pane; there's nothing to pop).
   */
  embedded?: boolean;
}

export function ContributeListScreen({
  onSelectConversation,
  selectedId,
  embedded = false,
}: ContributeListScreenProps = {}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const { access, hasAccess, isLoading: accessLoading } = useDevAccess();

  const [segment, setSegment] = useState<Segment>("yourTurn");
  const [owner, setOwner] = useState<Owner>("mine");

  // listAll is a maintainer view — only offer (and query) it for maintainers.
  const canSeeEveryone = access?.isMaintainer === true;
  const showEveryone = canSeeEveryone && owner === "everyone";

  // Only query once access is confirmed — the queries throw for
  // non-contributors, which would crash the render instead of showing the
  // lock UI below.
  const mine = useMyContributions(hasAccess);
  const everyone = useAllContributions(showEveryone);
  const { contributions, isLoading } = showEveryone ? everyone : mine;

  const visible = useMemo(() => {
    const items = contributions ?? [];
    const filtered = items.filter((item) => {
      // Archived items live only in their own tab, out of the active ones.
      if (segment === "archived") return isArchived(item);
      if (isArchived(item)) return false;
      if (segment === "yourTurn") return isYourTurn(item);
      // "Done" = terminal conversations, shipped or set aside.
      if (segment === "done")
        return item.status === "MERGED" || item.status === "REJECTED";
      // "In progress" = fired off and actively being built/reviewed.
      return isInProgress(item);
    });
    return [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [contributions, segment]);

  const renderBody = () => {
    if (accessLoading || (hasAccess && isLoading)) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.text} />
        </View>
      );
    }

    if (!hasAccess) {
      return (
        <View style={styles.centered}>
          <Ionicons name="lock-closed-outline" size={40} color={colors.iconSecondary} />
          <Text style={[styles.lockedText, { color: colors.textSecondary }]}>
            This area is for Togather contributors. Ask the team to invite you if
            you'd like to help build the app.
          </Text>
        </View>
      );
    }

    const empty = EMPTY_COPY[segment];

    return (
      <>
        <View style={styles.controls}>
          <SegmentedTabs<Segment>
            options={SEGMENT_OPTIONS}
            value={segment}
            onChange={setSegment}
            accessibilityLabel="Filter conversations"
          />
          {canSeeEveryone ? (
            <SegmentedTabs<Owner>
              options={OWNER_OPTIONS}
              value={owner}
              onChange={setOwner}
              accessibilityLabel="Whose conversations to show"
            />
          ) : null}
        </View>
        <FlatList
          data={visible}
          keyExtractor={(item) => item._id}
          renderItem={({ item }) => (
            <ConversationRow
              item={item}
              selected={item._id === selectedId}
              onPress={() =>
                onSelectConversation
                  ? onSelectConversation(item._id)
                  : router.push(`/(user)/dev/${item._id}`)
              }
            />
          )}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <TouchableOpacity
              style={[styles.newButton, { backgroundColor: primaryColor }]}
              onPress={() => router.push("/(user)/dev/submit")}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={20} color="#ffffff" />
              <Text style={styles.newButtonText}>New conversation</Text>
            </TouchableOpacity>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="sparkles-outline" size={40} color={colors.iconSecondary} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>{empty.title}</Text>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {empty.text}
              </Text>
            </View>
          }
        />
        <GithubCreditRow />
      </>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.headerRow}>
        {embedded ? (
          <View style={styles.backBtn} />
        ) : (
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </TouchableOpacity>
        )}
        <Text style={[styles.headerTitle, { color: colors.text }]}>Contribute</Text>
        <View style={styles.backBtn} />
      </View>
      {renderBody()}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  backBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    gap: 12,
  },
  lockedText: { fontSize: 15, lineHeight: 22, textAlign: "center" },
  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48 },
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 8,
  },
  newButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Active-row highlight for the desktop split view. The negative margin
  // bleeds the background into the list's horizontal padding without moving
  // the row content, so highlighted and plain rows stay pixel-aligned.
  rowSelected: {
    borderRadius: 10,
    paddingHorizontal: 10,
    marginHorizontal: -10,
  },
  dot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  rowBody: { flex: 1, gap: 3 },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  rowTitle: { fontSize: 15, fontWeight: "600", flex: 1 },
  rowTime: { fontSize: 12 },
  rowSnippet: { fontSize: 13, lineHeight: 18 },
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 16,
    gap: 8,
  },
  emptyTitle: { fontSize: 17, fontWeight: "600", marginTop: 8 },
  emptyText: { fontSize: 14, lineHeight: 21, textAlign: "center" },
});
