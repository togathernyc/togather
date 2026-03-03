/**
 * EventsListView Component
 *
 * Displays a list of community events grouped by date sections.
 * Sections: Today, Tomorrow, This Week, Later
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  SectionList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants';
import { EventCard } from './EventCard';
import type { CommunityEvent } from '../hooks/useCommunityEvents';

interface EventsListViewProps {
  events: CommunityEvent[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onEventPress?: (event: CommunityEvent) => void;
  onRefresh?: () => void;
  isLoading?: boolean;
  isRefreshing?: boolean;
}

interface Section {
  title: string;
  data: CommunityEvent[];
}

/**
 * Groups events by date sections: Today, Tomorrow, This Week, Later
 */
function groupEventsByDateSection(events: CommunityEvent[]): Section[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const startOfDayAfterTomorrow = new Date(startOfToday);
  startOfDayAfterTomorrow.setDate(startOfDayAfterTomorrow.getDate() + 2);
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));

  const today: CommunityEvent[] = [];
  const tomorrow: CommunityEvent[] = [];
  const thisWeek: CommunityEvent[] = [];
  const later: CommunityEvent[] = [];

  events.forEach((event) => {
    const eventDate = new Date(event.scheduledAt);
    if (eventDate >= startOfToday && eventDate < startOfTomorrow) {
      today.push(event);
    } else if (eventDate >= startOfTomorrow && eventDate < startOfDayAfterTomorrow) {
      tomorrow.push(event);
    } else if (eventDate >= startOfDayAfterTomorrow && eventDate < endOfWeek) {
      thisWeek.push(event);
    } else if (eventDate >= endOfWeek) {
      later.push(event);
    }
  });

  const sections: Section[] = [];
  if (today.length > 0) sections.push({ title: 'TODAY', data: today });
  if (tomorrow.length > 0) sections.push({ title: 'TOMORROW', data: tomorrow });
  if (thisWeek.length > 0) sections.push({ title: 'THIS WEEK', data: thisWeek });
  if (later.length > 0) sections.push({ title: 'COMING UP', data: later });

  return sections;
}

export function EventsListView({
  events,
  searchQuery,
  onSearchChange,
  onEventPress,
  onRefresh,
  isLoading,
  isRefreshing,
}: EventsListViewProps) {
  // Filter events based on search query
  const filteredEvents = useMemo(() => {
    if (!searchQuery.trim()) return events;

    const query = searchQuery.toLowerCase();
    return events.filter((event) => {
      const title = (event.title || '').toLowerCase();
      const groupName = event.group.name.toLowerCase();
      const location = (event.locationOverride || '').toLowerCase();
      return title.includes(query) || groupName.includes(query) || location.includes(query);
    });
  }, [events, searchQuery]);

  // Group events into sections
  const sections = useMemo(() => groupEventsByDateSection(filteredEvents), [filteredEvents]);

  const renderSectionHeader = ({ section }: { section: Section }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{section.title}</Text>
      <Text style={styles.sectionCount}>{section.data.length}</Text>
    </View>
  );

  const renderItem = ({ item }: { item: CommunityEvent }) => (
    <EventCard event={item} onPress={onEventPress ? () => onEventPress(item) : undefined} />
  );

  const renderEmpty = () => {
    if (isLoading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.emptyText}>Loading events...</Text>
        </View>
      );
    }

    if (searchQuery.trim()) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="search-outline" size={48} color={COLORS.textMuted} />
          <Text style={styles.emptyTitle}>No events found</Text>
          <Text style={styles.emptyText}>Try adjusting your search or filters</Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="calendar-outline" size={48} color={COLORS.textMuted} />
        <Text style={styles.emptyTitle}>No upcoming events</Text>
        <Text style={styles.emptyText}>Check back later for new events</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputWrapper}>
          <Ionicons
            name="search"
            size={20}
            color={COLORS.textMuted}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search events by name, group, or location..."
            placeholderTextColor={COLORS.textMuted}
            value={searchQuery}
            onChangeText={onSearchChange}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <Ionicons
              name="close-circle"
              size={20}
              color={COLORS.textMuted}
              style={styles.clearIcon}
              onPress={() => onSearchChange('')}
            />
          )}
        </View>
      </View>

      {/* Events list with sections */}
      {sections.length > 0 ? (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={isRefreshing || false}
                onRefresh={onRefresh}
                tintColor={COLORS.primary}
              />
            ) : undefined
          }
        />
      ) : (
        renderEmpty()
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: 0,
    paddingTop: 8,
    paddingBottom: 16,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
  },
  clearIcon: {
    marginLeft: 8,
  },
  listContent: {
    paddingBottom: 100,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 0,
    marginTop: 8,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    letterSpacing: 0.5,
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  separator: {
    height: 12,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
});
