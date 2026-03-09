# Agents

## Cursor Cloud specific instructions

### Overview

Togather is a community management platform. The monorepo contains:

- **`apps/mobile`** -- React Native/Expo mobile app (primary frontend, port 8081)
- **`apps/convex`** -- Convex serverless backend (cloud-hosted, not a local server)
- **`apps/web`** -- Vite landing page (port 5173)
- **`packages/shared`** -- Shared TypeScript types/utils (must be built before other packages)

### Key commands

Standard dev commands are in root `package.json` and documented in `README.md` and `CLAUDE.md`. Quick reference:

| Task | Command |
|------|---------|
| Install deps | `pnpm install` |
| Build shared pkg | `pnpm --filter @togather/shared build` |
| Dev (full stack) | `pnpm dev` |
| Dev (mobile only) | `pnpm dev --mobile` |
| Dev (web landing) | `cd apps/web && pnpm dev` |
| Lint | `pnpm lint` |
| Test all | `pnpm test` |
| Build all | `pnpm build` |
| Convex tests | `cd apps/convex && pnpm test` (vitest) |
| Mobile tests | `cd apps/mobile && pnpm test` (jest) |

### Non-obvious caveats

- **`@togather/shared` must be built** before running mobile or convex tests/builds. Run `pnpm --filter @togather/shared build` if you see import errors from `@togather/shared`.
- **`apps/mobile/.env`** must exist (even if empty) or the dev script (`scripts/dev.js`) will error. At minimum it needs `EXPO_PUBLIC_CONVEX_URL`.
- **`.env.local`** in the repo root must contain `CONVEX_DEPLOYMENT` for the dev script to derive the Convex URL. Without a real Convex deployment, only the web landing page and Expo Metro bundler can run; Convex backend functions won't sync.
- **Convex is a cloud service** -- there is no local Convex server. `npx convex dev` syncs local function code to a cloud deployment. A Convex account and deployment are required for full-stack development and seeding test data.
- **Expo's `--non-interactive` flag** is not supported; use `CI=1` environment variable instead for non-interactive Metro.
- **Pre-commit hook** runs `lint-staged` (ESLint on changed `.ts`/`.tsx` files). Pre-push hook runs mobile tests (`pnpm test --filter mobile`). Husky is set up via `prepare` script.
- **Web app** (`apps/web`) is a standalone Vite + React + Tailwind landing page with no Convex dependency. It can always be started independently.
- **Mobile tests** use Jest with `jest-expo` preset. The custom `run-tests.js` script in `apps/mobile` handles test execution. Tests run without requiring Convex or any external services.
- **Convex tests** use Vitest with `convex-test` for local function testing without a live deployment.

### Multi-agent Convex isolation

Each concurrent agent **must** use its own Convex deployment to avoid overwriting each other's backend functions and data. The `CONVEX_DEPLOYMENT` secret determines which cloud deployment an agent syncs to. Two agents sharing the same deployment will conflict -- the last `npx convex dev --once` wins.

To set up a new agent's Convex deployment:
1. Set `CONVEX_DEPLOYMENT` and `JWT_SECRET` environment secrets for the agent
2. Run `npx convex dev --once` to push schema + functions
3. Set `JWT_SECRET` on the Convex deployment: `npx convex env set "JWT_SECRET=$JWT_SECRET"`
4. Set dev flags: `npx convex env set APP_ENV=development && npx convex env set DEBUG=true`
5. Seed test data: `npx convex run functions/seed:seedDemoData`
6. Test credentials: phone `2025550123`, OTP code `000000`
