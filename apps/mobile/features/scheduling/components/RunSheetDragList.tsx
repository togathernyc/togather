/**
 * RunSheetDragList
 *
 * A cross-platform drag-to-reorder list for the run sheet (ADR-026). Reordering
 * is grab-and-drag from a handle, on web AND native, with an insertion line
 * marking the drop target — no up/down arrows.
 *
 * - **Web:** HTML5 drag. The handle and the row container are real DOM nodes
 *   created with `React.createElement` because RN-Web strips `draggable` /
 *   `onDrop` from `View` (same trick as `FollowupDesktopTable`). Only the
 *   handle starts a drag, so inputs in the row stay editable; the row element
 *   is the drag image and the drop target.
 * - **Native:** a `react-native-gesture-handler` Pan on the handle lifts the
 *   active row (`react-native-reanimated` finger-follow) while an insertion
 *   line tracks the drop target. Both libs are already `core` deps (ADR-013).
 *
 * Reorder math (`moveKey`) is shared; the platforms only differ in how a drag
 * is driven and how the drop target is detected.
 */
import React, { useCallback, useRef, useState } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  runOnJS,
} from "react-native-reanimated";
import { useTheme } from "@hooks/useTheme";

/** A handle component the row renderer wraps around its grip icon. */
type HandleComponent = React.ComponentType<{ children: React.ReactNode }>;

type RenderRow<T> = (info: {
  item: T;
  index: number;
  Handle: HandleComponent;
  isActive: boolean;
}) => React.ReactNode;

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

export function RunSheetDragList<T>({
  data,
  keyExtractor,
  onReorder,
  renderRow,
}: {
  data: T[];
  keyExtractor: (item: T) => string;
  /** Called with the full reordered key list when a drag completes. */
  onReorder: (orderedKeys: string[]) => void;
  renderRow: RenderRow<T>;
}) {
  const { colors } = useTheme();
  const keys = data.map(keyExtractor);

  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Insertion slot the dragged row would drop into (0..length), or null.
  const [overSlot, setOverSlot] = useState<number | null>(null);
  // Measured row heights (native offset math only).
  const heights = useRef<Record<string, number>>({});

  const reset = useCallback(() => {
    setActiveKey(null);
    setOverSlot(null);
  }, []);

  const commit = useCallback(
    (key: string, toSlot: number) => {
      const from = keys.indexOf(key);
      if (from !== -1 && toSlot !== from && toSlot !== from + 1) {
        onReorder(moveKey(keys, key, toSlot));
      }
      reset();
    },
    [keys, onReorder, reset],
  );

  const line = (
    <View style={[styles.insertLine, { backgroundColor: colors.buttonPrimary }]} />
  );

  return (
    <View>
      {data.map((item, index) => {
        const key = keyExtractor(item);
        const isActive = key === activeKey;

        const Handle: HandleComponent =
          Platform.OS === "web"
            ? ({ children }) => (
                <WebHandle dragKey={key} setActiveKey={setActiveKey}>
                  {children}
                </WebHandle>
              )
            : ({ children }) => (
                <NativeHandle
                  dragKey={key}
                  index={index}
                  keys={keys}
                  heights={heights}
                  setActiveKey={setActiveKey}
                  setOverSlot={setOverSlot}
                  commit={commit}
                >
                  {children}
                </NativeHandle>
              );

        const rowBody = (
          <>
            {overSlot === index ? line : null}
            {renderRow({ item, index, Handle, isActive })}
            {overSlot === data.length && index === data.length - 1 ? line : null}
          </>
        );

        if (Platform.OS === "web") {
          return React.createElement(
            "div",
            {
              key,
              "data-runsheet-row": "true",
              onDragOver: (e: any) => {
                if (!activeKey) return;
                e.preventDefault();
                const rect = e.currentTarget?.getBoundingClientRect?.();
                const after =
                  rect ? e.clientY > rect.top + rect.height / 2 : false;
                setOverSlot(after ? index + 1 : index);
              },
              onDrop: (e: any) => {
                e.preventDefault();
                const dragged = e.dataTransfer?.getData?.("text/plain") || activeKey;
                const rect = e.currentTarget?.getBoundingClientRect?.();
                const after =
                  rect ? e.clientY > rect.top + rect.height / 2 : false;
                if (dragged) commit(dragged, after ? index + 1 : index);
              },
            },
            rowBody,
          );
        }

        return (
          <View
            key={key}
            onLayout={(e) => {
              heights.current[key] = e.nativeEvent.layout.height;
            }}
          >
            {rowBody}
          </View>
        );
      })}
    </View>
  );
}

/** Web drag grip: a real `<div draggable>` that sets the row as the drag image. */
function WebHandle({
  dragKey,
  setActiveKey,
  children,
}: {
  dragKey: string;
  setActiveKey: (k: string | null) => void;
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
    },
    children,
  );
}

/** Native drag grip: a long-press Pan that finger-follows the active row. */
function NativeHandle({
  dragKey,
  index,
  keys,
  heights,
  setActiveKey,
  setOverSlot,
  commit,
  children,
}: {
  dragKey: string;
  index: number;
  keys: string[];
  heights: React.MutableRefObject<Record<string, number>>;
  setActiveKey: (k: string | null) => void;
  setOverSlot: (i: number | null) => void;
  commit: (key: string, toSlot: number) => void;
  children: React.ReactNode;
}) {
  const translateY = useSharedValue(0);

  const slotFor = useCallback(
    (ty: number) => {
      // Cumulative tops from measured heights (fallback 56px).
      const tops: number[] = [];
      let acc = 0;
      for (const k of keys) {
        tops.push(acc);
        acc += heights.current[k] ?? 56;
      }
      const rowTop = tops[index] ?? 0;
      const rowH = heights.current[dragKey] ?? 56;
      const center = rowTop + rowH / 2 + ty;
      let slot = 0;
      for (let i = 0; i < tops.length; i++) {
        const h = heights.current[keys[i]] ?? 56;
        if (center > tops[i] + h / 2) slot = i + 1;
      }
      return slot;
    },
    [keys, heights, index, dragKey],
  );

  const onMove = useCallback(
    (ty: number) => setOverSlot(slotFor(ty)),
    [setOverSlot, slotFor],
  );
  const onDrop = useCallback(
    (ty: number) => commit(dragKey, slotFor(ty)),
    [commit, dragKey, slotFor],
  );

  const pan = Gesture.Pan()
    .activateAfterLongPress(150)
    .onBegin(() => runOnJS(setActiveKey)(dragKey))
    .onUpdate((e) => {
      translateY.value = e.translationY;
      runOnJS(onMove)(e.translationY);
    })
    .onEnd((e) => {
      runOnJS(onDrop)(e.translationY);
      translateY.value = 0;
    })
    .onFinalize(() => {
      translateY.value = 0;
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    zIndex: translateY.value !== 0 ? 10 : 0,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={animatedStyle}>{children}</Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  insertLine: {
    height: 2,
    borderRadius: 1,
    marginVertical: 3,
  },
});
