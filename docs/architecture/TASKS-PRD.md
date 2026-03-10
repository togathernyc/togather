# Tasks Feature PRD (Leaders)

**Date:** 2026-03-10  
**Status:** Proposed (discussion draft)  
**Owner:** Product + Mobile + Convex

## 1) Problem Statement

Leaders currently manage actionable work across multiple disconnected surfaces:

- Task Reminder Bot creates chat/notification reminders, not first-class tasks.
- Reach Out creates request cards in chat plus separate workflow state.
- Follow-up tracks member actions, but is optimized for score/history, not unified task management.

This creates duplication in data models, UI patterns, and automation logic. We need one native **Tasks** system that becomes the canonical model for leader action items.

## 2) Product Goals

1. Create a first-class `Task` object that can represent reminders, outreach requests, and manual leader work.
2. Keep Tasks **leader-only** for management views and actions.
3. Support both:
   - **group-level responsibility** (unassigned/shared ownership), and
   - **person-level responsibility** (assigned to a specific leader).
4. Provide a dedicated leader task page with quick actions:
   - mark done,
   - snooze (preset intervals, default 1 week),
   - cancel.
5. Support hierarchical tasks (parent + sub-tasks) with compact UI.
6. Support indexable tags (e.g., `prayer_request`, `praise_report`).
7. Support contextual links to a target member or target group.
8. Remove redundant systems over time (`task reminder` reminder-as-message flow and `reach out` request workflow).

## 3) Non-Goals (V1)

- Full Kanban/board UI.
- Arbitrary recurrence rules beyond existing reminder schedule migration.
- End-user/member task inbox.
- Replacing follow-up score computation in V1.

## 4) Users & Primary Jobs

- **Leader/Admin:** review, claim/assign, complete, snooze, and cancel tasks.
- **Member (limited input only):** submit outreach/help request that becomes an unassigned leader task.

## 5) Functional Requirements

### 5.1 Task Sources

1. **Manual leader-created task** (from Task page).
2. **Task Reminder Bot generated task** (instead of plain reminder message).
3. **Reach Out submission generated task** (unassigned, routed to leaders).

### 5.2 Task Core Fields

Each task must support:

- `groupId`
- `title` and optional `description`
- `status`: `open | snoozed | done | canceled`
- `responsibilityType`: `group | person`
- `assignedToId` (nullable; required when `person`)
- `createdById`
- `sourceType`: `manual | bot_task_reminder | reach_out | followup`
- `sourceRef` (idempotency / source linkage)
- `targetType`: `none | member | group`
- `targetMemberId` / `targetGroupId` (as applicable)
- `tagIds` or normalized `tags[]`
- `parentTaskId` (nullable for hierarchy)
- ordering fields (see section 6.4)
- `dueAt` (optional)
- `snoozedUntil` (optional)
- `completedAt`, `canceledAt` (optional)
- audit timestamps (`createdAt`, `updatedAt`)

### 5.3 Leader Task Views

Dedicated leader-only Task page:

- **My Tasks**: `responsibilityType=person && assignedToId=currentUser`.
- **Group Tasks**: all leader-visible tasks in group, including unassigned.
- Filters: status, tag, source type, assignee, target type.
- Sorts: default by active status then manual/order field then recency.

### 5.4 Quick Actions

From list/detail/card:

- Mark Done
- Snooze (1 week preset in V1; architecture supports more presets later)
- Cancel
- Assign/Reassign (leaders only)
- Claim (for unassigned group-level tasks)

### 5.5 Hierarchy + Compact Rendering

- Parent task can have child sub-tasks.
- UI renders parent row compactly with expand/collapse children.
- Parent completion rules (V1): parent can be completed independently; optional “auto-complete parent when all children done” is disabled by default.

### 5.6 Tags

- Tags are indexed and queryable.
- V1 allows controlled free-form entry (normalized slug + display label).
- Suggested defaults include: `prayer_request`, `praise_report`, `care`, `attendance_followup`.

### 5.7 Context Linking

Tasks may link to:

- target member (show profile/contact context),
- target group (show group context).

### 5.8 Chat Integration

Task reminder configuration can optionally post a **rendered task card** message to chat when a task is created.

- New chat message type in V1 should reference `taskId`.
- Mention behavior/notifications remain configurable by delivery settings.

## 6) Technical Design (Proposed)

### 6.1 New Tables

1. `tasks`
2. `taskEvents` (audit/history timeline; action log for assignment, snooze, done, cancel, comment)
3. Optional `taskTags` (if we choose normalized dictionary instead of plain tags array)

### 6.2 Indices (minimum)

- `by_group`
- `by_group_status`
- `by_group_assignee_status`
- `by_parent`
- `by_group_sourceType`
- `by_target_member`
- `by_target_group`
- `by_group_tag` (if tag normalization table is used)

### 6.3 API Surface (Convex)

Queries:

- `tasks.listMine`
- `tasks.listGroup`
- `tasks.getById`
- `tasks.listChildren`

Mutations:

- `tasks.create`
- `tasks.assign`
- `tasks.claim`
- `tasks.markDone`
- `tasks.snooze`
- `tasks.cancel`
- `tasks.update`
- `tasks.reorder`
- `tasks.addTag` / `tasks.removeTag`

Internal actions/mutations:

- `scheduledJobs.createTasksFromReminderConfig` (idempotent daily generation)
- bridge action for reach out submission -> task creation

### 6.4 Ordering Model

Need stable ordering that supports optional “linked list” behavior:

- V1 recommendation: `orderKey` numeric rank + optional `parentTaskId`.
- Keep `prevTaskId/nextTaskId` out of V1 unless strict adjacency semantics are required.

This simplifies concurrent edits and avoids linked-list corruption under high write frequency.

### 6.5 Authorization

All task management operations are leader/admin only, scoped by active group membership.

Required helper pattern:

- `requireLeaderMembership(ctx, token, groupId)` used consistently by task mutations and queries.

Important existing gap to close during migration:

- `groupBots.updateConfig`, `groupBots.toggle`, and `groupBots.resetConfig` currently authenticate but do not enforce leader role; this should be corrected in the same migration wave as Tasks.

## 7) UX / Navigation (Proposed)

### 7.1 Placement

- Add `tasks` tool to leader toolbar (`attendance/followup/events/bots/...` set).
- Route proposal: `/leader-tools/[group_id]/tasks`

### 7.2 Page Structure

- Header metrics: open, snoozed, overdue (if due dates used), unassigned.
- Tabs/segments:
  - My Tasks
  - Group Tasks
- Collapsible parent rows for sub-task stacks.
- Inline quick actions (done/snooze/cancel/assign).

### 7.3 Reach Out Member Experience

- Member “Reach Out” entry remains as UX entry point in V1, but backend writes a task instead of `reachOutRequests`.
- Optional member-visible status text can be retained later, but leader workflow source of truth is task state.

## 8) Migration & Redundancy Removal Plan

### Phase 0 - Introduce Tasks in Parallel

- Add new schema + APIs + leader task page.
- No destructive changes yet.

### Phase 1 - Task Reminder Bot Migration

- Reminder cron creates/upserts tasks (idempotent per template/day/assignee scope).
- Optional chat card posting references `taskId`.
- Deprecate reminder-as-plain-message behavior.

### Phase 2 - Reach Out Migration

- Reach Out submission creates unassigned group-level task with source `reach_out`.
- Leader actions move from `reachOutRequests` status transitions to task mutations.
- Existing `ReachOutRequestCard` UI replaced by task card rendering where relevant.

### Phase 3 - Follow-up Integration (Not full replacement in V1)

- Keep follow-up scoring system intact.
- Add lightweight bridging: task events can optionally create follow-up log entries for member-targeted tasks.
- Reassess full follow-up/task convergence after V1 stabilization.

### Phase 4 - Decommission Legacy Paths

After backfill and confidence window:

- Remove `reachOutRequests` table and related API/UI.
- Remove `chatMessages.reachOutRequestId` usage and `reach_out_request` content rendering.
- Remove reach-out channel toggle/dependency logic from channel management.
- Simplify task-reminder bot config model to task templates + delivery options.

## 9) Data Migration Requirements

1. Backfill open `reachOutRequests` into `tasks` with source linkage.
2. Preserve auditability by converting historical status transitions into `taskEvents` where feasible.
3. Keep old IDs in `sourceRef` for rollback/debug.
4. Run dual-write/dual-read only for limited migration window with explicit cutoff date.

## 10) Notifications & Scheduling

- Existing cron cadence remains; task reminder cron now generates tasks first.
- Notification sends should use task-derived payloads (`taskId`, title, group, target context).
- Snooze updates should re-surface tasks when `snoozedUntil <= now`.

## 11) Success Metrics

1. % of leader actionable items represented as `tasks` (target: >90% after migration).
2. Reduction in duplicate leader workflows (reach out + reminder + follow-up overlaps).
3. Task completion and response latency for reach-out-origin tasks.
4. Fewer leader clicks from intake to assignment/resolution.

## 12) Risks

- Migration complexity and temporary dual-path logic.
- Permission regressions if leader checks are inconsistent.
- UX churn for leaders used to reach-out cards and follow-up flows.
- Ordering/hierarchy edge cases (especially if strict linked list is required).

## 13) Open Questions (Need Product Decision)

1. **Follow-up boundary:** Do we want Tasks to fully replace follow-up action logging long-term, or keep follow-up as a scoring/history subsystem?
2. **Group-level completion semantics:** Can any leader complete a group-level task, or only assignee/creator once claimed?
3. **Tag governance:** free-form tags only, or curated per-community dictionary with admin controls?
4. **Ordering strictness:** Is numeric ranking sufficient, or do we need explicit linked-list adjacency guarantees in V1?
5. **Member visibility:** Should members see status updates for reach-out-origin tasks after submission?
6. **Snooze presets:** confirm V1 presets (1 week only vs 1 day/3 days/1 week/custom).
7. **Target context cardinality:** can a task target both member and group simultaneously, or exactly one target type?

## 14) Proposed V1 Scope Lock

Ship V1 with:

- leader-only task page,
- manual + task-reminder + reach-out task creation,
- assignment/claim,
- done/snooze/cancel,
- parent/child tasks,
- indexed tags,
- member/group target context,
- optional chat task card,
- migration of reminder + reach-out workflows.

Defer:

- full follow-up replacement,
- advanced recurrence,
- strict linked-list adjacency model,
- member-facing task inbox.
