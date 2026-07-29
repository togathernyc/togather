/**
 * WaLargeTitle — the 34pt heavy screen title current WhatsApp iOS sets on its
 * own line BELOW the floating-button row (WA-VISUAL-DELTAS.md S1.2, S7).
 *
 * Deliberately plain: no bar fill, no hairline, no letter-spacing tricks —
 * just the platform default font stack (-apple-system/SF on iOS and mac web)
 * at `WA_TYPE_LARGE_TITLE` / `WA_WEIGHT_LARGE_TITLE`. Togather's pre-pass
 * titles ran 28pt bold, which read a full weight light next to the reference.
 */
import React from 'react';
import { Text, StyleSheet, StyleProp, TextStyle } from 'react-native';
import { useTheme } from '@hooks/useTheme';
import {
  WA_TYPE_LARGE_TITLE,
  WA_WEIGHT_LARGE_TITLE,
  WA_ROW_LEADING_PADDING,
} from './metrics';

export interface WaLargeTitleProps {
  children: string;
  style?: StyleProp<TextStyle>;
}

export function WaLargeTitle({ children, style }: WaLargeTitleProps) {
  const { colors } = useTheme();
  return (
    <Text style={[styles.title, { color: colors.text }, style]} numberOfLines={1}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: WA_TYPE_LARGE_TITLE,
    fontWeight: WA_WEIGHT_LARGE_TITLE,
    textAlign: 'left',
    paddingHorizontal: WA_ROW_LEADING_PADDING,
  },
});
