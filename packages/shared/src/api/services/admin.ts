import { getClient } from "../instance";

/**
 * Admin API - minimal set of methods still needed for REST API calls.
 * Most admin functionality has been migrated to Convex.
 *
 * Still in use:
 * - getSubscriptionsList: Fetches subscription plans from Django API
 */
export const adminApi = {
  /**
   * Fetches subscription plans from the payments API.
   * Used by pricing and get-started pages.
   */
  async getSubscriptionsList() {
    const client = getClient();
    try {
      const response = await client.get("/api/payments/subscriptions/plans");
      return response.data;
    } catch (error) {
      // Fallback to empty array if endpoint doesn't exist
      console.warn("Subscriptions endpoint not available:", error);
      return { data: [] };
    }
  },
};

