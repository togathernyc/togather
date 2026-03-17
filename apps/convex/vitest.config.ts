import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Map @togather/shared/config to the source so tests can resolve it
      // without needing the shared package to be built (dist/).
      "@togather/shared/config": path.resolve(
        __dirname,
        "../../packages/shared/src/config/index.ts"
      ),
    },
  },
  test: {
    environment: "edge-runtime",
    include: ["__tests__/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    server: { deps: { inline: ["convex-test"] } },
    env: {
      // Test JWT secret - must be at least 32 characters
      JWT_SECRET: "test-jwt-secret-for-convex-testing-at-least-32-chars",
    },
  },
});
