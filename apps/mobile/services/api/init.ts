/**
 * Initialize the shared API client for mobile app
 * This should be called once at app startup
 */
import { initializeApiClient } from "@togather/shared/api";
import { Environment } from "@services/environment";

/**
 * Detect environment name from URL for logging purposes.
 * This helps developers see which environment they're actually hitting,
 * regardless of build config.
 */
const getEnvironmentNameFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    // Check for local development hostnames
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)
    ) {
      return "Local";
    }

    // Check for staging hostname
    if (hostname.startsWith("api-staging.")) {
      return "Staging";
    }

    return "Production";
  } catch {
    // Fallback to string matching if URL parsing fails
    if (
      url.includes("localhost") ||
      url.includes("127.0.0.1") ||
      /\b(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url)
    ) {
      return "Local";
    }
    if (url.includes("api-staging.")) {
      return "Staging";
    }
    return "Production";
  }
};

/**
 * Get API base URL from environment config (production/staging based on build variant)
 */
const getApiBaseUrl = () => {
  const baseUrl = Environment.getApiBaseUrl();

  if (__DEV__) {
    // Use actual URL to determine display name, not build config
    // This prevents confusing logs like "Using Production API: https://api-staging..."
    const envName = getEnvironmentNameFromUrl(baseUrl);
    console.log(`🌐 Using ${envName} API: ${baseUrl}`);
  }

  return baseUrl;
};

/**
 * Initialize the API client for mobile app
 * Call this once at app startup
 */
export function initializeMobileApiClient() {
  const baseURL = getApiBaseUrl();

  // Debug: Log the API base URL being used
  if (__DEV__) {
    console.log("🔗 API Base URL:", baseURL);
  }

  return initializeApiClient({
    baseURL,
    timeout: 10000,
  });
}
