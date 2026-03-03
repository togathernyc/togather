/**
 * Mobile Environment Service
 *
 * Thin wrapper around @togather/shared environment module.
 * Initializes environment from Expo build config at module load.
 *
 * Environment is determined at BUILD TIME via APP_VARIANT:
 * - Staging builds (APP_VARIANT=staging) use staging API and Stream channels
 * - Production builds use production API and Stream channels
 *
 * This ensures complete isolation - a staging app ALWAYS uses staging,
 * and a production app ALWAYS uses production. No runtime switching.
 */

import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  initEnvironment,
  Environment as SharedEnvironment,
  type EnvironmentConfig,
  type EnvironmentType,
} from "@togather/shared";

// Re-export types for backwards compatibility
export type { EnvironmentConfig, EnvironmentType };

// Legacy storage key - we clear this on startup to prevent confusion
const LEGACY_STORAGE_KEY = "togather_environment";

/**
 * Clear legacy AsyncStorage environment preference.
 * Called on app startup to ensure old preferences don't cause confusion.
 */
async function clearLegacyPreference(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Ignore errors - this is just cleanup
  }
}

// Initialize environment from Expo build config
initEnvironment({
  isStaging: Constants.expoConfig?.extra?.isStaging,
  bundleId:
    Constants.expoConfig?.ios?.bundleIdentifier ||
    Constants.expoConfig?.android?.package,
});

// Clear legacy preference on module load
clearLegacyPreference();

/**
 * Mobile-specific environment wrapper.
 *
 * Provides the same API as the old mobile-only Environment module
 * while delegating to the shared @togather/shared environment module.
 */
export const Environment = {
  /**
   * Get the current environment configuration.
   */
  get current(): EnvironmentConfig {
    return SharedEnvironment.current;
  },

  /**
   * Check if running in staging environment.
   */
  isStaging(): boolean {
    return SharedEnvironment.isStaging();
  },

  /**
   * Check if running in production environment.
   */
  isProduction(): boolean {
    return SharedEnvironment.isProduction();
  },

  /**
   * Get the API base URL.
   * Note: With the migration to Convex, this is only used for legacy REST endpoints.
   * Returns the Convex HTTP URL for the current environment.
   */
  getApiBaseUrl(): string {
    // The tRPC API has been removed. Return the Convex HTTP URL instead.
    // Derive from the Convex URL by replacing .convex.cloud with .convex.site
    const convexUrl = this.getConvexUrl();
    return convexUrl.replace('.convex.cloud', '.convex.site');
  },

  /**
   * Get the Convex deployment URL.
   *
   * IMPORTANT: This MUST be set via EXPO_PUBLIC_CONVEX_URL environment variable.
   * The dev script (pnpm dev) automatically derives this from .env.local.
   *
   * @throws Error if EXPO_PUBLIC_CONVEX_URL is not set
   */
  getConvexUrl(): string {
    const url = process.env.EXPO_PUBLIC_CONVEX_URL;
    if (!url) {
      throw new Error(
        'EXPO_PUBLIC_CONVEX_URL is not set!\n\n' +
        'For local development:\n' +
        '  1. Run "npx convex dev" to create your personal Convex deployment\n' +
        '  2. Run "pnpm dev" to start the app (it reads your deployment from .env.local)\n\n' +
        'For production builds, ensure EXPO_PUBLIC_CONVEX_URL is set in the build environment.'
      );
    }
    return url;
  },

  /**
   * Get Stream channel ID with appropriate prefix for current environment.
   * @deprecated Use buildStreamChannelId from @togather/shared instead
   */
  getStreamChannelId(baseChannelId: string): string {
    const prefix = SharedEnvironment.getStreamChannelPrefix();
    return `${prefix}_${baseChannelId}`;
  },

  /**
   * Parse a Stream channel ID to extract environment info.
   * @deprecated Use parseStreamChannelId from @togather/shared instead
   */
  parseStreamChannelId(channelId: string): {
    baseId: string;
    isStaging: boolean;
    isProduction: boolean;
  } {
    // New compact format
    if (channelId.startsWith("p_")) {
      return {
        baseId: channelId.slice(2),
        isStaging: false,
        isProduction: true,
      };
    }
    if (channelId.startsWith("s_")) {
      return {
        baseId: channelId.slice(2),
        isStaging: true,
        isProduction: false,
      };
    }

    // Legacy formats
    if (channelId.startsWith("stg_")) {
      return {
        baseId: channelId.slice(4),
        isStaging: true,
        isProduction: false,
      };
    }
    if (channelId.startsWith("staging_")) {
      return {
        baseId: channelId.slice(8),
        isStaging: true,
        isProduction: false,
      };
    }

    // No prefix = old production format
    return {
      baseId: channelId,
      isStaging: false,
      isProduction: true,
    };
  },

  /**
   * Available environments (for reference only).
   */
  environments: SharedEnvironment.environments,
};

export default Environment;
