/**
 * RunSheetDragList
 *
 * A cross-platform drag-to-reorder list for the run sheet (ADR-026). It owns the
 * scroll container so the list, its header (title/date) and footer (add
 * controls) scroll together. Reordering is grab-and-drag from a grip handle on
 * web AND native.
 *
 * - **Native:** `react-native-reorderable-list` (`ReorderableList`, sits on
 *   `react-native-gesture-handler` + `react-native-reanimated` — both `core`
 *   deps, ADR-013). It handles the finger-follow, autoscroll, and winning the
 *   gesture over the scroll, which a hand-rolled Pan could not do reliably on
 *   the New Architecture. Drag starts from a grip via the `useReorderableDrag`
 *   hook, so the row's TextInputs stay editable.
 * - **Web:** HTML5 drag inside a ScrollView. The handle and the row container
 *   are real DOM nodes created with `React.createElement` because RN-Web strips
 *   `draggable` / `onDrop` from `View` (same trick as `FollowupDesktopTable`).
 *   Only the handle starts a drag, so inputs in the row stay editable; the row
 *   element is the drag image and the drop target.
 *
 * Both platforms expose the same API: `renderRow` receives a `Handle` component
 * to wrap the grip, and `onReorder` is called with the full reordered key list.
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  Platform,
  Pressable,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import ReorderableList, {
  useReorderableDrag,
  reorderItems,
  type ReorderableListReorderEvent,
} from "react-native-reorderable-list";
import { useTheme } from "@hooks/useTheme";

/** A handle component the row renderer wraps around its grip icon. */
type HandleComponent = React.ComponentType<{ children: React.ReactNode }>;

type RenderRow<T> = (info: {
  item: T;
  index: number;
  Handle: HandleComponent;
  isActive: boolean;
}) => React.ReactNode;

interface Props<T> {
  data: T[];
  keyExtractor: (item: T) => string;
  /** Called with the full reordered key list when a drag completes. */
  onReorder: (orderedKeys: string[]) => void;
  renderRow: RenderRow<T>;
  /** Scrolls above the list (e.g. plan title / date). */
  ListHeaderComponent?: React.ReactElement | null;
  /** Scrolls below the list (e.g. add controls). */
  ListFooterComponent?: React.ReactElement | null;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/** Platform switch — Platform.OS is constant, so the branch never flips. */
export function RunSheetDragList<T>(props: Props<T>) {
  return Platform.OS === "web" ? (
    <WebDragList {...props} />
  ) : (
    <NativeDragList {...props} />
  );
}

/* ------------------------------------------------------------------ native */

/** Grip wrapper: long-pressing it starts the row's drag (TextInputs stay tappable). */
function NativeHandle({ children }: { children: React.ReactNode }) {
  const drag = useReorderableDrag();
  return (
    <Pressable onLongPress={drag} delayLongPress={150} hitSlop={10}>
      {children}
    </Pressable>
  );
}

function NativeDragList<T>({
  data,
  keyExtractor,
  onReorder,
  renderRow,
  ListHeaderComponent,
  ListFooterComponent,
  contentContainerStyle,
}: Props<T>) {
  // Keep the latest key order so onReorder can translate the library's
  // {from, to} indices into the full reordered key list our parent expects.
  const keysRef = useRef<string[]>([]);
  keysRef.current = data.map(keyExtractor);

  const handleReorder = useCallback(
    ({ from, to }: ReorderableListReorderEvent) => {
      onReorder(reorderItems(keysRef.current, from, to));
    },
    [onReorder],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: T; index: number }) =>
      renderRow({
        item,
        index,
        Handle: NativeHandle,
        isActive: false,
      }) as React.ReactElement,
    [renderRow],
  );

  return (
    <ReorderableList
      data={data}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      onReorder={handleReorder}
      ListHeaderComponent={ListHeaderComponent ?? undefined}
      ListFooterComponent={ListFooterComponent ?? undefined}
      contentContainerStyle={contentContainerStyle}
      keyboardShouldPersistTaps="handled"
    />
  );
}

/* --------------------------------------------------------------------- web */

/** Move `key` so it lands at insertion slot `toSlot` (0..length). */
function moveKey(keys: string[], key: string, toSlot: number): string[] {
  const from = keys.indexOf(key);
  if (from === -1) return keys;
  const next = [...keys];
  next.splice(from, 1);
  const insertAt = toSlot > from ? toSlot - 1 : toSlot;
  next.splice(insertAt, 0, key);
  return next;
}

function WebDragList<T>({
  data,
  keyExtractor,
  onReorder,
  renderRow,
  ListHeaderComponent,
  ListFooterComponent,
  contentContainerStyle,
}: Props<T>) {
  const { colors } = useTheme();
  const keys = data.map(keyExtractor);
  const keysSignature = keys.join("|");

  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Insertion slot the dragged row would drop into (0..length), or null.
  const [overSlot, setOverSlot] = useState<number | null>(null);

  // Latest key order in a ref so `commit` (and the Handles built from it) can
  // stay identity-stable across renders. If they were rebuilt every render, the
  // re-render triggered by `setActiveKey` / `setOverSlot` mid-drag would give
  // each row a NEW Handle type, making React remount the dragged element — which
  // cancels an in-progress HTML5 drag. That was the "have to drag twice" bug.
  const keysRef = useRef(keys);
  keysRef.current = keys;

  const reset = useCallback(() => {
    setActiveKey(null);
    setOverSlot(null);
  }, []);

  const commit = useCallback(
    (key: string, toSlot: number) => {
      const ks = keysRef.current;
      const from = ks.indexOf(key);
      if (from !== -1 && toSlot !== from && toSlot !== from + 1) {
        onReorder(moveKey(ks, key, toSlot));
      }
      reset();
    },
    [onReorder, reset],
  );

  // Stable per-key Handle components. Recomputed only when the row set/order
  // changes — never on `activeKey` / `overSlot` updates during a drag — so the
  // dragged element is not remounted while the user is dragging it.
  const handlesByKey = useMemo(() => {
    const map: Record<string, HandleComponent> = {};
    keysRef.current.forEach((k) => {
      map[k] = ({ children }) => (
        <WebHandle dragKey={k} setActiveKey={setActiveKey} reset={reset}>
          {children}
        </WebHandle>
      );
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSignature, reset]);

  const line = (
    <View style={[styles.insertLine, { backgroundColor: colors.buttonPrimary }]} />
  );

  return (
    <ScrollView
      contentContainerStyle={contentContainerStyle}
      keyboardShouldPersistTaps="handled"
    >
      {ListHeaderComponent}
      <View>
        {data.map((item, index) => {
          const key = keyExtractor(item);
          const isActive = key === activeKey;
          const Handle = handlesByKey[key];

          const rowBody = (
            <>
              {overSlot === index ? line : null}
              {renderRow({ item, index, Handle, isActive })}
              {overSlot === data.length && index === data.length - 1
                ? line
                : null}
            </>
          );

          return React.createElement(
            "div",
            {
              key,
              "data-runsheet-row": "true",
              onDragOver: (e: any) => {
                // Always preventDefault so the row is a valid drop target from
                // the very first dragover frame — even before React has
                // re-rendered with `activeKey` set. Guarding on `activeKey`
                // here skipped preventDefault on the opening frames of a drag,
                // so the browser refused the drop and the item only moved on a
                // second attempt.
                e.preventDefault();
                const rect = e.currentTarget?.getBoundingClientRect?.();
                const after = rect ? e.clientY > rect.top + rect.height / 2 : false;
                setOverSlot(after ? index + 1 : index);
              },
              onDrop: (e: any) => {
                e.preventDefault();
                const dragged =
                  e.dataTransfer?.getData?.("text/plain") || activeKey;
                const rect = e.currentTarget?.getBoundingClientRect?.();
                const after = rect ? e.clientY > rect.top + rect.height / 2 : false;
                if (dragged) commit(dragged, after ? index + 1 : index);
              },
            },
            rowBody,
          );
        })}
      </View>
      {ListFooterComponent}
    </ScrollView>
  );
}

/** Web drag grip: a real `<div draggable>` that sets the row as the drag image. */
function WebHandle({
  dragKey,
  setActiveKey,
  reset,
  children,
}: {
  dragKey: string;
  setActiveKey: (k: string | null) => void;
  reset: () => void;
  children: React.ReactNode;
}) {
  return React.createElement(
    "div",
    {
      draggable: true,
      style: { cursor: "grab", display: "flex", touchAction: "none" },
      onDragStart: (e: any) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragKey);
        const row = e.currentTarget?.closest?.("[data-runsheet-row]");
        if (row && e.dataTransfer.setDragImage) {
          e.dataTransfer.setDragImage(row, 16, 16);
        }
        setActiveKey(dragKey);
      },
      // Always clear the active/insert state when the drag ends — including a
      // cancelled drop (released outside any row). Without this the row stays
      // "lifted" and a stale activeKey forces a second drag before it moves.
      onDragEnd: () => reset(),
    },
    children,
  );
}

const styles = StyleSheet.create({
  insertLine: {
    height: 2,
    borderRadius: 1,
    marginVertical: 3,
  },
});
