/**
 * WaSectionLabel — the text above/below an inset-grouped card.
 *
 * WA-VISUAL-DELTAS.md S3.5 supersedes WHATSAPP-DESIGN-SYSTEM.md §3.2 here:
 * the reference screenshots show NO ALL-CAPS section labels anywhere on
 * WhatsApp's info surfaces. Where a section is labelled at all it's
 * sentence-case gray at a *larger* size than the iOS-15 13pt uppercase
 * treatment Togather shipped ("MEMBERS", "LEADER TOOLS", "GROUPS YOU'RE IN"
 * read as iOS-15, not WA).
 *
 * So `header` now renders its string VERBATIM at `WA_SECTION_LABEL_SIZE`
 * (15pt) gray — no `toUpperCase()`, no letter-spacing. Callers own their own
 * casing, which also keeps proper nouns ("Leader tools", "PCO Services")
 * intact. The prop API is unchanged.
 *
 * `footer` is the S3.6 gray metadata line below a card ("Created by …
 * Created Jul 27, 2024.") — 13pt gray, wraps freely.
 */
import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useTheme } from '@hooks/useTheme';
import {
  WA_GROUP_MARGIN,
  WA_SECTION_LABEL_SIZE,
  WA_SECTION_FOOTER_SIZE,
} from './metrics';

export interface WaSectionLabelProps {
  children: string;
  /** 'header' (sentence case, sits above a card) or 'footer' (gray metadata, sits below). Default 'header'. */
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
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: WA_GROUP_MARGIN,
  },
  header: {
    fontSize: WA_SECTION_LABEL_SIZE,
    fontWeight: '400',
  },
  footer: {
    fontSize: WA_SECTION_FOOTER_SIZE,
    fontWeight: '400',
  },
});
