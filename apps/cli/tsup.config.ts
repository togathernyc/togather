import { defineConfig } from "tsup";

const env = process.env.CLI_ENV || "production";

const convexUrls: Record<string, string> = {
  staging: "https://hushed-lemur-239.convex.cloud",
  production: "https://artful-echidna-883.convex.cloud",
};

const cdnBase = process.env.R2_PUBLIC_URL || "https://images.togather.nyc";
const prefix = env === "staging" ? "cli-staging" : "cli";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  define: {
    __CONVEX_URL__: JSON.stringify(convexUrls[env] || convexUrls.production),
    __CLI_ENV__: JSON.stringify(env),
    __LATEST_URL__: JSON.stringify(`${cdnBase}/${prefix}/latest.json`),
  },
});
