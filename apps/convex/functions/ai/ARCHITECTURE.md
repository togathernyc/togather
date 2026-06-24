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
        • post a heads-up into the thread (once, on entering the outage)
        • start the hourly poll loop (idempotent — never stacked)
        • return { available: false }
                │
                ▼
        pollModelAvailability (every hour, self-rescheduling)
                │
                ├─ a model recovered ──► announce "back online", stop
                └─ still down ──► reschedule one hour out
```

State lives in the singleton `claudeModelPolls` row (`schema.ts`), which both
prevents duplicate poll loops and caches the last-known status for
`checkModelStatus`.

## Tools (callable internal actions)

- **`ensureModelAvailable`** — the gate above. A Claude task path should call
  this first and only dispatch when `available: true`, passing the originating
  `notifyGroupId` (+ optional channel slug) so outage/recovery notices land in
  the right thread.
- **`checkModelStatus`** — read-only "what's the status right now"; returns each
  model's availability and the model the bot would pick. Never schedules a poll.
- **`pollModelAvailability`** — the hourly loop; normally scheduled by
  `ensureModelAvailable`, not called directly.
