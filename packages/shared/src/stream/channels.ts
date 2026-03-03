/**
 * Centralized Stream Chat channel utilities.
 *
 * This module provides the SINGLE SOURCE OF TRUTH for Stream channel ID
 * construction and parsing. All apps (mobile, api, jobs) MUST use these
 * utilities to ensure consistent channel naming across environments.
 *
 * SIMPLIFIED FORMAT:
 *
 * Format: {env}_{groupId}_{type}
 * - env: prod (production) or staging
 * - groupId: Convex document ID (e.g., k17abc123)
 * - type: main or leaders
 * Example: prod_k17abc123_main
 *
 * NOTE: This module is framework-agnostic and uses process.env directly.
 */

export type StreamEnvironment = "production" | "staging";
export type StreamChannelType = "main" | "leaders";

/**
 * Channel prefix by environment.
 * Production uses 'prod', staging uses 'staging'.
 */
export const STREAM_CHANNEL_PREFIXES: Record<StreamEnvironment, string> = {
  production: 'prod',
  staging: 'staging',
} as const;

/**
 * Channel type suffixes.
 * Main chat uses 'main', leaders chat uses 'leaders'.
 */
export const STREAM_CHANNEL_TYPE_SUFFIXES: Record<StreamChannelType, string> = {
  main: "main",
  leaders: "leaders",
} as const;

/**
 * Get the channel prefix for the current environment.
 * Returns 'prod' for production, 'staging' for staging.
 * Uses APP_ENV environment variable directly (framework-agnostic).
 */
export function getStreamChannelPrefix(): string {
  const isProduction = process.env.APP_ENV === "production";
  return isProduction ? "prod" : "staging";
}

/**
 * Construct a Stream channel ID with the correct environment prefix.
 *
 * Format: {env}_{groupId}_{type}
 *
 * @param groupId - The Convex group document ID
 * @param type - Channel type ('main' for member chat, 'leaders' for leader chat)
 * @returns The full channel ID with environment prefix
 *
 * @example
 * // Returns "prod_k17abc123_main"
 * buildStreamChannelId('k17abc123', 'main');
 *
 * @example
 * // Returns "staging_k17def456_leaders"
 * buildStreamChannelId('k17def456', 'leaders');
 */
export function buildStreamChannelId(
  groupId: string,
  type: StreamChannelType = 'main'
): string {
  const prefix = getStreamChannelPrefix();
  const typeSuffix = STREAM_CHANNEL_TYPE_SUFFIXES[type];
  return `${prefix}_${groupId}_${typeSuffix}`;
}


/**
 * Check if a channel ID belongs to the current environment.
 *
 * @param channelId - Full channel ID to check
 * @returns True if the channel is for the current environment
 */
export function isChannelForCurrentEnvironment(channelId: string): boolean {
  const expectedPrefix = `${getStreamChannelPrefix()}_`;
  return channelId.startsWith(expectedPrefix);
}

/**
 * Check if a channel ID belongs to a specific environment.
 */
export function isChannelForEnvironment(channelId: string, env: StreamEnvironment): boolean {
  const prefix = `${STREAM_CHANNEL_PREFIXES[env]}_`;
  return channelId.startsWith(prefix);
}

/**
 * Parsed channel ID result.
 */
export interface ParsedStreamChannelId {
  /** Environment (production or staging) */
  environment: StreamEnvironment | null;
  /** Group ID (Convex document ID) */
  groupId: string | null;
  /** Channel type (main or leaders) */
  type: StreamChannelType | null;
}

/**
 * Parse a Stream channel ID to extract its components.
 *
 * Format: {env}_{groupId}_{type}
 *
 * @param channelId - Full channel ID to parse
 * @returns Parsed components or null if invalid
 */
export function parseStreamChannelId(channelId: string): ParsedStreamChannelId | null {
  // Determine environment from prefix
  let environment: StreamEnvironment | null = null;
  let baseId = channelId;

  // Check for environment prefix
  if (channelId.startsWith('prod_')) {
    environment = 'production';
    baseId = channelId.slice(5);
  } else if (channelId.startsWith('staging_')) {
    environment = 'staging';
    baseId = channelId.slice(8);
  }

  // Parse: {groupId}_{type}
  // Group IDs are alphanumeric Convex document IDs
  const match = baseId.match(/^([a-z0-9]+)_(main|leaders)$/i);
  if (!match) {
    return null;
  }

  return {
    environment,
    groupId: match[1],
    type: match[2].toLowerCase() as StreamChannelType,
  };
}

/**
 * Extract the group UUID from a Stream channel ID.
 * Supports both compact and legacy formats.
 *
 * @param channelId - Full or base channel ID
 * @returns Group UUID or null if not found
 */
export function extractGroupIdFromChannel(channelId: string): string | null {
  const parsed = parseStreamChannelId(channelId);
  return parsed?.groupId ?? null;
}
