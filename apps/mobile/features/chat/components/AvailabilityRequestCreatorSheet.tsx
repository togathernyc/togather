/**
 * AvailabilityRequestCreatorSheet — leader composer modal for sending an
 * in-chat availability request.
 *
 * Mirrors PollCreatorSheet's modal shell. A leader writes an optional note;
 * on Send the backend (`sendAvailabilityRequest`) gathers the group's
 * upcoming events and posts an availability card into the channel. The
 * backend may reject (no upcoming events / not a leader / not a group
 * channel) — those messages surface via Alert.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Id } from '@services/api/convex';
import { api, useAuthenticatedMutation } from '@services/api/convex';
import { useTheme } from '@hooks/useTheme';

const MAX_MESSAGE_LENGTH = 280;

interface Props {
  visible: boolean;
  channelId: Id<'chatChannels'>;
  onClose: () => void;
}

export function AvailabilityRequestCreatorSheet({ visible, channelId, onClose }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const sendAvailabilityRequest = useAuthenticatedMutation(
    api.functions.messaging.availabilityRequests.sendAvailabilityRequest,
  );

  // Reset the draft whenever the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setMessage('');
    setSubmitting(false);
  }, [visible]);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await sendAvailabilityRequest({
        channelId,
        message: message.trim() || undefined,
      });
      onClose();
    } catch (e) {
      const err = e as { data?: { message?: string }; message?: string };
      Alert.alert('Error', err?.data?.message ?? err?.message ?? 'Failed to send request');
      setSubmitting(false);
    }
  }, [submitting, sendAvailabilityRequest, channelId, message, onClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        {/* Header */}
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              paddingTop: Math.max(insets.top, 12),
            },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={8} disabled={submitting}>
            <Text style={[styles.headerAction, { color: colors.link }]}>Cancel</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Request availability</Text>
          <Pressable onPress={handleSubmit} hitSlop={8} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator size="small" color={colors.link} />
            ) : (
              <Text
                style={[styles.headerAction, styles.headerActionPrimary, { color: colors.link }]}
              >
                Send
              </Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>NOTE</Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Add a note (optional) — e.g. 'Mark which Sundays you can serve.'"
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={MAX_MESSAGE_LENGTH}
            style={[
              styles.messageInput,
              {
                color: colors.text,
                backgroundColor: colors.inputBackground,
                borderColor: colors.border,
              },
            ]}
            editable={!submitting}
          />

          <Text style={[styles.helper, { color: colors.textSecondary }]}>
            This posts a card listing the group's upcoming events. Members can mark whether they're
            available for each one.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  headerAction: {
    fontSize: 16,
  },
  headerActionPrimary: {
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 48,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  messageInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  helper: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 16,
  },
});
