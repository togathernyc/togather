# Fix: Slackbot Nag Hallucinating Confirmations

## Problem
The nag agent (GPT) hallucinates confirmations. Even when PCO shows all positions as "Needed" (nobody assigned), the agent marks items as ✅ confirmed. Root cause: the AI interprets "responsible person" mentions and ambiguous PCO data as confirmation, instead of the code computing it deterministically.

## Solution: Pre-compute status + Two-phase nag

### Change 1: Pre-compute item statuses in code (`prompts.ts`)
Instead of letting the AI decide what's confirmed/missing, compute it from PCO data:
- **Role items** (`assign_role`): Check `teamMembers` for platform team with matching position + actual person (not "Needed" placeholder via `pcoPersonId`). Any status (C or U) counts as filled.
- **Plan item items** (`update_plan_item`): Check PCO plan items for matching item with non-empty content in the configured field (description/notes).
- **None items** (track-only): Default to "unknown" — agent checks thread history.

Pass structured `ItemStatus[]` to the nag prompt so the AI just formats the message.

### Change 2: Two-phase nag (`actions.ts`)
**Phase 1 — Catchup sync**: Before reporting status, read thread + PCO state. If thread mentions info not reflected in PCO (from failed previous syncs), sync it now. Uses full PCO tools, NO Slack reply tools.

**Phase 2 — Status report**: Re-fetch PCO context (now updated), pre-compute statuses, generate nag message. Uses only `reply_in_thread` + `add_reaction`.

### Change 3: Manual trigger (`actions.ts`)
Add `triggerNag` internalAction that skips schedule/dedup checks. Can be called via `npx convex run` to send a nag on demand.

### Change 4: PcoContext enhancement (`pcoSync.ts`)
Add `platformRolesAll` field that includes both "C" and "U" status members (not just "C"), excluding "Needed" placeholders.

## Files Modified
1. `pcoSync.ts` — Add `platformRolesAll` to PcoContext, update both fetch functions
2. `prompts.ts` — Add `computeItemStatuses`, `buildCatchupSyncPrompt`, rewrite `buildNagPrompt`
3. `actions.ts` — Extract `nagThread` helper, rewrite `checkAndNag`, add `triggerNag`
4. `index.ts` — Export `triggerNag`
