/**
 * PlanView — the AI plan (the doc's `spec`) on its own surface.
 *
 * Plans are long, so they no longer render inline in the conversation (that
 * buried the thread under walls of text). Instead the thread shows a compact
 * "The plan" card and the full plan opens here:
 *
 *  - PlanScreen: the phone route (/dev/plan/[id]) — full-screen with a back
 *    button.
 *  - PlanPanel: the desktop-web presentation — a right-side panel beside the
 *    conversation (ContributionDetailScreen toggles it).
 *  - PlanContent: the shared body (approval state, scope explanation, and the
 *    markdown itself).
 */
import React from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { Markdown } from "@components/ui/Markdown";
import { ImageViewerManager } from "@/providers/ImageViewerProvider";
import type { Id } from "@services/api/convex";
import { useDevAccess } from "../hooks/useDevAccess";
import { useContribution } from "../hooks/useContribution";
import { LOOKS_LIKE_CONVEX_ID } from "../utils/devRoute";
import { displayTitle, isBuildableScope, PALETTE } from "../utils/status";
import type { Contribution } from "../types";

/** The plan body: approval/scope context + the spec markdown. */
export function PlanContent({ contribution }: { contribution: Contribution }) {
  const { colors } = useTheme();
  if (!contribution.spec) {
    return (
      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
        No plan yet — the AI is still drafting it.
      </Text>
    );
  }

  return (
    <View style={styles.content}>
      {contribution.specApprovedAt ? (
        <View style={styles.stateRow}>
          <Ionicons name="checkmark-circle" size={15} color={PALETTE.shipped} />
          <Text style={[styles.stateText, { color: PALETTE.shipped }]}>
            Approved plan
          </Text>
        </View>
      ) : (
        <View style={styles.stateRow}>
          <Ionicons name="reader-outline" size={15} color={colors.textSecondary} />
          <Text style={[styles.stateText, { color: colors.textSecondary }]}>
            Not approved yet
          </Text>
        </View>
      )}
      {!isBuildableScope(contribution.scope) ? (
        <Text style={[styles.scopeNote, { color: colors.textSecondary }]}>
          {contribution.scope === "design_needed"
            ? "This one needs some design thinking before anything gets built. Here's the AI's take:"
            : "This one covers more than a single build can safely take on. Here's how the AI suggests breaking it up:"}
        </Text>
      ) : null}
      <PlanPreviewImages urls={contribution.screenshotUrls} />
      <Markdown source={contribution.spec} />
    </View>
  );
}

/**
 * The AI routine renders a before/after mock image for each plan and stores its
 * URL(s) on the item. Show them as a labelled, tappable "Preview" block so the
 * plan reads visually, not as text alone. Tapping opens the full-screen viewer,
 * matching the screenshot row on ContributionDetailScreen.
 */
function PlanPreviewImages({ urls }: { urls?: string[] }) {
  const { colors } = useTheme();
  if (!urls || urls.length === 0) return null;
  return (
    <View style={styles.previewBlock}>
      <Text style={[styles.previewCaption, { color: colors.textSecondary }]}>
        Preview — before / after
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.previewRow}
      >
        {urls.map((url, index) => (
          <TouchableOpacity
            key={url}
            onPress={() => ImageViewerManager.show(urls, index)}
            activeOpacity={0.85}
            accessibilityRole="imagebutton"
            accessibilityLabel="Plan preview — tap to view full screen"
          >
            <Image source={{ uri: url }} style={styles.previewImage} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * Desktop-web right panel: rendered by ContributionDetailScreen beside the
 * conversation when the plan is open. Memoized — the parent re-renders on
 * every composer keystroke, and reconciling a long markdown tree per
 * keystroke would jank typing.
 */
export const PlanPanel = React.memo(function PlanPanel({
  contribution,
  onClose,
}: {
  contribution: Contribution;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: colors.background, borderLeftColor: colors.border },
      ]}
    >
      <View style={[styles.panelHeader, { borderBottomColor: colors.border }]}>
        <Text style={[styles.panelTitle, { color: colors.text }]} numberOfLines={1}>
          The plan
        </Text>
        <TouchableOpacity
          onPress={onClose}
          style={styles.closeBtn}
          accessibilityLabel="Close the plan"
        >
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.panelScroll}>
        <PlanContent contribution={contribution} />
      </ScrollView>
    </View>
  );
});

/** Phone route: /dev/plan/[id] — the plan as its own full screen. */
export function PlanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const rawId = (params.id || null) as Id<"devBugs"> | null;
  const id = rawId && LOOKS_LIKE_CONVEX_ID.test(rawId) ? rawId : null;

  const { hasAccess, isLoading: accessLoading } = useDevAccess();
  const { contribution } = useContribution(hasAccess ? id : null);

  if (accessLoading || (hasAccess && id && contribution === undefined)) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    );
  }

  if (!hasAccess || !contribution) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary }}>
          We couldn't find this plan.
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          {displayTitle(contribution)}
        </Text>
        <View style={styles.backBtn} />
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.screenScroll,
          { paddingBottom: Math.max(insets.bottom, 24) },
        ]}
      >
        <PlanContent contribution={contribution} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  backBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 17, fontWeight: "600", flex: 1, textAlign: "center" },
  screenScroll: { paddingHorizontal: 16 },
  content: { gap: 8 },
  stateRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  stateText: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  scopeNote: { fontSize: 13, lineHeight: 19 },
  previewBlock: { gap: 6 },
  previewCaption: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  previewRow: { gap: 8, paddingVertical: 2 },
  previewImage: {
    width: 160,
    height: 280,
    borderRadius: 10,
    backgroundColor: "#00000010",
  },
  emptyText: { fontSize: 14, padding: 16, textAlign: "center" },
  panel: {
    width: 400,
    borderLeftWidth: 1,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  panelTitle: { fontSize: 16, fontWeight: "600" },
  closeBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  panelScroll: { padding: 16, paddingBottom: 32 },
});
