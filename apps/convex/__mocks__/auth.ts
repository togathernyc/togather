/**
 * Mock for Convex auth module
 *
 * This mock allows unit tests to import from authInternal.ts
 * without pulling in jose and other ESM dependencies.
 */

import type { Id } from "../_generated/dataModel";

/**
 * Mock requireAuth - returns a fixed user ID for testing
 */
export async function requireAuth(
  _ctx: unknown,
  _token: string
): Promise<Id<"users">> {
  return "mock-user-id" as Id<"users">;
}

/**
 * Mock getOptionalAuth - returns null for testing
 */
export async function getOptionalAuth(
  _ctx: unknown,
  _token: string | undefined
): Promise<Id<"users"> | null> {
  return null;
}

/**
 * Mock requireAuthUser - returns a mock user for testing
 */
export async function requireAuthUser(_ctx: unknown, _token: string) {
  return {
    _id: "mock-user-id" as Id<"users">,
    firstName: "Mock",
    lastName: "User",
  };
}

/**
 * Mock verifyAccessToken - returns a mock payload for testing
 */
export async function verifyAccessToken(_token: string) {
  return {
    sub: "mock-user-id",
    communityId: "mock-community-id",
    exp: Date.now() / 1000 + 3600,
  };
}
