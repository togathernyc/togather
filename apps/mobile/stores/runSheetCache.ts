/**
 * Run Sheet Cache Store
 *
 * Zustand store with AsyncStorage persistence for offline run sheet access.
 * Provides stale-while-revalidate pattern for PCO service plans and service types.
 *
 * Run sheets are fetched via actions (not cached by Convex), so this cache
 * is essential for offline access.
 *
 * - 4 hour expiry (run sheets change more frequently than group data)
 * - Max 20 cached sheets
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_EXPIRY_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_SHEETS = 20;

interface CachedSheet {
  data: any; // getRunSheet result
  timestamp: number;
}

interface CachedServiceTypes {
  data: any[]; // getAvailableServiceTypes result
  timestamp: number;
}

interface RunSheetCacheState {
  sheets: Record<string, CachedSheet>; // key: `${groupId}:${serviceTypeId}`
  serviceTypes: Record<string, CachedServiceTypes>; // key: groupId
  setRunSheet: (groupId: string, serviceTypeId: string, data: any) => void;
  /** Returns only non-expired cache entries (preferred for online rendering). */
  getRunSheet: (groupId: string, serviceTypeId: string) => any | null;
  /** Returns cached entry regardless of age (offline fallback). */
  getRunSheetStale: (groupId: string, serviceTypeId: string) => any | null;
  setServiceTypes: (groupId: string, types: any[]) => void;
  /** Returns only non-expired cache entries (preferred for online rendering). */
  getServiceTypes: (groupId: string) => any[] | null;
  /** Returns cached entry regardless of age (offline fallback). */
  getServiceTypesStale: (groupId: string) => any[] | null;
  clearAll: () => void;
}

function evictOldestSheets(sheets: Record<string, CachedSheet>): Record<string, CachedSheet> {
  const entries = Object.entries(sheets);
  if (entries.length <= MAX_SHEETS) return sheets;

  const sorted = entries.sort(
    ([, a], [, b]) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
  );
  const toRemove = sorted.slice(0, entries.length - MAX_SHEETS);
  const result = { ...sheets };
  toRemove.forEach(([key]) => delete result[key]);
  return result;
}

export const useRunSheetCache = create<RunSheetCacheState>()(
  persist(
    (set, get) => ({
      sheets: {},
      serviceTypes: {},

      setRunSheet: (groupId: string, serviceTypeId: string, data: any) => {
        const key = `${groupId}:${serviceTypeId}`;
        set((state) => {
          const sheets = evictOldestSheets({
            ...state.sheets,
            [key]: {
              data,
              timestamp: Date.now(),
            },
          });
          return { sheets };
        });
      },

      getRunSheet: (groupId: string, serviceTypeId: string) => {
        const key = `${groupId}:${serviceTypeId}`;
        const cached = get().sheets[key];
        if (!cached) return null;
        if (Date.now() - cached.timestamp > CACHE_EXPIRY_MS) return null;
        return cached.data;
      },

      getRunSheetStale: (groupId: string, serviceTypeId: string) => {
        const key = `${groupId}:${serviceTypeId}`;
        return get().sheets[key]?.data ?? null;
      },

      setServiceTypes: (groupId: string, types: any[]) => {
        set((state) => ({
          serviceTypes: {
            ...state.serviceTypes,
            [groupId]: {
              data: types,
              timestamp: Date.now(),
            },
          },
        }));
      },

      getServiceTypes: (groupId: string) => {
        const cached = get().serviceTypes[groupId];
        if (!cached) return null;
        if (Date.now() - cached.timestamp > CACHE_EXPIRY_MS) return null;
        return cached.data;
      },

      getServiceTypesStale: (groupId: string) => {
        return get().serviceTypes[groupId]?.data ?? null;
      },

      clearAll: () => {
        set({ sheets: {}, serviceTypes: {} });
      },
    }),
    {
      name: "runsheet-cache",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        sheets: state.sheets,
        serviceTypes: state.serviceTypes,
      }),
    }
  )
);
