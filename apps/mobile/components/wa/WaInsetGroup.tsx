/**
 * WaInsetGroup — the iOS inset-grouped card container (Settings, Community
 * info, Group/Channel info).
 *
 * WHATSAPP-DESIGN-SYSTEM.md §3.2 as recalibrated by WA-VISUAL-DELTAS.md S3:
 * ~24pt corner radius (`WA_GROUP_RADIUS` — S3.1's single most visible card
 * delta), 16pt horizontal screen margin, optional sentence-case section
 * header above the card and footer text below it (via `WaSectionLabel` — pass
 * `header`/`footer` strings here rather than composing them yourself, so the
 * 8pt header-to-card gap stays consistent), internal hairlines between cells
 * inset to the cells' label edge (S3.4).
 *
 * Renders each child as a card row separated by a `WaSeparator`. Screens
 * compose multiple `WaInsetGroup`s with `WA_GROUP_SPACING` between them —
 * that outer spacing is the screen's own layout concern, not this
 * component's (it only lays out one card).
 */
import React, { Children, Fragment, isValidElement } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@hooks/useTheme';
import { WaSeparator } from './WaSeparator';
import { WaSectionLabel } from './WaSectionLabel';
import {
  WA_GROUP_RADIUS,
  WA_GROUP_MARGIN,
  WA_SECTION_HEADER_GAP,
  WA_CELL_LABEL_INSET,
} from './metrics';

export interface WaInsetGroupProps {
  /** Sentence-case section header (rendered verbatim by `WaSectionLabel`); sits above the card. */
  header?: string;
  /** Sits below the card, sentence case. */
  footer?: string;
  /** `WaCell`s (or any row content) — a hairline is inserted between each. */
  children: React.ReactNode;
  /**
   * Left inset for the internal hairlines. S3.4: separators start at the
   * LABEL, i.e. past the whole icon well (padding + icon column + icon→label
   * gap), not at the icon column's own leading edge — defaults to
   * `WA_CELL_LABEL_INSET`. Pass `0` for a group whose cells have no leading
   * icon, or an explicit value for rows with a wider avatar well.
   */
  separatorInset?: number;
}

export function WaInsetGroup({
  header,
  footer,
  children,
  separatorInset = WA_CELL_LABEL_INSET,
}: WaInsetGroupProps) {
  const { colors } = useTheme();
  // React.Children.toArray already drops null/undefined/boolean children and
  // assigns each a stable key.
  const rows = Children.toArray(children);

  return (
    <View>
      {header ? (
        <View style={styles.headerWrapper}>
          <WaSectionLabel variant="header">{header}</WaSectionLabel>
        </View>
      ) : null}

      <View style={[styles.card, { backgroundColor: colors.surfaceGrouped, borderRadius: WA_GROUP_RADIUS }]}>
        {rows.map((row, index) => (
          <Fragment key={isValidElement(row) && row.key != null ? row.key : index}>
            {row}
            {index < rows.length - 1 ? <WaSeparator inset={separatorInset} /> : null}
          </Fragment>
        ))}
      </View>

      {footer ? (
        <View style={styles.footerWrapper}>
          <WaSectionLabel variant="footer">{footer}</WaSectionLabel>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrapper: {
    // WaSectionLabel applies its own WA_GROUP_MARGIN horizontal padding.
    marginBottom: WA_SECTION_HEADER_GAP,
  },
  card: {
    marginHorizontal: WA_GROUP_MARGIN,
    overflow: 'hidden',
  },
  footerWrapper: {
    marginTop: WA_SECTION_HEADER_GAP,
  },
});
