/**
 * Sentry Error Tracking Provider
 *
 * Wraps the app with Sentry for error tracking and performance monitoring.
 * Requires EXPO_PUBLIC_SENTRY_DSN environment variable.
 *
 * If the DSN is not set, the provider renders children without
 * Sentry integration (error tracking becomes no-ops).
 *
 * Environment is automatically attached to all events for filtering
 * in Sentry dashboard (staging vs production).
 *
 * IMPORTANT: This provider gracefully handles OTA updates where the native
 * Sentry module may not be available:
 * - New builds (has native Sentry): Full native error tracking + performance
 * - Old builds (no native): JS-only error tracking via @sentry/browser fallback
 *
 * This allows the same JS bundle to work on both old and new native builds.
 */

import React, { useEffect, useRef } from "react";
import * as SentryNative from "@sentry/react-native";
import * as SentryBrowser from "@sentry/browser";
import { NativeModules } from "react-native";
import { Environment } from "@services/environment";

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

/**
 * Check if the native Sentry module is available.
 * This will be false for OTA updates to builds that don't have Sentry native code.
 */
const SENTRY_NATIVE_AVAILABLE = !!NativeModules.RNSentry;

/**
 * Use native Sentry when available, otherwise fall back to browser (JS-only) version.
 * Both have compatible APIs for the features we use.
 */
const Sentry = SENTRY_NATIVE_AVAILABLE ? SentryNative : SentryBrowser;

/**
 * Get the current environment name for Sentry tracking.
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

// Initialize Sentry at module load
// This needs to happen as early as possible
if (SENTRY_DSN) {
  const environment = getEnvironmentName();
  const isNative = SENTRY_NATIVE_AVAILABLE;

  if (isNative) {
    // Full native initialization with performance monitoring
    SentryNative.init({
      dsn: SENTRY_DSN,
      environment,
      // Enable performance monitoring
      tracesSampleRate: __DEV__ ? 1.0 : 0.2, // 100% in dev, 20% in prod
      // Enable automatic breadcrumbs
      enableAutoPerformanceTracing: true,
      enableAutoSessionTracking: true,
      // Don't send events in development (but still initialize for testing)
      enabled: !__DEV__,
      // Debug mode for development
      debug: __DEV__,
      // Attach stack traces to all messages
      attachStacktrace: true,
      // Normalize paths for consistent stack traces
      normalizeDepth: 10,
      beforeSend(event) {
        // Add tag to identify this came from native SDK
        event.tags = { ...event.tags, sdk_type: "native" };
        return event;
      },
      beforeBreadcrumb(breadcrumb) {
        return breadcrumb;
      },
    });
  } else {
    // JS-only initialization (fallback for OTA to old builds)
    SentryBrowser.init({
      dsn: SENTRY_DSN,
      environment,
      // Lower sample rate for JS-only since we have less visibility
      tracesSampleRate: __DEV__ ? 1.0 : 0.1,
      // Don't send events in development
      enabled: !__DEV__,
      debug: __DEV__,
      attachStacktrace: true,
      normalizeDepth: 10,
      beforeSend(event) {
        // Add tag to identify this came from browser (JS-only) SDK
        event.tags = { ...event.tags, sdk_type: "browser_fallback" };
        return event;
      },
    });
  }

  if (__DEV__) {
    console.log(
      `[Sentry] Initialized with environment: ${environment} ` +
      `(${isNative ? "native" : "JS-only fallback"})`
    );
  }
} else if (__DEV__) {
  console.warn(
    "[Sentry] EXPO_PUBLIC_SENTRY_DSN is not set. " +
    "Error tracking will be disabled."
  );
}

interface SentryProviderProps {
  children: React.ReactNode;
}

/**
 * Context manager for Sentry user identification.
 * Wraps children and handles user context updates.
 */
function SentryContextManager({ children }: { children: React.ReactNode }) {
  const initialized = useRef(false);

  useEffect(() => {
    if (SENTRY_DSN && !initialized.current) {
      // Set initial tags that apply to all events
      Sentry.setTag("app.environment", getEnvironmentName());
      Sentry.setTag("sdk.native_available", String(SENTRY_NATIVE_AVAILABLE));
      initialized.current = true;
    }
  }, []);

  return <>{children}</>;
}

/**
 * Sentry Provider component.
 *
 * Wraps children with Sentry error tracking if DSN is configured.
 * Falls back to rendering children directly if not configured.
 */
export function SentryProvider({ children }: SentryProviderProps) {
  // If no DSN is configured, render children without Sentry
  if (!SENTRY_DSN) {
    return <>{children}</>;
  }

  return <SentryContextManager>{children}</SentryContextManager>;
}

// Type for severity level that works with both SDKs
type SeverityLevel = "fatal" | "error" | "warning" | "log" | "info" | "debug";

/**
 * Utility functions for Sentry that can be used throughout the app.
 * These work with both native and browser SDKs.
 */
export const SentryUtils = {
  /**
   * Check if Sentry is using the native SDK or JS-only fallback.
   */
  isNative: () => SENTRY_NATIVE_AVAILABLE,

  /**
   * Identify the current user for Sentry.
   * Call this after login to associate errors with the user.
   */
  identifyUser: (user: { id: string; email?: string; username?: string }) => {
    if (!SENTRY_DSN) return;

    Sentry.setUser({
      id: user.id,
      email: user.email,
      username: user.username,
    });
  },

  /**
   * Clear the current user from Sentry.
   * Call this on logout.
   */
  clearUser: () => {
    if (!SENTRY_DSN) return;

    Sentry.setUser(null);
  },

  /**
   * Capture an exception manually.
   * Use this for caught errors that you want to track.
   */
  captureException: (error: Error, context?: Record<string, unknown>) => {
    if (!SENTRY_DSN) {
      if (__DEV__) {
        console.error("[Sentry] Would capture exception:", error, context);
      }
      return;
    }

    Sentry.withScope((scope) => {
      if (context) {
        Object.entries(context).forEach(([key, value]) => {
          scope.setExtra(key, value);
        });
      }
      Sentry.captureException(error);
    });
  },

  /**
   * Capture a message manually.
   * Use this for non-error events you want to track.
   */
  captureMessage: (
    message: string,
    level: SeverityLevel = "info",
    context?: Record<string, unknown>
  ) => {
    if (!SENTRY_DSN) {
      if (__DEV__) {
        console.log(`[Sentry] Would capture message (${level}):`, message, context);
      }
      return;
    }

    Sentry.withScope((scope) => {
      if (context) {
        Object.entries(context).forEach(([key, value]) => {
          scope.setExtra(key, value);
        });
      }
      Sentry.captureMessage(message, level);
    });
  },

  /**
   * Add a breadcrumb for debugging.
   * Breadcrumbs are attached to the next error and help debug what happened.
   */
  addBreadcrumb: (
    message: string,
    category: string,
    data?: Record<string, unknown>,
    level: SeverityLevel = "info"
  ) => {
    if (!SENTRY_DSN) return;

    Sentry.addBreadcrumb({
      category,
      message,
      level,
      data,
    });
  },

  /**
   * Set a tag that will be attached to all future events.
   */
  setTag: (key: string, value: string) => {
    if (!SENTRY_DSN) return;

    Sentry.setTag(key, value);
  },

  /**
   * Set extra context data for the current scope.
   */
  setContext: (name: string, context: Record<string, unknown>) => {
    if (!SENTRY_DSN) return;

    Sentry.setContext(name, context);
  },

  /**
   * Check if Sentry is initialized and ready.
   */
  isReady: () => {
    return SENTRY_DSN !== undefined && SENTRY_DSN !== "";
  },
};

export default SentryProvider;
