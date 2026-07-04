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
  Pressable,
  Platform,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

/**
 * A data row with a web-only hover highlight (matches the prototype). Pointer
 * enter/leave only fire on web where there's a cursor; on native the handlers
 * are omitted, so touch rows behave exactly as before.
 */
function HoverableRow({
  isActive,
  minHeight,
  borderBottomColor,
  baseBg,
  activeBg,
  hoverBg,
  children,
}: {
  isActive: boolean;
  minHeight: number;
  borderBottomColor: string;
  baseBg: string;
  activeBg: string;
  hoverBg: string;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const hoverProps =
    Platform.OS === "web"
      ? {
          onPointerEnter: () => setHovered(true),
          onPointerLeave: () => setHovered(false),
        }
      : {};
  const backgroundColor = isActive ? activeBg : hovered ? hoverBg : baseBg;
  return (
    <View
      {...hoverProps}
      style={[styles.row, { minHeight, borderBottomColor, backgroundColor }]}
    >
      {children}
    </View>
  );
}
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

/**
 * An optional collapsible group of rows. When the `sections` prop is supplied,
 * `GridScrollList` renders each section as a full-width header row (chevron +
 * uppercase title + right-aligned muted `meta`), followed by its `rows` (via the
 * SAME row renderer as the flat API — drag grip, columns, cells, dense sizing
 * all identical) and an optional full-width `footer` (typically a "+ Add" button).
 *
 * `GridRow` is the caller's own row item type (the generic `T`); a section's
 * `rows` are exactly the same items the flat `data`/`rows` prop accepts.
 */
export type GridSection<T> = {
  key: string;
  /** Uppercased, letter-spaced group label, e.g. "BEFORE EVENT" / "PRE". */
  title: string;
  /** Right-aligned muted text, e.g. "11 items · 7:30–9:59a" or "0/23 ready". */
  meta?: string;
  /** Collapse state is owned by the caller; flip it inside `onToggle`. */
  collapsed?: boolean;
  /** Called when the header is tapped so the caller can flip `collapsed`. */
  onToggle?: () => void;
  /** The section's row items — same type the flat `data`/`rows` prop accepts. */
  rows: T[];
  /** Full-width node rendered below the rows (e.g. a per-section Add button). */
  footer?: React.ReactNode;
};

/** Left gutter that holds the drag grip (header has a matching spacer). */
const GRIP_W = 34;
// Roomier events-os spacing: a comfortable row that lets 1–2 line cells breathe,
// with content top-aligned (not vertically centered) so multi-line cells read
// cleanly against the shorter ones. The header is compact above it.
const ROW_MIN_HEIGHT = 46;
// Tighter floor for one-line-per-cell grids (Event Tasks). Rows still grow past
// this when a cell wraps, so wrapped content is never clipped.
const DENSE_ROW_MIN_HEIGHT = 38;
const HEADER_MIN_HEIGHT = 38;
/** Full-width collapsible section header row (only used when `sections` is set). */
const SECTION_MIN_HEIGHT = 32;
/** Key prefixes for the synthetic header/footer rows woven into the drag list. */
const SECTION_KEY_PREFIX = "__gridSectionHeader__:";
const FOOTER_KEY_PREFIX = "__gridSectionFooter__:";

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
  /**
   * Tighter row min-height + cell padding for cells that are one line in the
   * common case (e.g. the Event Tasks grid). Rows still grow when a cell wraps,
   * so this never clips multi-line content — it only lowers the floor.
   */
  dense?: boolean;
  /**
   * OPTIONAL section grouping. When provided, rows are rendered grouped under
   * collapsible section headers (each with an optional footer), instead of the
   * flat `data` list. `data`/`keyExtractor`/`columns`/`renderCell` are still
   * required — the section rows reuse `keyExtractor`, `columns` and `renderCell`
   * exactly as the flat path does. When omitted, rendering is unchanged.
   *
   * Reordering stays within the drag list; `onReorder` is called with the
   * reordered row keys (synthetic header/footer keys stripped). Cross-section
   * drag is not specially handled.
   */
  sections?: GridSection<T>[];
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
  dense = false,
  sections,
}: Props<T>) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const rowMinHeight = dense ? DENSE_ROW_MIN_HEIGHT : ROW_MIN_HEIGHT;

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
    paddingVertical: dense ? 6 : 9,
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

  // The shared data-row renderer — identical for the flat list and for the rows
  // inside a section, so drag grip, columns, cells and dense sizing stay the same.
  const renderDataRow = ({
    item,
    Handle,
    isActive,
  }: {
    item: T;
    Handle: React.ComponentType<{ children: React.ReactNode }>;
    isActive: boolean;
  }) => (
    <HoverableRow
      isActive={isActive}
      minHeight={rowMinHeight}
      borderBottomColor={colors.border}
      baseBg={colors.surface}
      activeBg={colors.surfaceSecondary}
      hoverBg={primaryColor + "12"}
    >
      <Handle>
        <View
          style={styles.gripCell}
          accessibilityLabel="Drag to reorder"
          hitSlop={8}
        >
          <Ionicons name="reorder-three" size={18} color={colors.textTertiary} />
        </View>
      </Handle>
      {columns.map((col, i) => (
        <View key={col.key} style={cellFrame(i)}>
          {renderCell(item, col.key, { isActive })}
        </View>
      ))}
    </HoverableRow>
  );

  // ── Section rendering (only when `sections` is provided) ────────────────────
  // The header/footer are woven into a SINGLE drag list as synthetic rows so
  // there is exactly one vertical scroll container (same as the flat path). On
  // web the header/footer content is pinned to the visible left edge via
  // position:sticky so the title/Add button stay visible while scrolling
  // horizontally; on native it scrolls with the content (acceptable fallback —
  // this component has no frozen column region to pin to).
  const stickyLeft: ViewStyle =
    Platform.OS === "web"
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ position: "sticky", left: 0 } as any)
      : {};
  const pinnedWidth = size.w || innerWidth;

  type SectionItem =
    | { _kind: "header"; section: GridSection<T> }
    | { _kind: "footer"; section: GridSection<T> }
    | { _kind: "row"; item: T };

  const sectionItems: SectionItem[] = [];
  if (sections) {
    for (const section of sections) {
      sectionItems.push({ _kind: "header", section });
      if (!section.collapsed) {
        for (const row of section.rows)
          sectionItems.push({ _kind: "row", item: row });
        if (section.footer != null)
          sectionItems.push({ _kind: "footer", section });
      }
    }
  }

  const sectionKeyExtractor = (it: SectionItem) =>
    it._kind === "header"
      ? `${SECTION_KEY_PREFIX}${it.section.key}`
      : it._kind === "footer"
        ? `${FOOTER_KEY_PREFIX}${it.section.key}`
        : keyExtractor(it.item);

  // Turn the drag list's post-drop order into a COMPLETE, section-safe order.
  //
  // Two hazards to handle, both because all sections share one drag list:
  //  1. Collapsed sections contribute no rows, so `orderedKeys` omits them —
  //     forwarding that partial list would make the run-sheet mutation reject a
  //     stale order and let Event Tasks rewrite sort orders for only visible rows.
  //  2. A row can be dropped across a section boundary. We don't support segment
  //     changes via drag (that's the row's ⋯ menu), so such a drop must be a
  //     full no-op — not a silent within-section reshuffle of the landing section.
  //
  // A within-section reorder never moves a row out of its section's contiguous
  // block, so the sequence of section indices stays non-decreasing. Any
  // inversion means the row crossed a boundary → snap back by not persisting.
  // Otherwise re-emit every row (collapsed sections keep their original rows).
  const handleSectionReorder = (orderedKeys: string[]) => {
    if (!sections) return onReorder(orderedKeys);
    const visibleOrder = orderedKeys.filter(
      (k) =>
        !k.startsWith(SECTION_KEY_PREFIX) && !k.startsWith(FOOTER_KEY_PREFIX),
    );
    const sectionOf = new Map<string, number>();
    sections.forEach((section, i) =>
      section.rows.forEach((row) => sectionOf.set(keyExtractor(row), i)),
    );
    const seq = visibleOrder
      .map((k) => sectionOf.get(k))
      .filter((i): i is number => i !== undefined);
    if (seq.length !== visibleOrder.length) return; // unknown key → no-op
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] < seq[i - 1]) return; // cross-section drop → no-op
    }
    const expandedCount = sections.reduce(
      (n, s) => n + (s.collapsed ? 0 : s.rows.length),
      0,
    );
    if (visibleOrder.length !== expandedCount) return; // defensive → no-op
    // `visibleOrder` is now guaranteed grouped by section in ascending order,
    // so walk it straight through, splicing collapsed rows back at their spot.
    const fullOrder: string[] = [];
    let vi = 0;
    for (const section of sections) {
      if (section.collapsed) {
        for (const row of section.rows) fullOrder.push(keyExtractor(row));
      } else {
        for (let n = 0; n < section.rows.length; n++)
          fullOrder.push(visibleOrder[vi++]);
      }
    }
    onReorder(fullOrder);
  };

  const renderSectionHeader = (section: GridSection<T>) => (
    <Pressable
      onPress={section.onToggle}
      style={[
        styles.sectionHeader,
        {
          backgroundColor: colors.surfaceSecondary,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View
        style={[styles.sectionHeaderInner, { width: pinnedWidth }, stickyLeft]}
      >
        <Ionicons
          name={section.collapsed ? "chevron-forward" : "chevron-down"}
          size={14}
          color={colors.textSecondary}
        />
        <Text
          style={[styles.sectionTitle, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {section.title}
        </Text>
        {section.meta ? (
          <Text
            style={[styles.sectionMeta, { color: colors.textTertiary }]}
            numberOfLines={1}
          >
            {section.meta}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );

  const renderSectionFooter = (section: GridSection<T>) => (
    <View style={styles.sectionFooter}>
      <View style={[styles.sectionFooterInner, { width: pinnedWidth }, stickyLeft]}>
        {section.footer}
      </View>
    </View>
  );

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
              {sections ? (
                <RunSheetDragList<SectionItem>
                  data={sectionItems}
                  keyExtractor={sectionKeyExtractor}
                  onReorder={handleSectionReorder}
                  contentContainerStyle={contentContainerStyle}
                  renderRow={({ item: it, Handle, isActive }) =>
                    it._kind === "header"
                      ? renderSectionHeader(it.section)
                      : it._kind === "footer"
                        ? renderSectionFooter(it.section)
                        : renderDataRow({ item: it.item, Handle, isActive })
                  }
                />
              ) : (
                <RunSheetDragList
                  data={data}
                  keyExtractor={keyExtractor}
                  onReorder={onReorder}
                  contentContainerStyle={contentContainerStyle}
                  renderRow={({ item, Handle, isActive }) =>
                    renderDataRow({ item, Handle, isActive })
                  }
                />
              )}
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
  sectionHeader: {
    minHeight: SECTION_MIN_HEIGHT,
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionHeaderInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: SECTION_MIN_HEIGHT,
    paddingHorizontal: 10,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    flexShrink: 1,
  },
  sectionMeta: {
    fontSize: 11,
    fontWeight: "500",
    marginLeft: "auto",
    paddingLeft: 8,
  },
  sectionFooter: {
    minHeight: SECTION_MIN_HEIGHT,
    justifyContent: "center",
  },
  sectionFooterInner: {
    paddingLeft: GRIP_W,
    paddingRight: 10,
    paddingVertical: 4,
  },
});
