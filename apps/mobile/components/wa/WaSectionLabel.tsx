/**
 * WaSectionLabel — the text above/below an inset-grouped card.
 *
 * WHATSAPP-DESIGN-SYSTEM.md §3.2:
 * - "Section headers: sit *above* their card, outside the white fill, 13pt
 *   uppercase gray, 16pt leading padding matching the card margin."
 * - "Section footers: sit *below* their card, same margin, 13pt gray, wraps
 *   to multiple lines freely."
 * §2 confirms header tracking (+0.5) and footer color (`text.tertiary`).
 */
import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useTheme } from '@hooks/useTheme';
import { WA_GROUP_MARGIN } from './metrics';

export interface WaSectionLabelProps {
  children: string;
  /** 'header' (uppercase, sits above a card) or 'footer' (sentence case, sits below). Default 'header'. */
  variant?: 'header' | 'footer';
}

export function WaSectionLabel({ children, variant = 'header' }: WaSectionLabelProps) {
  const { colors } = useTheme();

  if (variant === 'footer') {
    return (
      <Text style={[styles.base, styles.footer, { color: colors.textTertiary }]}>
        {children}
      </Text>
    );
  }

  return (
    <Text style={[styles.base, styles.header, { color: colors.textSecondary }]}>
      {children.toUpperCase()}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontSize: 13,
    paddingHorizontal: WA_GROUP_MARGIN,
  },
  header: {
    fontWeight: '400',
    letterSpacing: 0.5,
  },
  footer: {
    fontWeight: '400',
  },
});
