/**
 * Stream Chat Utilities
 *
 * Centralized utilities for Stream Chat channel management.
 * All apps MUST use these utilities to ensure consistent channel naming.
 *
 * SIMPLIFIED FORMAT:
 * Format: {env}_{groupId}_{type}
 * - env: prod (production) or staging
 * - groupId: Convex document ID (e.g., k17abc123)
 * - type: main or leaders
 *
 * See channels.ts for detailed format documentation.
 */

export {
  // Types
  type StreamEnvironment,
  type StreamChannelType,
  type ParsedStreamChannelId,
  // Constants
  STREAM_CHANNEL_PREFIXES,
  STREAM_CHANNEL_TYPE_SUFFIXES,
  // Environment management
  getStreamChannelPrefix,
  // Channel ID construction
  buildStreamChannelId,
  // Channel ID parsing
  parseStreamChannelId,
  extractGroupIdFromChannel,
  // Environment checking
  isChannelForCurrentEnvironment,
  isChannelForEnvironment,
} from './channels';
