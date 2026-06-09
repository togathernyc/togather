/**
 * AvailabilityRequestCard — visual availability-request surface rendered
 * inside a chat message.
 *
 * Pure presentational component: receives the resolved request (optional
 * leader message + the group's upcoming events with the viewer's current
 * status) and a `onSetStatus(planId, status)` callback. The data wrapper
 * (AvailabilityRequestCardFromMessage) owns the mutations and the busy state;
 * this component just draws pills and surfaces taps.
 *
 * Mirrors PollCard's visual density: rounded card, themed surface, compact
 * rows. Each event shows a title + date/time line on the left and two pill
 * buttons ("Available" / "Can't") on the right. The selected pill is filled.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '@hooks/useTheme';
import type { Id } from '@services/api/convex';

export interface AvailabilityRequestEvent {
  _id: Id<'eventPlans'>;
  title: string;
  eventDate: number;
  times: Array<{ label: string; startsAt: number }>;
  myStatus: 'available' | 'unavailable' | null;
}

export interface AvailabilityRequestCardProps {
  message?: string;
  events: AvailabilityRequestEvent[];
  busyPlanId: string | null;
  onSetStatus: (planId: Id<'eventPlans'>, status: 'available' | 'unavailable') => void;
  /** Opens the full "My Availability" page for the request's group, if wired. */
  onOpenPage?: () => void;
  /** Public `/a/<token>` URL; when set, a "Copy link" button is shown. */
  copyLinkUrl?: string;
}

function formatEventDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function AvailabilityRequestCard({
  message,
  events,
  busyPlanId,
  onSetStatus,
  onOpenPage,
  copyLinkUrl,
}: AvailabilityRequestCardProps) {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);

  const availableCount = useMemo(
    () => events.filter((e) => e.myStatus === 'available').length,
    [events],
  );

  const handleCopy = useCallback(async () => {
    if (!copyLinkUrl) return;
    await Clipboard.setStringAsync(copyLinkUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [copyLinkUrl]);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surfaceSecondary,
          borderColor: colors.border,
        },
      ]}
    >
      {/* Header */}
      <View style={styles.headerBadgeRow}>
        <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
        <Text style={[styles.headerBadge, { color: colors.textSecondary }]}>Availability</Text>
      </View>

      {/* Optional leader note */}
      {message ? (
        <Text style={[styles.message, { color: colors.text }]}>{message}</Text>
      ) : null}

      {/* Summary line */}
      <Text style={[styles.summary, { color: colors.textSecondary }]}>
        {`You're available for ${availableCount} of ${events.length}`}
      </Text>

      {/* Events */}
      <View style={styles.events}>
        {events.map((event) => {
          const dateLine = [
            formatEventDate(event.eventDate),
            event.times.map((t) => t.label).join(', '),
          ]
            .filter(Boolean)
            .join(' · ');
          const isBusy = busyPlanId === event._id;
          const isAvailable = event.myStatus === 'available';
          const isUnavailable = event.myStatus === 'unavailable';

          return (
            <View key={event._id} style={styles.eventRow}>
              <View style={styles.eventTextWrap}>
                <Text style={[styles.eventTitle, { color: colors.text }]} numberOfLines={2}>
                  {event.title}
                </Text>
                {dateLine ? (
                  <Text
                    style={[styles.eventDate, { color: colors.textTertiary }]}
                    numberOfLines={2}
                  >
                    {dateLine}
                  </Text>
                ) : null}
              </View>

              <View style={styles.pills}>
                {isBusy ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : (
                  <>
                    <Pressable
                      onPress={() => onSetStatus(event._id, 'available')}
                      hitSlop={4}
                      style={({ pressed }) => [
                        styles.pill,
                        {
                          backgroundColor: isAvailable ? colors.success : 'transparent',
                          borderColor: isAvailable ? colors.success : colors.border,
                        },
                        pressed && styles.pillPressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.pillLabel,
                          { color: isAvailable ? '#fff' : colors.textSecondary },
                        ]}
                      >
                        Available
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => onSetStatus(event._id, 'unavailable')}
                      hitSlop={4}
                      style={({ pressed }) => [
                        styles.pill,
                        {
                          backgroundColor: isUnavailable ? colors.destructive : 'transparent',
                          borderColor: isUnavailable ? colors.destructive : colors.border,
                        },
                        pressed && styles.pillPressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.pillLabel,
                          { color: isUnavailable ? '#fff' : colors.textSecondary },
                        ]}
                      >
                        Can't
                      </Text>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          );
        })}
      </View>

      {/* Footer: copy the shareable link + open the full page. */}
      {copyLinkUrl || onOpenPage ? (
        <View style={[styles.footerRow, { borderTopColor: colors.border }]}>
          {copyLinkUrl ? (
            <Pressable onPress={handleCopy} hitSlop={6} style={styles.footer}>
              <Ionicons
                name={copied ? 'checkmark' : 'link-outline'}
                size={14}
                color={colors.link}
              />
              <Text style={[styles.footerText, { color: colors.link }]}>
                {copied ? 'Copied' : 'Copy link'}
              </Text>
            </Pressable>
          ) : (
            <View />
          )}
          {onOpenPage ? (
            <Pressable onPress={onOpenPage} hitSlop={6} style={styles.footer}>
              <Text style={[styles.footerText, { color: colors.link }]}>
                Manage all upcoming
              </Text>
              <Ionicons name="chevron-forward" size={13} color={colors.link} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    minWidth: 240,
    maxWidth: 360,
  },
  headerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  headerBadge: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  message: {
    fontSize: 14,
    lineHeight: 19,
    marginTop: 2,
  },
  summary: {
    fontSize: 12,
    marginTop: 6,
  },
  events: {
    marginTop: 12,
    gap: 10,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eventTextWrap: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  eventDate: {
    fontSize: 12,
    marginTop: 2,
  },
  pills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 56,
    justifyContent: 'flex-end',
  },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillPressed: {
    opacity: 0.7,
  },
  pillLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  footerText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
