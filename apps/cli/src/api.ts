import { anyApi } from "convex/server";

/**
 * We use anyApi since the CLI is a separate package from the Convex backend.
 * This gives us the function references without needing generated types.
 * Type safety comes from the server-side validators.
 */
export const api = anyApi;
