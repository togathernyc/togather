"use node";

/**
 * PostHog Node SDK Wrapper for Convex Actions
 *
 * Provides feature flag evaluation for backend logic in Convex actions.
 * Uses lazy initialization to avoid loading PostHog when not needed.
 *
 * IMPORTANT: This file uses the Node.js runtime because posthog-node
 * requires Node.js APIs (async_hooks, fs, readline).
 *
 * Usage:
 * ```ts
 * import { isFeatureEnabled } from "@/lib/posthog";
 *
 * // In a Convex action (must be in a "use node" file)
 * const enabled = await isFeatureEnabled("new-checkout-flow", userId);
 * if (enabled) {
 *   // New behavior
 * }
 * ```
 */

import { PostHog } from "posthog-node";

// Lazy-initialized PostHog client
let posthogClient: PostHog | null = null;
let initAttempted = false;

/**
 * Get or create the PostHog client instance.
 * Returns null if POSTHOG_API_KEY is not set.
 */
function getClient(): PostHog | null {
  if (initAttempted) {
    return posthogClient;
  }

  initAttempted = true;

  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) {
    console.warn(
      "[PostHog] POSTHOG_API_KEY not set - feature flags will return defaults"
    );
    return null;
  }

  posthogClient = new PostHog(apiKey, {
    host: "https://us.i.posthog.com",
    // Flush immediately for serverless environments
    flushAt: 1,
    flushInterval: 0,
  });

  return posthogClient;
}

/**
 * Convert properties to string values as required by PostHog SDK.
 */
function toStringProperties(
  properties?: Record<string, string | number | boolean>
): Record<string, string> | undefined {
  if (!properties) return undefined;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    result[key] = String(value);
  }
  return result;
}

/**
 * Check if a feature flag is enabled for a user.
 *
 * @param flagName - The feature flag key
 * @param userId - The user's unique identifier
 * @param properties - Optional user properties for flag evaluation
 * @returns true if the flag is enabled, false otherwise
 *
 * @example
 * const enabled = await isFeatureEnabled("new-feature", "user_123");
 * const enabledWithProps = await isFeatureEnabled("beta-feature", "user_123", {
 *   plan: "pro",
 *   community_id: "comm_456",
 * });
 */
export async function isFeatureEnabled(
  flagName: string,
  userId: string,
  properties?: Record<string, string | number | boolean>
): Promise<boolean> {
  const client = getClient();
  if (!client) {
    return false;
  }

  try {
    const result = await client.isFeatureEnabled(flagName, userId, {
      personProperties: toStringProperties(properties),
    });
    return result ?? false;
  } catch (error) {
    console.error(`[PostHog] Error checking feature flag "${flagName}":`, error);
    return false;
  }
}

/**
 * Get the value of a feature flag (for multivariate flags).
 *
 * @param flagName - The feature flag key
 * @param userId - The user's unique identifier
 * @param properties - Optional user properties for flag evaluation
 * @returns The flag value (boolean, string, or undefined if not set)
 *
 * @example
 * const variant = await getFeatureFlag("button-color-test", "user_123");
 * // variant might be "red", "blue", "control", true, false, or undefined
 */
export async function getFeatureFlag(
  flagName: string,
  userId: string,
  properties?: Record<string, string | number | boolean>
): Promise<boolean | string | undefined> {
  const client = getClient();
  if (!client) {
    return undefined;
  }

  try {
    const result = await client.getFeatureFlag(flagName, userId, {
      personProperties: toStringProperties(properties),
    });
    return result ?? undefined;
  } catch (error) {
    console.error(`[PostHog] Error getting feature flag "${flagName}":`, error);
    return undefined;
  }
}

/**
 * Get all feature flags for a user.
 *
 * @param userId - The user's unique identifier
 * @param properties - Optional user properties for flag evaluation
 * @returns Record of flag names to their values
 *
 * @example
 * const flags = await getAllFeatureFlags("user_123");
 * // flags = { "feature-a": true, "feature-b": "variant-1", ... }
 */
export async function getAllFeatureFlags(
  userId: string,
  properties?: Record<string, string | number | boolean>
): Promise<Record<string, boolean | string>> {
  const client = getClient();
  if (!client) {
    return {};
  }

  try {
    const result = await client.getAllFlags(userId, {
      personProperties: toStringProperties(properties),
    });
    return result ?? {};
  } catch (error) {
    console.error("[PostHog] Error getting all feature flags:", error);
    return {};
  }
}

/**
 * Shutdown the PostHog client and flush any pending events.
 * Call this during graceful shutdown of your application.
 *
 * @example
 * // In a cleanup handler
 * await shutdown();
 */
export async function shutdown(): Promise<void> {
  if (posthogClient) {
    await posthogClient.shutdown();
    posthogClient = null;
    initAttempted = false;
  }
}
