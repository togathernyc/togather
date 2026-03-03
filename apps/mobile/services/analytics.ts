/**
 * Analytics Service
 *
 * Helper functions for tracking events and identifying users with PostHog.
 * All methods are safe to call even when PostHog is not initialized.
 */

import { usePostHog } from "posthog-react-native";

/**
 * JSON-serializable value type for PostHog properties.
 */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Properties that can be attached to events.
 * Values must be JSON-serializable (matching PostHog's JsonType).
 */
type EventProperties = Record<string, JsonValue>;

/**
 * Analytics hook for capturing events and managing user identity.
 *
 * @returns Analytics methods that are safe to call even if PostHog is not configured
 *
 * @example
 * const analytics = useAnalytics();
 *
 * // Track an event
 * analytics.capture("button_clicked", { buttonId: "cta-main" });
 *
 * // Identify the user after login
 * analytics.identify(user.id, { email: user.email, plan: "pro" });
 *
 * // Reset on logout
 * analytics.reset();
 */
export function useAnalytics() {
  const posthog = usePostHog();

  return {
    /**
     * Capture an analytics event.
     *
     * @param event - The event name (e.g., "purchase_completed")
     * @param properties - Optional properties to attach to the event
     */
    capture: (event: string, properties?: EventProperties) => {
      posthog?.capture(event, properties);
    },

    /**
     * Identify the current user.
     * Call this after login to associate events with the user.
     *
     * @param userId - The unique user ID
     * @param properties - Optional user properties (email, plan, etc.)
     */
    identify: (userId: string, properties?: EventProperties) => {
      posthog?.identify(userId, properties);
    },

    /**
     * Add properties to the current user.
     * These properties will be included in all future events.
     *
     * @param properties - Properties to add to the user
     */
    setUserProperties: (properties: EventProperties) => {
      // PostHog's identify can be used to update properties
      // without passing a distinct_id again
      if (posthog) {
        posthog.capture("$set", { $set: properties });
      }
    },

    /**
     * Reset the user identity.
     * Call this on logout to clear the current user's data.
     */
    reset: () => {
      posthog?.reset();
    },

    /**
     * Register super properties that will be sent with every event.
     *
     * @param properties - Properties to include in all future events
     */
    register: (properties: EventProperties) => {
      posthog?.register(properties);
    },

    /**
     * Manually trigger a screen view event.
     * Use this to capture screen views with Expo Router.
     *
     * @param screenName - The name of the screen
     * @param properties - Optional additional properties
     */
    screen: (screenName: string, properties?: EventProperties) => {
      posthog?.screen(screenName, properties);
    },

    /**
     * Reload feature flags from PostHog.
     * Useful after user properties change that might affect flag targeting.
     */
    reloadFeatureFlags: () => {
      posthog?.reloadFeatureFlagsAsync();
    },

    /**
     * Check if PostHog is initialized and ready.
     */
    isReady: () => {
      return posthog !== null && posthog !== undefined;
    },
  };
}
