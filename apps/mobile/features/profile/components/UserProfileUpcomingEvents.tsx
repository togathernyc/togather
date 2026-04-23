/**
 * Upcoming events the profile user is hosting or attending, filtered by
 * visibility on the backend. Each row reuses `EventCardRow` and wears a
 * "Hosting" / "Going" badge overlay based on the `role` field on the card.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { EventCardRow } from '@features/events/components/EventCardRow';
import type { UpcomingEvent } from '../hooks/useUserProfile';

interface UserProfileUpcomingEventsProps {
  events: UpcomingEvent[];
}

export function UserProfileUpcomingEvents({
  events,
}: UserProfileUpcomingEventsProps) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  if (events.length === 0) return null;

  return (
    <View>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Upcoming events
      </Text>
      <View style={styles.list}>
        {events.map((card, index) => {
          // CWE cards have no id/single-event shape; route via representativeShortId.
          if (card.kind === 'community_wide') {
            // Render a minimal hint row for CWE. Rare on profile pages since
            // CWEs are authored by admins and most users won't "host" one.
            return null;
          }

          const role = (card as UpcomingEvent & { role?: 'hosting' | 'attending' }).role;
          const badgeText =
            role === 'hosting' ? 'Hosting' : role === 'attending' ? 'Going' : null;

          return (
            <View key={String(card.id) || index} style={styles.rowWrapper}>
              <EventCardRow event={card as any} />
              {badgeText && (
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor:
                        role === 'hosting'
                          ? primaryColor
                          : colors.backgroundSecondary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      {
                        color:
                          role === 'hosting' ? '#FFFFFF' : colors.textSecondary,
                      },
                    ]}
                  >
                    {badgeText}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  list: {
    gap: 8,
  },
  rowWrapper: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: 8,
    right: 36, // leave room for the trailing chevron
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
