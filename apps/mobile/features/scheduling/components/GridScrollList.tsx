/**
 * GridScrollList
 *
 * A bordered, spreadsheet-style table with inline-editable cells and
 * drag-to-reorder — the shared body of the run sheet and event-tasks grids
 * (the leader's "database view", modelled faithfully on the events-os Run of
 * Show table).
 *
 * Notion-style horizontal scroll: a SINGLE horizontal `ScrollView` wraps BOTH
 * the column-label header row AND the drag list, so they scroll horizontally in
 * sync. Columns are FIXED pixel widths (not flex-fill) so they never squish —
 * when the columns overflow the card, the table keeps its natural width and the
 * ScrollView scrolls sideways; when they fit, any leftover "slack" is handed to
 * the `flex` columns so the table fills the card on desktop. The header stays
 * pinned vertically because it sits above the drag list's own vertical scroll.
 *
 * Reordering reuses `RunSheetDragList` unchanged — a grip in a left gutter, the
 * same cross-platform drag (native `react-native-reorderable-list` / web HTML5).
 * The screen owns data + mutations and supplies `renderCell(item, columnKey)`;
 * this component only lays the cells out and draws the divided, padded, sized
 * cell frame (the table chrome).
 */
import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { RunSheetDragList } from "./RunSheetDragList";

/**
 * One table column. Widths are FIXED pixels (`width`); `flex` is only a weight
 * for distributing leftover slack when the whole table fits inside the card.
 */
export type GridColumn = {
  key: string;
  label: string;
  /** Fixed width in px. */
  width: number;
  /** Weight for absorbing leftover slack when the table fits the card (0 = fixed). */
  flex?: number;
  align?: "left" | "center";
};

/** Left gutter that holds the drag grip (header has a matching spacer). */
const GRIP_W = 34;
// Roomier events-os spacing: a comfortable row that lets 1–2 line cells breathe,
// with content top-aligned (not vertically centered) so multi-line cells read
// cleanly against the shorter ones. The header is compact above it.
const ROW_MIN_HEIGHT = 46;
const HEADER_MIN_HEIGHT = 38;

interface Props<T> {
  data: T[];
  keyExtractor: (item: T) => string;
  onReorder: (orderedKeys: string[]) => void;
  columns: GridColumn[];
  /** Cell content for a given row + column. The frame/size is drawn here. */
  renderCell: (
    item: T,
    columnKey: string,
    info: { isActive: boolean },
  ) => React.ReactNode;
  /** Fixed content above the table card (e.g. plan title / readiness). */
  ListHeaderComponent?: React.ReactElement | null;
  /** Fixed content below the table card (e.g. the add-row bar). */
  ListFooterComponent?: React.ReactElement | null;
  /** Vertical padding only — never horizontal, or rows misalign with the header. */
  contentContainerStyle?: StyleProp<ViewStyle>;
}

export function GridScrollList<T>({
  data,
  keyExtractor,
  onReorder,
  columns,
  renderCell,
  ListHeaderComponent,
  ListFooterComponent,
  contentContainerStyle,
}: Props<T>) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  // The card's measured inner size. Width drives the slack distribution; height
  // bounds the inner content so the drag list's vertical scroll works while it
  // lives inside the horizontal ScrollView.
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) =>
      prev.w === width && prev.h === height ? prev : { w: width, h: height },
    );
  };

  // ── Column width math ──────────────────────────────────────────────────────
  // baseW = the table's NATURAL width (grip + every fixed column width).
  // slack  = leftover space when the card is wider than the table; distributed
  //          to the flex columns by weight. When the table overflows, slack = 0
  //          and the table keeps its natural width (→ the ScrollView scrolls).
  // innerWidth = max(baseW, containerWidth) so the inner content fills the card
  //          when it fits, and keeps its natural width when it overflows.
  const baseW = GRIP_W + columns.reduce((sum, c) => sum + c.width, 0);
  const totalFlex = columns.reduce((sum, c) => sum + (c.flex ?? 0), 0);
  const slack = Math.max(0, size.w - baseW);
  const effWidths = columns.map((c) =>
    c.flex && totalFlex > 0 ? c.width + (slack * c.flex) / totalFlex : c.width,
  );
  const innerWidth = Math.max(baseW, size.w);

  const cellFrame = (i: number): ViewStyle => ({
    width: effWidths[i],
    paddingHorizontal: 10,
    paddingVertical: 9,
    // Top-align content (events-os `items-start`) so a 2-line cell doesn't push
    // its 1-line neighbours off-centre. The row stretches every cell to the same
    // height, so the vertical dividers still run the full row.
    justifyContent: "flex-start",
    alignItems: columns[i].align === "center" ? "center" : "flex-start",
    borderRightWidth: i < columns.length - 1 ? StyleSheet.hairlineWidth : 0,
    borderRightColor: colors.border,
  });

  const headerRow = (
    <View
      style={[
        styles.headerRow,
        {
          backgroundColor: primaryColor + "0D",
          borderBottomColor: primaryColor,
        },
      ]}
    >
      <View style={styles.gripCell} />
      {columns.map((col, i) => (
        <View key={col.key} style={cellFrame(i)}>
          <Text
            style={[
              styles.headerLabel,
              { color: colors.textTertiary },
              col.align === "center" && styles.headerLabelCenter,
            ]}
            numberOfLines={1}
          >
            {col.label}
          </Text>
        </View>
      ))}
    </View>
  );

  // Bound the inner content to the measured card height so the nested vertical
  // drag list scrolls within the horizontal ScrollView. Before the first layout
  // pass, fall back to filling available height so nothing renders at zero.
  const innerHeightStyle: ViewStyle = size.h
    ? { height: size.h }
    : { flexGrow: 1 };

  return (
    <View style={styles.root}>
      {ListHeaderComponent}
      <View
        style={[
          styles.card,
          { borderColor: colors.border, backgroundColor: colors.surface },
        ]}
        onLayout={onLayout}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.hScroll}
        >
          <View style={[{ width: innerWidth }, innerHeightStyle]}>
            {headerRow}
            <View style={styles.listWrap}>
              <RunSheetDragList
                data={data}
                keyExtractor={keyExtractor}
                onReorder={onReorder}
                contentContainerStyle={contentContainerStyle}
                renderRow={({ item, Handle, isActive }) => (
                  <View
                    style={[
                      styles.row,
                      {
                        borderBottomColor: colors.border,
                        backgroundColor: isActive
                          ? colors.surfaceSecondary
                          : colors.surface,
                      },
                    ]}
                  >
                    <Handle>
                      <View
                        style={styles.gripCell}
                        accessibilityLabel="Drag to reorder"
                        hitSlop={8}
                      >
                        <Ionicons
                          name="reorder-three"
                          size={18}
                          color={colors.textTertiary}
                        />
                      </View>
                    </Handle>
                    {columns.map((col, i) => (
                      <View key={col.key} style={cellFrame(i)}>
                        {renderCell(item, col.key, { isActive })}
                      </View>
                    ))}
                  </View>
                )}
              />
            </View>
          </View>
        </ScrollView>
      </View>
      {ListFooterComponent}
    </View>
  );
}

/** #RRGGBB (with or without the leading #). Team / role colors are stored as hex. */
const HEX6 = /^#?[0-9a-fA-F]{6}$/;

/** Append an 8-bit alpha to a #RRGGBB hex, for a soft tinted background. */
function hexWithAlpha(hex: string, alpha: number): string {
  const h = hex.startsWith("#") ? hex : `#${hex}`;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${h}${a}`;
}

/**
 * Darken a #RRGGBB hex toward black so a colored tag's text reads cleanly on its
 * own soft tint (mirrors the readable text/bg pairing in events-os optionColor).
 */
function darkenHex(hex: string, amount = 0.42): string {
  const n = parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return hex;
  const scale = (v: number) => Math.round(v * (1 - amount));
  const r = scale((n >> 16) & 0xff);
  const g = scale((n >> 8) & 0xff);
  const b = scale(n & 0xff);
  const to2 = (v: number) => v.toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/**
 * A subtle events-os-style value tag for cells (When / Phase / Team / Role /
 * Owner). Small, light background, small radius (NOT a fully-round pill), compact
 * text, with an optional leading color dot (roles/owner) and a trailing chevron
 * for the ones that open a dropdown. Purely presentational — the screens wrap it
 * in a Pressable that measures its own anchor for the AnchoredMenu.
 *
 * Pass `color` (a hex, e.g. a team/role color) to render a COLORED tag: a soft
 * tint of that color as the background, its darkened form as the text, and a
 * matching leading dot. Without `color` it keeps the neutral / primary-tint look.
 */
export function OptionTag({
  label,
  colors,
  primaryColor,
  color,
  dotColor,
  chevron,
  tinted,
  placeholder,
}: {
  label: string;
  colors: ReturnType<typeof useTheme>["colors"];
  primaryColor: string;
  /** A concrete hex (team / role color) → soft tinted background + readable text. */
  color?: string;
  /** Leading swatch (role / owner color); defaults to `color` when that is set. */
  dotColor?: string;
  /** Trailing chevron-down for dropdown tags. */
  chevron?: boolean;
  /** Use a light primary tint background instead of the neutral surface. */
  tinted?: boolean;
  /** Render as an empty/placeholder tag (faint text). */
  placeholder?: boolean;
}) {
  const hasColor = !!color && HEX6.test(color);
  const backgroundColor = hasColor
    ? hexWithAlpha(color as string, 0.14)
    : tinted
      ? primaryColor + "14"
      : colors.surfaceSecondary;
  const textColor = placeholder
    ? colors.textTertiary
    : hasColor
      ? darkenHex(color as string)
      : colors.text;
  // A colored tag gets a leading dot in its own color unless one is set explicitly.
  const swatch = dotColor ?? (hasColor ? (color as string) : undefined);
  return (
    <View style={[tagStyles.tag, { backgroundColor }]}>
      {swatch ? (
        <View style={[tagStyles.dot, { backgroundColor: swatch }]} />
      ) : null}
      <Text style={[tagStyles.text, { color: textColor }]} numberOfLines={1}>
        {label}
      </Text>
      {chevron ? (
        <Ionicons name="chevron-down" size={11} color={colors.textTertiary} />
      ) : null}
    </View>
  );
}

const tagStyles = StyleSheet.create({
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: 12, fontWeight: "600", flexShrink: 1 },
});

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16, paddingTop: 4 },
  card: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: "hidden",
    marginTop: 12,
  },
  hScroll: { flex: 1 },
  listWrap: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: HEADER_MIN_HEIGHT,
    // A 2px accent underline in the community's primary color (events-os look).
    borderBottomWidth: 2,
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  headerLabelCenter: { textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: ROW_MIN_HEIGHT,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gripCell: {
    width: GRIP_W,
    alignItems: "center",
    justifyContent: "center",
  },
});
