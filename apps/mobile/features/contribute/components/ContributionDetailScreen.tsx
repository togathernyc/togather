/**
 * ContributionDetailScreen — one contribution as a conversation
 * (ADR-029 Phase 1.5).
 *
 * A chat-style thread with the AI builder: the original report opens the
 * conversation, AI replies and system events stream in below it, and the
 * latest plan (the doc's `spec`) renders once as a card at the bottom of the
 * thread — next to the actions it unlocks. Inline actions (approve the plan,
 * start the build, verify on staging) appear as message-adjacent cards, and
 * a composer lets the contributor keep chatting (replies during review ask
 * the AI to revise the plan). The old step timeline is replaced by the
 * friendly status chip in the header.
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Image,
  Linking,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { Markdown } from "@components/ui/Markdown";
import { formatError } from "@/utils/error-handling";
import type { Id } from "@services/api/convex";
import { useDevAccess } from "../hooks/useDevAccess";
import { useContribution } from "../hooks/useContribution";
import { useThread } from "../hooks/useThread";
import { useImageAttachments } from "../hooks/useImageAttachments";
import {
  useApproveSpec,
  useConfirmStaging,
  usePostMessage,
  useReportStagingIssue,
  useStartBuild,
} from "../hooks/useContributionMutations";
import {
  displayTitle,
  isBuildableScope,
  isFromChat,
  needsSpecApproval,
  needsStagingVerify,
  PALETTE,
} from "../utils/status";
import { AttachmentStrip } from "./AttachmentStrip";
import { FromChatTag, KindPill, RiskBadge, StatusChip } from "./ContributionBadges";
import { SystemCaption, ThreadMessageBubble, UserBubble } from "./ThreadBubbles";
import type { Contribution, SplitSlice } from "../types";

/**
 * The latest AI plan, rendered once at the bottom of the thread. When the AI
 * judged the item too big to build in one go (scope "split"/"design_needed"),
 * it becomes a "Too big for one build" card and approval is off the table.
 */
function SpecCard({ contribution }: { contribution: Contribution }) {
  const { colors } = useTheme();
  const spec = contribution.spec;
  if (!spec) return null;

  if (!isBuildableScope(contribution.scope)) {
    return (
      <View
        style={[
          styles.specCard,
          { backgroundColor: colors.surface, borderColor: PALETTE.aiWorking },
        ]}
      >
        <View style={styles.specHeader}>
          <Ionicons name="git-branch-outline" size={16} color={PALETTE.aiWorking} />
          <Text style={[styles.specHeaderText, { color: PALETTE.aiWorking }]}>
            Too big for one build
          </Text>
        </View>
        <Text style={[styles.specSubtitle, { color: colors.textSecondary }]}>
          {contribution.scope === "design_needed"
            ? "This one needs some design thinking before anything gets built. Here's the AI's take:"
            : "This one covers more than a single build can safely take on. Here's how the AI suggests breaking it up:"}
        </Text>
        <Markdown source={spec} />
      </View>
    );
  }

  return (
    <View style={[styles.specCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.specHeader}>
        <Ionicons name="reader-outline" size={16} color={colors.textSecondary} />
        <Text style={[styles.specHeaderText, { color: colors.textSecondary }]}>
          The plan{contribution.specApprovedAt ? " — approved" : ""}
        </Text>
      </View>
      <Markdown source={spec} />
    </View>
  );
}

/**
 * One proposed slice: its title, the full build prompt (shown so the
 * maintainer can read exactly what they're about to paste into a dev session —
 * it's AI-generated from a contributor's report, so it shouldn't be copied
 * blind), and a button to copy it.
 */
function SliceRow({ slice, index }: { slice: SplitSlice; index: number }) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(slice.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      Alert.alert("Couldn't copy", formatError(error));
    }
  }, [slice.prompt]);

  return (
    <View style={[styles.sliceRow, { borderColor: colors.border }]}>
      <View style={styles.sliceHeader}>
        <Text style={[styles.sliceTitle, { color: colors.text }]}>
          {index + 1}. {slice.title}
        </Text>
        <TouchableOpacity
          style={[styles.copyButton, { borderColor: primaryColor }]}
          onPress={handleCopy}
          activeOpacity={0.7}
          accessibilityLabel={`Copy build prompt for ${slice.title}`}
        >
          <Ionicons
            name={copied ? "checkmark" : "copy-outline"}
            size={15}
            color={primaryColor}
          />
          <Text style={[styles.copyButtonText, { color: primaryColor }]}>
            {copied ? "Copied" : "Copy prompt"}
          </Text>
        </TouchableOpacity>
      </View>
      <Text
        style={[
          styles.slicePrompt,
          { color: colors.textSecondary, backgroundColor: colors.background, borderColor: colors.border },
        ]}
        selectable
      >
        {slice.prompt}
      </Text>
    </View>
  );
}

/**
 * For a "split" item: the buildable slices the AI proposed, each with a
 * copy-the-prompt button so a maintainer can paste it straight into a fresh
 * dev session and build that slice on its own.
 */
function SplitSlicesCard({ contribution }: { contribution: Contribution }) {
  const { colors } = useTheme();
  const slices = contribution.splitSlices;
  if (!slices || slices.length === 0) return null;

  return (
    <View
      style={[
        styles.specCard,
        { backgroundColor: colors.surface, borderColor: PALETTE.aiWorking },
      ]}
    >
      <View style={styles.specHeader}>
        <Ionicons name="albums-outline" size={16} color={PALETTE.aiWorking} />
        <Text style={[styles.specHeaderText, { color: PALETTE.aiWorking }]}>
          Build it in {slices.length} pieces
        </Text>
      </View>
      <Text style={[styles.specSubtitle, { color: colors.textSecondary }]}>
        Copy any piece's prompt and paste it into a new dev session to build
        that piece on its own.
      </Text>
      {slices.map((slice, index) => (
        <SliceRow key={index} slice={slice} index={index} />
      ))}
    </View>
  );
}

export function ContributionDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const id = (params.id || null) as Id<"devBugs"> | null;

  // Access gate: the contribution queries throw for non-contributors (deep
  // link, revoked role), which would crash the render — skip them until the
  // dev-dashboard access check confirms.
  const { hasAccess, isLoading: accessLoading } = useDevAccess();
  const { contribution } = useContribution(hasAccess ? id : null);
  const { messages } = useThread(hasAccess ? id : null);
  const approveSpec = useApproveSpec();
  const startBuild = useStartBuild();
  const postMessage = usePostMessage();
  const confirmStaging = useConfirmStaging();
  const reportStagingIssue = useReportStagingIssue();

  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [issueMode, setIssueMode] = useState(false);
  const [issueNote, setIssueNote] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  const images = useImageAttachments();

  const handleApprove = useCallback(() => {
    if (!id) return;
    Alert.alert(
      "Approve this plan?",
      "You're confirming the plan describes what you meant. Building starts after approval.",
      [
        { text: "Not yet", style: "cancel" },
        {
          text: "Approve",
          onPress: async () => {
            setBusy(true);
            try {
              await approveSpec({ id });
            } catch (error) {
              Alert.alert("Couldn't approve", formatError(error));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [id, approveSpec]);

  const handleStartBuild = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    try {
      await startBuild({ id });
    } catch (error) {
      Alert.alert("Couldn't start the build", formatError(error));
    } finally {
      setBusy(false);
    }
  }, [id, startBuild]);

  const handleConfirmStaging = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    try {
      await confirmStaging({ id });
    } catch (error) {
      Alert.alert("Couldn't confirm", formatError(error));
    } finally {
      setBusy(false);
    }
  }, [id, confirmStaging]);

  const handleReportIssue = useCallback(async () => {
    if (!id) return;
    const note = issueNote.trim();
    if (!note) return;
    setBusy(true);
    try {
      await reportStagingIssue({ id, note });
      setIssueNote("");
      setIssueMode(false);
    } catch (error) {
      Alert.alert("Couldn't send", formatError(error));
    } finally {
      setBusy(false);
    }
  }, [id, issueNote, reportStagingIssue]);

  const handleSend = useCallback(async () => {
    if (!id || sending || images.uploading) return;
    const body = draft.trim();
    const imageUrls = images.storagePaths;
    // A picture-only message is valid; require text otherwise.
    if (!body && imageUrls.length === 0) return;
    // Optimistic clear of the text; keep the attachments until the send
    // succeeds so a failure doesn't silently lose the uploaded pictures.
    setDraft("");
    setSending(true);
    try {
      await postMessage({
        id,
        body,
        ...(imageUrls.length > 0 ? { imageUrls } : {}),
      });
      images.reset();
    } catch (error) {
      setDraft(body);
      Alert.alert("Couldn't send", formatError(error));
    } finally {
      setSending(false);
    }
  }, [id, draft, sending, postMessage, images]);

  /**
   * The original report opens the thread. The backend may also seed it as the
   * first thread message — skip the synthetic bubble when it does.
   */
  const showReportBubble = useMemo(() => {
    if (!contribution) return false;
    const first = messages?.[0];
    return !(first?.authorType === "user" && first.body.trim() === contribution.body.trim());
  }, [contribution, messages]);

  if (accessLoading || (hasAccess && contribution === undefined)) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    );
  }

  if (!hasAccess) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="lock-closed-outline" size={40} color={colors.iconSecondary} />
        <Text style={[styles.lockedText, { color: colors.textSecondary }]}>
          This area is for Togather contributors. Ask the team to invite you if
          you'd like to help build the app.
        </Text>
      </View>
    );
  }

  if (!contribution) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary }}>
          We couldn't find this conversation.
        </Text>
      </View>
    );
  }

  const showApproveSpec = needsSpecApproval(contribution);
  // Non-buildable scopes can't enter the build pipeline (the backend rejects
  // them too) — keep the UI consistent with the "Too big for one build" card.
  const showStartBuild =
    !!contribution.specApprovedAt &&
    contribution.status === "IN_REVIEW" &&
    isBuildableScope(contribution.scope);
  const showStagingCard = needsStagingVerify(contribution);
  const awaitingSpec =
    (contribution.status === "DRAFT" || contribution.status === "IN_REVIEW") &&
    !contribution.spec;
  // The AI only reads replies while drafting/revising the spec
  // (DRAFT/IN_REVIEW) — past that, be honest that messages are notes for
  // the team, not instructions to the builder.
  const aiReadsReplies =
    contribution.status === "DRAFT" || contribution.status === "IN_REVIEW";
  const composerHint = aiReadsReplies
    ? contribution.status === "IN_REVIEW" && contribution.spec
      ? "Replying asks the AI to revise the spec"
      : null
    : "Notes here are saved to the conversation for the team — the AI builder doesn't read them mid-build";

  // Send is enabled with text OR at least one uploaded picture, and never
  // while a picture is still uploading.
  const canSend =
    (draft.trim().length > 0 || images.storagePaths.length > 0) &&
    !sending &&
    !images.uploading;

  const reportBody = contribution.repro
    ? `${contribution.body}\n\nHow to see it: ${contribution.repro}`
    : contribution.body;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
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

      <View style={styles.badgeRow}>
        <KindPill kind={contribution.kind} />
        <StatusChip contribution={contribution} />
        {contribution.riskLevel ? <RiskBadge risk={contribution.riskLevel} /> : null}
        {isFromChat(contribution) ? <FromChatTag /> : null}
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        keyboardShouldPersistTaps="handled"
      >
        {showReportBubble ? (
          <UserBubble body={reportBody} createdAt={contribution.createdAt} />
        ) : null}

        {/* Chat-originated items keep resolved screenshot URLs on the row;
            dashboard items show their pictures inline in the thread bubbles
            (the opening message carries them), so only render this for chat. */}
        {isFromChat(contribution) &&
        contribution.screenshotUrls &&
        contribution.screenshotUrls.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.screenshotRow}
          >
            {contribution.screenshotUrls.map((url) => (
              <Image key={url} source={{ uri: url }} style={styles.screenshot} />
            ))}
          </ScrollView>
        ) : null}

        {messages === undefined ? (
          <ActivityIndicator style={styles.threadSpinner} color={colors.textSecondary} />
        ) : (
          messages.map((message) => (
            <ThreadMessageBubble key={message._id} message={message} />
          ))
        )}

        {awaitingSpec ? (
          <SystemCaption body="The AI is reading your report and drafting a plan — it'll reply here." />
        ) : null}

        {contribution.spec ? <SpecCard contribution={contribution} /> : null}

        <SplitSlicesCard contribution={contribution} />

        {showApproveSpec ? (
          <View style={styles.actionBlock}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              Read the plan and confirm it says what you meant — you're checking
              the idea, not the code. If something's off, just reply below.
            </Text>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: primaryColor }, busy && styles.buttonDisabled]}
              onPress={handleApprove}
              disabled={busy}
              activeOpacity={0.8}
            >
              {busy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color="#ffffff" />
                  <Text style={styles.primaryButtonText}>Approve spec</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        {showStartBuild ? (
          <View style={styles.actionBlock}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              You've approved the plan. Because this change touches more of the
              app, it needs an explicit go-ahead to start building.
            </Text>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: primaryColor }, busy && styles.buttonDisabled]}
              onPress={handleStartBuild}
              disabled={busy}
              activeOpacity={0.8}
            >
              {busy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="rocket-outline" size={20} color="#ffffff" />
                  <Text style={styles.primaryButtonText}>Start build</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        {showStagingCard ? (
          <View
            style={[
              styles.stagingCard,
              { backgroundColor: colors.surface, borderColor: PALETTE.yourTurn },
            ]}
          >
            <View style={styles.specHeader}>
              <Ionicons name="flask-outline" size={16} color={PALETTE.yourTurn} />
              <Text style={[styles.specHeaderText, { color: PALETTE.yourTurn }]}>
                Ready for you to try
              </Text>
            </View>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              Your change is live on the staging app. Open it, try the thing you
              reported, and tell us how it went.
            </Text>
            {issueMode ? (
              <>
                <TextInput
                  style={[
                    styles.issueInput,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={issueNote}
                  onChangeText={setIssueNote}
                  placeholder="What's off? A sentence or two is plenty."
                  placeholderTextColor={colors.textTertiary}
                  multiline
                  textAlignVertical="top"
                />
                <View style={styles.stagingButtonRow}>
                  <TouchableOpacity
                    style={[styles.secondaryButton, { borderColor: colors.border }]}
                    onPress={() => setIssueMode(false)}
                    disabled={busy}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.secondaryButtonText, { color: colors.textSecondary }]}>
                      Cancel
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.primaryButton,
                      styles.stagingButton,
                      { backgroundColor: primaryColor },
                      (busy || !issueNote.trim()) && styles.buttonDisabled,
                    ]}
                    onPress={handleReportIssue}
                    disabled={busy || !issueNote.trim()}
                    activeOpacity={0.8}
                  >
                    {busy ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <Text style={styles.primaryButtonText}>Send</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <View style={styles.stagingButtonRow}>
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    styles.stagingButton,
                    { backgroundColor: PALETTE.shipped },
                    busy && styles.buttonDisabled,
                  ]}
                  onPress={handleConfirmStaging}
                  disabled={busy}
                  activeOpacity={0.8}
                >
                  {busy ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>✓ Works — ship it</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryButton, { borderColor: colors.border }]}
                  onPress={() => setIssueMode(true)}
                  disabled={busy}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
                    ✗ Something's off
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : null}

        {contribution.githubIssueUrl ? (
          <TouchableOpacity
            style={[styles.linkRow, { borderColor: colors.border }]}
            onPress={() => Linking.openURL(contribution.githubIssueUrl as string)}
          >
            <Ionicons name="logo-github" size={18} color={colors.text} />
            <Text style={[styles.linkText, { color: colors.text }]} numberOfLines={1}>
              View the GitHub issue
            </Text>
            <Ionicons name="open-outline" size={16} color={colors.iconSecondary} />
          </TouchableOpacity>
        ) : null}

        {contribution.prUrl ? (
          <TouchableOpacity
            style={[styles.linkRow, { borderColor: colors.border }]}
            onPress={() => Linking.openURL(contribution.prUrl as string)}
          >
            <Ionicons name="git-pull-request-outline" size={18} color={colors.text} />
            <Text style={[styles.linkText, { color: colors.text }]} numberOfLines={1}>
              View the code change on GitHub
            </Text>
            <Ionicons name="open-outline" size={16} color={colors.iconSecondary} />
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      {composerHint ? (
        <Text style={[styles.composerHint, { color: colors.textTertiary }]}>
          {composerHint}
        </Text>
      ) : null}
      {images.attachments.length > 0 ? (
        <View style={styles.composerAttachments}>
          <AttachmentStrip attachments={images.attachments} onRemove={images.remove} />
        </View>
      ) : null}
      <View
        style={[
          styles.composer,
          {
            borderTopColor: colors.border,
            backgroundColor: colors.background,
            paddingBottom: Math.max(insets.bottom, 8),
          },
        ]}
      >
        <TouchableOpacity
          style={styles.attachIcon}
          onPress={images.pick}
          activeOpacity={0.7}
          accessibilityLabel="Attach a picture"
        >
          <Ionicons name="image-outline" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <TextInput
          style={[
            styles.composerInput,
            {
              backgroundColor: colors.surfaceSecondary,
              color: colors.text,
            },
          ]}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message @Togather…"
          placeholderTextColor={colors.textTertiary}
          multiline
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            { backgroundColor: primaryColor },
            !canSend && styles.buttonDisabled,
          ]}
          onPress={handleSend}
          disabled={!canSend}
          activeOpacity={0.8}
          accessibilityLabel="Send message"
        >
          <Ionicons name="arrow-up" size={18} color="#ffffff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 12 },
  lockedText: { fontSize: 15, lineHeight: 22, textAlign: "center" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  backBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 17, fontWeight: "600", flex: 1, textAlign: "center" },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  scroll: { paddingHorizontal: 16, paddingBottom: 24 },
  threadSpinner: { marginTop: 16 },
  screenshotRow: { marginTop: 8, justifyContent: "flex-end", flexGrow: 1 },
  screenshot: {
    width: 120,
    height: 210,
    borderRadius: 10,
    marginLeft: 8,
    backgroundColor: "#00000010",
  },
  specCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 14,
    gap: 8,
  },
  specHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  specHeaderText: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  specSubtitle: { fontSize: 13, lineHeight: 19 },
  sliceRow: {
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    marginTop: 2,
  },
  sliceHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sliceTitle: { flex: 1, fontSize: 14, fontWeight: "600" },
  slicePrompt: {
    fontSize: 12,
    lineHeight: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 10,
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 9,
    paddingVertical: 7,
    paddingHorizontal: 11,
  },
  copyButtonText: { fontSize: 13, fontWeight: "600" },
  hint: { fontSize: 13, lineHeight: 19 },
  actionBlock: { marginTop: 14, gap: 10 },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  secondaryButtonText: { fontSize: 15, fontWeight: "600" },
  stagingCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 14,
    gap: 10,
  },
  stagingButtonRow: { flexDirection: "row", gap: 8 },
  stagingButton: { flex: 1 },
  issueInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    minHeight: 70,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
  },
  linkText: { fontSize: 14, flex: 1 },
  composerHint: {
    fontSize: 11,
    textAlign: "center",
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  composerAttachments: { paddingHorizontal: 12 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  attachIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 1,
  },
  composerInput: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 9,
    fontSize: 15,
    maxHeight: 110,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 1,
  },
});
