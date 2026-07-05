/**
 * Grid Column Widths Store
 *
 * Zustand + AsyncStorage store for per-grid, per-column width overrides set by
 * dragging a column's right-edge handle in `GridScrollList`. Keyed by a stable
 * `storageKey` (e.g. "runSheet", "eventTasks") so each grid remembers its own
 * layout, then by the column's `key`.
 *
 * Unlike the offline data caches (`stores/*Cache.ts`, which ship a `.web.ts`
 * no-op stub), these are a UI PREFERENCE we WANT to persist on web too — desktop
 * is the primary surface for these tables. AsyncStorage maps to localStorage on
 * web, so this single cross-platform file is correct; there is deliberately no
 * `.web.ts` stub.
 *
 * Overrides are committed on drag RELEASE (not on every move) so we don't thrash
 * AsyncStorage during a drag — the live width feeds off local component state
 * while the pointer is down. See `GridScrollList`.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface GridColumnWidthsState {
  /** Overrides keyed `[storageKey][columnKey] = widthPx`. */
  widths: Record<string, Record<string, number>>;
  /** Persist a dragged width for one column of one grid. */
  setWidth: (storageKey: string, columnKey: string, width: number) => void;
  /** Forget a single column's override (double-click a handle → default width). */
  resetColumn: (storageKey: string, columnKey: string) => void;
  /** Read one grid's overrides (`{}` when none) for the width math. */
  getGridWidths: (storageKey: string) => Record<string, number>;
  /** Wipe everything (logout cleanup). */
  clearAll: () => void;
}

export const useGridColumnWidths = create<GridColumnWidthsState>()(
  persist(
    (set, get) => ({
      widths: {},

      setWidth: (storageKey, columnKey, width) => {
        set((state) => ({
          widths: {
            ...state.widths,
            [storageKey]: {
              ...(state.widths[storageKey] ?? {}),
              [columnKey]: width,
            },
          },
        }));
      },

      resetColumn: (storageKey, columnKey) => {
        set((state) => {
          const grid = state.widths[storageKey];
          if (!grid || !(columnKey in grid)) return state;
          // Drop just this column; keep the rest of the grid's overrides.
          const { [columnKey]: _removed, ...rest } = grid;
          return {
            widths: { ...state.widths, [storageKey]: rest },
          };
        });
      },

      getGridWidths: (storageKey) => get().widths[storageKey] ?? {},

      clearAll: () => set({ widths: {} }),
    }),
    {
      name: "grid-column-widths",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ widths: state.widths }),
    },
  ),
);
