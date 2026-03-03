// Combined export of all API services
export * from "./auth";
export * from "./admin";

// Export combined API object for convenience
import { authApi } from "./auth";
import { adminApi } from "./admin";

export const api = {
  ...authApi,
  ...adminApi,
};
