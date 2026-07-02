/**
 * AnchoredMenu
 *
 * A compact single-select dropdown that appears next to the pill/chip that
 * opened it — the native-select feel the scheduling grids use for their short
 * enum pickers (run-sheet "When", tasks "Phase" / "Team" / "Role", and the
 * How-To type). It replaces the full-screen `CustomModal` those pickers used to
 * open, which took over the whole page on desktop for a three-item choice.
 *
 * It renders inside a transparent `Modal` so it overlays the app and is never
 * clipped by the table card's `overflow: "hidden"`, yet a full-screen
 * transparent backdrop dismisses it on an outside press. The menu box is
 * absolutely positioned at the anchor's measured window rect (below by default,
 * flipped above when near the viewport bottom) and caps its height with an
 * internal scroll so long Team / Role lists stay usable.
 *
 * The caller measures its anchor with `ref.measureInWindow` (see `measureAnchor`)
 * and passes the resulting `AnchorRect`. Selection semantics mirror the old
 * `TaskOptionList`: pass `emptyOption` for a leading "clear" row (e.g.
 * "Team-level (no role)"), which calls `onSelect(null)`.
 */
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal as RNModal,
  Pressable,
  ScrollView,
  Platform,
  useWindowDimensions,
  type GestureResponderEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";

/** A window-space rectangle, as returned by `measureInWindow`. */
export type AnchorRect = { x: number; y: number; width: number; height: number };

export type AnchoredMenuOption = {
  id: string;
  name: string;
  /** Optional leading color swatch (roles). */
  color?: string;
  /** Optional leading icon (How-To types). */
  icon?: keyof typeof Ionicons.glyphMap;
};

/**
 * Measure a host component (a `ref` on a Pressable/View) into window space and
 * report its rect. A no-op if the ref isn't mounted yet.
 */
export function measureAnchor(
  ref: { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null,
  cb: (rect: AnchorRect) => void,
) {
  if (ref?.measureInWindow) {
    ref.measureInWindow((x, y, width, height) => cb({ x, y, width, height }));
  }
}

const GAP = 4;
const MENU_MAX_HEIGHT = 320;
const MIN_MENU_HEIGHT = 120;

export function AnchoredMenu({
  anchor,
  options,
  selectedId,
  emptyOption,
  onSelect,
  onClose,
  minWidth = 168,
  maxWidth = 300,
}: {
  anchor: AnchorRect;
  options: AnchoredMenuOption[];
  selectedId?: string | null;
  /** Prepend a "clear" row that reports `null` (e.g. "Team-level (no role)"). */
  emptyOption?: { label: string };
  onSelect: (id: string | null) => void;
  onClose: () => void;
  minWidth?: number;
  maxWidth?: number;
}) {
  const { colors } = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();

  const menuWidth = Math.min(
    Math.max(anchor.width, minWidth),
    maxWidth,
    Math.max(winW - 16, minWidth),
  );

  let left = anchor.x;
  if (left + menuWidth > winW - 8) left = winW - 8 - menuWidth;
  if (left < 8) left = 8;

  const spaceBelow = winH - (anchor.y + anchor.height);
  const spaceAbove = anchor.y;
  const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
  const maxHeight = Math.max(
    MIN_MENU_HEIGHT,
    Math.min(MENU_MAX_HEIGHT, (placeAbove ? spaceAbove : spaceBelow) - 16),
  );

  const positionStyle = placeAbove
    ? { bottom: winH - anchor.y + GAP, left }
    : { top: anchor.y + anchor.height + GAP, left };

  return (
    <RNModal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          onPress={(e: GestureResponderEvent) => e.stopPropagation()}
          style={[
            styles.menu,
            positionStyle,
            {
              width: menuWidth,
              maxHeight,
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
            Platform.select({
              web: { boxShadow: "0px 6px 24px rgba(0,0,0,0.16)" } as object,
              default: {
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.18,
                shadowRadius: 16,
                elevation: 6,
              },
            }),
          ]}
        >
          <ScrollView
            style={styles.scroll}
            bounces={false}
            keyboardShouldPersistTaps="handled"
          >
            {emptyOption ? (
              <Pressable
                onPress={() => onSelect(null)}
                style={[
                  styles.row,
                  !selectedId && { backgroundColor: colors.surfaceSecondary },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: !selectedId }}
              >
                <Text
                  style={[styles.rowText, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {emptyOption.label}
                </Text>
                {!selectedId ? (
                  <Ionicons name="checkmark" size={17} color={colors.buttonPrimary} />
                ) : null}
              </Pressable>
            ) : null}

            {options.length === 0 && !emptyOption ? (
              <Text style={[styles.empty, { color: colors.textTertiary }]}>
                No options available.
              </Text>
            ) : (
              options.map((o) => {
                const active = o.id === selectedId;
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => onSelect(o.id)}
                    style={[
                      styles.row,
                      active && { backgroundColor: colors.surfaceSecondary },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    {o.icon ? (
                      <Ionicons name={o.icon} size={16} color={colors.textSecondary} />
                    ) : null}
                    {o.color ? (
                      <View style={[styles.swatch, { backgroundColor: o.color }]} />
                    ) : null}
                    <Text
                      style={[styles.rowText, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {o.name}
                    </Text>
                    {active ? (
                      <Ionicons name="checkmark" size={17} color={colors.buttonPrimary} />
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  menu: {
    position: "absolute",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: "hidden",
  },
  scroll: { flexGrow: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  rowText: { flex: 1, fontSize: 14, fontWeight: "500" },
  swatch: { width: 12, height: 12, borderRadius: 6 },
  empty: { fontSize: 13, padding: 16, fontStyle: "italic" },
});
