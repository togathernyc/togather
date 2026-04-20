import React from 'react';
import { Text } from 'react-native';
import type { StyleProp, TextProps, TextStyle } from 'react-native';
import { useTheme } from '@hooks/useTheme';

interface ThemedMonoProps extends Omit<TextProps, 'style'> {
  style?: StyleProp<TextStyle>;
  children: React.ReactNode;
}

/**
 * Renders text in the active theme's mono font. Most themes fall back to the
 * platform's system monospace; Console promotes JetBrains Mono.
 */
export function ThemedMono({ style, children, ...rest }: ThemedMonoProps) {
  const { colors, fonts } = useTheme();
  return (
    <Text
      {...rest}
      style={[
        { color: colors.text, fontFamily: fonts.mono },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
