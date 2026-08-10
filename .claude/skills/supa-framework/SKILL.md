---
name: supa-framework
description: MUST be read before changing behavior that comes from a `@supa-media/*` package, shared bin, or reusable workflow (native-safety / check-react-consistency, the 1Password→GitHub secret sync, dev-assistant) — the upstream-first rule applies. Also read when installing or updating `@supa-media/*` packages, debugging GitHub Packages auth (`GITHUB_TOKEN`, `GH_PACKAGES_TOKEN`), or EAS remote native build install failures.
---

# Supa Framework (consumed by Togather)

This repo consumes packages and reusable workflows from **Supa-Media/supa-framework**
(local checkout: `~/Code/supa-framework`).

- Consumed today: `@supa-media/native-safety` (check-react-consistency CI guard),
  the shared 1Password sync (`supa-sync-1password-to-github` via the reusable
  `sync-secrets.yml@v1` workflow), and `@supa-media/dev-assistant` (the ADR-029
  contribution pipeline — schema, pipeline core, and Convex functions; Togather
  supplies only the app-specific seams in `apps/convex/functions/devAssistant/`).
  More adoption is planned (see the framework repo).
- Private registry: installing `@supa-media/*` needs a `GITHUB_TOKEN` with
  `read:packages` (see `.npmrc`; CI passes `secrets.GITHUB_TOKEN`). EAS remote
  native builds (`eas build`, no `--local`) run their own `pnpm install` on
  Expo's infra, which never sees `secrets.GITHUB_TOKEN` — those workflows
  instead forward the durable `GH_PACKAGES_TOKEN` secret via `eas env:create
  --name GITHUB_TOKEN`. See `docs/secrets.md`'s "GitHub Packages auth for
  native builds" section.
- **Upstream-first rule:** if a change touches behavior that comes from the
  framework (a package, bin, or reusable workflow), do NOT patch or fork it
  here first. Ask: is the change generic? If yes → change it in
  supa-framework (PR there → release → `pnpm update "@supa-media/*"` here).
  Only implement locally when the need is genuinely Togather-specific — and
  leave a comment explaining why it diverges.
- Updating: `pnpm update "@supa-media/*"`; reusable workflows are pinned `@v1`.

Note: any `pnpm update "@supa-media/*"` is a dependency change — the
`native-deps-safety` skill's rules (scoped installs, `check-react-consistency`
plus `check-native-instance`) apply.
