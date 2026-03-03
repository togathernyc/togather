/**
 * Environment Types
 *
 * Shared types for environment configuration across mobile and backend.
 */

export type EnvironmentType = "production" | "staging";

export interface EnvironmentConfig {
  name: EnvironmentType;
  displayName: string;
  /** Stream channel prefix: "prod" for production, "staging" for staging */
  streamChannelPrefix: "prod" | "staging";
}

/**
 * Options for initializing the environment.
 *
 * Mobile apps pass Expo config values, backend passes process.env values.
 * The detection logic uses these in priority order to determine staging vs production.
 */
export interface EnvironmentInitOptions {
  // For mobile: pass from Expo Constants
  /** From Constants.expoConfig?.extra?.isStaging */
  isStaging?: boolean;
  /** From Constants.expoConfig?.ios?.bundleIdentifier */
  bundleId?: string;

  // For backend: pass from process.env
  /** From process.env.APP_ENV */
  appEnv?: string;
  /** From process.env.NODE_ENV */
  nodeEnv?: string;
}
