/**
 * Birthday (month + day, no year) and location. Renders nothing if both
 * are missing so the profile layout stays compact.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';

interface UserProfileDetailsCardProps {
  birthdayMonth: number | null | undefined;
  birthdayDay: number | null | undefined;
  location: string | null | undefined;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function UserProfileDetailsCard({
  birthdayMonth,
  birthdayDay,
  location,
}: UserProfileDetailsCardProps) {
  const { colors } = useTheme();

  const birthday =
    birthdayMonth &&
    birthdayDay &&
    birthdayMonth >= 1 &&
    birthdayMonth <= 12 &&
    birthdayDay >= 1 &&
    birthdayDay <= 31
      ? `${MONTH_NAMES[birthdayMonth - 1]} ${birthdayDay}`
      : null;

  if (!birthday && !location) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      {birthday && (
        <Row
          icon="gift-outline"
          label={birthday}
          color={colors.text}
          iconColor={colors.textSecondary}
        />
      )}
      {location && (
        <Row
          icon="location-outline"
          label={location}
          color={colors.text}
          iconColor={colors.textSecondary}
        />
      )}
    </View>
  );
}

interface RowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  iconColor: string;
}

function Row({ icon, label, color, iconColor }: RowProps) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color={iconColor} />
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  label: {
    flex: 1,
    fontSize: 15,
  },
});
