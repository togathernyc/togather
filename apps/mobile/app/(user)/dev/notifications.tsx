/**
 * NotificationTester Page
 *
 * A comprehensive testing page for push notifications in dev/staging environments.
 *
 * Features:
 * - Toggle between REAL push (via centralized system) and local notifications
 * - Dropdown to select notification types (from registry)
 * - Multi-channel selection (push, email, chat, sms)
 * - Mode toggle (cascade vs multi)
 * - Chat target picker for chat channel
 * - Email preview with subject and HTML
 * - Sample payload auto-fill
 * - Editable payload fields
 * - Live notification preview (iOS-style banner)
 * - Test deep link handler directly
 *
 * IMPORTANT: The "Real Push" mode sends notifications through the centralized
 * notification system, which correctly handles environment separation
 * (staging vs production). This is the recommended way to test notifications
 * as it mirrors the real production flow.
 *
 * The "Local" mode only sends device-local notifications and does NOT test
 * the actual notification infrastructure.
 *
 * Only accessible in dev/staging builds.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Platform,
  TouchableOpacity,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import { Card, Button, Select, Modal } from '@components/ui';
import { NotificationPreview } from '@/components/dev/NotificationPreview';
import {
  NOTIFICATION_SAMPLES,
  getNotificationSample,
  getNotificationTypeOptions,
} from '@/components/dev/notification-samples';
import { useNotifications } from '@/providers/NotificationProvider';
import { useAuth } from '@/providers/AuthProvider';
import { Environment } from '@/services/environment';
import { useDevToolsEscapeHatch } from '@/hooks/useDevToolsEscapeHatch';
import { UserRoute } from '@components/guards/UserRoute';
import { useQuery, useAction, useMutation, api } from '@services/api/convex';
import { useTheme } from '@hooks/useTheme';

// Available notification channels
type NotificationChannel = 'push' | 'email' | 'chat' | 'sms';
type SendMode = 'cascade' | 'multi';
type ChatTarget = 'main' | 'leaders';

// Channel display info
const CHANNEL_INFO: Record<NotificationChannel, { label: string; icon: string; note?: string }> = {
  push: { label: 'Push', icon: 'notifications' },
  email: { label: 'Email', icon: 'mail' },
  chat: { label: 'Chat', icon: 'chatbubbles' },
  sms: { label: 'SMS', icon: 'phone-portrait', note: '(Not implemented)' },
};

export default function NotificationTesterPage() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { handleNotificationTap, expoPushToken } = useNotifications();
  const { community, user, token: authToken } = useAuth();
  const { isEnabled: devToolsEnabled } = useDevToolsEscapeHatch();

  // Form state
  const [selectedType, setSelectedType] = useState<string>(
    NOTIFICATION_SAMPLES[0].type
  );
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [groupId, setGroupId] = useState('');
  const [communityId, setCommunityId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [shortId, setShortId] = useState('');

  // Multi-channel options (only for real push mode)
  const [selectedChannels, setSelectedChannels] = useState<NotificationChannel[]>(['push']);
  const [sendMode, setSendMode] = useState<SendMode>('cascade');
  const [chatTarget, setChatTarget] = useState<ChatTarget>('main');
  const [availableChannels, setAvailableChannels] = useState<NotificationChannel[]>(['push', 'email', 'chat', 'sms']);

  // Email preview state
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [emailPreviewLoading, setEmailPreviewLoading] = useState(false);

  // Result state
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [useRealPush, setUseRealPush] = useState(true); // Default to real push

  // Email preview state for manual fetching
  const [emailPreviewData, setEmailPreviewData] = useState<{ subject: string; html: string } | null>(null);
  const [emailPreviewError, setEmailPreviewError] = useState<Error | null>(null);
  const [emailPreviewFetching, setEmailPreviewFetching] = useState(false);

  // Convex queries and actions
  const notificationTypesData = useQuery(
    api.functions.notifications.actions.getNotificationTypes,
    useRealPush ? {} : "skip"
  );
  const typesLoading = useRealPush && notificationTypesData === undefined;

  // Debug query to check token status
  const tokenDebugData = useQuery(
    api.functions.notifications.debug.debugTokensForUser,
    user?.id ? { userId: user.id as any } : "skip"
  );

  // Convex action for sending test notifications
  const sendTestNotification = useAction(api.functions.notifications.actions.sendTestNotification);

  // Mutation for re-registering token
  const registerTokenMutation = useMutation(api.functions.notifications.tokens.registerToken);
  const [isReregistering, setIsReregistering] = useState(false);

  // Mutation for cleaning up legacy tokens
  const cleanupLegacyTokensMutation = useMutation(api.functions.notifications.tokens.cleanupLegacyTokens);
  const [isCleaningUp, setIsCleaningUp] = useState(false);

  // Mutation for toggling push notifications (activates/deactivates tokens)
  const updatePreferencesMutation = useMutation(api.functions.notifications.preferences.updateChannelPreferences);
  const [isTogglingPush, setIsTogglingPush] = useState(false);

  // Re-register token with correct environment
  const handleReregisterToken = async () => {
    if (!expoPushToken || !user) return;

    setIsReregistering(true);
    try {
      // Get auth token from storage
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      const authToken = await AsyncStorage.getItem('auth_token');

      if (!authToken) {
        setLastResult('Error: No auth token found');
        return;
      }

      await registerTokenMutation({
        authToken,
        token: expoPushToken,
        platform: Platform.OS as 'ios' | 'android' | 'web',
        bundleId: require('expo-constants').default.expoConfig?.ios?.bundleIdentifier,
      });

      setLastResult('✅ Token re-registered! Refresh the page to see updated status.');
    } catch (error) {
      setLastResult(`Error re-registering token: ${error}`);
    } finally {
      setIsReregistering(false);
    }
  };

  // Clean up legacy tokens (those without environment)
  const handleCleanupLegacyTokens = async () => {
    setIsCleaningUp(true);
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      const authToken = await AsyncStorage.getItem('auth_token');

      if (!authToken) {
        setLastResult('Error: No auth token found');
        return;
      }

      const result = await cleanupLegacyTokensMutation({ authToken });
      setLastResult(
        `✅ Cleanup complete!\n` +
        `Deleted ${result.deletedCount} legacy token(s)\n\n` +
        `If you still see issues, tap "Re-register Token" to create a fresh token.`
      );
    } catch (error) {
      setLastResult(`Error cleaning up: ${error}`);
    } finally {
      setIsCleaningUp(false);
    }
  };

  // Toggle push notifications (activates/deactivates tokens for current environment)
  const handleTogglePush = async (enable: boolean) => {
    setIsTogglingPush(true);
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      const authToken = await AsyncStorage.getItem('auth_token');

      if (!authToken) {
        setLastResult('Error: No auth token found');
        return;
      }

      await updatePreferencesMutation({
        token: authToken,
        push: enable,
      });

      setLastResult(
        enable
          ? '✅ Push notifications enabled! Tokens are now active.'
          : '✅ Push notifications disabled. Tokens are now inactive.'
      );
    } catch (error) {
      setLastResult(`Error toggling push: ${error}`);
    } finally {
      setIsTogglingPush(false);
    }
  };

  // Environment check - only show in dev/staging or when escape hatch is enabled
  const shouldShow = __DEV__ || Environment.isStaging() || devToolsEnabled;

  // Get notification type options - use registry if available, otherwise use local samples
  const notificationTypeOptions = React.useMemo(() => {
    if (useRealPush && notificationTypesData?.types) {
      return notificationTypesData.types.map((t: { type: string }) => ({
        label: t.type.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
        value: t.type,
      }));
    }
    return getNotificationTypeOptions();
  }, [useRealPush, notificationTypesData]);

  // Get current notification type definition from registry
  const currentTypeDefinition = React.useMemo(() => {
    if (useRealPush && notificationTypesData?.types) {
      return notificationTypesData.types.find((t: { type: string }) => t.type === selectedType);
    }
    return null;
  }, [useRealPush, notificationTypesData, selectedType]);

  // Update available channels and defaults when notification type changes
  useEffect(() => {
    if (currentTypeDefinition) {
      setAvailableChannels(currentTypeDefinition.availableChannels as NotificationChannel[]);
      setSelectedChannels(currentTypeDefinition.defaultChannels as NotificationChannel[]);
      setSendMode(currentTypeDefinition.defaultMode as SendMode);
    } else {
      // Reset to defaults for local mode
      setAvailableChannels(['push', 'email', 'chat', 'sms']);
      setSelectedChannels(['push']);
      setSendMode('cascade');
    }
  }, [currentTypeDefinition, selectedType]);

  // Auto-fill sample data when notification type changes
  useEffect(() => {
    const sample = getNotificationSample(selectedType);
    if (sample) {
      setTitle(sample.defaultTitle);
      setBody(sample.defaultBody);

      // Set default IDs from sample data
      const sampleData = sample.getData({
        groupId: '',
        communityId: community?.id?.toString() || '1',
        channelId: '',
        shortId: '',
      });

      if (sampleData.groupId && !groupId) {
        setGroupId(sampleData.groupId as string);
      }
      if (sampleData.communityId && !communityId) {
        setCommunityId(sampleData.communityId as string);
      }
      if (sampleData.channelId && !channelId) {
        setChannelId(sampleData.channelId as string);
      }
      if (sampleData.shortId && !shortId) {
        setShortId(sampleData.shortId as string);
      }
    }
  }, [selectedType]);

  // Set community ID from auth context
  useEffect(() => {
    if (community?.id && !communityId) {
      setCommunityId(community.id.toString());
    }
  }, [community?.id]);

  // Build notification payload
  const buildPayload = (): Record<string, unknown> => {
    const sample = getNotificationSample(selectedType);
    if (!sample) return { type: selectedType };

    return sample.getData({
      groupId,
      communityId,
      channelId,
      shortId,
    });
  };

  // Toggle channel selection
  const toggleChannel = (channel: NotificationChannel) => {
    if (!availableChannels.includes(channel)) return;

    setSelectedChannels((prev) => {
      if (prev.includes(channel)) {
        // Don't allow removing the last channel
        if (prev.length === 1) return prev;
        return prev.filter((c) => c !== channel);
      }
      return [...prev, channel];
    });
  };

  // Handle email preview - fetch using convexVanilla since we need on-demand fetching
  const handleEmailPreview = async () => {
    setShowEmailPreview(true);
    setEmailPreviewLoading(true);
    setEmailPreviewError(null);
    try {
      const { convexVanilla } = await import('@services/api/convex');
      const result = await convexVanilla.query(api.functions.notifications.actions.getEmailPreview, {
        type: selectedType,
        data: {
          title: title || undefined,
          body: body || undefined,
          groupId: groupId || undefined,
          communityId: communityId || undefined,
          channelId: channelId || undefined,
          shortId: shortId || undefined,
        },
      });
      setEmailPreviewData(result);
    } catch (error) {
      console.error('Error fetching email preview:', error);
      setEmailPreviewError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setEmailPreviewLoading(false);
    }
  };

  // Send notification (real push via API or local)
  const handleSendNotification = async () => {
    setIsSending(true);
    setLastResult(null);

    try {
      const payload = buildPayload();

      if (useRealPush) {
        // Use Convex action for multi-channel test endpoint
        if (!user?.id) {
          throw new Error('User not authenticated - cannot send push notification');
        }

        if (!authToken) {
          throw new Error('No auth token available');
        }

        const result = await sendTestNotification({
          token: authToken,
          userId: user.id as any, // Convex ID
          type: selectedType,
          channels: selectedChannels,
          mode: sendMode,
          data: {
            title: title || undefined,
            body: body || undefined,
            groupId: groupId || undefined,
            communityId: communityId || undefined,
            channelId: channelId || undefined,
            shortId: shortId || undefined,
          },
          chatTarget: selectedChannels.includes('chat') ? chatTarget : undefined,
        });

        setLastResult(
          `🚀 REAL Push Notification Sent!\n\n` +
          `Environment: ${result.environment}\n` +
          `Type: ${result.notificationType}\n` +
          `Mode: ${sendMode}\n` +
          `Success: ${result.success}\n` +
          `Channels Attempted: ${result.channelsAttempted.join(', ') || 'none'}\n` +
          `Channels Succeeded: ${result.channelsSucceeded.join(', ') || 'none'}\n` +
          (result.errors.length > 0 ? `\nErrors:\n${result.errors.map((e: { channel: string; error: string }) => `  - ${e.channel}: ${e.error}`).join('\n')}\n` : '') +
          `\nPayload:\n${JSON.stringify({ type: selectedType, channels: selectedChannels, mode: sendMode, data: { title, body } }, null, 2)}`
        );
      } else {
        // Send LOCAL notification (for testing deep links only)
        await Notifications.scheduleNotificationAsync({
          content: {
            title,
            body,
            data: payload,
          },
          trigger: null, // immediate
        });

        setLastResult(
          `📱 Local Notification Sent!\n\n` +
          `⚠️ Note: This is a LOCAL notification, not a real push.\n` +
          `It does NOT test the centralized notification system.\n\n` +
          `Title: ${title}\nBody: ${body}\n\nPayload:\n${JSON.stringify(payload, null, 2)}`
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setLastResult(`Error sending notification: ${errorMessage}`);
    } finally {
      setIsSending(false);
    }
  };

  // Test deep link handler directly
  const handleTestDeepLink = async () => {
    setLastResult(null);

    try {
      const payload = buildPayload();
      setLastResult(
        `Testing deep link...\n\nPayload:\n${JSON.stringify(payload, null, 2)}`
      );

      await handleNotificationTap(payload);

      setLastResult(
        (prev) => `${prev}\n\nDeep link triggered successfully!`
      );
    } catch (error) {
      setLastResult(`Error testing deep link: ${error}`);
    }
  };

  // Preview tap handler - test deep link
  const handlePreviewPress = () => {
    handleTestDeepLink();
  };

  if (!shouldShow) {
    return (
      <UserRoute>
        <View style={[styles.container, { backgroundColor: colors.surfaceSecondary, paddingTop: insets.top }]}>
          <Text style={[styles.errorText, { color: colors.error }]}>
            This page is only available in dev/staging builds.
          </Text>
        </View>
      </UserRoute>
    );
  }

  return (
    <UserRoute>
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Notification Tester</Text>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
              Test push notifications and deep links
            </Text>
          </View>

          {/* Environment Info */}
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Environment</Text>
            <View style={[styles.infoRow, { borderBottomColor: colors.surfaceSecondary }]}>
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Environment:</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>
                {Environment.isStaging() ? 'Staging' : 'Development'}
              </Text>
            </View>
            <View style={[styles.infoRow, { borderBottomColor: colors.surfaceSecondary }]}>
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Community:</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>
                {community?.name || 'None'} (ID: {community?.id || 'N/A'})
              </Text>
            </View>
            <View style={[styles.infoRow, { borderBottomColor: colors.surfaceSecondary }]}>
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>User ID:</Text>
              <Text
                style={[styles.infoValue, { color: colors.text }, styles.tokenText]}
                numberOfLines={1}
              >
                {user?.id || 'Not authenticated'}
              </Text>
            </View>
            <View style={[styles.infoRow, { borderBottomColor: colors.surfaceSecondary }]}>
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Push Token:</Text>
              <Text
                style={[styles.infoValue, { color: colors.text }, styles.tokenText]}
                numberOfLines={1}
              >
                {expoPushToken || 'Not registered'}
              </Text>
            </View>
            {tokenDebugData && (
              <>
                <View style={[styles.infoRow, { borderBottomColor: colors.surfaceSecondary }]}>
                  <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Backend Env:</Text>
                  <Text style={[styles.infoValue, { color: colors.text }]}>
                    {tokenDebugData.currentEnvironment}
                  </Text>
                </View>

                {/* Push State - based on active tokens (single source of truth) */}
                <View style={[styles.infoRow, { backgroundColor: tokenDebugData.pushEnabled ? colors.success + '15' : colors.error + '15', marginTop: 8, borderRadius: 8, padding: 12, borderBottomColor: 'transparent' }]}>
                  <Text style={[styles.infoLabel, { color: colors.textSecondary, fontWeight: '600' }]}>Push Notifications:</Text>
                  <Text style={[
                    styles.infoValue,
                    {
                      color: tokenDebugData.pushEnabled ? colors.success : colors.error,
                      fontWeight: '600',
                    }
                  ]}>
                    {tokenDebugData.pushEnabled ? 'ENABLED' : 'DISABLED'}
                  </Text>
                </View>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4, marginBottom: 8 }}>
                  {tokenDebugData.pushEnabledReason}
                </Text>

                {/* Action buttons based on suggested action */}
                {tokenDebugData.suggestedAction === 'cleanup_legacy' && (
                  <Button
                    onPress={handleCleanupLegacyTokens}
                    loading={isCleaningUp}
                    variant="primary"
                    style={{ marginTop: 8 }}
                  >
                    Clean Up {tokenDebugData.legacyTokenCount} Legacy Token(s)
                  </Button>
                )}
                {tokenDebugData.suggestedAction === 'enable_push' && (
                  <Button
                    onPress={() => handleTogglePush(true)}
                    loading={isTogglingPush}
                    variant="primary"
                    style={{ marginTop: 8 }}
                  >
                    Enable Push Notifications
                  </Button>
                )}
                {tokenDebugData.pushEnabled && (
                  <Button
                    onPress={() => handleTogglePush(false)}
                    loading={isTogglingPush}
                    variant="secondary"
                    style={{ marginTop: 8 }}
                  >
                    Disable Push Notifications
                  </Button>
                )}

                <View style={[styles.infoRow, { marginTop: 12, borderBottomColor: colors.surfaceSecondary }]}>
                  <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Diagnosis:</Text>
                  <Text style={[
                    styles.infoValue,
                    { color: tokenDebugData.diagnosis.startsWith('OK') ? colors.success : colors.error }
                  ]}>
                    {tokenDebugData.diagnosis}
                  </Text>
                </View>
                {tokenDebugData.tokens.map((t: any, i: number) => (
                  <View key={i} style={[styles.infoRow, { flexDirection: 'column', alignItems: 'flex-start', borderBottomColor: colors.surfaceSecondary }]}>
                    <Text style={[styles.tokenText, { color: colors.text }]}>
                      Token {i + 1}: {t.environment} / {t.platform} / {t.isActive ? 'active' : 'inactive'}
                      {t.matchesCurrentEnv ? ' ✓' : ' ✗'}
                    </Text>
                  </View>
                ))}
                {!tokenDebugData.diagnosis.startsWith('OK') && expoPushToken && (
                  <Button
                    onPress={handleReregisterToken}
                    loading={isReregistering}
                    variant="secondary"
                    style={{ marginTop: 12 }}
                  >
                    Fix: Re-register Token
                  </Button>
                )}
              </>
            )}
          </Card>

          {/* Notification Type Selector */}
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Notification Type</Text>
            {typesLoading && useRealPush ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={colors.textSecondary} />
                <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading notification types...</Text>
              </View>
            ) : (
              <>
                <Select
                  label="Type"
                  placeholder="Select notification type"
                  value={selectedType}
                  options={notificationTypeOptions}
                  onSelect={(value) => setSelectedType(value as string)}
                  searchable
                />
                {getNotificationSample(selectedType) && (
                  <Text style={[styles.typeDescription, { color: colors.textSecondary }]}>
                    {getNotificationSample(selectedType)?.description}
                  </Text>
                )}
                {currentTypeDefinition && (
                  <Text style={[styles.typeChannels, { color: colors.link }]}>
                    Supports: {currentTypeDefinition.availableChannels.join(', ')}
                  </Text>
                )}
              </>
            )}
          </Card>

          {/* Multi-Channel Options (only for real push mode) */}
          {useRealPush && (
            <Card style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Channels & Mode</Text>

              {/* Channel Selection */}
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Select Channels</Text>
              <View style={styles.channelGrid}>
                {(Object.keys(CHANNEL_INFO) as NotificationChannel[]).map((channel) => {
                  const info = CHANNEL_INFO[channel];
                  const isSelected = selectedChannels.includes(channel);
                  const isAvailable = availableChannels.includes(channel);

                  return (
                    <TouchableOpacity
                      key={channel}
                      style={[
                        styles.channelChip,
                        { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                        isSelected && { backgroundColor: colors.link, borderColor: colors.link },
                        !isAvailable && { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, opacity: 0.6 },
                      ]}
                      onPress={() => toggleChannel(channel)}
                      disabled={!isAvailable}
                    >
                      <Ionicons
                        name={info.icon as any}
                        size={16}
                        color={isSelected ? colors.textInverse : isAvailable ? colors.textSecondary : colors.iconSecondary}
                      />
                      <Text
                        style={[
                          styles.channelChipText,
                          { color: colors.text },
                          isSelected && { color: colors.textInverse },
                          !isAvailable && { color: colors.textTertiary },
                        ]}
                      >
                        {info.label}
                        {info.note && <Text style={[styles.channelNote, { color: colors.textTertiary }]}> {info.note}</Text>}
                      </Text>
                      {isSelected && (
                        <Ionicons name="checkmark" size={14} color={colors.textInverse} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Mode Toggle */}
              <Text style={[styles.inputLabel, { color: colors.textSecondary, marginTop: 16 }]}>Send Mode</Text>
              <View style={[styles.modeToggle, { backgroundColor: colors.surfaceSecondary }]}>
                <TouchableOpacity
                  style={[
                    styles.modeOption,
                    sendMode === 'cascade' && [styles.modeOptionSelected, { backgroundColor: colors.surface, shadowColor: colors.shadow }],
                  ]}
                  onPress={() => setSendMode('cascade')}
                >
                  <Text
                    style={[
                      styles.modeOptionText,
                      { color: colors.textSecondary },
                      sendMode === 'cascade' && { color: colors.text },
                    ]}
                  >
                    Cascade
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modeOption,
                    sendMode === 'multi' && [styles.modeOptionSelected, { backgroundColor: colors.surface, shadowColor: colors.shadow }],
                  ]}
                  onPress={() => setSendMode('multi')}
                >
                  <Text
                    style={[
                      styles.modeOptionText,
                      { color: colors.textSecondary },
                      sendMode === 'multi' && { color: colors.text },
                    ]}
                  >
                    Multi
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.modeDescription, { color: colors.textSecondary }]}>
                {sendMode === 'cascade'
                  ? 'Stops on first successful channel'
                  : 'Sends to all selected channels'}
              </Text>

              {/* Chat Target (only when chat is selected) */}
              {selectedChannels.includes('chat') && (
                <>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary, marginTop: 16 }]}>Chat Target</Text>
                  <View style={[styles.modeToggle, { backgroundColor: colors.surfaceSecondary }]}>
                    <TouchableOpacity
                      style={[
                        styles.modeOption,
                        chatTarget === 'main' && [styles.modeOptionSelected, { backgroundColor: colors.surface, shadowColor: colors.shadow }],
                      ]}
                      onPress={() => setChatTarget('main')}
                    >
                      <Text
                        style={[
                          styles.modeOptionText,
                          { color: colors.textSecondary },
                          chatTarget === 'main' && { color: colors.text },
                        ]}
                      >
                        Main Chat
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.modeOption,
                        chatTarget === 'leaders' && [styles.modeOptionSelected, { backgroundColor: colors.surface, shadowColor: colors.shadow }],
                      ]}
                      onPress={() => setChatTarget('leaders')}
                    >
                      <Text
                        style={[
                          styles.modeOptionText,
                          { color: colors.textSecondary },
                          chatTarget === 'leaders' && { color: colors.text },
                        ]}
                      >
                        Leaders Chat
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {/* Email Preview Button (only when email is selected) */}
              {selectedChannels.includes('email') && availableChannels.includes('email') && (
                <Button
                  onPress={handleEmailPreview}
                  variant="secondary"
                  style={{ marginTop: 16 }}
                >
                  Preview Email
                </Button>
              )}
            </Card>
          )}

          {/* Content Fields */}
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Notification Content</Text>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Title</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}
                value={title}
                onChangeText={setTitle}
                placeholder="Notification title"
                placeholderTextColor={colors.textTertiary}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Body</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}
                value={body}
                onChangeText={setBody}
                placeholder="Notification body"
                placeholderTextColor={colors.textTertiary}
                multiline
                numberOfLines={3}
              />
            </View>
          </Card>

          {/* Data Fields */}
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Payload Data</Text>

            <View style={styles.inputRow}>
              <View style={styles.inputHalf}>
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Group ID</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}
                  value={groupId}
                  onChangeText={setGroupId}
                  placeholder="abc123-uuid"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>

              <View style={styles.inputHalf}>
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Community ID</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}
                  value={communityId}
                  onChangeText={setCommunityId}
                  placeholder="1"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View style={styles.inputRow}>
              <View style={styles.inputHalf}>
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Channel ID</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}
                  value={channelId}
                  onChangeText={setChannelId}
                  placeholder="Optional"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>

              <View style={styles.inputHalf}>
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Short ID (Event)</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}
                  value={shortId}
                  onChangeText={setShortId}
                  placeholder="abc123"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
            </View>
          </Card>

          {/* Live Preview */}
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Preview</Text>
            <Text style={[styles.previewHint, { color: colors.textTertiary }]}>
              Tap the preview to test the deep link
            </Text>
            <NotificationPreview
              title={title || 'Notification Title'}
              body={body || 'Notification body text...'}
              onPress={handlePreviewPress}
            />
          </Card>

          {/* Action Buttons */}
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Actions</Text>

            {/* Toggle for Real vs Local Push */}
            <View style={[styles.toggleRow, { backgroundColor: colors.selectedBackground }]}>
              <View style={styles.toggleInfo}>
                <Text style={[styles.toggleLabel, { color: colors.text }]}>
                  {useRealPush ? '🚀 Real Push' : '📱 Local Only'}
                </Text>
                <Text style={[styles.toggleDescription, { color: colors.textSecondary }]}>
                  {useRealPush
                    ? 'Uses centralized notification system (recommended)'
                    : 'Local notification - does NOT test real flow'}
                </Text>
              </View>
              <Button
                onPress={() => setUseRealPush(!useRealPush)}
                variant="secondary"
                style={styles.toggleButton}
              >
                {useRealPush ? 'Switch to Local' : 'Switch to Real'}
              </Button>
            </View>

            <Button
              onPress={handleSendNotification}
              loading={isSending}
              style={styles.actionButton}
            >
              {useRealPush ? 'Send Real Push Notification' : 'Send Local Notification'}
            </Button>

            <Button
              onPress={handleTestDeepLink}
              variant="secondary"
              style={styles.actionButton}
            >
              Test Deep Link Only
            </Button>
          </Card>

          {/* Result Display */}
          {lastResult && (
            <Card style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Result</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.resultScroll}
              >
                <Text style={[styles.resultText, { color: colors.text, backgroundColor: colors.surfaceSecondary }]}>{lastResult}</Text>
              </ScrollView>
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Email Preview Modal */}
      <Modal
        visible={showEmailPreview}
        onClose={() => setShowEmailPreview(false)}
        title="Email Preview"
      >
        {emailPreviewLoading || emailPreviewFetching ? (
          <View style={styles.emailPreviewLoading}>
            <ActivityIndicator size="large" color={colors.textSecondary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading email preview...</Text>
          </View>
        ) : emailPreviewError ? (
          <View style={styles.emailPreviewError}>
            <Ionicons name="alert-circle" size={48} color={colors.error} />
            <Text style={[styles.emailPreviewErrorText, { color: colors.textSecondary }]}>
              Failed to load email preview.{'\n'}
              {emailPreviewError.message || 'Make sure the notification type has an email formatter.'}
            </Text>
          </View>
        ) : emailPreviewData ? (
          <View style={styles.emailPreviewContent}>
            <View style={[styles.emailSubjectRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.emailSubjectLabel, { color: colors.textSecondary }]}>Subject:</Text>
              <Text style={[styles.emailSubjectValue, { color: colors.text }]}>{emailPreviewData.subject}</Text>
            </View>
            <Text style={[styles.emailHtmlLabel, { color: colors.textSecondary }]}>HTML Preview:</Text>
            <ScrollView style={[styles.emailHtmlScroll, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.emailHtmlText, { color: colors.text }]}>{emailPreviewData.html}</Text>
            </ScrollView>
            <Text style={[styles.emailHtmlNote, { color: colors.textTertiary }]}>
              Note: Install react-native-webview for rendered preview
            </Text>
          </View>
        ) : (
          <View style={styles.emailPreviewError}>
            <Ionicons name="alert-circle" size={48} color={colors.error} />
            <Text style={[styles.emailPreviewErrorText, { color: colors.textSecondary }]}>
              Failed to load email preview.{'\n'}
              Make sure the notification type has an email formatter.
            </Text>
          </View>
        )}
      </Modal>
    </UserRoute>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  header: {
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    fontSize: 15,
    marginTop: 4,
  },
  section: {
    marginBottom: 16,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  infoLabel: {
    fontSize: 14,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
  tokenText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  loadingText: {
    fontSize: 14,
    marginLeft: 8,
  },
  typeDescription: {
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: 8,
  },
  typeChannels: {
    fontSize: 12,
    marginTop: 4,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  inputHalf: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  // Channel selection styles
  channelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  channelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  channelChipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  channelNote: {
    fontSize: 11,
  },
  // Mode toggle styles
  modeToggle: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 4,
    marginTop: 8,
  },
  modeOption: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: 'center',
  },
  modeOptionSelected: {
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.1)',
      },
      default: {
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
      },
    }),
  },
  modeOptionText: {
    fontSize: 14,
    fontWeight: '500',
  },
  modeDescription: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 8,
    textAlign: 'center',
  },
  previewHint: {
    fontSize: 12,
    marginBottom: 12,
    fontStyle: 'italic',
  },
  actionButton: {
    marginBottom: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 12,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  toggleDescription: {
    fontSize: 12,
    marginTop: 2,
  },
  toggleButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  resultScroll: {
    maxHeight: 200,
  },
  resultText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    padding: 12,
    borderRadius: 8,
    minWidth: '100%',
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    padding: 20,
  },
  // Email preview modal styles
  emailPreviewLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emailPreviewContent: {
    flex: 1,
  },
  emailSubjectRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  emailSubjectLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,
  },
  emailSubjectValue: {
    fontSize: 14,
    flex: 1,
  },
  emailHtmlLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  emailHtmlScroll: {
    maxHeight: 300,
    borderRadius: 8,
    padding: 12,
  },
  emailHtmlText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
  },
  emailHtmlNote: {
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 8,
    textAlign: 'center',
  },
  emailPreviewError: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emailPreviewErrorText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 16,
  },
});
