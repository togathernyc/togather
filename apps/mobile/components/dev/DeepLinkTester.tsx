/**
 * DeepLinkTester - Development utility for testing notification deep links
 *
 * This component allows testing notification tap handling without real push notifications.
 * It simulates different notification types and triggers the same handleNotificationTap
 * function that real notifications use.
 *
 * Only visible in development mode (__DEV__), staging builds, or when dev tools
 * escape hatch is enabled (tap version number 5 times in Settings).
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, StyleSheet } from 'react-native';
import { useNotifications } from '@/providers/NotificationProvider';
import { useAuth } from '@/providers/AuthProvider';
import { Environment } from '@/services/environment';
import { useDevToolsEscapeHatch } from '@/hooks/useDevToolsEscapeHatch';
import { useTheme } from '@hooks/useTheme';

// Sample notification payloads for testing
const SAMPLE_NOTIFICATIONS = [
  {
    name: 'Join Request Approved',
    type: 'join_request_approved',
    description: 'User approved to join a group',
    getData: (groupId: string, communityId: string) => ({
      type: 'join_request_approved',
      groupId,
      communityId,
    }),
  },
  {
    name: 'Group Creation Approved',
    type: 'group_creation_approved',
    description: 'Group creation request approved',
    getData: (groupId: string, communityId: string) => ({
      type: 'group_creation_approved',
      groupId,
      communityId,
      url: `/groups/${groupId}`,
    }),
  },
  {
    name: 'Role Changed (Leader Promotion)',
    type: 'role_changed',
    description: 'User promoted to leader',
    getData: (groupId: string, communityId: string) => ({
      type: 'role_changed',
      groupId,
      communityId,
      newRole: 'leader',
    }),
  },
  {
    name: 'Join Request Received (Admin)',
    type: 'join_request_received',
    description: 'New join request for admin to review',
    getData: () => ({
      type: 'join_request_received',
    }),
  },
  {
    name: 'New Message',
    type: 'new_message',
    description: 'New chat message received',
    getData: (groupId: string, communityId: string, channelId: string) => ({
      type: 'new_message',
      channelId: channelId || `community${communityId}_group${groupId}_main`,
    }),
  },
  {
    name: 'Event Updated',
    type: 'event_updated',
    description: 'Event details changed',
    getData: (_groupId: string, _communityId: string, _channelId: string, shortId: string) => ({
      type: 'event_updated',
      shortId: shortId || 'test123',
    }),
  },
];

export function DeepLinkTester() {
  const { handleNotificationTap } = useNotifications();
  const { community } = useAuth();
  const { isEnabled: devToolsEnabled } = useDevToolsEscapeHatch();
  const { colors } = useTheme();

  const [groupId, setGroupId] = useState('');
  const [communityId, setCommunityId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [shortId, setShortId] = useState('');
  const [lastResult, setLastResult] = useState<string | null>(null);

  // Only render in development, staging, or when escape hatch is enabled
  // Hidden in production builds unless dev tools are explicitly enabled
  const shouldShow = __DEV__ || Environment.isStaging() || devToolsEnabled;
  if (!shouldShow) {
    return null;
  }

  const handleTest = async (notification: typeof SAMPLE_NOTIFICATIONS[0]) => {
    const data = notification.getData(groupId, communityId, channelId, shortId);
    setLastResult(`Testing: ${notification.name}\nData: ${JSON.stringify(data, null, 2)}`);
    try {
      await handleNotificationTap(data);
      setLastResult((prev) => `${prev}\n\nSuccess! Navigation triggered.`);
    } catch (error) {
      setLastResult((prev) => `${prev}\n\nError: ${error}`);
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Deep Link Tester</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Current Community: {community?.id || 'None'}
        </Text>
      </View>

      <View style={[styles.inputSection, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Test Parameters</Text>

        <View style={styles.inputRow}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Group ID:</Text>
          <TextInput
            style={[styles.input, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
            value={groupId}
            onChangeText={setGroupId}
            placeholder="e.g., abc123-uuid"
            placeholderTextColor={colors.inputPlaceholder}
          />
        </View>

        <View style={styles.inputRow}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Community ID:</Text>
          <TextInput
            style={[styles.input, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
            value={communityId}
            onChangeText={setCommunityId}
            placeholder="e.g., 123"
            placeholderTextColor={colors.inputPlaceholder}
            keyboardType="numeric"
          />
        </View>

        <View style={styles.inputRow}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Channel ID:</Text>
          <TextInput
            style={[styles.input, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
            value={channelId}
            onChangeText={setChannelId}
            placeholder="Optional - for new_message"
            placeholderTextColor={colors.inputPlaceholder}
          />
        </View>

        <View style={styles.inputRow}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Short ID:</Text>
          <TextInput
            style={[styles.input, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
            value={shortId}
            onChangeText={setShortId}
            placeholder="Optional - for events"
            placeholderTextColor={colors.inputPlaceholder}
          />
        </View>
      </View>

      <View style={[styles.buttonSection, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Test Notifications</Text>

        {SAMPLE_NOTIFICATIONS.map((notification) => (
          <TouchableOpacity
            key={notification.type}
            style={[styles.button, { backgroundColor: colors.link }]}
            onPress={() => handleTest(notification)}
          >
            <Text style={styles.buttonText}>{notification.name}</Text>
            <Text style={styles.buttonDescription}>{notification.description}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {lastResult && (
        <View style={[styles.resultSection, { backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Last Result</Text>
          <Text style={[styles.resultText, { color: colors.text, backgroundColor: colors.backgroundSecondary }]}>{lastResult}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  inputSection: {
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  inputRow: {
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    fontSize: 14,
  },
  buttonSection: {
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  button: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDescription: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
    marginTop: 2,
  },
  resultSection: {
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
  },
  resultText: {
    fontFamily: 'monospace',
    fontSize: 12,
    padding: 12,
    borderRadius: 6,
  },
});

export default DeepLinkTester;
