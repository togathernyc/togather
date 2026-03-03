/**
 * CommunityWideBadge Component
 *
 * Displays a badge indicating an event is part of a community-wide event.
 * Shows optional override status for leaders who have customized their group's event.
 */
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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

// Community-wide badge uses a muted purple/indigo color
const BADGE_COLORS = {
  background: '#EEF2FF', // Light indigo
  text: '#4338CA', // Indigo-700
  icon: '#6366F1', // Indigo-500
  overrideBackground: '#FEF3C7', // Amber-100
  overrideText: '#92400E', // Amber-800
};

export function CommunityWideBadge({
  parentEventTitle,
  isOverridden = false,
  showOverrideNote = false,
  size = 'medium',
}: CommunityWideBadgeProps) {
  const isSmall = size === 'small';

  return (
    <View style={styles.container}>
      {/* Main Badge */}
      <View style={[styles.badge, isSmall && styles.badgeSmall]}>
        <Ionicons
          name="globe-outline"
          size={isSmall ? 12 : 14}
          color={BADGE_COLORS.icon}
        />
        <Text style={[styles.badgeText, isSmall && styles.badgeTextSmall]}>
          Community-wide event
        </Text>
      </View>

      {/* Parent Event Title Subtitle */}
      {parentEventTitle && !isSmall && (
        <Text style={styles.subtitle} numberOfLines={1}>
          {parentEventTitle}
        </Text>
      )}

      {/* Override Note for Leaders */}
      {showOverrideNote && isOverridden && (
        <View style={styles.overrideNote}>
          <Ionicons name="pencil" size={12} color={BADGE_COLORS.overrideText} />
          <Text style={styles.overrideText}>Customized by your group</Text>
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
    backgroundColor: BADGE_COLORS.background,
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
    color: BADGE_COLORS.text,
  },
  badgeTextSmall: {
    fontSize: 10,
  },
  subtitle: {
    fontSize: 12,
    color: BADGE_COLORS.text,
    opacity: 0.8,
    marginLeft: 4,
  },
  overrideNote: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BADGE_COLORS.overrideBackground,
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
    color: BADGE_COLORS.overrideText,
  },
});
