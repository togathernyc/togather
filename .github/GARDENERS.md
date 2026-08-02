# Gardeners — operator guide

Five scheduled maintenance agents for this repo — four "gardeners" plus the repo
half of the **[Watchdog](#watchdog)**, which is gardener-shaped but watches the
agent fleet rather than the code — built with
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
> only produce **issues, comments, and — for Cost Report alone — an in-place
> rewrite of its own standing issue body** (`update-issue`, constrained to
> `body` and to titles matching `[gardeners] `). None can open a pull request,
> push a branch, or edit a file. Evaluate the output for two weeks before
> granting any write scope — checklist at the bottom.

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
| **Watchdog (repo)** | `watchdog-repo.md` | Sweeps for stuck claims, failing gardeners, and green agent PRs nobody has reviewed — see [Watchdog](#watchdog) | `codex` → **Ollama** · `glm-5.2` | **Every 6h** (00/06/12/18 ET) | 200 AIC | 400 AIC | 1 issue/day, `[watchdog]` |

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
| Watchdog (repo) | No skip, for a stronger reason: `skip-if-match` would silence the watchdog precisely when its last sweep found something, which is when you need it most. One issue per day, rewritten in place by the day's later runs. |

**Why `expires: 6d` and not 7d.** The maintenance sweep that closes expired
issues used to run only once a day, at 00:37 UTC. With a 7-day expiry on a weekly
gardener, the sweep closed last week's issue roughly *eleven hours after* the next
run had already checked `skip-if-match` and skipped — so each gardener would
quietly run every **other** week while the table above claimed weekly. Six days
closes it the morning before.

That sweep now runs [every two hours](#githubworkflowsagentics-maintenanceyml),
which shrinks the window this reasoning turns on to under two hours — but 6d is
still correct and still the safer number, so it stays. If you change a cadence,
re-check this interaction.

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

### Reading the firewall config

Every gardener runs behind the AWF egress firewall. What is worth understanding
before you touch `network:` — because the obvious reading is backwards:

> [!WARNING]
> **`network.allowed` is ADDITIVE over the engine's baseline. It cannot narrow
> anything.** Listing ecosystem identifiers only ever *widens* egress. An earlier
> revision of these gardeners used `allowed: [github, node, threat-detection]`
> believing it was a restriction; it compiled ci-doctor to **88** domains against
> **55** for plain `defaults` — a 60% increase, including `telemetry.vercel.com`,
> `storage.googleapis.com`, and four `*.githubcopilot.com` hosts. `registry.npmjs.org`
> was already in the baseline, so `node` bought nothing.

The only true narrowing lever is **`network.blocked`**, which emits a separate
`blockDomains` list that takes precedence at request time. Note it does *not*
shrink `allowDomains` in the lock file — the effective set is
`allowDomains − blockDomains`, so counting one list alone will mislead you.

Measured at the current head:

| Gardener | `allowDomains` | blocked out | **effective** |
|---|---:|---:|---:|
| CI Doctor | 55 | 5 | **50** |
| Large Files | 43 | 0 | **43** |
| Docs Drift | 43 | 0 | **43** |
| Cost Report | 43 | 0 | **43** |
| Watchdog (repo) | 43 | 0 | **43** |

The codex baseline is smaller than claude's, which is why the three Ollama
gardeners sit lower despite adding `ollama.com`. `blocked` removes nothing there
because those ecosystems are absent from the codex baseline to begin with; it is
kept for consistency and to stay correct if the baseline changes.

**The baseline itself is irreducible in this gh-aw version** short of blocking
individual infrastructure domains by name — OCSP/CRL endpoints, Ubuntu archives,
certificate and schema hosts. Doing that risks breaking TLS validation or
container start-up in ways that cannot be verified without a live run, so it has
not been attempted. Reproduce any of the above with:

```bash
python3 -c "import re,sys; s=open(sys.argv[1]).read(); \
  g=lambda k: set(re.findall(r'\\\\?\"([^\"\\\\]+)\\\\?\"', re.search(k+r'\\\\?\":\[(.*?)\]', s).group(1))); \
  a,b=g('allowDomains'),g('blockDomains'); print(len(a), len(a&b), len(a-b))" \
  .github/workflows/gardener-ci-doctor.lock.yml
```

### Reading the cost caps

`gh-aw` meters agent spend in **AI Credits (AIC)**. **1 AIC = $0.01 USD.**

- `max-ai-credits` — hard per-run ceiling, enforced mid-run by the API proxy, so
  a single run cannot overspend. **It defaults to 1000 ($10) if you omit it** —
  always set it explicitly. Each gardener's per-run cap is held at or below its
  daily slice, so one run can never blow the whole day's budget.
- `max-daily-ai-credits` — rolling 24-hour guardrail, checked *before* the agent
  starts. When exceeded the activation job skips the run entirely and nothing is
  billed. Omitting this key leaves the guardrail *off*.
- `max-turns: 30` is the other non-financial bound. `timeout-minutes: 15` is
  **only real on CI Doctor** — see the warning below.

> [!CAUTION]
> **`timeout-minutes` is silently dropped for `engine: codex` in gh-aw v0.83.4.**
> The compiler emits it as a step-level timeout on the agent execution step for
> `engine: claude`, but the codex step builder never emits it at all. Verified:
> `grep -c 'timeout-minutes: 15'` returns **1** in
> `gardener-ci-doctor.lock.yml` and **0** in all three codex lock files. There is
> no frontmatter key that fixes this — the engine schema has no timeout field,
> and `engine.command` / `engine.harness` replace the executable rather than
> bound it.
>
> **So the three Ollama gardeners' agent jobs have no wall-clock limit of their
> own** and fall back to GitHub Actions' default job ceiling of **360 minutes**.
> Their real bounds are the AI-credit cap and `max-turns`, both enforced inside
> the AWF proxy — and both demonstrably do terminate a run, since the
> analogous cache-miss guard is exactly what stopped
> [run 30686121841](https://github.com/togathernyc/togather/actions/runs/30686121841)
> mid-flight.
>
> The `timeout-minutes: 15` line is deliberately left in those three workflows:
> it is inert today but costs nothing and will start working if gh-aw closes the
> gap. Do not treat it as a live control until `grep` says otherwise. This looks
> like an upstream bug and is worth reporting to github/gh-aw.

The five daily caps sum to 1400 AIC = **$14/day repo-wide** (the repo watchdog
added the fifth, raised to 400 after it exhausted 200 in a single day). The guardrail is enforced per workflow per triggering
user, not globally — that $12 is an arithmetic budget across the five, not one
number GitHub enforces.

> [!NOTE]
> **"200 AIC" is not the same ceiling for each gardener.** It is a dollar
> budget, so at each model's declared price it buys wildly different amounts of
> work:
>
> | Gardener | Model | ~Input tokens per 200 AIC |
> |---|---|---:|
> | Large Files | `deepseek-v4-flash` ($0.14/1M) | **~14M** |
> | Docs Drift, Cost Report, Watchdog | `glm-5.2` ($1.40/1M) | **~1.4M** |
> | CI Doctor | claude (default) | **~a few hundred thousand** |
>
> (Input-only, for scale; output costs 2–3× more, so real runs land lower.)
>
> The practical consequence: on the three Ollama gardeners the AIC cap is loose
> enough that it will rarely be the first thing to stop a run — **`max-turns` is
> the binding bound there**, since `timeout-minutes` is inert for `engine: codex`
> (see the caution above). The cap is a backstop against a pathological loop
> rather than a working budget, and with no wall-clock limit it is also the only
> thing standing between a wedged run and GitHub's 360-minute job ceiling. On CI
> Doctor both the cap and the timeout are real and close enough to bind.
>
> To change how much work an Ollama gardener does, tune `max-turns`. Tuning its
> AIC or its `timeout-minutes` will mostly do nothing.

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
  still cut a runaway run off, which is the useful part. The rates in force are
  the ones each workflow declares under `models.default-ai-credits-pricing` —
  pinned to the model vendor's list price, not fetched at compile time (see
  [Always pass `--no-models-dev-lookup`](#always-pass---no-models-dev-lookup)).
  They reach the proxy as `defaultAiCreditsPricing` in the lock file, which is
  where to check what is actually enforced.

  **Your real exposure on the Ollama path is the Ollama Cloud subscription
  itself** ($20/mo Pro, with session limits resetting every 5 hours and weekly
  limits every 7 days) — not anything in the table above. Note there is **no
  wall-clock backstop** on these three: `timeout-minutes` does not compile for
  `engine: codex`, so a wedged run is bounded by the credit cap, `max-turns`, and
  GitHub's 360-minute job ceiling rather than by 15 minutes.

Metering works on the Ollama path at all only because gh-aw routes **every**
engine through the AWF API proxy sidecar; the proxy is retargeted at `ollama.com`
rather than bypassed. The failure mode is the opposite of the usual worry: an
unpriced model does not run unmetered, it gets **rejected with HTTP 400
`unknown_model_ai_credits`**. That is why each Ollama gardener declares
`models.default-ai-credits-pricing` — gh-aw's own daily Ollama test broke for
eight consecutive days on exactly this.

Since we compile with `--no-models-dev-lookup`, that declaration is not a
fallback any more; it is **the** pricing. If you add an Ollama-backed gardener
and forget it, the proxy rejects every request rather than running unmetered —
loud, and in the safe direction.

---

## Watchdog

The gardeners watch the **code**. The watchdog watches the **agents** — it is the
manager layer above the orchestrators, and the only thing in this repo whose job
is noticing that an automated run has stopped without saying so.

It never edits code, never implements anything, and never opens a pull request.
It detects, it diagnoses cheaply, and it escalates. The respawn ladder — retry,
re-plan, give up — lives inside the overnight supervisor
(`.claude/commands/overnight.md`), which is the right place for it: a supervisor
can see its own units of work. What a supervisor cannot see is that *it* died,
that it is burning money, or that it walked away from a claimed issue. That is
the gap this fills.

### Two halves, because one machine cannot see both sides

| | **Local half** | **Repo half** |
|---|---|---|
| What | `scripts/watchdog.sh` + a launchd job | `.github/workflows/watchdog-repo.md` |
| Runs | every 30 min, on the owner's Mac | every 6h, on GitHub Actions |
| Costs | **$0** — bash, `gh`, `ccusage`. No model call anywhere in it | ~$0.50/run capped, `glm-5.2` on Ollama |
| Can act? | **Yes**, narrowly: releases orphaned claims | **No.** Read-only, reports only |
| Sees | live processes, real spend, the overnight marker files | issue/PR history, workflow runs, review state |

The split is not redundancy. Each half checks things the other physically
cannot. Only the local half can answer "is a `claude` process alive right
now?" — which is the difference between *slow* and *dead*, and the only safe
basis for releasing someone's claim. Only the repo half can see a pull request
that has been green and unreviewed for a day, because that happens while the
laptop is closed.

**The local half is not installed by merging anything.** It is a launchd job on
one machine; install steps are in the header comment of
`scripts/com.supa.fleet-watchdog.plist`. The repo half ships disabled behind the
same `GARDENERS_ENABLED` variable as the gardeners.

### What the local half checks

Every 30 minutes, in this order. It **exits immediately** — under a second, and
$0 — when there is no agent process running, no `agent:in-progress` issue, and
no overnight marker file. On an idle machine that is every single run, and it is
the normal case.

| Check | Trips when | Escalation |
|---|---|---|
| **Liveness** | an `agent:in-progress` issue has no open PR and no branch commit (local or remote) or issue activity for 45 min | report |
| **Orphaned claim** | the same, past 2h, **and** no agent process on the host, **and** no remote branch activity | **relabels** `agent:in-progress` → `agent:ready`, comments why, reports |
| **Spend pace** | `ccusage`'s active 5-hour block passes $25 (report) or $40 (page) | report at $25; **page** at $40 *only if no unattended run is in flight* |
| **Overnight health** | `stop-epoch` says the run should still be working but no session is alive | **page** if the queue is non-empty or unknown, report if it is empty |
| **caffeinate leak** | the pidfile's process is still holding the machine awake >1h past `stop-epoch` | report |
| **Gardener failures** | a `Gardener:`/`Watchdog:` workflow failed in the last day (queried per workflow, so a busy CI day cannot crowd it out) | report |
| **Spend check disabled** | `ccusage` is not on the launchd PATH | report, once a day |

"Liveness" reads four signals and takes the newest: an **open linked PR** (which
means the issue is finished, not stalled — never flagged), a **local commit on
the branch the supervisor would have created** for it (`<init>/<slug>`, derived
with overnight.md's own slugify), **the same branch on `origin`** (via
`git ls-remote`, which asks the remote without writing to the local ref store,
so it cannot race anyone's checkout), and the **issue's own `updatedAt`**.

### Which layer owns the reclaim

**The watchdog does, at 2h.** `overnight.md` § 0.5 performs the identical repair
at **12h** — same relabel, same "no open PR" precondition. Once the launchd job
is installed the watchdog always gets there first, so § 0.5 becomes a backstop
that effectively never fires, and **the real window is 2 hours, not 12**. If you
read § 0.5 in six months and believe 12h, this is the paragraph that corrects
you. On a host without the local watchdog installed, § 0.5 is still the only
reclaimer and 12h is still the window.

The watchdog is deliberately the tighter of the two because it can afford to be:
it runs every 30 minutes and can check whether a session is *actually alive*,
which the supervisor's start-of-night sweep cannot.

### The reclaim's blind spot, stated plainly

Reclaiming requires **all three**: no agent process on this Mac, no local or
remote branch activity, and no issue activity for 2h. The remote-branch check is
what covers agents that are not local processes — Cursor Cloud agents, Conductor
sessions, CI agents (see `CLAUDE.md` § "Agent Backend Selection"), any of which
push to `origin` and are otherwise invisible to `pgrep`.

**The residual risk:** a remote agent that claimed an issue and has pushed
nothing for 2h can still be falsely reclaimed, and the cost is two agents on one
issue. There is no signal left at that point to tell it from an abandoned claim.

The mitigation is a convention on the agent side, not more machinery here:
**an agent that claims an issue should comment on it when it claims it, and again
on any long silent stretch.** A comment moves `updatedAt`, which is one of the
four liveness signals, so it makes a working agent visible. The reclaim comment
the watchdog leaves says this too, so an agent that gets reclaimed learns why.

If any lookup the decision depends on fails — the linked-PR query, the remote
ref list — the watchdog **does not reclaim**. It reports the claim as
"unverified" and re-checks in 30 minutes. Failing closed costs a delay; failing
open costs duplicated work.

Every threshold is in `scripts/watchdog.config.sh`. Nothing else needs editing,
and `WATCHDOG_DRY_RUN=1 ./scripts/watchdog.sh` runs every check while mutating
nothing — including printing the report body it would have filed.

### Silence is the feature

An all-clear appends **one line to a local log and does nothing else**. No issue,
no notification. The design assumption is that you will stop reading anything
that talks to you every 30 minutes, so it only talks when something is wrong —
and even then it separates the two volumes:

- **Report** — one issue per day, labelled `watchdog:report`, title-prefixed
  `[watchdog]`, updated in place. An orphan reclaim goes here: it is a *repair*,
  the queue is strictly better afterwards, and nobody needs waking for it.
- **Page** — a Telegram message, and only for findings that mean the night is
  being wasted or money is running away with nobody watching: a dead overnight
  run with issues still queued, or spend past $40 while no unattended run is in
  flight. An unchanged page will not re-send for 6h; a genuinely *new* condition
  goes out immediately.

  The cooldown works because the digest is taken over each finding's **identity**
  (`spend-runaway`, `overnight-dead:<stop-epoch>`) and never over its rendered
  text. Every page interpolates something that moves between sweeps — a live
  cost, an age, a countdown — so a digest over the prose differs on every run and
  suppresses nothing at all. That version shipped in the first draft of this PR
  and would have paged every 30 minutes through the night.

Telegram uses the same `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` credentials as
the overnight supervisor's morning report (setup in overnight.md § 8.4). launchd
does not read your shell profile, so the script falls back to the macOS keychain
when they are absent from the environment — which is where those docs tell you to
put them anyway. **Do not put the bot token in the plist**: it is a bearer
credential in a URL path and `~/Library/LaunchAgents` is world-readable and gets
backed up. If both are missing the page still lands in the report issue, and the
log says so.

The repo half carries `max-turn-cache-misses: 200` for the same reason the three
Ollama gardeners do — on a provider with no prompt caching that setting is a hard
request cap, not a cache guard. It is documented once, in
[Move a gardener onto Ollama](#move-a-gardener-onto-ollama-open-model-flat-rate)
and the incident table below it; do not re-derive it here.

### One-time setup

The report issue needs its label to exist first — `gh issue create` fails on an
unknown label, and the script's log will tell you that is what happened:

```bash
gh label create "watchdog:report" --color 5319E7 \
  --description "Filed by the fleet watchdog - read, do not hand-edit"
```

Then install the launchd job (the plist header is the runbook — it templates the
repo path, `$HOME`, **and** your node bin directory, so `ccusage` keeps resolving
across node upgrades) and, for the repo half,
`gh variable set GARDENERS_ENABLED --body true` — the same switch as the
gardeners, on purpose: one variable turns the entire automated fleet off.

`launchctl bootstrap gui/$UID <plist>` is the modern spelling; `bootout` removes
it and `kickstart` forces a sweep now. `load`/`unload`/`start` still work but
warn.

---

## Where your code goes

Running these agents sends repository content to third-party inference
providers. That is an ordinary decision and it was made deliberately — the
per-gardener model split below is the repo owner's choice, on his own Ollama
plan — but it is his decision to make, and you should know you are making it
before you set `GARDENERS_ENABLED`.

| Gardener | Sends | To | Under |
|---|---|---|---|
| **Large Files** | The full text of the largest source file it finds, plus a listing of every tracked source path | `ollama.com` | the owner's Ollama Cloud account |
| **Docs Drift** | Up to **8 days of merged-commit diffs**, plus the docs and onboarding-guide files it checks them against | `ollama.com` | the owner's Ollama Cloud account |
| **Cost Report** | Workflow run metadata and token-usage figures — no source | `ollama.com` | the owner's Ollama Cloud account |
| **CI Doctor** | **CI logs** from failed runs, which routinely quote source, file paths, and test output | `api.anthropic.com` | the owner's Anthropic API key |
| **Watchdog (repo)** | Issue and PR metadata — numbers, titles, timestamps, check conclusions. No source, no diffs, no log text | `ollama.com` | the owner's Ollama Cloud account |

This repository is public (AGPL-3.0), so none of this is confidential
disclosure. It would be if the setup were copied to a private repo — which is
exactly the situation to re-read this table in.

### What the providers say they do with it

Both published policies are favourable, and both are quoted rather than
paraphrased so you can check them:

- **Ollama** ([privacy policy](https://ollama.com/privacy)) — *"When using
  cloud-hosted models, we process your prompts and responses transiently to
  provide the service and never train on it."* Elsewhere: content *"is not stored
  beyond the time required to fulfill the request"*, and *"We do not use your
  inputs or outputs to train any AI models."*
- **Anthropic** ([privacy centre](https://privacy.anthropic.com/en/articles/7996868-is-my-data-used-for-model-training))
  — *"By default, we will not use your inputs or outputs from our commercial
  products"* to train models.

Policies change and neither is a contract you negotiated. If that matters for
your use, read the current versions rather than trusting this snapshot.

### Sending nothing to Ollama

One line per gardener puts it back on Claude only — replace the `engine:` block
with `engine: claude` and drop `model:` / `models:` / `max-turn-cache-misses:`
and the `ollama.com` entry in `network.allowed`. Full steps in
[Move a gardener back onto Claude](#move-a-gardener-back-onto-claude).

To send nothing to *any* third party, do not set `GARDENERS_ENABLED`. There is no
configuration in which these agents do useful work without an external model.

---

## Changing the cadence

> [!WARNING]
> **The `.md` file is the source; the `.lock.yml` is what actually runs.**
> Editing the `.md` without recompiling changes *nothing* — GitHub Actions only
> ever reads the `.lock.yml`. The schedule will silently stay exactly as it was.
> Always run `gh aw compile --no-models-dev-lookup` and commit **both** files.

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
gh aw compile --no-models-dev-lookup

# 3. Commit BOTH files together
git add .github/workflows/gardener-large-files.md \
        .github/workflows/gardener-large-files.lock.yml
git commit -m "chore(gardeners): move large-files scan to Wednesdays"
```

Recompile everything at once with a bare
`gh aw compile --no-models-dev-lookup`. Add `--approve` if it warns about a
newly-introduced secret or action (it is asking you to review a supply-chain
change — read what it lists before approving).

Sanity check that the change landed:

```bash
git diff --stat .github/workflows/          # both .md and .lock.yml should appear
grep 'cron:' .github/workflows/gardener-large-files.lock.yml
```

> [!IMPORTANT]
> ### Always pass `--no-models-dev-lookup`
>
> **Why:** it makes the lock files deterministic. Without it, `gh aw compile`
> looks up per-token pricing on models.dev *at compile time* for any model
> outside gh-aw's embedded catalogue — which is all three Ollama models — and
> bakes the result into the lock file. models.dev lists the same model under
> dozens of resellers at different prices (`glm-5.2` ranges from $0.50 to $1.80
> per 1M input), and the compiler does not always pick the same one. Two compiles
> minutes apart in this repo produced **two different prices for the same model**.
> The result is lock-file churn with no source change, which makes "recompile and
> confirm an empty diff" — the integrity check this whole workflow rests on —
> useless exactly where it matters most.
>
> **What you give up:** the imputed dollar figures no longer track the market.
> They come instead from each workflow's `models.default-ai-credits-pricing`,
> which is pinned to the model vendor's own list price (`glm-5.2` → Zhipu's
> $1.40/$4.40; `deepseek-v4-flash` → DeepSeek's $0.14/$0.28). At those rates a
> rounding error is worth fractions of a cent, and `max-ai-credits` still bounds
> the worst case regardless — so this costs precision that was never real
> anyway, and buys a reproducible build.
>
> **Refresh the fallbacks deliberately** when a model reprices, rather than
> having the compiler do it behind your back:
> ```bash
> curl -s https://models.dev/api.json | python3 -c \
>   "import json,sys; d=json.load(sys.stdin); m='glm-5.2'; \
>    print({k: v['models'][m].get('cost') for k,v in d.items() if m in v.get('models',{})})"
> ```
> Pick the model vendor's own entry (`zhipuai` for GLM, `deepseek` for DeepSeek),
> update `models.default-ai-credits-pricing` in the workflow, recompile, commit.
>
> Verify determinism any time by compiling twice and diffing — it should be
> byte-identical.

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
**edit → `gh aw compile --no-models-dev-lookup` → commit both files.**

### Move a gardener onto Ollama (open model, flat-rate)

```yaml
engine:
  id: codex
  env:
    OPENAI_BASE_URL: "https://ollama.com/v1"
    OPENAI_API_KEY: "${{ secrets.OLLAMA_API_KEY }}"
model: glm-5.2

models:
  default-ai-credits-pricing:   # REQUIRED ($/1M tokens) — without it the proxy
    input: 1.40                 # 400s every request. Pin to the model VENDOR's
    output: 4.40                # list price (zhipuai for GLM, deepseek for V4).

network:
  allowed:
    - defaults
    - "ollama.com"              # REQUIRED — the firewall blocks it otherwise
  blocked:
    - python
    - playwright
    - containers

max-turn-cache-misses: 200      # see the trap below — 5 and 40 both kill runs
```

> [!CAUTION]
> **`max-turn-cache-misses` is not a cache guard on Ollama — it is a hard request
> cap, and it will kill healthy runs.** Ollama does no prompt caching, so *every*
> request is a "consecutive miss" and the counter only ever goes up. Set it far
> above your turn budget. It **cannot be disabled** — the schema enforces
> `minimum: 1`, and `-1` fails to compile with `must be at least 1 (got -1)`.
> Live-verified below.

gh-aw reads `OPENAI_BASE_URL` at compile time, extracts the hostname, and points
the AWF proxy at it (`"targets":{"openai":{"host":"ollama.com"}}` in the lock
file). **The host must also appear in `network.allowed`** or every request is
firewalled.

Also pin `CODEX_API_KEY` to the same secret. Left alone, gh-aw wires
`CODEX_API_KEY: ${{ secrets.CODEX_API_KEY || secrets.OPENAI_API_KEY }}` — so the
day someone adds an unrelated `OPENAI_API_KEY` repo secret, it would be handed to
a CLI whose OpenAI host is `ollama.com`. Naming it explicitly removes the
fallback.

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
| `OLLAMA_API_KEY` | Large Files, Docs Drift, Cost Report, Watchdog (repo) | From ollama.com. Passed to the codex engine as **both** `OPENAI_API_KEY` and `CODEX_API_KEY`, pinned explicitly — see the warning below. |
| `ANTHROPIC_API_KEY` | CI Doctor | Set a **small, capped budget** on this key in the Anthropic console — a second line of defence behind the AIC caps. |

Both are plain repository secrets:

```bash
gh secret set OLLAMA_API_KEY
gh secret set ANTHROPIC_API_KEY
```

> [!WARNING]
> **Do not add an `OPENAI_API_KEY` repository secret expecting it to be ignored.**
> The codex engine's default wiring is
> `CODEX_API_KEY: ${{ secrets.CODEX_API_KEY || secrets.OPENAI_API_KEY }}` — an
> undeclared fallback that would quietly hand an unrelated OpenAI key to a CLI
> whose OpenAI host is `ollama.com`, i.e. send your OpenAI credential to Ollama.
>
> All three Ollama gardeners pin `CODEX_API_KEY` explicitly in `engine.env`,
> which removes the fallback — verify with
> `grep 'CODEX_API_KEY:' .github/workflows/gardener-large-files.lock.yml`; every
> occurrence should read `secrets.OLLAMA_API_KEY` and none should contain `||`.
> **If you add a new codex-based gardener, pin it too.**

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

**All five at once** — the `GARDENERS_ENABLED` variable, effective immediately,
no recompile. The repo watchdog shares this switch deliberately: one variable
turns the whole automated fleet off. (The *local* watchdog is a launchd job and
is unaffected — `launchctl bootout gui/$UID/com.supa.fleet-watchdog` is its
switch.)

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
It runs every **2 hours at :37**.

> [!NOTE]
> **That cadence is repo-global and derived from the *minimum* `expires:`
> anywhere in the repo** — do not hand-edit the cron, `gh aw compile` rewrites
> it. It was daily at 00:37 UTC until the watchdog's report issue introduced
> `expires: 1d`; a future workflow with `expires: 1h` would ratchet it again for
> everything. The file is generated, so nobody will think to look here — which is
> why it is written down. Costs nothing but Actions minutes: the jobs below are
> `actions/github-script` only, on `ubuntu-slim`, in a public repo.

Its top-level `permissions:` is `{}`, but **four jobs run on that cron**,
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

Regenerate all of them with `gh aw compile --no-models-dev-lookup`.

---

## Guardrails these agents are told to respect

Both of these rules are now written into all four gardeners' prompts — verify
with `grep -c 'check-native-instance' .github/workflows/gardener-*.md` — because
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
- [ ] **Did the Ollama-backed gardeners complete their runs?** Tool calling is
      proven (2026-08-01, `deepseek-v4-flash`, ~40 clean tool-executing turns).
      What is unproven is whether Docs Drift and Cost Report fit inside their
      turn budgets — neither has run live. A run that dies partway is a
      `max-turns` problem, not a model problem; see below.

Grant write scope to **one** gardener first, not all four.

### The Ollama path: what is proven and what is not

The wiring is verified in the lock files (proxy retarget, firewall allowlist, AIC
caps, model pricing), the endpoint and model IDs are confirmed against the live
API, and **one gardener has now run for real** — see the 2026-08-01 run below.

**The endpoint and the model IDs are now confirmed against the live API**
(probed 2026-07-31, unauthenticated):

| Probe | Result |
|---|---|
| `POST https://ollama.com/v1/chat/completions` | **401** — the endpoint exists and requires auth |
| `GET https://ollama.com/v1/models` | **200** — returns the cloud catalogue |
| `glm-5.2` in that catalogue | **exact match** |
| `deepseek-v4-flash` in that catalogue | **exact match** |
| Any `:cloud`-suffixed IDs | **none** — every ID is a bare name |

So the OpenAI-compatible base URL is real despite not appearing in Ollama's own
docs (which document `https://ollama.com/api` for cloud and only show the `/v1`
shape against a local daemon), and the bare model names in these workflows are
the correct strings. There is no `:cloud` suffix to worry about — the API does
not offer one.

Re-run the check yourself any time:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://ollama.com/v1/models
curl -s https://ollama.com/v1/models | python3 -c \
  "import json,sys; print([m['id'] for m in json.load(sys.stdin)['data']])"
```

### Live run, 2026-08-01: tool calling works — the request cap was the problem

The last open question was tool-calling quality. It has now been tested for real
(`gardener-large-files`, dispatched manually with secrets wired and
`GARDENERS_ENABLED=true`,
[run 30686121841](https://github.com/togathernyc/togather/actions/runs/30686121841)):

| | |
|---|---|
| **Tool calling on `deepseek-v4-flash`** | **Worked.** ~40 consecutive healthy tool-executing turns, mid-scan of a 3,000-line file. |
| **Outcome** | **Failed** — `403 Maximum consecutive cache misses exceeded (40/40)` from the gh-aw api-proxy |
| **Cause** | `max-turn-cache-misses`, not the model |
| **maxRuns / AI credits / timeout** | all held correctly |

So the open-model bet is sound and the guard was wrong. **`max-turn-cache-misses`
is meaningless on Ollama**: with no prompt caching, every request is a
"consecutive miss", so the setting stops being a cache-health signal and becomes
a hard cap on total requests. At 40 it killed a run that was doing exactly what
it was asked to do.

It is now **200** on all three Ollama gardeners — comfortably above any realistic
turn budget. It cannot simply be switched off: the schema enforces `minimum: 1`,
and `max-turn-cache-misses: -1` fails to compile with
`must be at least 1 (got -1)`. Verified, not assumed.

Two follow-on changes from the same run:

- **`gardener-large-files` now has `max-turns: 60`** (was 30). It was still
  mid-scan when it died, and cost is nowhere near binding on this model — 200 AIC
  buys roughly 14M input tokens — so `max-turns` is what actually bounds it
  (`timeout-minutes` is inert on codex). It needed the room.
- **Its prompt now insists on reading a file in one call, not in pages.** The run
  was paging a 3,000-line file in ~250-line slices against a **million-token**
  context window, spending its request budget on pagination. Fewer, larger reads
  is both cheaper and far less likely to hit any cap.

**Docs Drift and Cost Report have not been probed live.** They got the same
`max-turn-cache-misses: 200`, but their turn budgets are untested — Docs Drift in
particular makes a lot of git calls. If either dies partway through, this is the
first thing to look at, and `max-turns` is the knob.

**If an Ollama gardener does fail at runtime, the rollback is four lines** — swap
its `engine:` block for `engine: claude`, drop `model:` / `models:` /
`max-turn-cache-misses:` and the `ollama.com` network line, recompile, commit.
See [Move a gardener back onto Claude](#move-a-gardener-back-onto-claude).

### Live run, 2026-08-01: `gh` does not work inside the agent, and neither do `mcp__github__*` calls

The repo watchdog's first production runs
([run 30697357668](https://github.com/togathernyc/togather/actions/runs/30697357668),
issue #715) died on `403 Maximum AI credits exceeded (50.469 / 50)`. The credit
cap was the symptom. The cause was that **the agent could not read GitHub at
all**, and spent its whole budget working out why.

> [!CAUTION]
> **Inside the agent container: `gh` is NOT authenticated, and MCP servers are
> NOT callable as `mcp__github__*` functions under the `codex` engine.**
> Measured, in this order, by an agent with no other option:
>
> | Attempt | Result |
> |---|---|
> | `mcp__github__list_issues` | `ERROR … unsupported call: mcp__github__list_issues` |
> | `gh auth status` | prints nothing — unauthenticated |
> | `safeoutputs --help` | works, but it is **write-only** (8 tools, no reads) |
> | `github list_issues .` | **works** — `MCP tools/call: status=200` |
>
> gh-aw mounts each MCP server as a **CLI shim** on `PATH`
> (`$RUNNER_TEMP/gh-aw/mcp-cli/bin/{github,safeoutputs}`). The generated prompt
> advertises the `safeoutputs` shim but **not** the `github` one, while
> simultaneously instructing the agent to "use GitHub MCP tools for all GitHub
> reads" — so an agent that needs a read has to discover the shim by
> experiment. That is ~10 turns of uncached context on a provider that re-bills
> the whole conversation every turn.

**Any gardener whose prompt calls `gh` for data is broken and does not know it.**
The shim gives 28 read commands — `list_issues`, `list_pull_requests`,
`issue_read`, `pull_request_read`, `actions_list`, `actions_get`, `search_*`:

```bash
github --help
github list_issues --owner togathernyc --repo togather --state open
printf '%s' '{"owner":"togathernyc","repo":"togather"}' | github list_issues .   # verified form
```

Fixed in Watchdog and Cost Report. **Large Files and Docs Drift were never
affected** — they read the checked-out working tree with `git`, `grep` and `cat`
and never touch the GitHub API, which is exactly why Large Files was able to run
to the request cap in the first place.

> [!WARNING]
> **`tools.bash` is inert on `engine: codex` — it is documentation, not a
> sandbox.** The entries never reach the lock file (`grep -c 'cat \*'` on any
> codex `.lock.yml` returns **0**) and the agent is launched with
> `--dangerously-bypass-approvals-and-sandbox`. The failing run freely executed
> `gh`, `ls`, `cat` and `./bin/github`, none of which were in its allowlist.
>
> So **fixing a gardener by editing its `bash:` list changes nothing.** Keep the
> list honest as a statement of intent, but the prompt is the only thing that
> actually steers these agents. Do not rely on it as a security boundary —
> the real boundaries are the egress firewall, the read-only `permissions:`, and
> safe-outputs.

> [!NOTE]
> **The "Invalid or Unsupported Model" banner on issue #715 is a
> misclassification — ignore it.** codex emits
> `{"type":"error","message":"Model metadata for 'glm-5.2' not found. Defaulting
> to fallback metadata"}` for any model outside its built-in table, and gh-aw's
> failure reporter pattern-matches that into a model error. **`deepseek-v4-flash`
> emits the byte-identical item** in run 30686121841 — which succeeded. It is a
> warning about metadata, not a rejection; `glm-5.2` ran fine for eight minutes
> and made real tool calls. Do not go changing model IDs on the strength of that
> banner.

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
