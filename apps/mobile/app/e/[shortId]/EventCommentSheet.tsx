/**
 * EventCommentSheet
 *
 * Bottom-sheet composer for posting a comment on an event page.
 *
 * Follows the modal + overlay pattern used in EventBlastSheet. The sheet
 * surface is fixed to the bottom of the screen with rounded top corners and a
 * visual drag handle (drag-to-dismiss gesture is out of scope for v1).
 *
 * Embeds the shared `MessageInput` so @mentions, attachments, and link
 * previews work out of the box. We wire `externalSendMessage` to wrap the
 * internal send hook and auto-close the sheet after a successful send — this
 * matches the Partiful-style "write, send, dismiss" flow and avoids leaving
 * the sheet floating over the newly posted comment.
 */

import React, { useCallback } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { MessageInput } from "@/features/chat/components/MessageInput";
import { useSendMessage } from "@/features/chat/hooks/useConvexSendMessage";

interface EventCommentSheetProps {
  visible: boolean;
  onClose: () => void;
  channelId: Id<"chatChannels"> | null;
}

export function EventCommentSheet({
  visible,
  onClose,
  channelId,
}: EventCommentSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // Drive sending through the standard hook so optimistic updates, offline
  // queueing, and attachment handling all behave exactly like a regular chat
  // send. We then wrap `sendMessage` to close the sheet on success.
  const { sendMessage, isSending } = useSendMessage(channelId);

  const handleExternalSend = useCallback(
    async (content: string, options?: any) => {
      await sendMessage(content, options);
      // Only closes on resolve; if sendMessage throws, the sheet stays open so
      // MessageInput can surface the error and let the user retry.
      onClose();
    },
    [sendMessage, onClose],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.flex}>
        {/**
         * Overlay is a sibling of the sheet (not a parent). On RN Web, wrapping
         * the TextInput inside a Pressable with `stopPropagation` intercepts
         * click events before they reach the input, so the composer won't
         * accept focus. Keeping them as siblings means clicks on the sheet
         * never touch the overlay Pressable.
         */}
        <Pressable
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: colors.overlay },
          ]}
          onPress={onClose}
        />
        <KeyboardAvoidingView
          style={styles.sheetContainer}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          pointerEvents="box-none"
        >
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.surface,
                paddingBottom: Math.max(insets.bottom, 12),
              },
            ]}
          >
            <View style={styles.handleContainer}>
              <View
                style={[styles.handle, { backgroundColor: colors.border }]}
              />
            </View>

            <View style={styles.inputWrapper}>
              <MessageInput
                channelId={channelId}
                externalSendMessage={handleExternalSend}
                externalIsSending={isSending}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export default EventCommentSheet;

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  // Sheet container pins the actual sheet to the bottom of the screen without
  // wrapping the overlay as a parent — avoids the RN Web click-interception
  // issue documented above.
  sheetContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "90%",
  },
  handleContainer: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  inputWrapper: {
    paddingTop: 4,
  },
});
