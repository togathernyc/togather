# Gardeners — operator guide

Four scheduled maintenance agents ("gardeners") for this repo, built with
[GitHub Agentic Workflows](https://github.github.com/gh-aw/) (`gh-aw`). Each is a
Markdown file with YAML frontmatter under `.github/workflows/` that **compiles**
into a hardened GitHub Actions workflow.

> [!CAUTION]
> **They ship DISABLED.** Every gardener is gated on
> `if: ${{ vars.GARDENERS_ENABLED == 'true' }}`, and that repository variable does
> not exist yet. Merging this changes nothing — no runs, no issues, no spend.
>
> **To turn them on** (after adding the secrets below):
> ```bash
> gh variable set GARDENERS_ENABLED --body true
> ```
> **To turn them off again** — instantly, no recompile:
> ```bash
> gh variable delete GARDENERS_ENABLED
> ```

> [!IMPORTANT]
> **SHADOW MODE.** Every gardener has read-only repository permissions and can
> only produce **issues and comments**. None can open a pull request, push a
> branch, or edit a file. Evaluate the output for two weeks before granting any
> write scope — checklist at the bottom.

This is a plain document, not a workflow. Editing it changes nothing. It lives in
`.github/` rather than `.github/workflows/` on purpose: gh-aw's tooling treats
every `.md` in the workflows directory as a workflow, and this one would show up
in `gh aw list`.

---

## The gardeners

| Gardener | File | What it does | Engine · model | Cadence | Per-run cap | Daily cap | Files |
|---|---|---|---|---|---:|---:|---|
| **Large Files** | `gardener-large-files.md` | Finds the largest hand-written source file; if it is over 500 lines, proposes a concrete split | `codex` → **Ollama** · `deepseek-v4-flash` | Weekly · **Tue 09:15 ET** | 200 AIC | 200 AIC | 1 issue, `[gardener:large-files]` |
| **Docs Drift** | `gardener-docs-drift.md` | Diffs the last week of merged changes against `docs/` and the `apps/web` onboarding guides | `codex` → **Ollama** · `glm-5.2` | Weekly · **Thu 09:15 ET** | 200 AIC | 200 AIC | 1 issue, `[gardener:docs-drift]` |
| **CI Doctor** | `gardener-ci-doctor.md` | Diagnoses `CI` failures on `main`, grouped by failure signature; plus a weekly roll-up | **`claude`** · default | On CI failure (main) **+** weekly · **Mon 09:15 ET** | 200 AIC ($2.00) | 400 AIC ($4.00) | ≤2 issues, `[gardener:ci-doctor]` |
| **Cost Report** | `gardener-cost-report.md` | The visibility surface — keeps one standing issue with a per-gardener cost & activity table | `codex` → **Ollama** · `glm-5.2` | Weekly · **Fri 09:15 ET** | 200 AIC | 200 AIC | 1 standing issue, `[gardeners]` |

Three gardeners run on an open model through the owner's Ollama Cloud
subscription; **CI Doctor deliberately does not.** It reads noisy CI logs and
depends on many correct tool calls per run, and a confidently wrong diagnosis
costs more human time than the model saves. It is the one place worth paying for.

### How each gardener avoids repeating itself

Worth knowing, because it is both the idempotency mechanism *and* the main cost
control — the check runs in a cheap pre-activation job, before any inference is
billed.

| Gardener | Mechanism |
|---|---|
| Large Files, Docs Drift | `on.skip-if-match` — if last week's issue is still open, the run exits before the model starts. **This means an unaddressed issue suppresses the next run.** Combined with `expires: 6d` (below), that is at most a one-week pause, not a permanent stall. |
| CI Doctor | No skip — it must run per failure. Dedupes by *failure signature*: it comments on an existing issue for a repeat rather than filing a new one. Hard cap of 2 issues per run. |
| Cost Report | No skip — it must run to refresh the standing issue. `deduplicate-by-title` plus update-in-place keeps it to one. |

**Why `expires: 6d` and not 7d.** The maintenance sweep that closes expired
issues runs daily at 00:37 UTC. With a 7-day expiry on a weekly gardener, the
sweep closes last week's issue roughly *eleven hours after* the next run has
already checked `skip-if-match` and skipped — so each gardener would quietly run
every **other** week while the table above claimed weekly. Six days closes it the
morning before. If you change the cadence, re-check this interaction.

### Reading the schedule

All four run at **09:15 America/New_York**, on four different weekdays. That is
real ET, not UTC — each schedule entry carries a `timezone:` field, and GitHub
Actions handles daylight saving automatically, so it stays 09:15 ET year-round.

Two things about this are worth knowing before you change it:

- **`gh aw compile` prints an advisory warning** for each of these: *"Schedule
  uses fixed weekly time (Tuesday 9:15 UTC). Consider using fuzzy schedule…"*.
  Both halves of that message are misleading. It says "UTC" because gh-aw renders
  the warning without accounting for the `timezone:` field it just emitted — the
  runs really are 09:15 ET. And the fuzzy-schedule suggestion is about spreading
  load across GitHub's fleet, which does not matter for four weekly workflows on
  four separate days. **The warning is expected. It is not an error, and the
  compile still reports `0 error(s)`.**
- **The `timezone` field is new.** GitHub shipped it on 2026-03-19; before that,
  scheduled workflows were UTC-only. Tooling that pins an older schema snapshot
  may redline it locally — that is a linter false positive, not a failure.
  (`actionlint` 1.7.12, which `gh aw lint` bundles, accepts it.)

### Reading the cost caps

`gh-aw` meters agent spend in **AI Credits (AIC)**. **1 AIC = $0.01 USD.**

- `max-ai-credits` — hard per-run ceiling, enforced mid-run by the API proxy, so
  a single run cannot overspend. **It defaults to 1000 ($10) if you omit it** —
  always set it explicitly. Each gardener's per-run cap is held at or below its
  daily slice, so one run can never blow the whole day's budget.
- `max-daily-ai-credits` — rolling 24-hour guardrail, checked *before* the agent
  starts. When exceeded the activation job skips the run entirely and nothing is
  billed. Omitting this key leaves the guardrail *off*.
- `max-turns: 30` and `timeout-minutes: 15` are the two non-financial bounds.

The four daily caps sum to 1000 AIC = **$10/day repo-wide**. The guardrail is
enforced per workflow per triggering user, not globally — that $10 is an
arithmetic budget across the four, not one number GitHub enforces.

#### The dollar figures mean two different things

AIC is computed from the [models.dev](https://models.dev) pricing catalog, which
only knows *list* prices:

- **CI Doctor (`claude`)** — real. You are billed per token by Anthropic, and
  200 AIC ≈ $2.00 of that bill. The cap binds on actual money.
- **The three Ollama gardeners** — the cap still **binds**, but the dollars are
  imputed. models.dev's `ollama-cloud` provider carries no per-token pricing (it
  is a flat-rate subscription), so gh-aw falls back to the same model's list
  price at its *original* provider — Zhipu's for `glm-5.2`, DeepSeek's for
  `deepseek-v4-flash`. Those numbers are a **throttle, not an invoice**: they
  still cut a runaway run off, which is the useful part.

  **Your real exposure on the Ollama path is the Ollama Cloud subscription
  itself** ($20/mo Pro, with session limits resetting every 5 hours and weekly
  limits every 7 days) — not anything in the table above. The 15-minute
  `timeout-minutes` is the other hard bound and is deliberately tight for that
  reason.

Metering works on the Ollama path at all only because gh-aw routes **every**
engine through the AWF API proxy sidecar; the proxy is retargeted at `ollama.com`
rather than bypassed. The failure mode is the opposite of the usual worry: an
unpriced model does not run unmetered, it gets **rejected with HTTP 400
`unknown_model_ai_credits`**. That is why each Ollama gardener also declares
`models.default-ai-credits-pricing` as a fallback — gh-aw's own daily Ollama test
broke for eight consecutive days on exactly this.

---

## Changing the cadence

> [!WARNING]
> **The `.md` file is the source; the `.lock.yml` is what actually runs.**
> Editing the `.md` without recompiling changes *nothing* — GitHub Actions only
> ever reads the `.lock.yml`. The schedule will silently stay exactly as it was.
> Always run `gh aw compile` and commit **both** files.

### One-time setup

```bash
gh extension install github/gh-aw
gh aw --version
```

### The loop

```bash
# 1. Edit the schedule in the frontmatter
$EDITOR .github/workflows/gardener-large-files.md

# 2. Recompile (regenerates the .lock.yml)
gh aw compile

# 3. Commit BOTH files together
git add .github/workflows/gardener-large-files.md \
        .github/workflows/gardener-large-files.lock.yml
git commit -m "chore(gardeners): move large-files scan to Wednesdays"
```

Recompile everything at once with a bare `gh aw compile`. Add `--approve` if it
warns about a newly-introduced secret or action (it is asking you to review a
supply-chain change — read what it lists before approving).

Sanity check that the change landed:

```bash
git diff --stat .github/workflows/          # both .md and .lock.yml should appear
grep 'cron:' .github/workflows/gardener-large-files.lock.yml
```

### Schedule syntax

All of these compile (verified against gh-aw v0.83.4):

```yaml
on:
  schedule:
    - cron: "15 9 * * 2"          # what we use — explicit, with a timezone
      timezone: America/New_York
```
```yaml
on:
  schedule: weekly on friday around 5pm
```
```yaml
on:
  schedule: daily around 10:30
```
```yaml
on:
  schedule: every 6h                          # minimum interval is 5 minutes
```

**Use an explicit cron with `timezone`, not a fuzzy string.** gh-aw does not do
timezone math itself — it passes `timezone:` straight through to GitHub Actions,
which interprets the cron in that zone. So the cron you write is the local time
you get. A fuzzy expression still works, but gh-aw resolves its scattered minute
first and the result is harder to predict. `timezone` must sit on a schedule
**array item** next to `cron`; the object form (`schedule: {cron:, timezone:}`)
fails with `schedule field must be a string or an array`. To go back to UTC,
delete the `timezone` line.

### Making a gardener run less often

There is **no `biweekly` keyword, and `monthly on tuesday` does not compile**
(`invalid day of month 'tuesday', must be 1-31` — the `monthly` fuzzy form takes
a day-of-month, not a weekday). Use a raw cron on a day of the month:

```yaml
on:
  schedule:
    - cron: "15 9 1 * *"          # the 1st of each month, 09:15 ET
      timezone: America/New_York
```

> [!WARNING]
> **Do not try to express "the first Tuesday" as `15 9 1-7 * 2`.** In POSIX cron,
> when *both* day-of-month and day-of-week are restricted they are **OR**-ed, not
> AND-ed — that expression fires on the 1st–7th of every month **and** on every
> Tuesday, which is far more often than you wanted. Cron cannot express "first
> Tuesday" at all. Pick a day-of-month, or keep it weekly and accept the cadence.

### Making a change stop after a while (trial runs)

```yaml
on:
  schedule:
    - cron: "15 9 * * 2"
      timezone: America/New_York
  stop-after: "+30d"      # relative to COMPILE time; recompiling resets it
```

Useful for a time-boxed evaluation: the workflow disables itself rather than
running forever if nobody looks at it. Minimum unit is hours.

---

## Changing a gardener's model

Each gardener picks its own engine and model, so you are not locked into one
provider. The knobs are all frontmatter, so the loop is the same as cadence:
**edit → `gh aw compile` → commit both files.**

### Move a gardener onto Ollama (open model, flat-rate)

```yaml
engine:
  id: codex
  env:
    OPENAI_BASE_URL: "https://ollama.com/v1"
    OPENAI_API_KEY: "${{ secrets.OLLAMA_API_KEY }}"
model: glm-5.2

models:
  default-ai-credits-pricing:   # fallback so the proxy never 400s
    input: 1.40
    output: 4.40

network:
  allowed:
    - github
    - node
    - threat-detection
    - "ollama.com"              # REQUIRED — the firewall blocks it otherwise

max-turn-cache-misses: 40       # Ollama has no prompt caching; default 5 is too low
```

gh-aw reads `OPENAI_BASE_URL` at compile time, extracts the hostname, and points
the AWF proxy at it (`"targets":{"openai":{"host":"ollama.com"}}` in the lock
file). **The host must also appear in `network.allowed`** or every request is
firewalled.

Current Ollama Cloud models worth considering — all support tool calling:
`glm-5.2` (976k ctx), `deepseek-v4-flash` (1M, cheapest), `kimi-k3` (1M),
`qwen3.5:397b`, `minimax-m3`, `gpt-oss:120b`.

### Move a gardener back onto Claude

```yaml
engine: claude
# delete: the `model:`, `models:`, `max-turn-cache-misses:` blocks
#         and the "ollama.com" line from network.allowed
```

Leaving `model:` off uses the engine default, which is what CI Doctor does.

### Pin a specific Claude model

```yaml
engine: claude
model: claude-haiku-4-5     # or an alias: small, large, sonnet, haiku, opus
```

Use the **top-level `model:`**, not `engine.model` — the latter is deprecated in
v0.83.x and `gh aw fix` will migrate it.

### Other engines

`gh-aw` v0.83.4 ships `copilot` (its default), `claude`, `codex`, `gemini`,
`opencode`, and `pi`. Any of them can be pointed at a custom OpenAI- or
Anthropic-compatible endpoint through `engine.env`:

| Engine | Base-URL variable |
|---|---|
| `codex` | `OPENAI_BASE_URL` |
| `claude` | `ANTHROPIC_BASE_URL` |
| `copilot` | `GITHUB_COPILOT_BASE_URL` |
| `gemini` | `GEMINI_API_BASE_URL` |

**Copilot is not currently an option here:** the `togathernyc` org has 0 Copilot
seats assigned (`seat_management_setting: unconfigured`), so that engine has
nothing to bill against. If seats are provisioned, `engine: copilot` plus
`permissions: copilot-requests: write` is the whole change, and both API-key
secrets can be deleted.

---

## Secrets

| Secret | Used by | Notes |
|---|---|---|
| `OLLAMA_API_KEY` | Large Files, Docs Drift, Cost Report | From ollama.com. Passed as `OPENAI_API_KEY` to the codex engine. |
| `ANTHROPIC_API_KEY` | CI Doctor | Set a **small, capped budget** on this key in the Anthropic console — a second line of defence behind the AIC caps. |

Both are plain repository secrets:

```bash
gh secret set OLLAMA_API_KEY
gh secret set ANTHROPIC_API_KEY
```

> [!NOTE]
> Neither flows through the 1Password → GitHub → Convex pipeline in
> `docs/secrets.md`, because both are consumed only by GitHub Actions and never
> by a Convex function. If you want them managed there anyway, add them to the
> `optional` list in `ee/secrets-allowlist.json` — but do **not** add them to
> `SECRET_KEYS` in `ee/scripts/sync-secrets-to-convex.sh`.

**Without the right secret a gardener does not fail silently.** The run reaches
its `conclusion` job via the `secret_verification_result == 'failed'` branch with
`GH_AW_FAILURE_REPORT_AS_ISSUE: "true"` and files a failure issue. That is why
these ship behind `GARDENERS_ENABLED` — set the secrets first, then the variable.

---

## Turning gardeners off and on

**All four at once** — the `GARDENERS_ENABLED` variable, effective immediately,
no recompile:

```bash
gh variable set GARDENERS_ENABLED --body true      # on
gh variable delete GARDENERS_ENABLED               # off
```

**One at a time** — `gh aw disable` flips the workflow off in GitHub Actions
without deleting anything:

```bash
gh aw disable gardener-large-files
gh aw enable gardener-large-files
gh aw disable                        # all agentic workflows
```

**Permanently** — deletes the `.md` and its `.lock.yml`; commit the result:

```bash
gh aw remove gardener-large-files
```

Either kill switch works from the GitHub UI too: Actions → pick the workflow →
"..." → Disable workflow.

---

## Seeing what they cost

The **Cost Report** gardener maintains a single standing issue titled
`[gardeners] weekly cost & activity report`. Its issue number never changes, so
bookmark it. That is the intended answer to "what are these things costing me?"

From the CLI:

```bash
gh aw status                              # all gardeners: enabled?  last run?
gh aw logs gardener-large-files           # per-run tokens, cost, turns
gh aw audit <run-id>                      # deep dive on one run
gh aw health gardener-ci-doctor           # success rate over time
gh run list --workflow=gardener-large-files.lock.yml --limit 20
```

`gh aw logs` is the authoritative per-run cost source — it parses the usage
artifact each run uploads.

---

## What else `gh aw compile` generated

Committing the gardeners also brought in three files nobody wrote by hand:

### `.github/workflows/agentics-maintenance.yml`

Auto-generated because the gardeners use `expires:` on their safe outputs. It is
**deterministic housekeeping, not an agent** — no LLM, no API key, no model call.
It runs daily at **00:37 UTC**.

Its top-level `permissions:` is `{}`, but **four jobs run on that daily cron**,
each with its own scope:

| Scheduled job | Permission | What it does |
|---|---|---|
| `close-expired-issues` | `issues: write` | Closes gardener issues past their expiry — the mechanism that stops a shadow-mode trial silting up |
| `close-expired-discussions` | `discussions: write` | Same, for discussions (no gardener creates any) |
| `close-expired-pull-requests` | `pull-requests: write` | Same, for PRs (no gardener can create any, so this is inert) |
| `cleanup-cache-memory` | **`actions: write`** | Deletes stale Actions caches. **This is repo-wide cache-delete authority** — it is not limited to gardener caches, and the CI pnpm/Expo caches live in the same store. |

**`actions: write` is the one to be deliberate about.** It runs
`cleanup_cache_memory.cjs`, resolved at runtime from the SHA-pinned
`github/gh-aw-actions/setup@e89c65e…` action, so the script is not reviewable in
this repo. SHA pinning makes an upstream problem unlikely, not impossible; the
blast radius would be "CI caches deleted, builds get slower until they repopulate".

The file *also* contains `run_operation`, `apply_safe_outputs`, and
`update_pull_request_branches` jobs carrying `contents: write` /
`pull-requests: write`. Those are **not** on the cron — each requires
`workflow_dispatch`/`workflow_call` **and** a specific non-empty `operation`
input.

If the `actions: write` job is unacceptable, `{"maintenance": false}` in
`.github/workflows/aw.json` stops this file being generated at all — but you lose
the automatic closing of expired issues along with it, which is load-bearing for
shadow mode.

### The other two

| Path | Why it exists |
|---|---|
| `.github/aw/actions-lock.json` | SHA pins for every action the compiled workflows use. Do not hand-edit. |
| `.gitattributes` | Marks `*.lock.yml` as `linguist-generated` so they collapse in diffs. Its `merge=ours` needs `git config merge.ours.driver true` to take effect; without that git falls back with a warning. |

Regenerate all of them with `gh aw compile`.

---

## Guardrails these agents are told to respect

Two repo-specific rules are written into every gardener's prompt, because getting
them wrong is expensive:

1. **No dependency or lockfile changes, ever.** A `pnpm install` re-resolution in
   this repo can silently break native video and GIF rendering in the Expo app —
   a class of bug CI is structurally blind to. See `CLAUDE.md` → "JS Changes Can
   Break Native Rendering". Gardeners must hand off rather than propose.
2. **Never weaken a CI guard.** `check-react-consistency` and
   `check-native-instance` exist because those bugs shipped to production twice.
   The CI Doctor is explicitly instructed never to suggest skipping them.

If you extend a gardener's prompt, carry these forward.

---

## Two-week evaluation checklist

Before granting any gardener write scope (`create-pull-request` instead of
`create-issue`), check:

- [ ] Did each gardener actually run on schedule? (`gh aw status`) Remember that
      an open, unaddressed issue legitimately suppresses the next Large Files or
      Docs Drift run.
- [ ] Were the issues it filed **correct** — not just plausible?
- [ ] Did anyone close them, or did they pile up? Issues nobody actions are spend
      with no return.
- [ ] Did real spend land near the caps, or nowhere near? Retune either way.
- [ ] Any daily guardrail trip? That means a gardener was skipped silently.
- [ ] Did the CI Doctor's failure signatures group sensibly, or did it file
      near-duplicates?
- [ ] **Did the Ollama-backed gardeners complete their tool calls cleanly?** This
      is the least-proven part of the setup — see the caveat below.

Grant write scope to **one** gardener first, not all four.

### The Ollama path has never executed

It compiles, and the wiring is verified in the lock files (proxy retarget,
firewall allowlist, AIC caps, and model pricing all resolve). What has *not* been
proven is a live run, and there are three known risks:

1. **`https://ollama.com/v1` is not in Ollama's official docs.** models.dev lists
   it as the `ollama-cloud` API base and it is almost certainly right, but the
   documented cloud base URL is `https://ollama.com/api`, and every documented
   OpenAI-compatible example points at a *local* daemon. Probe it before trusting
   it:
   ```bash
   curl -H "Authorization: Bearer $OLLAMA_API_KEY" https://ollama.com/v1/models
   ```
2. **`tool_choice` is unsupported.** Tool *calling* works; *forcing* a specific
   tool does not. These agents lean heavily on tool calls, so this is the most
   likely source of a runtime failure.
3. **Model tag strings may need a `:cloud` suffix** (`glm-5.2:cloud`). models.dev
   lists the bare names against `/v1`, which is what we use.

**If an Ollama gardener fails at runtime, the rollback is four lines** — swap its
`engine:` block for `engine: claude`, drop `model:` / `models:` /
`max-turn-cache-misses:` and the `ollama.com` network line, recompile, commit.
See [Move a gardener back onto Claude](#move-a-gardener-back-onto-claude).

---

## Reference

- gh-aw docs: <https://github.github.com/gh-aw/>
- Safe outputs: <https://github.github.com/gh-aw/reference/safe-outputs/>
- Frontmatter: <https://github.github.com/gh-aw/reference/frontmatter/>
- Engines & custom endpoints: <https://github.github.com/gh-aw/reference/engines/>
- Sample workflows these were adapted from: <https://github.com/githubnext/agentics>

`gh-aw` is a technical preview and pre-1.0 — the frontmatter schema changes
between releases. If `gh aw compile` starts rejecting a field, run `gh aw fix`
(dry-run by default) to apply the migration codemods, then recompile.
