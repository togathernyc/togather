---
name: secrets-and-backends
description: MUST be read before adding, rotating, or reading any secret or environment variable (1Password, GitHub secrets, Convex/Expo env, `ee/secrets-allowlist.json`, `sync-secrets.yml`), and before running any backend-affecting command as a maintainer CI agent (choosing a Convex backend, `pnpm dev:backend`). Also read when a change might touch the production environment.
---

# Environments, Secrets, and Backend Selection (Togather)

## Environment Setup

- Environment variables are documented in `docs/secrets.md`
- Depending on what the user is asking, use the relevant keys from the relevant environment (dev, staging, prod)
- Typically you will only make dev or staging related changes, double check if any action you take will affect production

## Secret Update Flow

Secrets flow **1Password → GitHub → Convex/Expo** — never shortcut either hop.
See the full "Secret Update Flow" section in `docs/secrets.md` for the why and
the step-by-step. In short:

- **1Password is the source of truth.** Set/rotate the value there, never
  directly in the GitHub UI (GitHub secrets are write-only; you can't read them
  back, and the next sync overwrites manual edits).
- **Don't push 1Password → Convex/Expo directly** — every deploy re-syncs all
  secrets and would hit 1Password rate limits. GitHub is the buffer.
- To add a new secret: (1) add the item to 1Password vault `Togather` with
  `staging`/`production` fields; (2) add `<KEY>` to the `required` or
  `optional` list in `ee/secrets-allowlist.json` (a key not listed is never
  synced — see that file's `$comment` and `docs/secrets.md`'s Secret Update
  Flow for what `required` vs `optional` means, including that `optional` gets
  **pruned** from GitHub when absent from 1Password); (3) **only if a Convex function needs it**, also add
  it to `SECRET_KEYS` in `ee/scripts/sync-secrets-to-convex.sh` — CI-only
  tokens stop at GitHub; (4) run
  `gh workflow run sync-secrets.yml -f environment=both` to push it to GitHub
  (the shared `supa-sync-1password-to-github` bin, via the reusable
  `sync-secrets.yml@v1` workflow); deploys forward it onward.

## Agent Backend Selection (Maintainer CI Agents Only)

This section applies **only** to Cursor Cloud Agents and similar CI agents run by project maintainers. Open-source contributors should ignore this section — you create your own personal Convex deployment via `npx convex dev` (see the `onboarding-new-dev` skill).

- Before any backend-affecting command, ask: **"Which backend should I use?"** and list the backends defined in `config/allowed-backends.json`.
- Do not proceed until the user answers.
- Use `pnpm dev:backend --backend=<choice>` only.
- Each concurrent agent **must** use a different backend to avoid data conflicts.
