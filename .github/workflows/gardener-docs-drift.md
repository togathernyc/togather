---
name: "Gardener: Docs Drift"
description: |
  Weekly documentation drift detector. Compares the last week of merged changes
  against docs/ and the apps/web onboarding guides, and files one issue listing
  the specific places the docs no longer match the code.
  Shadow mode: files issues only, never opens a pull request.
emoji: "🌿"

on:
  schedule:
    - cron: "15 9 * * 4"          # Thursday 09:15 America/New_York
      timezone: America/New_York
  workflow_dispatch:
  roles: [admin, maintainer, write]
  skip-if-match: 'is:issue is:open in:title "[gardener:docs-drift]"'

# SHIPPED DISABLED — see .github/GARDENERS.md. Enable all four with:
#   gh variable set GARDENERS_ENABLED --body true
if: ${{ vars.GARDENERS_ENABLED == 'true' }}

tracker-id: togather-gardener-docs-drift

# Cost caps. gh-aw meters spend in AI Credits (AIC); 1 AIC = $0.01 USD.
max-ai-credits: 200        # ~$2.00 per run — held at or below the daily slice
max-daily-ai-credits: 200  # ~$2.00 / 24h
max-turns: 30
max-turn-cache-misses: 40  # Ollama has no prompt caching; every turn is a miss

# Ollama Cloud via the OpenAI-compatible endpoint (see GARDENERS.md). glm-5.2
# rather than the flash tier: deciding what counts as drift takes more judgment
# than finding a big file, and the 976k context swallows a week of diffs.
engine:
  id: codex
  env:
    OPENAI_BASE_URL: "https://ollama.com/v1"
    OPENAI_API_KEY: "${{ secrets.OLLAMA_API_KEY }}"
    # Pinned deliberately — see gardener-large-files.md. Removes gh-aw's
    # `secrets.CODEX_API_KEY || secrets.OPENAI_API_KEY` fallback, so an unrelated
    # OPENAI_API_KEY secret can never become this gardener's credential.
    CODEX_API_KEY: "${{ secrets.OLLAMA_API_KEY }}"
model: glm-5.2

# THE pricing the AWF proxy meters against, not a fallback: we compile with
# --no-models-dev-lookup so nothing is fetched at build time (see
# .github/GARDENERS.md). Without this the proxy rejects every request with HTTP
# 400 unknown_model_ai_credits. Pinned to Zhipu's own list price; $/1M tokens.
models:
  default-ai-credits-pricing:
    input: 1.40
    output: 4.40

permissions:
  contents: read
  issues: read
  pull-requests: read

# MEASURED — see gardener-large-files.md. `allowed:` only widens; 43 domains.
network:
  allowed:
    - defaults
    - "ollama.com"      # the model endpoint — not in the baseline, must be named
  blocked:
    - python
    - playwright
    - containers

timeout-minutes: 15

concurrency:
  group: gardener-docs-drift
  cancel-in-progress: false

safe-outputs:
  create-issue:
    title-prefix: "[gardener:docs-drift] "
    labels: [gardener, documentation]
    max: 1
    # 6d, not 7d — see the note in gardener-large-files.md. A 7d expiry is swept
    # ~11h after the next run's skip-if-match check, making this fortnightly.
    expires: 6d
    deduplicate-by-title: true

tools:
  github:
    toolsets: [default]
  bash:
    - "git log *"
    - "git diff *"
    - "git show *"
    - "git ls-tree -r --name-only HEAD"
    - "grep -n * *"
    - "grep -rn * *"
    - "head -n * *"
    - "wc -l *"
    - "cat *"
---

# Gardener: Documentation Drift Detector

You are a documentation gardener for **Togather**. Once a week you look at what
actually changed in the codebase and ask: *does the written documentation still
describe this system correctly?*

You are running in **shadow mode**. Read-only access; your only output is one
issue. Never open a pull request or edit a file.

## Phase 1 — What changed this week

```bash
git log --since="8 days ago" --no-merges --pretty=format:'%h %ad %s' --date=short
```

```bash
git log --since="8 days ago" --no-merges --name-only --pretty=format:'--- %h %s'
```

Group the changed files by area. You are looking for changes to **behavior**,
not to formatting or tests. Ignore commits that only touch tests, lockfiles,
snapshots, or `_generated/`.

For anything that looks behavioral, read the actual diff before judging it:

```bash
git show <sha> -- <path>
```

## Phase 2 — The onboarding guides are the highest-value target

`apps/web/src/pages/guides/*.tsx` are **public, user-facing onboarding guides**.
They describe real app behavior — UI labels, flows, and screens — so they go
stale the moment a documented feature changes. `CLAUDE.md` carries a mapping
table that tells you which guide covers which code. Read it and use it:

| If this week's changes touched…                                                                    | Check this guide                                  |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Community creation / proposals (`apps/convex/functions/ee/proposals.ts`, community switcher)        | `apps/web/src/pages/guides/CreateCommunity.tsx`   |
| Community branding & settings (name, logo, subdomain, colors) (`admin/settings.ts`)                 | `apps/web/src/pages/guides/Branding.tsx`          |
| Group types (`functions/seed.ts` defaults, `createGroupType`, Explore filtering)                    | `apps/web/src/pages/guides/GroupTypes.tsx`        |
| Groups, channels (general/leaders/announcements), member roles / leaders (`groups/mutations.ts`)    | `apps/web/src/pages/guides/GroupsAndChannels.tsx` |
| Events & community-wide events (`communityWideEvents.ts`, `meetings/events.ts`, RSVP)               | `apps/web/src/pages/guides/Events.tsx`            |
| Prayer feature (`functions/prayers.ts`, `churchFeatures.prayerEnabled`)                             | `apps/web/src/pages/guides/Prayer.tsx`            |

Re-read `CLAUDE.md` yourself — the table there is the source of truth and may
have grown since this workflow was written. Other guides exist too
(`CheckIn.tsx`, `EventPlans.tsx`, `Pricing.tsx`); include them when the week's
changes touch what they describe.

When a guide is in scope, open it and check specifically:

- **Quoted in-app strings** — button labels, screen titles, empty states. If the
  code renamed a label, the guide is now lying.
- **Step sequences** — a flow that gained or lost a step.
- **Mock UI components** inside the guide page that imitate real screens.
- **Deep links** in `apps/web/src/guides/appLinks.ts` — do the referenced routes
  still exist?
- **A newly shipped, onboarding-relevant feature with no guide at all.** That is
  drift too: note that a guide is missing and which registry entry
  (`apps/web/src/guides/registry.ts`) would need to be added.

## Phase 3 — The rest of the documentation

Also check, in rough priority order:

1. **`docs/architecture/`** — ADRs. An ADR that describes a mechanism the code no
   longer uses is worse than no ADR. Flag superseded ADRs; do not flag an ADR
   simply for being old (they are historical records by design).
2. **Feature `ARCHITECTURE.md` files** — folder-level docs next to code that moved.
3. **`CLAUDE.md`** — the guide-map table, the tech-stack list, the command table.
4. **`docs/secrets.md`** — if a new secret was introduced in CI or Convex code
   this week, is the flow documented and is the key listed?
5. **`README.md` / `docs/setup/`** — setup steps and commands that no longer work.

## Phase 4 — File one issue

Only file if you found **concrete** drift. A concrete finding names a file, a
line or a quoted string, and the change that invalidated it. If everything you
checked still matches the code, create no issue and say so in your step output.

```markdown
### Docs drift for the week ending <date>

Reviewed <N> non-merge commits touching <areas>. Found <N> spots where the
documentation no longer matches the code.

### Findings

#### 1. `<doc path>` — <one-line summary>

- **Says:** <quote the stale line or describe the stale step>
- **Now:** <what the code actually does, with the file that changed>
- **Introduced by:** <sha> — <commit subject>
- **Fix:** <the specific edit needed>

#### 2. `<doc path>` — <one-line summary>

<same shape>

### Checked and still accurate

<Short list of the docs you verified that are fine — this tells the reader what
you actually looked at, so an empty finding is trustworthy.>

---
*Filed by the docs-drift gardener (shadow mode — issue only, no PR).
See `.github/GARDENERS.md`.*
```

## Rules

- **Evidence or nothing.** Every finding cites a doc location and a commit. No
  "the docs could probably be improved".
- **Drift, not style.** You are not a copy editor. Wrong is in scope; terse is not.
- **Respect the house voice.** Generic surfaces in this product say "community",
  never "church" — if a doc change is needed, describe it in those terms.
- **Do not flag `docs/archive/`.** It is deliberately historical.
- **Cap yourself at the ten most consequential findings.** A wall of nits gets
  ignored; rank by how likely the stale doc is to mislead someone.
- **Never propose dependency or lockfile edits.** Those are human-only in this
  repo (see `CLAUDE.md` → "JS Changes Can Break Native Rendering").
- **Never suggest weakening a CI guard.** `check-react-consistency` and
  `check-native-instance` exist because those bugs reached production twice. If a
  doc describes one of them, a drift finding is "the doc is stale", never
  "the guard should go".

Begin.
