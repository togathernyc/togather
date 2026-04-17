/**
 * ReportEventSheet
 *
 * Modal form for reporting a meeting. ADR-022: any community member can
 * report; reports route to the group leaders. We use a RN Modal here (not
 * `@gorhom/bottom-sheet`) because the content is a short form with keyboard
 * input — a centered modal behaves better for that on both iOS and the web.
 */

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import { api, useAuthenticatedMutation } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { useAnalytics } from '@services/analytics';

type Reason = 'spam' | 'inappropriate' | 'other';

interface ReportEventSheetProps {
  visible: boolean;
  meetingId: Id<'meetings'> | null;
  onClose: () => void;
  onReported?: () => void;
}

const REASON_OPTIONS: Array<{ key: Reason; label: string }> = [
  { key: 'spam', label: 'Spam' },
  { key: 'inappropriate', label: 'Inappropriate' },
  { key: 'other', label: 'Other' },
];

export function ReportEventSheet({
  visible,
  meetingId,
  onClose,
  onReported,
}: ReportEventSheetProps) {
  const { colors } = useTheme();
  const analytics = useAnalytics();
  const [reason, setReason] = useState<Reason>('spam');
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reportMutation = useAuthenticatedMutation(
    api.functions.meetings.reports.createReport
  );

  const reset = () => {
    setReason('spam');
    setDetails('');
  };

  const handleSubmit = async () => {
    if (!meetingId) return;
    setIsSubmitting(true);
    try {
      await reportMutation({
        meetingId,
        reason,
        details: details.trim() || undefined,
      });
      // ADR-022 analytics. `reporter_role` is left coarse here — we don't
      // know the user's per-group role at sheet open time, and the sheet
      // fires across contexts. Consumers should enrich from event properties.
      analytics.capture('event_reported', {
        event_id: meetingId,
        reason,
      });
      reset();
      onClose();
      onReported?.();
      Alert.alert(
        'Report submitted',
        "Thanks — group leaders will review this event."
      );
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to submit report.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <TouchableOpacity
          testID="report-backdrop"
          activeOpacity={1}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: colors.text }]}>
              Report this event
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.description, { color: colors.textSecondary }]}>
            Tell the group leaders what's wrong. Your identity is visible to
            them.
          </Text>

          <View style={styles.reasons}>
            {REASON_OPTIONS.map((opt) => {
              const active = reason === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  onPress={() => setReason(opt.key)}
                  activeOpacity={0.7}
                  style={[
                    styles.reasonRow,
                    { borderBottomColor: colors.border },
                  ]}
                >
                  <Text style={[styles.reasonLabel, { color: colors.text }]}>
                    {opt.label}
                  </Text>
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={active ? colors.link : colors.textSecondary}
                  />
                </TouchableOpacity>
              );
            })}
          </View>

          <TextInput
            style={[
              styles.detailsInput,
              {
                borderColor: colors.inputBorder,
                backgroundColor: colors.inputBackground,
                color: colors.text,
              },
            ]}
            placeholder="Optional — add any details that'll help moderators"
            placeholderTextColor={colors.inputPlaceholder}
            value={details}
            onChangeText={setDetails}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            editable={!isSubmitting}
            maxLength={500}
          />

          <View style={styles.actions}>
            <TouchableOpacity
              onPress={onClose}
              disabled={isSubmitting}
              style={[styles.button, { borderColor: colors.border }]}
            >
              <Text style={[styles.buttonText, { color: colors.text }]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="submit-report"
              onPress={handleSubmit}
              disabled={isSubmitting || !meetingId}
              style={[
                styles.button,
                styles.submitButton,
                { backgroundColor: colors.destructive },
                isSubmitting && { opacity: 0.7 },
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[styles.buttonText, { color: '#fff' }]}>
                  Submit report
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  description: {
    fontSize: 14,
    marginTop: 8,
    marginBottom: 16,
  },
  reasons: {
    marginBottom: 16,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  reasonLabel: {
    fontSize: 16,
  },
  detailsInput: {
    minHeight: 80,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    justifyContent: 'flex-end',
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 100,
    alignItems: 'center',
  },
  submitButton: {
    borderColor: 'transparent',
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
