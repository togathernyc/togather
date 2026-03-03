/**
 * PostHog Analytics Provider
 *
 * Wraps the app with PostHog for analytics and feature flags.
 * Requires EXPO_PUBLIC_POSTHOG_API_KEY environment variable.
 *
 * If the API key is not set, the provider renders children without
 * PostHog integration (analytics calls become no-ops).
 *
 * Environment is automatically attached to all events for filtering
 * in PostHog dashboard (staging vs production).
 */

import React, { useEffect, useRef } from "react";
import {
  PostHogProvider as RNPostHogProvider,
  usePostHog,
} from "posthog-react-native";
import { Environment } from "@services/environment";

const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const POSTHOG_HOST = "https://us.i.posthog.com";

// Log warning once at module load, not on every render
if (!POSTHOG_API_KEY && __DEV__) {
  console.warn(
    "[PostHog] EXPO_PUBLIC_POSTHOG_API_KEY is not set. " +
    "Analytics and feature flags will be disabled."
  );
}

/**
 * Get the current environment name for PostHog tracking.
 * Returns "development", "staging", or "production".
 */
function getEnvironmentName(): string {
  if (__DEV__) {
    return "development";
  }
  if (Environment.isStaging()) {
    return "staging";
  }
  return "production";
}

interface PostHogProviderProps {
  children: React.ReactNode;
}

/**
 * Registers environment as a super property on PostHog.
 * This ensures all events include the environment for filtering.
 */
function PostHogEnvironmentRegistrar({ children }: { children: React.ReactNode }) {
  const posthog = usePostHog();
  const registered = useRef(false);

  useEffect(() => {
    if (posthog && !registered.current) {
      const environment = getEnvironmentName();
      // Register environment as a super property - included with all events
      posthog.register({
        environment,
        app_environment: environment, // Alias for clarity in PostHog
      });
      registered.current = true;

      if (__DEV__) {
        console.log(`[PostHog] Registered environment: ${environment}`);
      }
    }
  }, [posthog]);

  return <>{children}</>;
}

/**
 * PostHog Provider component.
 *
 * Wraps children with PostHog analytics if API key is configured.
 * Falls back to rendering children directly if not configured.
 *
 * Note: Screen capture for Expo Router requires manual setup.
 * See: https://posthog.com/docs/libraries/react-native#capturing-screen-views
 */
export function PostHogProvider({ children }: PostHogProviderProps) {
  // If no API key is configured, render children without PostHog
  // Warning is logged at module level to avoid spam on re-renders
  if (!POSTHOG_API_KEY) {
    return <>{children}</>;
  }

  return (
    <RNPostHogProvider
      apiKey={POSTHOG_API_KEY}
      options={{
        host: POSTHOG_HOST,
      }}
      autocapture={{
        captureTouches: true,
        // Screen capture requires manual setup with Expo Router
        // See: https://docs.expo.dev/router/reference/screen-tracking/
        captureScreens: false,
      }}
    >
      <PostHogEnvironmentRegistrar>{children}</PostHogEnvironmentRegistrar>
    </RNPostHogProvider>
  );
}

export default PostHogProvider;
