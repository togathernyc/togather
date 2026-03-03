/**
 * Environment Detection
 *
 * Determines whether the app is running in staging or production.
 * Uses different detection strategies for mobile (Expo) and backend (Node.js).
 *
 * SAFETY: Defaults to STAGING to prevent accidental production access during
 * local development. Only returns production when explicitly configured.
 */

import type { EnvironmentType, EnvironmentInitOptions } from "./types";

/**
 * Detect environment from initialization options.
 *
 * Detection priority (production signals - must be explicit):
 * 1. Explicit isStaging=false flag (from Expo build config)
 * 2. APP_ENV being "production" (explicit env var)
 * 3. Bundle ID containing "staging" -> staging
 *
 * SAFETY: Defaults to STAGING unless production is explicitly set.
 * This prevents local development from accidentally connecting to production.
 *
 * @param options - Initialization options from mobile or backend
 * @returns The detected environment type
 */
export function detectEnvironment(
  options: EnvironmentInitOptions
): EnvironmentType {
  // Method 1: Explicit staging flag from build config (mobile)
  // isStaging=true -> staging, isStaging=false -> production
  if (options.isStaging === true) {
    return "staging";
  }
  if (options.isStaging === false) {
    return "production";
  }

  // Method 2: Check APP_ENV (backend)
  // Only return production if EXPLICITLY set to "production".
  //
  // NOTE: Do NOT infer production from NODE_ENV="production".
  // Many staging deployments run with NODE_ENV=production for performance.
  if (options.appEnv === "production") {
    return "production";
  }

  // Method 3: Check bundle identifier for "staging" (mobile)
  if (options.bundleId?.toLowerCase().includes("staging")) {
    return "staging";
  }

  // SAFETY DEFAULT: Return staging for local development
  // This ensures developers running locally don't accidentally connect to production
  return "staging";
}
