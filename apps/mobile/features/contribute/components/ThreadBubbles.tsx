/**
 * Chat bubbles for the contribution conversation thread (ADR-029 Phase 1.5).
 *
 * Follows the chat feature's bubble conventions (features/chat MessageItem):
 * the contributor's messages are right-aligned in the "own" bubble color with
 * a squared-off bottom corner; the AI's replies are left-aligned, labelled
 * "@Togather", and rendered as markdown; system events are small centered
 * captions like chat's SystemMessage. Data comes from getThread, not the
 * chat plumbing.
 */
import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { format } from "date-fns";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { Markdown } from "@components/ui/Markdown";
import { PALETTE } from "../utils/status";
import type { ThreadMessage } from "../types";

function bubbleTime(createdAt: number): string {
  return format(new Date(createdAt), "MMM d, h:mm a");
}

/** Attached pictures on a contributor message, stacked above the text. */
function BubbleImages({ imageUrls }: { imageUrls: string[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.imageStack}>
      {imageUrls.map((uri) => (
        <Image
          key={uri}
          source={{ uri }}
          style={[styles.bubbleImage, { backgroundColor: colors.surfaceSecondary }]}
          resizeMode="contain"
          accessibilityLabel="Attached screenshot"
        />
      ))}
    </View>
  );
}

/** The contributor's own message — right-aligned, chat "own" bubble color. */
export function UserBubble({
  body,
  createdAt,
  imageUrls,
}: {
  body: string;
  createdAt?: number;
  imageUrls?: string[];
}) {
  const { colors } = useTheme();
  const hasImages = !!imageUrls && imageUrls.length > 0;
  return (
    <View style={styles.userRow}>
      <View style={[styles.bubble, styles.userBubble, { backgroundColor: colors.chatBubbleOwn }]}>
        {hasImages ? <BubbleImages imageUrls={imageUrls} /> : null}
        {body ? (
          <Text style={[styles.bodyText, { color: colors.chatBubbleOwnText }]}>{body}</Text>
        ) : null}
        {createdAt ? (
          <Text style={[styles.timeText, { color: colors.textSecondary }]}>
            {bubbleTime(createdAt)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** An AI reply — left-aligned, labelled "@Togather", markdown body. */
export function AssistantBubble({ body, createdAt }: { body: string; createdAt?: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.assistantRow}>
      <View style={styles.assistantLabelRow}>
        <View style={[styles.assistantAvatar, { backgroundColor: `${PALETTE.yourTurn}20` }]}>
          <Ionicons name="sparkles" size={12} color={PALETTE.yourTurn} />
        </View>
        <Text style={[styles.assistantLabel, { color: PALETTE.yourTurn }]}>@Togather</Text>
      </View>
      <View
        style={[
          styles.bubble,
          styles.assistantBubble,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Markdown source={body} />
        {createdAt ? (
          <Text style={[styles.timeText, { color: colors.textTertiary }]}>
            {bubbleTime(createdAt)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** A system event ("Build started", "Merged — live on staging") — small centered caption. */
export function SystemCaption({ body, createdAt }: { body: string; createdAt?: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.systemRow}>
      <Text style={[styles.systemText, { color: colors.textTertiary }]}>{body}</Text>
      {createdAt ? (
        <Text style={[styles.systemTime, { color: colors.textTertiary }]}>
          {bubbleTime(createdAt)}
        </Text>
      ) : null}
    </View>
  );
}

/** Renders one thread message with the right bubble for its author. */
export function ThreadMessageBubble({ message }: { message: ThreadMessage }) {
  switch (message.authorType) {
    case "user":
      return (
        <UserBubble
          body={message.body}
          createdAt={message.createdAt}
          imageUrls={message.imageUrls}
        />
      );
    case "assistant":
      return <AssistantBubble body={message.body} createdAt={message.createdAt} />;
    case "system":
    default:
      return <SystemCaption body={message.body} createdAt={message.createdAt} />;
  }
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: "85%",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bodyText: { fontSize: 15, lineHeight: 21 },
  imageStack: { gap: 6, marginBottom: 6 },
  bubbleImage: { width: 220, height: 260, borderRadius: 10 },
  timeText: { fontSize: 10, marginTop: 4, alignSelf: "flex-end" },
  userRow: { alignItems: "flex-end", marginTop: 10 },
  userBubble: { borderBottomRightRadius: 3 },
  assistantRow: { alignItems: "flex-start", marginTop: 12 },
  assistantLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 3,
    marginLeft: 2,
  },
  assistantAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  assistantLabel: { fontSize: 11, fontWeight: "700" },
  assistantBubble: { borderBottomLeftRadius: 3, borderWidth: 1 },
  systemRow: { alignItems: "center", marginVertical: 10, paddingHorizontal: 16 },
  systemText: { fontSize: 13, fontWeight: "500", textAlign: "center" },
  systemTime: { fontSize: 10, marginTop: 3 },
});
