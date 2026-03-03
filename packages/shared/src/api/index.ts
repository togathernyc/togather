// Main API exports
export { initializeApiClient, getApiClient, getClient, getCommunityId } from "./instance";
export type { ApiClientConfig } from "./client";

// Export all services
export * from "./services";

// Re-export utilities for convenience
export { storage } from "../utils/storage";
export { extractApiData, extractApiError } from "../utils/api-response";
export { queryKeys } from "../utils/query-keys";

