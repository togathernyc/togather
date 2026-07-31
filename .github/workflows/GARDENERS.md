# Gardeners — operator guide

Four scheduled maintenance agents ("gardeners") run against this repo, built with
[GitHub Agentic Workflows](https://github.github.com/gh-aw/) (`gh-aw`). Each one
is a Markdown file with YAML frontmatter that **compiles** into a hardened GitHub
Actions workflow.

> [!IMPORTANT]
> **They are in SHADOW MODE.** Every gardener has read-only repository
> permissions and can only produce **issues and comments**. None of them can open
> a pull request, push a branch, or edit a file. Nothing merges automatically.
> This is deliberate — evaluate the output for two weeks before granting any
> write scope.

This is a plain document, not a workflow. Editing it changes nothing.

---

## The gardeners

| Gardener | File | What it does | Cadence | Per-run cap | Daily cap | Files |
|---|---|---|---|---:|---:|---|
| **Large Files** | `gardener-large-files.md` | Finds the largest hand-written source file; if it is over 500 lines, proposes a concrete split | Weekly · Tue ~09:15 UTC | 300 AIC ($3.00) | 200 AIC ($2.00) | 1 issue, `[gardener:large-files]` |
| **Docs Drift** | `gardener-docs-drift.md` | Diffs the last week of merged changes against `docs/` and the `apps/web` onboarding guides | Weekly · Thu ~09:15 UTC | 300 AIC ($3.00) | 200 AIC ($2.00) | 1 issue, `[gardener:docs-drift]` |
| **CI Doctor** | `gardener-ci-doctor.md` | Diagnoses `CI` failures on `main`, grouped by failure signature; plus a weekly roll-up | On CI failure (main) **+** weekly · Mon ~09:15 UTC | 200 AIC ($2.00) | 400 AIC ($4.00) | ≤2 issues, `[gardener:ci-doctor]` |
| **Cost Report** | `gardener-cost-report.md` | The visibility surface — keeps one standing issue with a per-gardener cost & activity table | Weekly · Fri ~09:15 UTC | 300 AIC ($3.00) | 200 AIC ($2.00) | 1 standing issue, `[gardeners]` |
| | | | | | **1000 AIC ($10.00)** repo-wide/day | |

**Engine:** all four use `engine: claude` and require an `ANTHROPIC_API_KEY`
repository secret. See [Engine & secrets](#engine--secrets).

### Reading the schedule

`gh-aw` accepts a friendly schedule (`weekly on tuesday around 9:15`) and
**scatters** it by a few minutes when compiling, so runs from many repos do not
all hit at once. The real cron lives in the generated `.lock.yml`:

```bash
grep 'cron:' .github/workflows/gardener-*.lock.yml
```

Times are **UTC**. During US Eastern Daylight Time (Mar–Nov) 09:15 UTC is
05:15 ET; during Standard Time it is 04:15 ET. If you want them to land in your
morning rather than overnight, see [Changing the timezone](#changing-the-timezone).

### Reading the cost caps

`gh-aw` meters agent spend in **AI Credits (AIC)**. **1 AIC = $0.01 USD.**

- `max-ai-credits` — hard per-run ceiling. The API proxy cuts the run off at this
  number, so a single run cannot overspend. **It defaults to 1000 ($10) if you
  omit it** — always set it explicitly.
- `max-daily-ai-credits` — rolling 24-hour guardrail. When exceeded, the
  activation job **skips the agent entirely** (it warns and files an issue);
  inference is never billed. Omitting this key leaves the guardrail *off*.

The four daily caps are sized to sum to 1000 AIC = **$10/day repo-wide**. Note
the guardrail is enforced per workflow per triggering user, not globally — the
$10 ceiling is an arithmetic budget across the four, not something GitHub
enforces as one number.

AIC figures are computed best-effort from the models.dev pricing catalog and may
not exactly match your provider's invoice.

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

`gh-aw` accepts friendly strings or raw cron. All of these are valid under `on:`:

```yaml
on:
  schedule: weekly on tuesday around 9:15     # what we use
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
```yaml
on:
  schedule:
    - cron: "38 8 * * 2"                      # raw cron, no scattering
```

### Changing the timezone

```yaml
on:
  schedule:
    cron: weekly on tuesday around 9:15
    timezone: America/New_York
```

### Making a gardener run less often

Halve the cost by going fortnightly — there is no `biweekly` keyword, so use raw
cron with a day-of-month filter, or simply move to `monthly on tuesday`.

### Making a change stop after a while (trial runs)

```yaml
on:
  schedule: weekly on tuesday around 9:15
  stop-after: "+30d"      # relative to COMPILE time; recompiling resets it
```

Useful for the two-week shadow-mode evaluation: the workflow disables itself
rather than running forever if nobody looks at it. Minimum unit is hours.

---

## Turning gardeners off and on

Disable (does not delete anything — flips the workflow off in GitHub Actions):

```bash
gh aw disable gardener-large-files
gh aw disable                        # all agentic workflows
```

Re-enable:

```bash
gh aw enable gardener-large-files
gh aw enable
```

Remove one permanently (deletes the `.md` and its `.lock.yml`; commit the result):

```bash
gh aw remove gardener-large-files
```

**Emergency stop for all four:** `gh aw disable`, or from the GitHub UI, Actions
→ pick the workflow → "..." → Disable workflow. Either takes effect immediately.

---

## Seeing what they cost

The **Cost Report** gardener maintains a single standing issue titled
`[gardeners] weekly cost & activity report`. Its issue number never changes, so
bookmark it. That is the intended answer to "what are these things costing me?"

To check directly from the CLI:

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

## Engine & secrets

All four run `engine: claude`, which needs one repository secret:

| Secret | Used by | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | all four gardeners | Set a **small, capped budget** on this key in the Anthropic console. It is a second line of defence behind the AIC caps. |

**Why not Copilot?** `gh-aw` defaults to `engine: copilot`, which needs no secret
— it bills against Copilot premium requests via a `copilot-requests: write`
permission. The `togathernyc` org currently has **0 Copilot seats assigned**
(`seat_management_setting: unconfigured`), so that engine has nothing to draw on.
If seats are provisioned later, switching is a three-line change per file:

```yaml
engine: copilot          # replaces `engine: claude`
permissions:
  copilot-requests: write  # add alongside the existing read scopes
```

…then `gh aw compile` and commit both files. The `ANTHROPIC_API_KEY` secret can
be deleted at that point.

> [!NOTE]
> This secret does **not** flow through the 1Password → GitHub → Convex pipeline
> described in `docs/secrets.md`, because it is consumed only by GitHub Actions
> and never by a Convex function. If you want it managed there anyway, add it to
> the `optional` list in `ee/secrets-allowlist.json` — but do **not** add it to
> `SECRET_KEYS` in `ee/scripts/sync-secrets-to-convex.sh`.

---

## What else `gh aw compile` generated

Committing the gardeners also brought in three files you did not write:

| Path | Why it exists |
|---|---|
| `.github/workflows/agentics-maintenance.yml` | Auto-generated because the gardeners use `expires:` on their safe outputs. A **deterministic, non-agentic** housekeeping workflow — no LLM, no API key. Daily at 00:37 UTC it closes gardener issues past their expiry. Its top-level `permissions:` is `{}`; the scheduled job takes only `issues: write`. It also carries `contents: write` / `pull-requests: write` jobs, but those are gated on `workflow_dispatch` with an explicit `operation` input and never fire on a schedule. Since no gardener can create a PR, the PR-related jobs have nothing to act on. |
| `.github/aw/actions-lock.json` | SHA pins for every action the compiled workflows use. This is what keeps the lock files supply-chain-pinned; do not hand-edit. |
| `.gitattributes` | Marks `*.lock.yml` as `linguist-generated` so they collapse in diffs. |

Regenerate all of them with `gh aw compile`.

---

## Guardrails these agents are told to respect

Two repo-specific rules are written into every gardener's prompt, because
getting them wrong is expensive:

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

- [ ] Did each gardener actually run on schedule? (`gh aw status`)
- [ ] Were the issues it filed **correct** — not just plausible?
- [ ] Did anyone close them, or did they pile up? Issues nobody actions are
      spend with no return.
- [ ] Did real spend land near the caps, or nowhere near? Retune either way.
- [ ] Any daily guardrail trip? That means a gardener was skipped silently.
- [ ] Did the CI Doctor's failure signatures group sensibly, or did it file
      near-duplicates?

Grant write scope to **one** gardener first, not all four.

---

## Reference

- gh-aw docs: <https://github.github.com/gh-aw/>
- Safe outputs: <https://github.github.com/gh-aw/reference/safe-outputs/>
- Frontmatter: <https://github.github.com/gh-aw/reference/frontmatter/>
- Sample workflows these were adapted from: <https://github.com/githubnext/agentics>

`gh-aw` is a technical preview and pre-1.0 — the frontmatter schema changes
between releases. If `gh aw compile` starts rejecting a field, run `gh aw fix`
(dry-run by default) to apply the migration codemods, then recompile.
