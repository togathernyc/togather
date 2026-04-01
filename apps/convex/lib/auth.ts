/**
 * Custom JWT-based Authentication for Convex
 *
 * This module provides JWT token generation and verification for authenticating
 * users in Convex functions. It mirrors the authentication approach used in the
 * tRPC backend (apps/api-trpc/src/lib/jwt.ts) but uses the `jose` library which
 * is compatible with the Convex runtime (edge/serverless environment).
 *
 * Key differences from @convex-dev/auth:
 * - No session table or session management in Convex
 * - Tokens are stateless JWTs verified by signature
 * - Client must pass token explicitly (header or argument)
 *
 * Token Flow:
 * 1. User authenticates (phone OTP, password, etc.)
 * 2. Server generates access_token (3 days) and refresh_token (10 years)
 * 3. Client stores tokens in AsyncStorage
 * 4. Access token includes userId and optional communityId
 * 5. Refresh token only includes userId (community selected on refresh)
 *
 * Pattern for protected queries/mutations:
 * 1. Client includes JWT token in function args
 * 2. Function calls requireAuth(ctx, token), or in actions requireAuthFromTokenAction(ctx, token)
 * 3. Helper verifies token and returns userId (Convex ID)
 * 4. Function uses userId to fetch user data and perform authorized operations
 *
 * @see apps/api-trpc/src/lib/jwt.ts for the original tRPC implementation
 */

import * as jose from "jose";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";

// ============================================================================
// Configuration
// ============================================================================

const ACCESS_TOKEN_EXPIRY = "30d"; // 30 days
const REFRESH_TOKEN_EXPIRY = "520w"; // ~10 years

/** Wall-clock max lifetime of refresh tokens in ms; must stay in sync with REFRESH_TOKEN_EXPIRY. */
export const REFRESH_TOKEN_MAX_AGE_MS = 520 * 7 * 24 * 60 * 60 * 1000;
const OAUTH_STATE_EXPIRY = "10m"; // 10 minutes for OAuth state tokens

/**
 * Access token expires in seconds (30 days)
 */
const ACCESS_TOKEN_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 2592000 seconds

/**
 * Get the JWT secret from environment.
 * Throws an error if not configured - no hardcoded fallback for security.
 */
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not configured");
  }

  // Reject the known weak default secret even if explicitly set
  if (secret === "default-secret-change-in-production") {
    throw new Error("JWT_SECRET must be set to a secure, random value");
  }

  // Require minimum length for security
  if (secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }

  return new TextEncoder().encode(secret);
}

// ============================================================================
// Custom Error Types
// ============================================================================

/**
 * Authentication error thrown when token verification fails.
 */
export class AuthenticationError extends Error {
  constructor(message: string = "Not authenticated") {
    super(message);
    this.name = "AuthenticationError";
  }
}

// ============================================================================
// Token Payload Types
// ============================================================================

/**
 * Access token payload structure
 * Includes userId and optional communityId for authorization
 */
export interface AccessTokenPayload {
  userId: string; // Convex user ID (e.g., "jh7xyz123...")
  communityId?: string; // Optional Convex community ID
  type: "access";
  issuedAt?: number; // Unix timestamp (seconds) from JWT iat claim
}

/**
 * Refresh token payload structure
 * Only includes userId - community is selected on refresh
 */
export interface RefreshTokenPayload {
  userId: string;
  type: "refresh";
  /** Unix timestamp (seconds) from JWT iat claim */
  issuedAt?: number;
}

/**
 * OAuth state token payload for CSRF protection in OAuth flows
 */
export interface OAuthStatePayload {
  userId: string;
  communityId: number;
  redirectUri?: string;
  type: "oauth_state";
}

/**
 * Result from token generation
 */
export interface TokenGenerationResult {
  /** JWT access token for API requests */
  accessToken: string;
  /** JWT refresh token for obtaining new access tokens */
  refreshToken: string;
  /** Access token expiry time in seconds */
  expiresIn: number;
}

// ============================================================================
// Token Generation (for auth actions)
// ============================================================================

/**
 * Generate access and refresh tokens for a user.
 *
 * Creates a pair of JWTs:
 * - Access token: Short-lived (3 days), includes communityId if provided
 * - Refresh token: Long-lived (10 years), only includes userId
 *
 * @param userId - User's ID (Convex ID or legacy ID as string)
 * @param communityId - Optional community ID to scope the access token
 * @returns Object containing accessToken, refreshToken, and expiresIn (seconds)
 *
 * @example
 * ```ts
 * const { accessToken, refreshToken, expiresIn } = await generateTokens(
 *   user._id, // Convex ID
 *   user.communityId
 * );
 * ```
 */
export async function generateTokens(
  userId: string,
  communityId?: string,
): Promise<TokenGenerationResult> {
  const secret = getJwtSecret();

  // Access token includes community_id if provided
  const accessPayload: AccessTokenPayload = {
    userId,
    type: "access",
    ...(communityId && { communityId }),
  };

  // Refresh token only includes user_id (community selected on refresh)
  const refreshPayload: RefreshTokenPayload = {
    userId,
    type: "refresh",
  };

  // Generate access token
  const accessToken = await new jose.SignJWT(
    accessPayload as unknown as jose.JWTPayload,
  )
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(secret);

  // Generate refresh token
  const refreshToken = await new jose.SignJWT(
    refreshPayload as unknown as jose.JWTPayload,
  )
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(secret);

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
  };
}

/**
 * Generate tokens for a legacy user ID (BigInt format).
 *
 * The tRPC backend uses BigInt user IDs. This function converts to string
 * for JWT encoding (JWTs can't encode BigInt directly).
 *
 * @param userId - User's legacy BigInt ID
 * @param communityId - Optional community ID (as number)
 * @returns Token generation result
 */
export async function generateTokensForLegacyId(
  userId: bigint,
  communityId?: number,
): Promise<TokenGenerationResult> {
  return generateTokens(userId.toString(), communityId?.toString());
}

// ============================================================================
// Token Verification
// ============================================================================

/**
 * Verify and decode an access token
 *
 * @param token - JWT access token
 * @returns Decoded payload with userId and optional communityId, or null if invalid
 */
export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenPayload | null> {
  try {
    const secret = getJwtSecret();
    const { payload } = await jose.jwtVerify(token, secret);

    if (payload.type !== "access") {
      return null;
    }

    return {
      userId: payload.userId as string,
      communityId: payload.communityId as string | undefined,
      type: "access",
      issuedAt: payload.iat,
    };
  } catch {
    // Token is invalid, expired, or malformed
    return null;
  }
}

/**
 * Verify and decode a refresh token
 *
 * @param token - JWT refresh token
 * @returns Decoded payload with userId, or null if invalid
 */
export async function verifyRefreshToken(
  token: string,
): Promise<RefreshTokenPayload | null> {
  try {
    const secret = getJwtSecret();
    const { payload } = await jose.jwtVerify(token, secret);

    if (payload.type !== "refresh") {
      return null;
    }

    return {
      userId: payload.userId as string,
      type: "refresh",
      issuedAt: payload.iat,
    };
  } catch {
    // Token is invalid, expired, or malformed
    return null;
  }
}

/**
 * Synchronous version of verifyAccessToken for queries/mutations
 * Uses jose.decodeJwt for decoding but also validates signature
 *
 * Note: This is async because jose.jwtVerify is async
 */
export async function verifyAccessTokenSync(
  token: string,
): Promise<AccessTokenPayload | null> {
  return verifyAccessToken(token);
}

/**
 * Decode a JWT token WITHOUT signature verification.
 *
 * WARNING: Only use this in development for specific test endpoints.
 * This allows tokens signed by different secrets (e.g., production/staging)
 * to be used against a local dev server.
 *
 * SECURITY NOTE: This function is only called from the tRPC backend (apps/api-trpc),
 * where devToolsEnabled is validated server-side. Never expose this function to
 * client-controlled Convex actions/mutations that accept devToolsEnabled as a parameter.
 *
 * @param token - JWT access token
 * @param devToolsEnabled - Server-validated flag indicating dev tools are enabled
 * @returns Decoded payload with userId and optional communityId, or null if malformed
 * @throws Error if called in production environment without devToolsEnabled
 */
export function decodeTokenUnsafe(
  token: string,
  devToolsEnabled?: boolean,
): AccessTokenPayload | null {
  // Defense-in-depth: throw if accidentally called in production (unless dev tools enabled via server-side validation)
  if (process.env.NODE_ENV === "production" && devToolsEnabled !== true) {
    throw new Error("decodeTokenUnsafe cannot be used in production");
  }

  try {
    // jose.decodeJwt() does NOT verify the signature
    const decoded = jose.decodeJwt(token);

    if (!decoded || decoded.type !== "access" || !decoded.userId) {
      return null;
    }

    return {
      userId: decoded.userId as string,
      communityId: decoded.communityId as string | undefined,
      type: "access",
    };
  } catch {
    return null;
  }
}

// ============================================================================
// User Lookup Helpers
// ============================================================================

/**
 * Look up a Convex user by their legacy ID
 *
 * The JWT tokens may contain legacy (Supabase) user IDs, so we need to
 * map them to Convex user IDs.
 */
async function getUserByLegacyId(
  ctx: QueryCtx | MutationCtx,
  legacyId: string,
): Promise<Id<"users"> | null> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_legacyId", (q) => q.eq("legacyId", legacyId))
    .first();

  return user?._id ?? null;
}

/**
 * Look up a Convex user by their Convex ID
 * Returns the user ID if the user exists, null otherwise
 */
async function getUserByConvexId(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<Id<"users"> | null> {
  try {
    const user = await ctx.db.get(userId as Id<"users">);
    return user?._id ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve a user ID from a token payload
 * Handles both legacy IDs and Convex IDs
 */
async function resolveUserId(
  ctx: QueryCtx | MutationCtx,
  tokenUserId: string,
): Promise<Id<"users"> | null> {
  // First, try to look up as a Convex ID
  const convexUser = await getUserByConvexId(ctx, tokenUserId);
  if (convexUser) {
    return convexUser;
  }

  // Fall back to legacy ID lookup
  return getUserByLegacyId(ctx, tokenUserId);
}

/**
 * Check if a token has been revoked via signout.
 *
 * Compares the token's issued-at time against the user's latest revocation
 * timestamp. If the token was issued before the user signed out, it's rejected.
 *
 * @param ctx - Convex query or mutation context
 * @param userId - Resolved Convex user ID
 * @param issuedAt - Token's iat claim (Unix whole seconds), undefined if missing
 * @returns true if the token is revoked
 */
export async function isTokenRevoked(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  issuedAt: number | undefined,
): Promise<boolean> {
  const revocation = await ctx.db
    .query("tokenRevocations")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();

  if (!revocation) {
    return false;
  }

  // If the token has no iat claim, treat it as revoked (legacy tokens
  // without iat should be re-issued after a signout)
  if (issuedAt === undefined) {
    return true;
  }

  // JWT iat is whole Unix seconds; revokedBefore is ms. Compare in seconds so a token
  // issued in the same second as signout is not falsely rejected (iat * 1000 is only
  // the start of that second).
  const cutoffSec = Math.floor(revocation.revokedBefore / 1000);
  return issuedAt < cutoffSec;
}

/**
 * Whether a JWT for this subject (Convex or legacy id string) was issued before
 * the user's last signout. Used for refresh tokens (same iat semantics as access).
 */
export async function isRevokedForJwtSubject(
  ctx: QueryCtx | MutationCtx,
  jwtUserId: string,
  issuedAt: number | undefined,
): Promise<boolean> {
  const userId = await resolveUserId(ctx, jwtUserId);
  if (!userId) {
    return true;
  }
  return isTokenRevoked(ctx, userId, issuedAt);
}

// ============================================================================
// Auth Helpers for Queries/Mutations
// ============================================================================

/**
 * Require authentication for a query or mutation
 *
 * Verifies the JWT token and returns the Convex user ID.
 * Throws an error if the token is invalid or user not found.
 *
 * @param ctx - Convex query or mutation context
 * @param token - JWT access token
 * @returns Convex user ID
 * @throws Error if not authenticated
 *
 * @example
 * ```ts
 * export const myProtectedQuery = query({
 *   args: { token: v.string() },
 *   handler: async (ctx, args) => {
 *     const userId = await requireAuth(ctx, args.token);
 *     // ... rest of handler
 *   },
 * });
 * ```
 */
export async function requireAuth(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<Id<"users">> {
  if (!token) {
    throw new Error("Not authenticated");
  }

  const payload = await verifyAccessToken(token);
  if (!payload) {
    throw new Error("Not authenticated");
  }

  // Resolve user ID (handles both Convex and legacy IDs)
  const userId = await resolveUserId(ctx, payload.userId);
  if (!userId) {
    throw new Error("Not authenticated");
  }

  // Check if the token was revoked (issued before the user's last signout)
  if (await isTokenRevoked(ctx, userId, payload.issuedAt)) {
    throw new Error("Not authenticated");
  }

  return userId;
}

/**
 * Like {@link requireAuth} but skips revocation — used by signout so another
 * device can finish logout after tokens were already blacklisted.
 */
export async function requireAuthIgnoringRevocation(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<Id<"users">> {
  if (!token) {
    throw new Error("Not authenticated");
  }

  const payload = await verifyAccessToken(token);
  if (!payload) {
    throw new Error("Not authenticated");
  }

  const userId = await resolveUserId(ctx, payload.userId);
  if (!userId) {
    throw new Error("Not authenticated");
  }

  return userId;
}

/**
 * Get optional authentication for a query or mutation
 *
 * Verifies the JWT token if provided and returns the Convex user ID.
 * Returns null if no token provided or token is invalid.
 *
 * Use this for queries that work for both authenticated and anonymous users.
 *
 * @param ctx - Convex query or mutation context
 * @param token - Optional JWT access token
 * @returns Convex user ID or null
 *
 * @example
 * ```ts
 * export const myOptionalAuthQuery = query({
 *   args: { token: v.optional(v.string()) },
 *   handler: async (ctx, args) => {
 *     const userId = await getOptionalAuth(ctx, args.token);
 *     if (userId) {
 *       // User is authenticated
 *     } else {
 *       // Anonymous access
 *     }
 *   },
 * });
 * ```
 */
export async function getOptionalAuth(
  ctx: QueryCtx | MutationCtx,
  token: string | undefined,
): Promise<Id<"users"> | null> {
  if (!token) {
    return null;
  }

  const payload = await verifyAccessToken(token);
  if (!payload) {
    return null;
  }

  const userId = await resolveUserId(ctx, payload.userId);
  if (!userId) {
    return null;
  }

  // Check if the token was revoked (issued before the user's last signout)
  if (await isTokenRevoked(ctx, userId, payload.issuedAt)) {
    return null;
  }

  return userId;
}

/**
 * Require authentication and return the full user document
 *
 * @param ctx - Convex query or mutation context
 * @param token - JWT access token
 * @returns User document
 * @throws Error if not authenticated or user not found
 */
export async function requireAuthUser(
  ctx: QueryCtx | MutationCtx,
  token: string,
) {
  const userId = await requireAuth(ctx, token);
  const user = await ctx.db.get(userId);
  if (!user) {
    throw new Error("User not found");
  }
  return user;
}

/**
 * Get the community ID from a token payload
 *
 * @param token - JWT access token
 * @returns Community ID or undefined
 */
export async function getCommunityFromToken(
  token: string,
): Promise<string | undefined> {
  const payload = await verifyAccessToken(token);
  return payload?.communityId;
}

// ============================================================================
// Auth from client-supplied access token in actions
// ============================================================================

/**
 * Verifies the JWT access token and checks the token revocation blacklist via
 * an internal query. Use this in actions where you have `ctx`.
 *
 * @param ctx - Convex action context
 * @param token - JWT access token
 * @returns The authenticated user's ID from the token payload
 * @throws AuthenticationError if token is missing, invalid, expired, or revoked
 */
export async function requireAuthFromTokenAction(
  ctx: ActionCtx,
  token: string | undefined,
): Promise<string> {
  if (!token) {
    throw new AuthenticationError("No authentication token provided");
  }

  const payload = await verifyAccessToken(token);
  if (!payload) {
    throw new AuthenticationError("Invalid or expired authentication token");
  }

  const revoked = await ctx.runQuery(
    internal.functions.authInternal.isJwtSubjectRevokedInternal,
    { jwtUserId: payload.userId, issuedAt: payload.issuedAt },
  );
  if (revoked) {
    throw new AuthenticationError("Session revoked");
  }

  return payload.userId;
}

/**
 * Verify authentication from a token, returning the payload or null.
 *
 * Similar to {@link verifyAccessToken} but returns null instead of throwing for missing token.
 * Useful for optional authentication or when you want to handle unauthenticated
 * users differently.
 *
 * @param token - JWT access token (passed from client)
 * @returns The token payload with userId and communityId, or null if invalid
 *
 * @example
 * ```ts
 * export const myOptionalAuthAction = action({
 *   args: { token: v.optional(v.string()) },
 *   handler: async (ctx, args) => {
 *     const auth = await verifyAuthFromToken(args.token);
 *     if (auth) {
 *       // Authenticated user
 *       console.log("User ID:", auth.userId);
 *     } else {
 *       // Anonymous user
 *     }
 *   },
 * });
 * ```
 */
export async function verifyAuthFromToken(
  token: string | undefined,
): Promise<AccessTokenPayload | null> {
  if (!token) {
    return null;
  }

  return verifyAccessToken(token);
}

// ============================================================================
// HTTP Helper Functions
// ============================================================================

/**
 * Extract the authorization token from request headers.
 *
 * Useful for HTTP actions that receive tokens in the Authorization header.
 * Supports "Bearer <token>" format.
 *
 * @param request - HTTP Request object
 * @returns The token string, or null if not present or malformed
 *
 * @example
 * ```ts
 * http.route({
 *   path: "/api/protected",
 *   method: "GET",
 *   handler: httpAction(async (ctx, request) => {
 *     const token = extractTokenFromHeaders(request);
 *     const userId = await requireAuthFromTokenAction(ctx, token);
 *     // ... handle authenticated request
 *   }),
 * });
 * ```
 */
export function extractTokenFromHeaders(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return null;
  }

  // Support "Bearer <token>" format
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Also support raw token
  return authHeader;
}

// ============================================================================
// OAuth State Tokens (for external OAuth flows)
// ============================================================================

/**
 * Sign OAuth state data as a JWT token.
 *
 * Used for CSRF protection in OAuth flows (e.g., Planning Center integration).
 * The state token is passed to the OAuth provider and verified on callback.
 *
 * @param userId - User's ID
 * @param communityId - Community ID
 * @param redirectUri - Optional redirect URI after OAuth completes
 * @returns Signed JWT token
 */
export async function signOAuthState(
  userId: string,
  communityId: number,
  redirectUri?: string,
): Promise<string> {
  const secret = getJwtSecret();

  const payload: Record<string, unknown> = {
    userId,
    communityId,
    type: "oauth_state",
  };
  if (redirectUri) {
    payload.redirectUri = redirectUri;
  }

  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(OAUTH_STATE_EXPIRY)
    .sign(secret);
}

/**
 * Verify and decode an OAuth state token.
 *
 * @param token - JWT state token from OAuth callback
 * @returns Decoded payload or null if invalid/expired
 */
export async function verifyOAuthState(
  token: string,
): Promise<OAuthStatePayload | null> {
  try {
    const secret = getJwtSecret();

    const { payload } = await jose.jwtVerify(token, secret);

    if (payload.type !== "oauth_state") {
      return null;
    }

    if (
      typeof payload.userId !== "string" ||
      typeof payload.communityId !== "number"
    ) {
      return null;
    }

    return {
      userId: payload.userId,
      communityId: payload.communityId,
      redirectUri:
        typeof payload.redirectUri === "string"
          ? payload.redirectUri
          : undefined,
      type: "oauth_state",
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Legacy BigInt Support
// ============================================================================

/**
 * Verify access token and return legacy BigInt user ID.
 *
 * @param token - JWT access token
 * @returns Payload with userId as BigInt, or null if invalid
 */
export async function verifyAccessTokenForLegacyId(
  token: string,
): Promise<{ userId: bigint; communityId?: number; type: "access" } | null> {
  const payload = await verifyAccessToken(token);
  if (!payload) {
    return null;
  }

  try {
    return {
      userId: BigInt(payload.userId),
      communityId: payload.communityId
        ? parseInt(payload.communityId, 10)
        : undefined,
      type: "access",
    };
  } catch {
    // userId is not a valid BigInt (might be a Convex ID)
    return null;
  }
}
