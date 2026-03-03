import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { DEFAULT_PRIMARY_COLOR } from '@utils/styles';

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
  return (
    <View style={[styles.badge, styles[variant], styles[size], style]}>
      <Text style={[styles.text, styles[`${variant}Text`], styles[`${size}Text`], textStyle]}>
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
  primary: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
  },
  secondary: {
    backgroundColor: '#6c757d',
  },
  success: {
    backgroundColor: '#28a745',
  },
  warning: {
    backgroundColor: '#ffc107',
  },
  danger: {
    backgroundColor: '#FF3B30',
  },
  info: {
    backgroundColor: '#17a2b8',
  },
  text: {
    fontWeight: '600',
    color: '#fff',
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
  primaryText: {
    color: '#ffffff',
  },
  secondaryText: {
    color: '#ffffff',
  },
  successText: {
    color: '#ffffff',
  },
  warningText: {
    color: '#000000',
  },
  dangerText: {
    color: '#ffffff',
  },
  infoText: {
    color: '#ffffff',
  },
});

