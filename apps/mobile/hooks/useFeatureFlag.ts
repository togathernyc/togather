/**
 * Feature Flag Hooks
 *
 * Hooks for accessing PostHog feature flags with local developer overrides.
 * Returns safe defaults when PostHog is not initialized.
 *
 * Developer overrides (stored in AsyncStorage) take precedence over PostHog
 * in all environments.
 */

import { useCallback, useEffect, useState } from "react";
import { usePostHog } from "posthog-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const OVERRIDE_STORAGE_KEY = "togather_feature_flag_overrides";

/**
 * Check URL params for feature flag overrides (web only, all environments).
 * Format: ?ff_<flagKey>=true|1|false|0
 */
function getUrlParamOverride(flagKey: string): boolean | undefined {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);
  const value = params.get(`ff_${flagKey}`);
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

// Cache for overrides to avoid async reads on every render
let overrideCache: Record<string, boolean> | null = null;

// Simple event emitter for override changes
type OverrideChangeListener = () => void;
const overrideListeners = new Set<OverrideChangeListener>();

function notifyOverrideChange() {
  overrideListeners.forEach((listener) => listener());
}

function subscribeToOverrideChanges(listener: OverrideChangeListener) {
  overrideListeners.add(listener);
  return () => {
    overrideListeners.delete(listener);
  };
}

/**
 * Load overrides from AsyncStorage into cache
 */
async function loadOverrides(): Promise<Record<string, boolean>> {
  if (overrideCache !== null) return overrideCache;

  try {
    const stored = await AsyncStorage.getItem(OVERRIDE_STORAGE_KEY);
    overrideCache = stored ? JSON.parse(stored) : {};
  } catch {
    overrideCache = {};
  }
  return overrideCache as Record<string, boolean>;
}

/**
 * Save an override to AsyncStorage
 */
export async function setFeatureFlagOverride(
  flagKey: string,
  enabled: boolean | null
): Promise<void> {
  const overrides = await loadOverrides();

  if (enabled === null) {
    delete overrides[flagKey];
  } else {
    overrides[flagKey] = enabled;
  }

  overrideCache = overrides;
  await AsyncStorage.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify(overrides));
  notifyOverrideChange();
}

/**
 * Clear all feature flag overrides
 */
export async function clearAllOverrides(): Promise<void> {
  overrideCache = {};
  await AsyncStorage.removeItem(OVERRIDE_STORAGE_KEY);
  notifyOverrideChange();
}

/**
 * Get all current overrides
 */
export async function getAllOverrides(): Promise<Record<string, boolean>> {
  return loadOverrides();
}

/**
 * Check if a feature flag is enabled.
 * Checks local overrides first (in dev/staging), then falls back to PostHog.
 *
 * @param flagKey - The feature flag key to check
 * @returns true if the flag is enabled, false otherwise
 *
 * @example
 * const showNewFeature = useFeatureFlag("new-checkout-flow");
 * if (showNewFeature) {
 *   return <NewCheckoutFlow />;
 * }
 */
export function useFeatureFlag(flagKey: string): boolean {
  const posthog = usePostHog();
  const [override, setOverride] = useState<boolean | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  // Load override from storage
  useEffect(() => {
    loadOverrides().then((overrides) => {
      setOverride(overrides[flagKey]);
      setLoaded(true);
    });
  }, [flagKey]);

  // Subscribe to override changes so we update when dev tools change a flag
  useEffect(() => {
    const unsubscribe = subscribeToOverrideChanges(() => {
      loadOverrides().then((overrides) => {
        setOverride(overrides[flagKey]);
      });
    });
    return unsubscribe;
  }, [flagKey]);

  // Check for local override first (AsyncStorage, all environments)
  if (loaded && override !== undefined) {
    return override;
  }

  // Check URL param overrides (web only, all environments)
  const urlOverride = getUrlParamOverride(flagKey);
  if (urlOverride !== undefined) {
    return urlOverride;
  }

  // Fall back to PostHog
  return posthog?.isFeatureEnabled(flagKey) ?? false;
}

/**
 * Same as `useFeatureFlag` but distinguishes "feature is off" from "we don't
 * yet know whether the feature is on" — the latter happens briefly on cold
 * starts while AsyncStorage / PostHog are hydrating. Callers that want to
 * render a loading state (rather than flashing the disabled UI on rollout
 * users) should use this instead.
 */
export function useFeatureFlagState(flagKey: string): {
  enabled: boolean;
  loaded: boolean;
} {
  const posthog = usePostHog();
  const [override, setOverride] = useState<boolean | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadOverrides().then((overrides) => {
      setOverride(overrides[flagKey]);
      setLoaded(true);
    });
  }, [flagKey]);

  useEffect(() => {
    const unsubscribe = subscribeToOverrideChanges(() => {
      loadOverrides().then((overrides) => {
        setOverride(overrides[flagKey]);
      });
    });
    return unsubscribe;
  }, [flagKey]);

  // Hydration order matches `useFeatureFlag`. We're "loaded" once both the
  // local override has been read from AsyncStorage AND PostHog has produced
  // a definitive value (or we hit a URL override, which is synchronous on
  // web and bypasses both async sources).
  const urlOverride = getUrlParamOverride(flagKey);
  if (urlOverride !== undefined) {
    return { enabled: urlOverride, loaded: true };
  }
  if (loaded && override !== undefined) {
    return { enabled: override, loaded: true };
  }
  const posthogValue = posthog?.isFeatureEnabled(flagKey);
  if (posthogValue !== undefined) {
    return { enabled: posthogValue, loaded: true };
  }
  return { enabled: false, loaded: false };
}

/**
 * Get the variant value of a multivariate feature flag.
 *
 * @param flagKey - The feature flag key
 * @returns The variant string, or undefined if not set
 *
 * @example
 * const buttonColor = useFeatureFlagVariant("button-color-test");
 * // buttonColor might be "red", "blue", "green", or undefined
 */
export function useFeatureFlagVariant(flagKey: string): string | undefined {
  const posthog = usePostHog();
  const value = posthog?.getFeatureFlag(flagKey);
  return typeof value === "string" ? value : undefined;
}

/**
 * Get the JSON payload attached to a feature flag.
 *
 * @param flagKey - The feature flag key
 * @returns The payload value, or undefined if not set
 *
 * @example
 * interface PromoBanner {
 *   title: string;
 *   message: string;
 *   ctaUrl: string;
 * }
 * const banner = useFeatureFlagPayload<PromoBanner>("promo-banner");
 */
export function useFeatureFlagPayload<T = unknown>(
  flagKey: string
): T | undefined {
  const posthog = usePostHog();
  return posthog?.getFeatureFlagPayload(flagKey) as T | undefined;
}

/**
 * Hook to manage feature flag overrides (for Developer Tools UI)
 */
export function useFeatureFlagOverrides() {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOverrides().then((o) => {
      setOverrides(o);
      setLoading(false);
    });
  }, []);

  const setOverride = useCallback(
    async (flagKey: string, enabled: boolean | null) => {
      await setFeatureFlagOverride(flagKey, enabled);
      const updated = await loadOverrides();
      setOverrides({ ...updated });
    },
    []
  );

  const clearAll = useCallback(async () => {
    await clearAllOverrides();
    setOverrides({});
  }, []);

  return {
    overrides,
    loading,
    setOverride,
    clearAll,
    hasOverride: (flagKey: string) => flagKey in overrides,
    getOverride: (flagKey: string) => overrides[flagKey],
  };
}
