import { createApiClient, ApiClient, ApiClientConfig } from "./client";

// Global API client instance
let apiClientInstance: ApiClient | null = null;

/**
 * Initialize the API client with configuration
 * This should be called once at app startup
 */
export function initializeApiClient(config: ApiClientConfig): ApiClient {
  apiClientInstance = createApiClient(config);
  return apiClientInstance;
}

/**
 * Get the current API client instance
 * Throws if not initialized
 */
export function getApiClient(): ApiClient {
  if (!apiClientInstance) {
    throw new Error(
      "API client not initialized. Call initializeApiClient() first."
    );
  }
  return apiClientInstance;
}

/**
 * Get the axios client instance for direct use
 */
export function getClient() {
  return getApiClient().getClient();
}

/**
 * Get community ID helper (for use in service modules)
 */
export async function getCommunityId(): Promise<string | null> {
  return getApiClient().getCommunityId();
}

