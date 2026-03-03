/**
 * Environment Configuration
 *
 * Defines the configuration for each environment (production, staging).
 * Stream channel prefixes distinguish data between environments.
 */

import type { EnvironmentType, EnvironmentConfig } from "./types";

/**
 * Environment configurations with Stream channel prefixes.
 *
 * Stream channels use 'prod' prefix for production, 'staging' for staging.
 * Note: The underscore separator is added when building channel IDs.
 */
export const ENVIRONMENTS: Record<EnvironmentType, EnvironmentConfig> = {
  production: {
    name: "production",
    displayName: "Production",
    streamChannelPrefix: "prod",
  },
  staging: {
    name: "staging",
    displayName: "Staging",
    streamChannelPrefix: "staging",
  },
};
