/// <reference types="vite/client" />
/**
 * Test setup for convex-test
 *
 * This file provides the modules glob pattern needed by convex-test
 * to locate and load Convex functions during testing.
 *
 * convex-test needs access to:
 * - _generated directory for API definitions (includes .js files)
 * - All TypeScript function files
 */
export const modules = import.meta.glob([
  "./**/*.ts",
  "./_generated/**/*.js",
  "!./__tests__/**",
  "!./__mocks__/**",
  "!./node_modules/**",
  "!./*.config.ts",
  "!./*.setup.ts",
]);
