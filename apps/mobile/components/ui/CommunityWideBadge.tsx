/**
 * CommunityWideBadge Component
 *
 * Displays a badge indicating an event is part of a community-wide event.
 * Shows optional override status for leaders who have customized their group's event.
 */
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';

interface CommunityWideBadgeProps {
  /** Optional parent event title to display as subtitle */
  parentEventTitle?: string;
  /** Whether the event has been customized/overridden by the group */
  isOverridden?: boolean;
  /** Whether to show the override note (only for leaders) */
  showOverrideNote?: boolean;
  /** Size variant */
  size?: 'small' | 'medium';
}

export function CommunityWideBadge({
  parentEventTitle,
  isOverridden = false,
  showOverrideNote = false,
  size = 'medium',
}: CommunityWideBadgeProps) {
  const { isDark } = useTheme();
  const isSmall = size === 'small';

  const badgeColors = {
    background: isDark ? '#1e1b4b' : '#EEF2FF',
    text: isDark ? '#a5b4fc' : '#4338CA',
    icon: isDark ? '#818cf8' : '#6366F1',
    overrideBackground: isDark ? '#451a03' : '#FEF3C7',
    overrideText: isDark ? '#fbbf24' : '#92400E',
  };

  return (
    <View style={styles.container}>
      {/* Main Badge */}
      <View style={[styles.badge, { backgroundColor: badgeColors.background }, isSmall && styles.badgeSmall]}>
        <Ionicons
          name="globe-outline"
          size={isSmall ? 12 : 14}
          color={badgeColors.icon}
        />
        <Text style={[styles.badgeText, { color: badgeColors.text }, isSmall && styles.badgeTextSmall]}>
          Community-wide event
        </Text>
      </View>

      {/* Parent Event Title Subtitle */}
      {parentEventTitle && !isSmall && (
        <Text style={[styles.subtitle, { color: badgeColors.text }]} numberOfLines={1}>
          {parentEventTitle}
        </Text>
      )}

      {/* Override Note for Leaders */}
      {showOverrideNote && isOverridden && (
        <View style={[styles.overrideNote, { backgroundColor: badgeColors.overrideBackground }]}>
          <Ionicons name="pencil" size={12} color={badgeColors.overrideText} />
          <Text style={[styles.overrideText, { color: badgeColors.overrideText }]}>Customized by your group</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    alignSelf: 'flex-start',
    gap: 6,
    ...Platform.select({
      web: {
        boxShadow: '0px 1px 2px rgba(0, 0, 0, 0.05)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
      },
    }),
  },
  badgeSmall: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  badgeTextSmall: {
    fontSize: 10,
  },
  subtitle: {
    fontSize: 12,
    opacity: 0.8,
    marginLeft: 4,
  },
  overrideNote: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 4,
  },
  overrideText: {
    fontSize: 11,
    fontWeight: '500',
  },
});
