import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useTheme } from '@hooks/useTheme';

interface CardProps {
  children: React.ReactNode;
  style?: any;
  onPress?: () => void;
}

export function Card({ children, style, onPress }: CardProps) {
  const { colors } = useTheme();
  const CardComponent = onPress ? require('react-native').TouchableOpacity : View;

  return (
    <CardComponent
      style={[styles.card, { backgroundColor: colors.surface }, style]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      {children}
    </CardComponent>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.1)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 3,
      },
    }),
  },
});
