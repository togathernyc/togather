/**
 * Group Chats Screen - Shows general chat + leaders hub for a group.
 *
 * Uses Convex getGroupChatsByLegacyId which accepts legacy UUIDs from route params.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@hooks/useTheme';
import { useQuery, api, Id, useStoredAuthToken } from '@services/api/convex';

type Chat = {
  _id: Id<"chatChannels">;
  slug: string;
  name: string;
  channelType: string;
};

export const GroupChatsScreen: React.FC = () => {
  const params = useLocalSearchParams<{ groupId: string; groupName: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { groupId, groupName } = params;
  const token = useStoredAuthToken();
  const { colors: themeColors } = useTheme();

  // Using Convex getChannelsByGroup from messaging module
  const data = useQuery(
    api.functions.messaging.channels.getChannelsByGroup,
    groupId && token ? { token, groupId: groupId as Id<"groups"> } : 'skip'
  );
  const loading = data === undefined && !!groupId && !!token;
  const chats = data || [];

  const openChat = (chat: Chat) => {
    // Use URL-based slug routing: /inbox/[groupId]/[channelSlug]
    router.push(`/inbox/${groupId}/${chat.slug}` as any);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" testID="loading-indicator" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.header}>{groupName}</Text>

      {chats.map((chat: Chat) => (
        <TouchableOpacity
          key={chat._id}
          style={styles.chatCard}
          onPress={() => openChat(chat)}
        >
          <View style={styles.chatIcon}>
            <Text style={styles.chatIconText}>
              {chat.channelType === 'leaders' ? '👑' : '💬'}
            </Text>
          </View>
          <View style={styles.chatInfo}>
            <Text style={styles.chatName}>{chat.name}</Text>
            <Text style={styles.chatType}>
              {chat.channelType === 'leaders' ? 'Leaders Hub' : 'General Chat'}
            </Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  chatCard: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginBottom: 12,
  },
  chatIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  chatIconText: {
    fontSize: 24,
  },
  chatInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  chatName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  chatType: {
    fontSize: 14,
    color: '#666',
  },
});
