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

import { convexTest } from "convex-test";
import { register as registerAggregate } from "@convex-dev/aggregate/test";
import schema from "./schema";

/**
 * Create a convex-test instance with aggregate components registered.
 * Use this instead of `convexTest(schema, modules)` in tests that touch
 * mutations which use the communityPeople aggregate.
 */
export function convexTestWithAggregates() {
  const t = convexTest(schema, modules);
  registerAggregate(t, "communityPeopleAggregate");
  return t;
}
