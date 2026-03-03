import axios, { AxiosInstance, AxiosError } from "axios";
import { storage } from "../utils/storage";
import { extractApiData } from "../utils/api-response";

export interface ApiClientConfig {
  baseURL: string;
  getCommunityId?: () => Promise<string | null>;
  timeout?: number;
}

/**
 * Helper function to get community ID from storage
 * Uses storage abstraction to work on both web and mobile
 */
async function getCommunityIdFromStorage(): Promise<string | null> {
  try {
    // Try newCommunityId first (preferred)
    const newCommunityId = await storage.getItem("newCommunityId");
    if (newCommunityId) return newCommunityId;

    // Fallback to current_community
    const communityId = await storage.getItem("current_community");
    return communityId;
  } catch (error) {
    console.error("Error getting community ID from storage:", error);
    return null;
  }
}

export class ApiClient {
  private client: AxiosInstance;
  private config: ApiClientConfig;
  private getCommunityIdFn: () => Promise<string | null>;

  constructor(config: ApiClientConfig) {
    this.config = config;
    // Ensure getCommunityIdFn is always defined
    this.getCommunityIdFn = config.getCommunityId || getCommunityIdFromStorage || (async () => null);

    this.client = axios.create({
      baseURL: config.baseURL,
      headers: {
        "Content-Type": "application/json",
      },
      timeout: config.timeout || 10000,
    });

    // Request interceptor: Add auth token and replace :communityID placeholder
    this.client.interceptors.request.use(
      async (config) => {
        const token = await storage.getItem("access_token");
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }

        // Replace :communityID placeholder in URL if present
        if (config.url?.includes(":communityID")) {
          const communityId = await this.getCommunityIdFn();
          if (communityId) {
            config.url = config.url.replace(":communityID", communityId);
          }
        }

        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor: Handle token refresh
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as any;

        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          // Try to refresh token
          const refreshed = await this.refreshToken();
          if (refreshed) {
            // Retry original request with new token
            const newToken = await storage.getItem("access_token");
            if (newToken) {
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
              return this.client.request(originalRequest);
            }
          }
        }

        return Promise.reject(error);
      }
    );
  }

  private async refreshToken(): Promise<boolean> {
    try {
      const refreshToken = await storage.getItem("refresh_token");
      if (!refreshToken) return false;

      // Get community_id from storage
      const communityId = await this.getCommunityIdFn();

      // Parse community_id if it exists
      let community_id: number | undefined;
      if (communityId) {
        const parsed = parseInt(communityId, 10);
        if (!isNaN(parsed)) {
          community_id = parsed;
        }
      }

      const payload: any = {
        refresh: refreshToken,
      };

      if (community_id) {
        payload.community_id = community_id;
      }

      const response = await axios.post(
        `${this.config.baseURL}/auth/token/refresh/`,
        payload
      );

      // Extract data using shared utility (handles errors and nested structure)
      const responseData = extractApiData<{
        access_token?: string;
        access?: string;
        refresh_token?: string;
        refresh?: string;
      }>(response);

      await storage.setItem(
        "access_token",
        responseData.access_token || responseData.access || ""
      );
      if (responseData.refresh_token || responseData.refresh) {
        await storage.setItem(
          "refresh_token",
          responseData.refresh_token || responseData.refresh || ""
        );
      }
      return true;
    } catch (error) {
      console.error("Token refresh failed:", error);
      return false;
    }
  }

  // Expose the client for use in feature modules
  getClient(): AxiosInstance {
    return this.client;
  }

  // Expose API_BASE_URL for use in feature modules if needed
  getBaseUrl(): string {
    return this.config.baseURL;
  }

  // Expose getCommunityId for use in service modules
  async getCommunityId(): Promise<string | null> {
    if (!this.getCommunityIdFn) {
      return null;
    }
    return this.getCommunityIdFn();
  }
}

// Factory function to create API client instance
// This will be configured by the consuming app (mobile or web)
export function createApiClient(config: ApiClientConfig): ApiClient {
  return new ApiClient(config);
}

// Export a helper to get community ID (for use in service modules)
export async function getCommunityId(): Promise<string | null> {
  return getCommunityIdFromStorage();
}

