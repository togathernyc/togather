# `functions/ai` — Claude model availability

This folder holds the Togather Bot's guardrail for **executing tasks with
Claude models**: before a task is dispatched, confirm a Claude model is
actually reachable, and degrade gracefully when none is.

## Pieces

| File | What it is |
| --- | --- |
| `../../lib/ai/claudeAvailability.ts` | Pure, `fetch`-injectable core. Probes Anthropic's Models API and walks the **Opus → Sonnet** fallback chain. Fully unit-tested (`__tests__/ai/claudeAvailability.test.ts`). |
| `modelAvailability.ts` | Convex actions/mutations that wrap the core with the bot's runtime behavior (notify + poll). |

## Models

The preference chain lives in `claudeAvailability.ts`:

1. **`claude-opus-4-8`** (Claude Opus) — primary
2. **`claude-sonnet-4-6`** (Claude Sonnet) — fallback

A model counts as available when `GET /v1/models/{id}` returns `200`. `404`
(unknown/retired id), `401`/`403` (no access), `429` (rate limited), and
`5xx`/`529` (overloaded/outage) all mean "don't dispatch to it." The probe uses
`ANTHROPIC_API_KEY` (see `docs/secrets.md`); without it the gate fails closed.

## Flow

```
task requested
   │
   ▼
ensureModelAvailable(notifyTarget?)
   │
   ├─ Opus healthy?  ──► return { available: true, model: "claude-opus-4-8" }
   ├─ Opus down, Sonnet healthy? ──► return { available: true, model: "claude-sonnet-4-6" }
   └─ both down:
        • record this thread as an outage target (deduped) and post it a
          one-time heads-up
        • start the hourly poll loop (idempotent — never stacked)
        • return { available: false }
                │
                ▼
        pollModelAvailability (every hour, self-rescheduling)
                │
                ├─ a model recovered ──► announce "back online" to every
                │                        affected thread, then stop
                └─ still down ──► reschedule one hour out
```

Multiple threads can trip the gate during one outage; each is recorded once in
`notifyTargets` and gets exactly one heads-up and one back-online notice.
Whichever path notices recovery first — a later gate retry or the hourly poll —
announces to all of them and clears the loop (`resolveRecovery`); the other
becomes a no-op.

State lives in the singleton `claudeModelPolls` row (`schema.ts`), which
prevents duplicate poll loops, holds the outage's notify targets, and caches the
last-known status for `checkModelStatus`.

## Tools (callable internal actions)

- **`ensureModelAvailable`** — the gate above. A Claude task path should call
  this first and only dispatch when `available: true`, passing the originating
  `notifyGroupId` (+ optional channel slug) so outage/recovery notices land in
  the right thread.
- **`checkModelStatus`** — read-only "what's the status right now"; returns each
  model's availability and the model the bot would pick. Never schedules a poll.
- **`pollModelAvailability`** — the hourly loop; normally scheduled by
  `ensureModelAvailable`, not called directly.
