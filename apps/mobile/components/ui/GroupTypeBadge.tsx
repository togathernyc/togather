/**
 * Reusable group type badge component.
 * Displays group type with consistent styling across all surfaces.
 */
import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { getGroupTypeColorScheme, DEFAULT_GROUP_COLOR_SCHEME } from '../../constants/groupTypes';

interface GroupTypeBadgeProps {
  /** The type name to display (e.g., "Small Group", "Dinner Party") */
  label: string;
  /** Optional numeric type for color mapping - works with any group type ID */
  typeNumber?: number;
  /** Optional slug for color mapping (deprecated - use typeNumber) */
  typeSlug?: string;
  /** Optional size variant */
  size?: 'small' | 'medium';
  /** Optional style override for container */
  style?: ViewStyle;
  /** Optional style override for text */
  textStyle?: TextStyle;
}

/**
 * Get colors for a group type.
 * Uses dynamic color generation based on typeNumber to support any group type ID.
 */
function getColors(typeNumber?: number, _typeSlug?: string) {
  if (typeNumber !== undefined) {
    return getGroupTypeColorScheme(typeNumber);
  }
  return DEFAULT_GROUP_COLOR_SCHEME;
}

export function GroupTypeBadge({
  label,
  typeNumber,
  typeSlug,
  size = 'small',
  style,
  textStyle,
}: GroupTypeBadgeProps) {
  if (!label) {
    return null;
  }

  const colors = getColors(typeNumber, typeSlug);
  const sizeStyles = size === 'medium' ? styles.medium : styles.small;
  const textSizeStyles = size === 'medium' ? styles.textMedium : styles.textSmall;

  return (
    <View style={[styles.badge, sizeStyles, { backgroundColor: colors.bg }, style]}>
      <Text style={[styles.text, textSizeStyles, { color: colors.color }, textStyle]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 12,
    alignSelf: 'flex-start',
    flexShrink: 0,
    // @ts-expect-error - Web-specific styling
    display: 'inline-flex',
  },
  small: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  medium: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  text: {
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  textSmall: {
    fontSize: 10,
  },
  textMedium: {
    fontSize: 12,
  },
});
