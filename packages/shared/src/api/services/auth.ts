import { getClient } from "../instance";
import { storage } from "../../utils/storage";
import { extractApiData } from "../../utils/api-response";

/**
 * Auth API - minimal set of methods still needed for REST API calls.
 * Most auth functionality has been migrated to Convex.
 *
 * Still in use:
 * - logout: Clears local tokens
 * - registerNewUser: Registers new users via Django API
 */
export const authApi = {
  /**
   * Clears auth tokens from local storage.
   * Used by AuthProvider during logout.
   */
  async logout() {
    await storage.removeItem("access_token");
    await storage.removeItem("refresh_token");
  },

  /**
   * Registers a new user via the Django API.
   * Called after phone verification for new users who need to create an account.
   */
  async registerNewUser(params: {
    phone: string;
    countryCode: string;
    otp: string;
    firstName: string;
    lastName: string;
    email: string;
    dateOfBirth?: string;
  }) {
    const client = getClient();
    const response = await client.post("/api/users/auth/phone/register-new-user", {
      phone: params.phone,
      country_code: params.countryCode,
      otp: params.otp,
      first_name: params.firstName,
      last_name: params.lastName,
      email: params.email,
      date_of_birth: params.dateOfBirth,
    });

    const responseData = extractApiData(response) as any;

    if (responseData?.access_token || responseData?.access) {
      const accessToken = responseData.access_token || responseData.access;
      const refreshToken = responseData.refresh_token || responseData.refresh;

      try {
        await storage.setItem("access_token", accessToken);
        await storage.setItem("refresh_token", refreshToken || "");
      } catch (storageError) {
        console.error("Failed to store tokens:", storageError);
      }
    } else {
      console.error("No tokens in response:", response.data);
      const error = new Error("No access token received from server");
      (error as any).response = { data: response.data };
      throw error;
    }
    return responseData;
  },
};

