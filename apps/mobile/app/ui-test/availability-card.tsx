/**
 * Browser preview for AvailabilityRequestCard layout.
 * Visit /ui-test/availability-card when running Expo web.
 */
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@hooks/useTheme';
import { AvailabilityRequestCard } from '@features/chat/components/AvailabilityRequestCard';
import type { AvailabilityRequestEvent } from '@features/chat/components/AvailabilityRequestCard';
import type { Id } from '@services/api/convex';

const FAKE_EVENTS: AvailabilityRequestEvent[] = [
  {
    _id: 'plan-1' as Id<'eventPlans'>,
    title: 'MH Service 7/5',
    eventDate: new Date('2025-07-05T10:00:00').getTime(),
    times: [
      { label: '10:00 AM', startsAt: new Date('2025-07-05T10:00:00').getTime() },
      { label: '12:00 PM', startsAt: new Date('2025-07-05T12:00:00').getTime() },
    ],
    myStatus: 'available',
  },
  {
    _id: 'plan-2' as Id<'eventPlans'>,
    title: 'MH Service 7/12',
    eventDate: new Date('2025-07-12T10:00:00').getTime(),
    times: [
      { label: '10:00 AM', startsAt: new Date('2025-07-12T10:00:00').getTime() },
      { label: '12:00 PM', startsAt: new Date('2025-07-12T12:00:00').getTime() },
    ],
    myStatus: 'available',
  },
  {
    _id: 'plan-3' as Id<'eventPlans'>,
    title: 'MH Service 7/19',
    eventDate: new Date('2025-07-19T10:00:00').getTime(),
    times: [
      { label: '10:00 AM', startsAt: new Date('2025-07-19T10:00:00').getTime() },
      { label: '12:00 PM', startsAt: new Date('2025-07-19T12:00:00').getTime() },
    ],
    myStatus: 'available',
  },
  {
    _id: 'plan-4' as Id<'eventPlans'>,
    title: 'MH Service 7/26 with extended rehearsal and sound check',
    eventDate: new Date('2025-07-26T10:00:00').getTime(),
    times: [
      { label: '10:00 AM', startsAt: new Date('2025-07-26T10:00:00').getTime() },
      { label: '12:00 PM', startsAt: new Date('2025-07-26T12:00:00').getTime() },
      { label: '2:00 PM', startsAt: new Date('2025-07-26T14:00:00').getTime() },
    ],
    myStatus: null,
  },
  {
    _id: 'plan-5' as Id<'eventPlans'>,
    title: 'MH Service 8/2',
    eventDate: new Date('2025-08-02T10:00:00').getTime(),
    times: [
      { label: '10:00 AM', startsAt: new Date('2025-08-02T10:00:00').getTime() },
      { label: '12:00 PM', startsAt: new Date('2025-08-02T12:00:00').getTime() },
    ],
    myStatus: 'unavailable',
  },
];

export default function AvailabilityCardPreviewScreen() {
  const { colors } = useTheme();
  const [events, setEvents] = useState(FAKE_EVENTS);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);

  const onSetStatus = useCallback(
    (planId: Id<'eventPlans'>, status: 'available' | 'unavailable') => {
      setBusyPlanId(planId);
      setEvents((current) =>
        current.map((event) =>
          event._id === planId
            ? { ...event, myStatus: event.myStatus === status ? null : status }
            : event,
        ),
      );
      setBusyPlanId(null);
    },
    [],
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}
      contentContainerStyle={styles.content}
      testID="availability-card-preview"
    >
      <Text style={[styles.title, { color: colors.text }]}>Availability Card Preview</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Fake chat data — stacked layout with long titles and multi-slot times
      </Text>

      <View style={[styles.chatColumn, { maxWidth: 320 }]}>
        <AvailabilityRequestCard
          message="When can everyone serve this month?"
          events={events}
          busyPlanId={busyPlanId}
          onSetStatus={onSetStatus}
          copyLinkUrl="https://togather.nyc/a/demo-token"
          onOpenPage={() => undefined}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 48,
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
    alignSelf: 'flex-start',
    width: '100%',
    maxWidth: 360,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 20,
    alignSelf: 'flex-start',
    width: '100%',
    maxWidth: 360,
  },
  chatColumn: {
    width: '100%',
    alignSelf: 'center',
  },
});
