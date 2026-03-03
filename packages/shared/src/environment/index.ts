/**
 * Centralized Environment Module
 *
 * Single source of truth for environment configuration across mobile and backend.
 *
 * Usage:
 * ```typescript
 * // At app startup (mobile)
 * import Constants from 'expo-constants';
 * import { initEnvironment } from '@togather/shared';
 *
 * initEnvironment({
 *   isStaging: Constants.expoConfig?.extra?.isStaging,
 *   bundleId: Constants.expoConfig?.ios?.bundleIdentifier,
 * });
 *
 * // At app startup (backend)
 * import { initEnvironment } from '@togather/shared';
 *
 * initEnvironment({
 *   appEnv: process.env.APP_ENV,
 *   nodeEnv: process.env.NODE_ENV,
 * });
 *
 * // Anywhere in the app
 * import { Environment } from '@togather/shared';
 *
 * if (Environment.isStaging()) {
 *   // staging-only code
 * }
 * ```
 */

import type { EnvironmentConfig, EnvironmentInitOptions, EnvironmentType } from "./types";
import { ENVIRONMENTS } from "./config";
import { detectEnvironment } from "./detection";

// Re-export types
export type { EnvironmentConfig, EnvironmentInitOptions, EnvironmentType };

// Singleton state
let currentEnvironment: EnvironmentConfig | null = null;
let initialized = false;

/**
 * Initialize the environment.
 *
 * Must be called once at app startup before using any Environment methods.
 * Safe to call multiple times - subsequent calls are ignored with a warning.
 *
 * @param options - Detection options (Expo config for mobile, process.env for backend)
 * @returns The determined environment configuration
 */
export function initEnvironment(
  options: EnvironmentInitOptions
): EnvironmentConfig {
  if (initialized) {
    console.warn(
      "[Environment] Already initialized, ignoring re-init. " +
        "If you need to reinitialize for testing, call resetEnvironment() first."
    );
    return currentEnvironment!;
  }

  const envType = detectEnvironment(options);
  currentEnvironment = ENVIRONMENTS[envType];
  initialized = true;

  // Log on init (useful for debugging)
  // Check for React Native's __DEV__ first (works in mobile builds),
  // then fall back to Node's NODE_ENV (but only if explicitly set)
  const isDev =
    (typeof globalThis !== "undefined" &&
      (globalThis as Record<string, unknown>).__DEV__ === true) ||
    (options.nodeEnv !== undefined && options.nodeEnv !== "production");

  if (isDev) {
    console.log(
      `🌍 Environment: ${currentEnvironment.displayName} (from shared module)`
    );
    console.log(
      `   Stream prefix: "${currentEnvironment.streamChannelPrefix}"`
    );
  }

  return currentEnvironment;
}

/**
 * Reset the environment state.
 *
 * Use cases:
 * - Tests: Reset between test cases
 * - Background jobs: Reset when env vars are injected late
 */
export function resetEnvironment(): void {
  currentEnvironment = null;
  initialized = false;
}

/**
 * Force re-initialization of the environment.
 *
 * This is for environments where environment variables may be injected
 * at runtime AFTER module initialization. Call this function to re-read
 * environment variables and reinitialize.
 *
 * @param options - Detection options
 * @returns The determined environment configuration
 */
export function forceReinitEnvironment(
  options: EnvironmentInitOptions
): EnvironmentConfig {
  resetEnvironment();
  return initEnvironment(options);
}

/**
 * Check if the environment has been initialized.
 */
export function isEnvironmentInitialized(): boolean {
  return initialized;
}

/**
 * Ensure environment is initialized before accessing.
 * @throws Error if environment is not initialized
 */
function ensureInitialized(): EnvironmentConfig {
  if (!initialized || !currentEnvironment) {
    throw new Error(
      "[Environment] Not initialized. Call initEnvironment() at app startup."
    );
  }
  return currentEnvironment;
}

/**
 * Environment API
 *
 * Provides access to environment configuration and helper methods.
 * Must call initEnvironment() before using these methods.
 */
export const Environment = {
  /**
   * Get the current environment configuration.
   * @throws Error if not initialized
   */
  get current(): EnvironmentConfig {
    return ensureInitialized();
  },

  /**
   * Check if running in staging environment.
   */
  isStaging(): boolean {
    return ensureInitialized().name === "staging";
  },

  /**
   * Check if running in production environment.
   */
  isProduction(): boolean {
    return ensureInitialized().name === "production";
  },

  /**
   * Get the Stream channel prefix for the current environment.
   * @returns "prod" for production, "staging" for staging
   */
  getStreamChannelPrefix(): "prod" | "staging" {
    return ensureInitialized().streamChannelPrefix;
  },

  /**
   * Available environments (for reference/debugging).
   */
  environments: ENVIRONMENTS,
};
