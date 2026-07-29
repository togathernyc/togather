import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useWhatsappShell } from '@hooks/useWhatsappShell';
import {
  WA_GROUP_RADIUS,
  WA_TYPE_HEADER_BLOCK,
  WA_TYPE_LARGE_TITLE,
  WA_TYPE_ROW_TITLE,
  WA_TYPE_SUBTITLE,
  WA_WEIGHT_BOLD,
  WA_WEIGHT_LARGE_TITLE,
  WA_WEIGHT_REGULAR,
  WA_WEIGHT_SEMIBOLD,
} from '@components/wa';
import { useAuthenticatedMutation, api } from '@services/api/convex';
import { formatError } from '@/utils/error-handling';
import { CrisisResourceCard } from './CrisisResourceCard';
import type { PrayerCardData } from './PrayerCard';

const TIMER_SECONDS = 180;
const CONFIRM_HOLD_MS = 1000;
const COMPLETED_GREEN = '#34C759';

interface Props {
  prayer: PrayerCardData | null;
  visible: boolean;
  onClose: () => void;
  onPrayed: () => void;
}

/**
 * 3-minute trust-based prayer session.
 *
 * Timer continues counting regardless of foreground/background — closing
 * the modal only cancels the visual countdown, it doesn't punish the user.
 * "I prayed, mark done" is enabled at any time. Auto-fires at 0:00.
 *
 * After the mutation lands, the modal stays open for ~1s with a checkmark
 * + "Prayed for {Name}" so the action feels real before the next card
 * slides in. Without this beat, the feed advance is invisible and users
 * don't trust they did anything.
 */
export function PraySession({ prayer, visible, onClose, onPrayed }: Props) {
  const { colors } = useTheme();
  const wa = useWhatsappShell();
  const { primaryColor } = useCommunityTheme();
  const [secondsLeft, setSecondsLeft] = useState(TIMER_SECONDS);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const submittedRef = useRef(false);
  const recordSession = useAuthenticatedMutation(
    api.functions.prayers.recordPrayerSession,
  );

  useEffect(() => {
    if (!visible || !prayer) return;
    setSecondsLeft(TIMER_SECONDS);
    setShowConfirm(false);
    submittedRef.current = false;

    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const remaining = Math.max(0, TIMER_SECONDS - elapsed);
      setSecondsLeft(remaining);
      if (remaining === 0) {
        clearInterval(interval);
        void handleMarkPrayed(true);
      }
    }, 250);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleMarkPrayed is stable enough; visible/prayer drive lifecycle
  }, [visible, prayer?.id]);

  const handleMarkPrayed = async (_auto = false) => {
    if (!prayer || submittedRef.current) return;
    submittedRef.current = true;
    setIsSubmitting(true);
    try {
      await recordSession({ prayerId: prayer.id });
      setShowConfirm(true);
      // Hold the confirmation for a beat, then advance.
      setTimeout(() => {
        onPrayed();
      }, CONFIRM_HOLD_MS);
    } catch (e) {
      submittedRef.current = false;
      Alert.alert('Error', formatError(e, 'Could not record your prayer'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!prayer) return null;

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeLabel = `${mins}:${secs.toString().padStart(2, '0')}`;
  const progress = 1 - secondsLeft / TIMER_SECONDS;
  const confirmTarget = prayer.authorDisplayName ?? 'your community';

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {showConfirm ? (
          <View style={[styles.confirmSheet, wa && waStyles.sheet, { backgroundColor: colors.surface }]}>
            <View
              style={[
                styles.confirmCircle,
                // The confirmation disc is the accent moment of the pray flow
                // (S5.1 "primary CTA"), so flag-on it takes the community
                // accent rather than iOS system green.
                { backgroundColor: wa ? primaryColor : COMPLETED_GREEN },
              ]}
            >
              <Ionicons name="checkmark" size={40} color="#fff" />
            </View>
            <Text style={[styles.confirmTitle, wa && waStyles.confirmTitle, { color: colors.text }]}>
              Prayed for {confirmTarget}
            </Text>
            <Text
              style={[styles.confirmBody, wa && waStyles.confirmBody, { color: colors.textSecondary }]}
            >
              Your prayer was sent.
            </Text>
          </View>
        ) : (
          <View style={[styles.sheet, wa && waStyles.sheet, { backgroundColor: colors.surface }]}>
            <View style={styles.headerRow}>
              <Text style={[styles.title, wa && waStyles.title, { color: colors.text }]}>
                Praying
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <Ionicons name="close" size={24} color={wa ? colors.text : colors.iconSecondary} />
              </TouchableOpacity>
            </View>

            {prayer.crisisFlag ? <CrisisResourceCard /> : null}
            <Text style={[styles.body, wa && waStyles.body, { color: colors.text }]}>
              {prayer.bodyText}
            </Text>

            <View style={styles.timerContainer}>
              <View style={[styles.progressTrack, { backgroundColor: colors.surfaceSecondary }]}>
                <View
                  style={[
                    styles.progressFill,
                    { backgroundColor: primaryColor, width: `${Math.min(100, progress * 100)}%` },
                  ]}
                />
              </View>
              <Text style={[styles.timeText, wa && waStyles.timeText, { color: colors.text }]}>
                {timeLabel}
              </Text>
              <Text
                style={[styles.helperText, wa && waStyles.helperText, { color: colors.textTertiary }]}
              >
                Take 3 minutes to pray for this request.
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.doneButton,
                wa && waStyles.doneButton,
                { backgroundColor: primaryColor },
                isSubmitting && { opacity: 0.6 },
              ]}
              onPress={() => handleMarkPrayed(false)}
              disabled={isSubmitting}
              activeOpacity={0.85}
            >
              <Text style={[styles.doneButtonText, wa && waStyles.doneButtonText]}>
                {secondsLeft > 0 ? 'I prayed, mark done' : 'Done'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  sheet: {
    borderRadius: 20,
    padding: 24,
  },
  confirmSheet: {
    borderRadius: 20,
    paddingVertical: 36,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  confirmCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  confirmTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  confirmBody: {
    fontSize: 14,
    textAlign: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  body: {
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 24,
  },
  timerContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressFill: {
    height: '100%',
  },
  timeText: {
    fontSize: 36,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginBottom: 8,
  },
  helperText: {
    fontSize: 13,
    textAlign: 'center',
  },
  doneButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  doneButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

/**
 * whatsapp-shell skin for the pray-session modal: WA card radius, the S7 type
 * scale (22pt bold header block, 17pt body, 34pt heavy timer numeral) and the
 * done CTA as a fully-rounded accent pill.
 */
const waStyles = StyleSheet.create({
  sheet: { borderRadius: WA_GROUP_RADIUS },
  title: { fontSize: WA_TYPE_HEADER_BLOCK, fontWeight: WA_WEIGHT_BOLD },
  body: { fontSize: WA_TYPE_ROW_TITLE, fontWeight: WA_WEIGHT_REGULAR, lineHeight: 25 },
  timeText: { fontSize: WA_TYPE_LARGE_TITLE, fontWeight: WA_WEIGHT_LARGE_TITLE },
  helperText: { fontSize: WA_TYPE_SUBTITLE },
  doneButton: { borderRadius: 26, paddingVertical: 15 },
  doneButtonText: { fontSize: WA_TYPE_ROW_TITLE, fontWeight: WA_WEIGHT_SEMIBOLD },
  confirmTitle: { fontSize: WA_TYPE_HEADER_BLOCK, fontWeight: WA_WEIGHT_BOLD },
  confirmBody: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_REGULAR },
});
