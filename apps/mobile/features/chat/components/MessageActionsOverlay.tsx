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
import { useTheme } from "@hooks/useTheme";
import { getMediaUrl } from "@/utils/media";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// Reaction types
const REACTIONS = [
  { type: "like", emoji: "👍" },
  { type: "love", emoji: "❤️" },
  { type: "haha", emoji: "😂" },
  { type: "wow", emoji: "😮" },
  { type: "sad", emoji: "😢" },
  { type: "pray", emoji: "🙏" },
  { type: "fire", emoji: "🔥" },
  { type: "clap", emoji: "👏" },
  { type: "celebrate", emoji: "🎉" },
  { type: "hundred", emoji: "💯" },
  { type: "eyes", emoji: "👀" },
  { type: "heart_eyes", emoji: "😍" },
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
  /** Community admins can delete any message in groups within their community */
  isCommunityAdmin?: boolean;
  /** Hide the reply action (useful in thread context where nested replies aren't allowed) */
  hideReplyAction?: boolean;
};

export function MessageActionsOverlay({
  visible,
  message,
  actionHandlers,
  onClose,
  isOwnMessage = false,
  isUserLeader = false,
  isCommunityAdmin = false,
  hideReplyAction = false,
}: MessageActionsOverlayProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const [showMoreActions, setShowMoreActions] = useState(false);

  // Filter primary actions based on message ownership, leader status, community admin, and context
  const availablePrimaryActions = useMemo(() => {
    return PRIMARY_ACTIONS.filter((action) => {
      if (action.id === "reply") return !hideReplyAction;
      if (action.id === "delete") return isOwnMessage || isUserLeader || isCommunityAdmin;
      if (action.id === "more") return !isOwnMessage;
      return true;
    });
  }, [isOwnMessage, isUserLeader, isCommunityAdmin, hideReplyAction]);

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
        <Animated.View style={[styles.backdrop, { opacity: fadeAnim, backgroundColor: colors.overlay }]} />
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
          <View style={[styles.reactionsContainer, { backgroundColor: colors.surface }]}>
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

          {/* Mini Message Preview */}
          <View
            style={[
              styles.messageBubbleContainer,
              isOwnMessage ? styles.ownMessageAlign : styles.otherMessageAlign,
            ]}
          >
            <View
              style={[
                styles.messageBubble,
                isOwnMessage
                  ? [styles.ownMessageBubble, { backgroundColor: colors.chatBubbleOwn }]
                  : [styles.otherMessageBubble, { backgroundColor: colors.chatBubbleOther }],
              ]}
            >
              {/* Image thumbnails */}
              {message.attachments?.some((a) => a.type === "image") && (() => {
                const images = message.attachments!.filter((a) => a.type === "image");
                const count = images.length;
                return (
                  <View style={[styles.miniImageGrid, count > 1 && styles.miniImageGridMulti]}>
                    {images.slice(0, 4).map((attachment, index) => (
                      <View
                        key={index}
                        style={[
                          styles.miniImageThumb,
                          count === 1 && styles.miniImageSingle,
                          count === 2 && styles.miniImageHalf,
                          count >= 3 && styles.miniImageQuarter,
                        ]}
                      >
                        <Image
                          source={{ uri: getMediaUrl(attachment.url) ?? undefined }}
                          style={StyleSheet.absoluteFill}
                          resizeMode="cover"
                        />
                        {index === 3 && count > 4 && (
                          <View style={styles.miniImageMoreOverlay}>
                            <Text style={styles.miniImageMoreText}>+{count - 4}</Text>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                );
              })()}

              {/* Video thumbnail */}
              {message.attachments?.some((a) => a.type === "video") && (
                <View style={styles.miniVideoThumb}>
                  <View style={styles.miniVideoPlayIcon}>
                    <Ionicons name="play" size={20} color="#fff" />
                  </View>
                </View>
              )}

              {/* Text content */}
              {displayContent.length > 0 && (
                <View style={styles.miniTextContent}>
                  <Text
                    style={[
                      styles.miniText,
                      { color: colors.chatBubbleOtherText },
                      isOwnMessage && { color: colors.chatBubbleOwnText },
                    ]}
                    numberOfLines={2}
                  >
                    {displayContent}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Actions Menu - Below Message */}
          <View style={[styles.actionsContainer, { backgroundColor: colors.surface }]}>
            {showMoreActions ? (
              <>
                <TouchableOpacity
                  style={[styles.actionButton, { borderBottomColor: colors.border }]}
                  onPress={handleBackFromMore}
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
                  <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>Back</Text>
                </TouchableOpacity>
                {availableMoreActions.map((action, index) => (
                  <TouchableOpacity
                    key={action.id}
                    style={[
                      styles.actionButton,
                      { borderBottomColor: colors.border },
                      index === availableMoreActions.length - 1 && styles.actionButtonLast,
                    ]}
                    onPress={() => handleActionTap(action.id)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={action.icon}
                      size={20}
                      color={action.color || colors.text}
                    />
                    <Text
                      style={[
                        styles.actionLabel,
                        { color: colors.text },
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
                    { borderBottomColor: colors.border },
                    index === availablePrimaryActions.length - 1 && styles.actionButtonLast,
                  ]}
                  onPress={() => handleActionTap(action.id)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={action.icon}
                    size={20}
                    color={action.color || colors.text}
                  />
                  <Text
                    style={[
                      styles.actionLabel,
                      { color: colors.text },
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
    flexWrap: "wrap",
    justifyContent: "center",
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
  // Mini Message Preview
  messageBubbleContainer: {
    width: "100%",
    flexDirection: "row",
    marginBottom: 12,
  },
  ownMessageAlign: {
    justifyContent: "flex-end",
  },
  otherMessageAlign: {
    justifyContent: "flex-start",
  },
  messageBubble: {
    borderRadius: 14,
    overflow: "hidden",
    maxWidth: 200,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  ownMessageBubble: {
    borderBottomRightRadius: 4,
  },
  otherMessageBubble: {
    borderBottomLeftRadius: 4,
  },
  // Mini image grid
  miniImageGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  miniImageGridMulti: {
    gap: 2,
  },
  miniImageThumb: {
    overflow: "hidden",
    backgroundColor: "#1a1a1a",
  },
  miniImageSingle: {
    width: 200,
    height: 150,
  },
  miniImageHalf: {
    width: 99,
    height: 99,
  },
  miniImageQuarter: {
    width: 99,
    height: 99,
  },
  miniImageMoreOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  miniImageMoreText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  // Mini video thumbnail
  miniVideoThumb: {
    width: 200,
    height: 112,
    backgroundColor: "#1a1a1a",
    justifyContent: "center",
    alignItems: "center",
  },
  miniVideoPlayIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(244, 67, 54, 0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  // Mini text content
  miniTextContent: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  miniText: {
    fontSize: 14,
    lineHeight: 18,
  },
  // Actions
  actionsContainer: {
    width: "100%",
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
  },
  actionButtonLast: {
    borderBottomWidth: 0,
  },
  actionLabel: {
    fontSize: 16,
    marginLeft: 12,
  },
});
