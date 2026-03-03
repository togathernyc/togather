/**
 * Mobile API client - re-exports from shared package
 *
 * This file maintains backward compatibility with existing mobile app code
 * while using the shared API client under the hood.
 *
 * The API client must be initialized by calling initializeMobileApiClient()
 * from apps/mobile/services/api/init.ts at app startup.
 *
 * NOTE: Most API functionality has been migrated to Convex. This module
 * only contains:
 * - api.logout() - clears local tokens
 * - api.registerNewUser() - registers new users via Django API
 * - api.getSubscriptionsList() - fetches subscription plans
 * - Utilities: storage, extractApiData, extractApiError, queryKeys
 */

// Re-export everything from shared package
export {
  initializeApiClient,
  getApiClient,
  getClient,
  getCommunityId,
} from "@togather/shared/api";

export type { ApiClientConfig } from "@togather/shared/api";

// Re-export all services
export * from "@togather/shared/api/services";

// Re-export utilities
export { storage } from "@togather/shared/utils/storage";
export { extractApiData, extractApiError } from "@togather/shared/utils/api-response";
export { queryKeys } from "@togather/shared/utils/query-keys";

// Export initialization function
export { initializeMobileApiClient } from "./init";

// For backward compatibility, export api object
import { api } from "@togather/shared/api/services";
export { api };
