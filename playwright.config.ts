import { defineConfig, devices } from "@playwright/test";

// Support running in agent worktrees (agent-1 -> 19001, etc)
let port = 8081;
if (process.env.PORT) {
  port = parseInt(process.env.PORT, 10);
} else {
  const cwd = process.cwd();
  const match = cwd.match(/worktrees\/agent-(\d+)/);
  if (match) {
    port = 19000 + parseInt(match[1], 10);
  }
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: `pnpm --filter mobile web -- --port ${port} --host localhost`,
    url: `http://localhost:${port}/ui-test/event-rsvp-refresh`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      EXPO_PUBLIC_CONVEX_URL: "https://demo.convex.cloud",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
