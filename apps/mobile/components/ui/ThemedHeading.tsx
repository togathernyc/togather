import React from 'react';
import { Text, StyleSheet } from 'react-native';
import type { StyleProp, TextProps, TextStyle } from 'react-native';
import { useTheme } from '@hooks/useTheme';

export type HeadingLevel = 1 | 2 | 3;

interface ThemedHeadingProps extends Omit<TextProps, 'style'> {
  level?: HeadingLevel;
  style?: StyleProp<TextStyle>;
  children: React.ReactNode;
}

/**
 * Renders headings in the active theme's display font.
 * Non-themed themes (auto/light/dark) use system fonts — behaviorally identical
 * to a plain <Text> at the same size/weight, so adopting <ThemedHeading> is safe
 * for any heading, even in default mode.
 *
 * Levels:
 *   1 → 28/32 bold, e.g. screen titles
 *   2 → 20/26 semibold, e.g. section titles
 *   3 → 16/22 semibold, e.g. card titles
 */
export function ThemedHeading({ level = 2, style, children, ...rest }: ThemedHeadingProps) {
  const { colors, fonts } = useTheme();
  return (
    <Text
      {...rest}
      style={[
        styles.base,
        styles[`level${level}`],
        { color: colors.text, fontFamily: fonts.display },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    includeFontPadding: false as unknown as undefined,
  },
  level1: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '700',
  },
  level2: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
  },
  level3: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
});
