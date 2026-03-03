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
import type { Id } from '@services/api/convex';

interface ConvexMessagingTestProps {
  channelId: Id<"chatChannels">;
}

export function ConvexMessagingTest({ channelId }: ConvexMessagingTestProps) {
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
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading messages...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header - Channel Info */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {channel ? channel.name : 'Loading...'}
        </Text>
        {channel && (
          <Text style={styles.headerSubtitle}>
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
          <View style={styles.messageContainer}>
            <View style={styles.messageHeader}>
              <Text style={styles.messageSender}>{item.senderName}</Text>
              <Text style={styles.messageTime}>
                {new Date(item.createdAt).toLocaleTimeString()}
              </Text>
              {item._optimistic && (
                <Text style={styles.messageStatus}>
                  {item._status === 'sending' && ' • Sending...'}
                  {item._status === 'sent' && ' • Sent'}
                  {item._status === 'error' && ' • Failed'}
                </Text>
              )}
            </View>
            <Text style={styles.messageContent}>{item.content}</Text>
            {item.attachments && item.attachments.length > 0 && (
              <Text style={styles.messageAttachments}>
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
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={styles.loadingMoreText}>Loading more...</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No messages yet</Text>
            <Text style={styles.emptySubtext}>Send a message to start the conversation</Text>
          </View>
        }
      />

      {/* Message Input */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={messageText}
          onChangeText={setMessageText}
          placeholder="Type a message..."
          multiline
          maxLength={2000}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!messageText.trim() || isSending) && styles.sendButtonDisabled]}
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
    backgroundColor: '#fff',
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    backgroundColor: '#f8f8f8',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  messageContainer: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  messageSender: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  messageTime: {
    fontSize: 12,
    color: '#999',
    marginLeft: 8,
  },
  messageStatus: {
    fontSize: 12,
    color: '#007AFF',
    fontStyle: 'italic',
  },
  messageContent: {
    fontSize: 16,
    color: '#000',
    lineHeight: 22,
  },
  messageAttachments: {
    fontSize: 14,
    color: '#007AFF',
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
    color: '#666',
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    padding: 10,
    fontSize: 16,
    backgroundColor: '#f8f8f8',
    borderRadius: 20,
    marginRight: 8,
  },
  sendButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#ccc',
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
