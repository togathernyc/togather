/**
 * ReactionDetailsModal - Shows users who reacted with a specific emoji
 *
 * Displays a modal overlay with:
 * - Emoji header
 * - List of users who reacted with their avatar and name
 * - Tap backdrop to dismiss
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { Avatar } from '@components/ui';
import { useTheme } from '@hooks/useTheme';
import { useReactionDetails, type ReactorUser } from '@features/chat/hooks/useReactionDetails';
import type { Id } from '@services/api/convex';

interface ReactionDetailsModalProps {
  visible: boolean;
  emoji: string | null;
  messageId: Id<"chatMessages"> | null;
  onClose: () => void;
}

export function ReactionDetailsModal({
  visible,
  emoji,
  messageId,
  onClose,
}: ReactionDetailsModalProps) {
  const { colors } = useTheme();
  const { users, isLoading } = useReactionDetails(messageId, emoji);

  const renderUserItem = ({ item }: { item: ReactorUser }) => (
    <View style={styles.userItem}>
      <Avatar
        name={item.displayName}
        imageUrl={item.profilePhoto}
        size={40}
      />
      <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
        {item.displayName}
      </Text>
    </View>
  );

  const renderContent = () => {
    if (isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.link} />
        </View>
      );
    }

    if (users.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.textTertiary }]}>No reactions found</Text>
        </View>
      );
    }

    return (
      <FlatList
        data={users}
        renderItem={renderUserItem}
        keyExtractor={(item) => item.userId}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose}>
        <Pressable style={[styles.modalContainer, { backgroundColor: colors.modalBackground }]} onPress={(e) => e.stopPropagation()}>
          {/* Header with emoji */}
          <View style={styles.header}>
            <Text style={styles.headerEmoji}>{emoji}</Text>
            {/* Only show count when loaded to avoid "0 reactions" flash during loading */}
            {!isLoading && (
              <Text style={[styles.headerText, { color: colors.text }]}>
                {users.length} {users.length === 1 ? 'reaction' : 'reactions'}
              </Text>
            )}
          </View>

          {/* Divider */}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* User list or loading state */}
          {renderContent()}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    borderRadius: 16,
    width: '80%',
    maxWidth: 320,
    maxHeight: '60%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  headerEmoji: {
    fontSize: 28,
    marginRight: 8,
  },
  headerText: {
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    height: 1,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 14,
  },
  listContent: {
    paddingVertical: 8,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  userName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    marginLeft: 12,
  },
});
