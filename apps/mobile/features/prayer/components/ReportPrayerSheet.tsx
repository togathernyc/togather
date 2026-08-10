/**
 * Member-facing report sheet.
 *
 * Final defense layer after the LLM moderator + author-side nudges. Any
 * community member can flag a prayer they're seeing. The reasons are a
 * predefined list — keeps the response taxonomy clean for admin triage
 * and means the reporter doesn't have to find words for something
 * uncomfortable. The optional note is for context, not required.
 *
 * After submission, the prayer disappears from the reporter's feed and
 * an admin notification fires. Idempotent on the backend per
 * (prayer, reporter).
 *
 * Privacy: the reporter's identity goes to community admins, not to the
 * prayer's author. We disclose this in the sheet so no one is surprised.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useAuthenticatedMutation, api } from '@services/api/convex';
import { formatError } from '@/utils/error-handling';
import type { Id } from '@services/api/convex';

const MAX_NOTE = 300;

type ReasonId =
  | 'names_person'
  | 'intimate_explicit'
  | 'spam_solicitation'
  | 'hateful'
  | 'crisis_needs_resources'
  | 'other';

interface ReasonOption {
  id: ReasonId;
  label: string;
  helper: string;
}

const REASONS: ReasonOption[] = [
  {
    id: 'names_person',
    label: 'Names a specific person',
    helper: 'Uses a real name or identifying detail about someone else.',
  },
  {
    id: 'intimate_explicit',
    label: 'Too intimate or explicit',
    helper: 'Shares details that don\'t belong on a public feed.',
  },
  {
    id: 'spam_solicitation',
    label: 'Spam or solicitation',
    helper: 'Promotes a product, fundraiser, or business.',
  },
  {
    id: 'hateful',
    label: 'Hateful or hurtful',
    helper: 'Slurs, hateful framing, or targeted attacks.',
  },
  {
    id: 'crisis_needs_resources',
    label: 'Needs crisis resources',
    helper: 'Author describes a crisis without a resource link attached.',
  },
  {
    id: 'other',
    label: 'Something else',
    helper: 'Use the note below to explain.',
  },
];

interface Props {
  prayerId: Id<'prayers'> | null;
  visible: boolean;
  onClose: () => void;
  onReported: () => void;
}

export function ReportPrayerSheet({ prayerId, visible, onClose, onReported }: Props) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const [reason, setReason] = useState<ReasonId | null>(null);
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const reportPrayer = useAuthenticatedMutation(api.functions.prayers.reportPrayer);

  useEffect(() => {
    if (visible) {
      setReason(null);
      setNote('');
    }
  }, [visible]);

  const handleSubmit = async () => {
    if (!prayerId || !reason) return;
    setIsSubmitting(true);
    try {
      await reportPrayer({
        prayerId,
        reason,
        customNote: note.trim() || undefined,
      });
      onReported();
      onClose();
      // Soft acknowledgement — no celebration here. Reporting is a serious act.
      Alert.alert('Thanks for reporting', 'A community admin will review this prayer.');
    } catch (e) {
      Alert.alert('Error', formatError(e, 'Could not submit your report'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!prayerId) return null;

  const charsLeft = MAX_NOTE - note.length;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: colors.text }]}>Report this prayer</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12} disabled={isSubmitting}>
              <Ionicons name="close" size={24} color={colors.iconSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Why are you reporting this?
          </Text>

          {REASONS.map((r) => {
            const selected = reason === r.id;
            return (
              <TouchableOpacity
                key={r.id}
                onPress={() => setReason(r.id)}
                style={[
                  styles.reasonRow,
                  {
                    borderColor: selected ? primaryColor : colors.border,
                    backgroundColor: selected ? `${primaryColor}11` : 'transparent',
                  },
                ]}
                activeOpacity={0.85}
                disabled={isSubmitting}
              >
                <View
                  style={[
                    styles.radio,
                    {
                      borderColor: selected ? primaryColor : colors.border,
                      backgroundColor: selected ? primaryColor : 'transparent',
                    },
                  ]}
                >
                  {selected ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.reasonLabel, { color: colors.text }]}>{r.label}</Text>
                  <Text style={[styles.reasonHelper, { color: colors.textTertiary }]}>
                    {r.helper}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}

          <TextInput
            style={[
              styles.noteInput,
              {
                backgroundColor: colors.inputBackground,
                color: colors.text,
                borderColor: colors.inputBorder,
              },
            ]}
            value={note}
            onChangeText={setNote}
            placeholder="Anything else the admin should know? (Optional)"
            placeholderTextColor={colors.inputPlaceholder}
            multiline
            maxLength={MAX_NOTE}
            editable={!isSubmitting}
          />
          <Text style={[styles.charCount, { color: colors.textTertiary }]}>
            {charsLeft} left
          </Text>

          <Text style={[styles.privacyDisclosure, { color: colors.textTertiary }]}>
            Your name is shared with community admins for follow-up. It is not shared with
            the prayer's author.
          </Text>

          <TouchableOpacity
            style={[
              styles.submitButton,
              {
                backgroundColor: primaryColor,
                opacity: !reason || isSubmitting ? 0.5 : 1,
              },
            ]}
            onPress={handleSubmit}
            disabled={!reason || isSubmitting}
            activeOpacity={0.85}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitText}>Submit report</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: { fontSize: 18, fontWeight: '700' },
  subtitle: { fontSize: 13, marginBottom: 12 },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 8,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  reasonLabel: { fontSize: 14, fontWeight: '600' },
  reasonHelper: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  noteInput: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 11,
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 12,
  },
  privacyDisclosure: {
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 14,
  },
  submitButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
