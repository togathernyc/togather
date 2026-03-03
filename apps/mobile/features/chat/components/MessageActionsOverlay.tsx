/**
 * iMessage-Style Message Actions Overlay
 *
 * Shows a focused view of the selected message with:
 * - Blurred background
 * - Message bubble centered in view
 * - Reactions bar above the message
 * - Actions menu below the message
 */
import React, { useEffect, useRef, useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Animated,
  Dimensions,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// Reaction types
const REACTIONS = [
  { type: "like", emoji: "👍" },
  { type: "love", emoji: "❤️" },
  { type: "haha", emoji: "😂" },
  { type: "wow", emoji: "😮" },
  { type: "sad", emoji: "😢" },
  { type: "pray", emoji: "🙏" },
];

// Action configuration
type ActionConfig = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  destructive?: boolean;
};

// Primary actions shown directly in the overlay
const PRIMARY_ACTIONS: ActionConfig[] = [
  { id: "reply", label: "Reply", icon: "arrow-undo-outline" },
  { id: "copy", label: "Copy Message", icon: "copy-outline" },
  {
    id: "delete",
    label: "Delete Message",
    icon: "trash-outline",
    color: "#e74c3c",
    destructive: true,
  },
  { id: "more", label: "More", icon: "ellipsis-horizontal" },
];

// Secondary actions shown after tapping "More"
const MORE_ACTIONS: ActionConfig[] = [
  { id: "flag", label: "Report Message", icon: "flag-outline", color: "#ff9500" },
  { id: "block", label: "Block User", icon: "ban-outline", color: "#e74c3c", destructive: true },
];

export type MessageActionHandlers = {
  toggleReaction?: (reactionType: string) => Promise<void>;
  copyMessage?: () => void;
  deleteMessage?: () => void;
  quotedReply?: () => void;
  flagMessage?: () => Promise<void>;
  blockUser?: () => Promise<void>;
};

// Message data needed for rendering the bubble
export interface OverlayMessageData {
  _id: string;
  content: string;
  senderName?: string;
  senderProfilePhoto?: string;
  attachments?: Array<{
    type: string;
    url: string;
  }>;
}

type MessageActionsOverlayProps = {
  visible: boolean;
  message: OverlayMessageData | null;
  actionHandlers: MessageActionHandlers | null;
  onClose: () => void;
  isOwnMessage?: boolean;
  isUserLeader?: boolean;
  /** Hide the reply action (useful in thread context where nested replies aren't allowed) */
  hideReplyAction?: boolean;
};

// Chat bubble colors (matching MessageItem)
const IMESSAGE_BLUE = '#e0efff';
const IMESSAGE_GRAY = '#E5E5EA';

export function MessageActionsOverlay({
  visible,
  message,
  actionHandlers,
  onClose,
  isOwnMessage = false,
  isUserLeader = false,
  hideReplyAction = false,
}: MessageActionsOverlayProps) {
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const [showMoreActions, setShowMoreActions] = useState(false);

  // Filter primary actions based on message ownership, leader status, and context
  const availablePrimaryActions = useMemo(() => {
    return PRIMARY_ACTIONS.filter((action) => {
      if (action.id === "reply") return !hideReplyAction;
      if (action.id === "delete") return isOwnMessage || isUserLeader;
      if (action.id === "more") return !isOwnMessage;
      return true;
    });
  }, [isOwnMessage, isUserLeader, hideReplyAction]);

  const availableMoreActions = MORE_ACTIONS;

  // Animate in when visible changes
  useEffect(() => {
    if (visible) {
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.9);
      setShowMoreActions(false);

      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 100,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, fadeAnim, scaleAnim]);

  // Animate out and close
  const handleClose = useCallback(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.9,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setShowMoreActions(false);
      onClose();
    });
  }, [fadeAnim, scaleAnim, onClose]);

  // Handle reaction tap
  const handleReactionTap = useCallback(
    async (emoji: string) => {
      if (actionHandlers?.toggleReaction) {
        await actionHandlers.toggleReaction(emoji);
      }
      handleClose();
    },
    [actionHandlers, handleClose]
  );

  // Handle action tap
  const handleActionTap = useCallback(
    async (actionId: string) => {
      if (actionId === "more") {
        setShowMoreActions(true);
        return;
      }

      switch (actionId) {
        case "reply":
          actionHandlers?.quotedReply?.();
          break;
        case "copy":
          actionHandlers?.copyMessage?.();
          break;
        case "delete":
          actionHandlers?.deleteMessage?.();
          break;
        case "flag":
          await actionHandlers?.flagMessage?.();
          break;
        case "block":
          await actionHandlers?.blockUser?.();
          break;
      }
      handleClose();
    },
    [actionHandlers, handleClose]
  );

  const handleBackFromMore = useCallback(() => {
    setShowMoreActions(false);
  }, []);

  // Get initials for avatar placeholder
  const getInitials = (name?: string) => {
    if (!name) return "?";
    const trimmed = name.trim();
    if (!trimmed) return "?";
    const parts = trimmed.split(" ").filter(part => part.length > 0);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return trimmed.substring(0, Math.min(2, trimmed.length)).toUpperCase();
  };

  if (!visible || !message) return null;

  // Truncate long messages for display
  const displayContent = message.content.length > 200
    ? `${message.content.substring(0, 200)}...`
    : message.content;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      {/* Dimmed Backdrop */}
      <TouchableWithoutFeedback onPress={handleClose}>
        <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]} />
      </TouchableWithoutFeedback>

      {/* Centered Content */}
      <View style={styles.centeredContainer} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.contentWrapper,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          {/* Reactions Bar - Above Message */}
          <View style={styles.reactionsContainer}>
            {REACTIONS.map((reaction) => (
              <TouchableOpacity
                key={reaction.type}
                style={styles.reactionButton}
                onPress={() => handleReactionTap(reaction.emoji)}
                activeOpacity={0.7}
              >
                <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Message Bubble Snapshot */}
          <View
            style={[
              styles.messageBubbleContainer,
              isOwnMessage ? styles.ownMessageAlign : styles.otherMessageAlign,
            ]}
          >
            {/* Avatar for others' messages */}
            {!isOwnMessage && (
              <View style={styles.avatarContainer}>
                {message.senderProfilePhoto ? (
                  <Image
                    source={{ uri: message.senderProfilePhoto }}
                    style={styles.avatar}
                  />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Text style={styles.avatarText}>
                      {getInitials(message.senderName)}
                    </Text>
                  </View>
                )}
              </View>
            )}

            <View style={styles.bubbleContent}>
              {/* Sender name for others' messages */}
              {!isOwnMessage && message.senderName && (
                <Text style={styles.senderName}>{message.senderName}</Text>
              )}

              {/* Message bubble */}
              <View
                style={[
                  styles.messageBubble,
                  isOwnMessage ? styles.ownMessageBubble : styles.otherMessageBubble,
                ]}
              >
                <Text
                  style={[
                    styles.messageText,
                    isOwnMessage && styles.ownMessageText,
                  ]}
                >
                  {displayContent}
                </Text>

                {/* Show image attachment preview if exists */}
                {message.attachments?.some((a) => a.type === "image") && (
                  <View style={styles.attachmentIndicator}>
                    <Ionicons name="image" size={14} color="#666" />
                    <Text style={styles.attachmentText}>Image</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Actions Menu - Below Message */}
          <View style={styles.actionsContainer}>
            {showMoreActions ? (
              <>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={handleBackFromMore}
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-back" size={20} color="#666" />
                  <Text style={[styles.actionLabel, { color: "#666" }]}>Back</Text>
                </TouchableOpacity>
                {availableMoreActions.map((action, index) => (
                  <TouchableOpacity
                    key={action.id}
                    style={[
                      styles.actionButton,
                      index === availableMoreActions.length - 1 && styles.actionButtonLast,
                    ]}
                    onPress={() => handleActionTap(action.id)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={action.icon}
                      size={20}
                      color={action.color || "#333"}
                    />
                    <Text
                      style={[
                        styles.actionLabel,
                        action.color && { color: action.color },
                      ]}
                    >
                      {action.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </>
            ) : (
              availablePrimaryActions.map((action, index) => (
                <TouchableOpacity
                  key={action.id}
                  style={[
                    styles.actionButton,
                    index === availablePrimaryActions.length - 1 && styles.actionButtonLast,
                  ]}
                  onPress={() => handleActionTap(action.id)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={action.icon}
                    size={20}
                    color={action.color || "#333"}
                  />
                  <Text
                    style={[
                      styles.actionLabel,
                      action.color && { color: action.color },
                    ]}
                  >
                    {action.label}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  centeredContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  contentWrapper: {
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
  },
  // Reactions
  reactionsContainer: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  reactionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 2,
  },
  reactionEmoji: {
    fontSize: 24,
  },
  // Message Bubble
  messageBubbleContainer: {
    flexDirection: "row",
    width: "100%",
    marginBottom: 12,
  },
  ownMessageAlign: {
    justifyContent: "flex-end",
  },
  otherMessageAlign: {
    justifyContent: "flex-start",
  },
  avatarContainer: {
    marginRight: 8,
    marginTop: 4,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  avatarPlaceholder: {
    backgroundColor: "#E5E5E5",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#666",
  },
  bubbleContent: {
    maxWidth: "85%",
    flexShrink: 1,
  },
  senderName: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
    marginBottom: 4,
    marginLeft: 12,
    opacity: 0.9,
  },
  messageBubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  ownMessageBubble: {
    backgroundColor: IMESSAGE_BLUE,
    borderBottomRightRadius: 4,
  },
  otherMessageBubble: {
    backgroundColor: IMESSAGE_GRAY,
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
    color: "#000",
  },
  ownMessageText: {
    color: "#000",
  },
  attachmentIndicator: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    gap: 4,
  },
  attachmentText: {
    fontSize: 12,
    color: "#666",
  },
  // Actions
  actionsContainer: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e0e0e0",
  },
  actionButtonLast: {
    borderBottomWidth: 0,
  },
  actionLabel: {
    fontSize: 16,
    color: "#333",
    marginLeft: 12,
  },
});
