import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { DEFAULT_PRIMARY_COLOR } from '@utils/styles';
import { useTheme } from '@hooks/useTheme';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'small' | 'medium' | 'large';
  style?: any;
  textStyle?: any;
}

export function Badge({
  children,
  variant = 'primary',
  size = 'medium',
  style,
  textStyle,
}: BadgeProps) {
  const { colors } = useTheme();

  const variantColors: Record<string, { bg: string; text: string }> = {
    primary: { bg: DEFAULT_PRIMARY_COLOR, text: colors.textInverse },
    secondary: { bg: colors.textSecondary, text: colors.textInverse },
    success: { bg: colors.success, text: colors.textInverse },
    warning: { bg: colors.warning, text: colors.text },
    danger: { bg: colors.destructive, text: colors.textInverse },
    info: { bg: colors.link, text: colors.textInverse },
  };

  const variantStyle = variantColors[variant] || variantColors.primary;

  return (
    <View style={[styles.badge, styles[size], { backgroundColor: variantStyle.bg }, style]}>
      <Text style={[styles.text, styles[`${size}Text`], { color: variantStyle.text }, textStyle]}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    ...Platform.select({
      web: {
        boxShadow: '0px 1px 2px rgba(0, 0, 0, 0.1)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 1,
      },
    }),
  },
  small: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  medium: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  large: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  text: {
    fontWeight: '600',
  },
  smallText: {
    fontSize: 10,
    lineHeight: 12,
  },
  mediumText: {
    fontSize: 12,
    lineHeight: 14,
  },
  largeText: {
    fontSize: 14,
    lineHeight: 16,
  },
});

