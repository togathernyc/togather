/**
 * ConvexMessagingTest Component
 *
 * Simple test component to verify the Convex messaging hooks work correctly.
 * Tests:
 * 1. useChannel - loads channel data
 * 2. useMessages - loads and paginates messages
 * 3. useSendMessage - sends messages with optimistic updates
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useChannel, useMessages, useConvexSendMessage } from '../hooks';
import { useTheme } from '@hooks/useTheme';
import type { Id } from '@services/api/convex';

interface ConvexMessagingTestProps {
  channelId: Id<"chatChannels">;
}

export function ConvexMessagingTest({ channelId }: ConvexMessagingTestProps) {
  const { colors, isDark } = useTheme();
  const [messageText, setMessageText] = useState('');

  // Test 1: useChannel
  const channel = useChannel(channelId);

  // Test 2: useMessages
  const { messages, loadMore, hasMore, isLoading } = useMessages(channelId, 20);

  // Test 3: useSendMessage
  const { sendMessage, optimisticMessages, isSending } = useConvexSendMessage(channelId);

  const handleSend = async () => {
    if (!messageText.trim()) return;

    try {
      await sendMessage(messageText.trim());
      setMessageText('');
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  // Combine real messages with optimistic messages
  const allMessages = [...messages, ...optimisticMessages].sort(
    (a, b) => b.createdAt - a.createdAt
  );

  if (isLoading && messages.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.link} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading messages...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header - Channel Info */}
      <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {channel ? channel.name : 'Loading...'}
        </Text>
        {channel && (
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            {channel.memberCount || 0} members • {channel.channelType}
          </Text>
        )}
      </View>

      {/* Messages List */}
      <FlatList
        data={allMessages}
        keyExtractor={(item) => item._id}
        inverted
        renderItem={({ item }) => (
          <View style={[styles.messageContainer, { borderBottomColor: colors.borderLight }]}>
            <View style={styles.messageHeader}>
              <Text style={[styles.messageSender, { color: colors.text }]}>{item.senderName}</Text>
              <Text style={[styles.messageTime, { color: colors.textTertiary }]}>
                {new Date(item.createdAt).toLocaleTimeString()}
              </Text>
              {item._optimistic && (
                <Text style={[styles.messageStatus, { color: colors.link }]}>
                  {item._status === 'sending' && ' • Sending...'}
                  {item._status === 'sent' && ' • Sent'}
                  {item._status === 'error' && ' • Failed'}
                </Text>
              )}
            </View>
            <Text style={[styles.messageContent, { color: colors.text }]}>{item.content}</Text>
            {item.attachments && item.attachments.length > 0 && (
              <Text style={[styles.messageAttachments, { color: colors.link }]}>
                📎 {item.attachments.length} attachment(s)
              </Text>
            )}
          </View>
        )}
        onEndReached={() => {
          if (hasMore && !isLoading) {
            loadMore();
          }
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          hasMore ? (
            <View style={styles.loadingMore}>
              <ActivityIndicator size="small" color={colors.link} />
              <Text style={[styles.loadingMoreText, { color: colors.textSecondary }]}>Loading more...</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No messages yet</Text>
            <Text style={[styles.emptySubtext, { color: colors.textTertiary }]}>Send a message to start the conversation</Text>
          </View>
        }
      />

      {/* Message Input */}
      <View style={[styles.inputContainer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TextInput
          style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text }]}
          value={messageText}
          onChangeText={setMessageText}
          placeholder="Type a message..."
          placeholderTextColor={colors.inputPlaceholder}
          multiline
          maxLength={2000}
        />
        <TouchableOpacity
          style={[styles.sendButton, { backgroundColor: colors.link }, (!messageText.trim() || isSending) && { backgroundColor: colors.iconSecondary }]}
          onPress={handleSend}
          disabled={!messageText.trim() || isSending}
        >
          <Text style={styles.sendButtonText}>
            {isSending ? 'Sending...' : 'Send'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  messageContainer: {
    padding: 12,
    borderBottomWidth: 1,
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  messageSender: {
    fontSize: 14,
    fontWeight: '600',
  },
  messageTime: {
    fontSize: 12,
    marginLeft: 8,
  },
  messageStatus: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  messageContent: {
    fontSize: 16,
    lineHeight: 22,
  },
  messageAttachments: {
    fontSize: 14,
    marginTop: 4,
  },
  loadingMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  loadingMoreText: {
    marginLeft: 8,
    fontSize: 14,
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    padding: 10,
    fontSize: 16,
    borderRadius: 20,
    marginRight: 8,
  },
  sendButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
