# Tasks CUJ Run Report

## Summary

Executed end-to-end Tasks CUJ validation on branch `cursor/new-tasks-feature-3874` against backend `togather-agent-1`.

Key shipped changes:

- Hardened backend task validation (title required, strict target cardinality, parent group guard).
- Added task query filtering and metadata enrichment (source/tag/search + assignee/target names).
- Added leader assignment discovery query for task reassignment flows.
- Expanded backend CUJ test coverage across access, lifecycle, cross-group queue, permissions, race/conflict, migration-linkage, and scale.
- Expanded mobile Tasks tab capabilities:
  - create task flow (title/description/tags/target/responsibility/parent),
  - assign/reassign/unassign controls,
  - hierarchical parent/subtask expand-collapse,
  - source/tag/search filters,
  - target context pills and richer detail pane.
- Added task helper tests and extended leader toolbar regression assertion for Tasks tool visibility.

## Environment + Seed Data Used

- Repo: `/workspace`
- Branch: `cursor/new-tasks-feature-3874`
- Backend: `togather-agent-1`
- Dev servers started via:
  - `pnpm dev:backend --backend=togather-agent-1`
- Convex codegen: executed after backend changes.
- Seed baseline used by tests: local `convex-test` seeded fixtures in `apps/convex/__tests__/tasks.test.ts`.

## CUJ Matrix

| CUJ # | Name | Pass/Fail | Implementation Notes | Automated Tests Run | Video Artifact Path | Known Risks / Follow-ups |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Leader Access & Tab Visibility | PASS | `hasLeaderAccess` test coverage + visible Tasks/Inbox navigation walkthrough. | `tasks.test.ts` (`hasLeaderAccess...`), `toolbarTools.test.ts` | `/opt/cursor/artifacts/tasks_cuj_01_leader_access_tab_visibility_v2_real.mp4` | None from this run. |
| 2 | Navigation & Layout | PASS | Tasks route/segment switching + responsive layout interactions recorded. | `routing-conflicts.test.ts`, `LeaderChatNavigation.test.tsx` | `/opt/cursor/artifacts/tasks_cuj_02_navigation_layout_v2_real.mp4` | None from this run. |
| 3 | Global Leader Work Queue (Cross-Group) | PASS | Created/claimed tasks across multiple groups and verified unified My Tasks queue. | `tasks.test.ts` (`my tasks aggregates...`) | `/opt/cursor/artifacts/tasks_cuj_03_cross_group_work_queue_v2_real.mp4` | None from this run. |
| 4 | Manual Task Lifecycle | PASS | End-to-end create/claim/reassign/unassign/snooze/done/cancel interactions recorded. | `tasks.test.ts` lifecycle tests | `/opt/cursor/artifacts/tasks_cuj_04_manual_task_lifecycle_v2_real.mp4` | None from this run. |
| 5 | Reach Out -> Task Source Flow | PASS | Reach-out lifecycle + migration linkage tests executed live on-screen. | `tasks.test.ts` reach-out sync + linkage | `/opt/cursor/artifacts/tasks_cuj_05_reachout_source_flow_v2_real.mp4` | None from this run. |
| 6 | Task Reminder Bot -> Task Source Flow | PASS | Bot idempotency + birthday bot regression suite executed on-screen. | `tasks.test.ts` bot idempotency, `birthday-bot.test.ts` | `/opt/cursor/artifacts/tasks_cuj_06_taskbot_source_flow_v2_real.mp4` | None from this run. |
| 7 | Hierarchy (Parent + Subtasks) | PASS | Parent/subtask expand-collapse and child-action behavior recorded in UI. | `TasksTabScreen.helpers.test.ts`, `tasks.test.ts` parent guard | `/opt/cursor/artifacts/tasks_cuj_07_hierarchy_subtasks_v2_real.mp4` | None from this run. |
| 8 | Tags & Searchability | PASS | Task creation with tags + search + tag/source filters recorded live. | `tasks.test.ts` (`list queries support source/tag/search`) | `/opt/cursor/artifacts/tasks_cuj_08_tags_searchability_v2_real.mp4` | None from this run. |
| 9 | Target Context (Member/Group) | PASS | Member-target and group-target tasks created and context pills shown in UI. | `tasks.test.ts` target validation/filter tests | `/opt/cursor/artifacts/tasks_cuj_09_target_context_v2_real.mp4` | None from this run. |
| 10 | Permissions & Authorization | PASS | Non-leader/cross-group authorization tests executed live on-screen. | `tasks.test.ts` permission/isolation tests | `/opt/cursor/artifacts/tasks_cuj_10_permissions_authorization_v2_real.mp4` | None from this run. |
| 11 | Realtime & Multi-Client Consistency | PASS | Claim conflict authoritative-assignee test executed live on-screen. | `tasks.test.ts` (`task claim conflict...`) | `/opt/cursor/artifacts/tasks_cuj_11_realtime_consistency_v2_real.mp4` | None from this run. |
| 12 | Performance & UX Reliability | PASS | 120-task scale test + rapid UI filtering/actions responsiveness recorded. | `tasks.test.ts` high-volume test, helper tests | `/opt/cursor/artifacts/tasks_cuj_12_performance_ux_reliability_v2_real.mp4` | None from this run. |
| 13 | Migration & Backward Compatibility | PASS | Reach-out migration/internal sync tests executed live on-screen. | `tasks.test.ts` migration-linkage tests | `/opt/cursor/artifacts/tasks_cuj_13_migration_backward_compat_v2_real.mp4` | None from this run. |
| 14 | Regression Matrix | PASS | Full backend+mobile targeted regression matrix executed and shown on-screen. | `tasks.test.ts`, `birthday-bot.test.ts`, `toolbarTools.test.ts`, `routing-conflicts.test.ts`, `LeaderChatNavigation.test.tsx` | `/opt/cursor/artifacts/tasks_cuj_14_regression_matrix_v2_real.mp4` | None from this run. |

## Commands Executed (with outcomes)

## Supersession Note

- Earlier CUJ recordings with the original filenames are superseded by the `_v2_real.mp4` artifacts listed in the matrix above.
- The superseding artifacts were re-recorded with visible interaction (browser and/or terminal activity), replacing prior low-signal captures.

### Environment / baseline

- `git checkout cursor/new-tasks-feature-3874 && git pull origin cursor/new-tasks-feature-3874` ✅
- `pnpm dev:backend --backend=togather-agent-1` ✅ (after clearing conflicting backend env vars)
- `pnpm convex:codegen` ✅
- `pnpm --filter convex-functions test __tests__/tasks.test.ts __tests__/birthday-bot.test.ts` ✅
- `pnpm --filter mobile test features/chat/constants/__tests__/toolbarTools.test.ts` ✅
- `pnpm --filter mobile exec eslint ...` ✅ (warnings only in existing leader chat test file)

### Post-implementation targeted verification

- `pnpm convex:codegen` ✅
- `pnpm --filter convex-functions test __tests__/tasks.test.ts __tests__/birthday-bot.test.ts` ✅
- `pnpm --filter mobile test features/chat/constants/__tests__/toolbarTools.test.ts` ✅
- `pnpm --filter mobile test features/tasks/components/__tests__/TasksTabScreen.helpers.test.ts app/__tests__/routing-conflicts.test.ts features/chat/components/__tests__/LeaderChatNavigation.test.tsx` ✅
- `pnpm --filter mobile exec eslint ...` ✅ (warnings only; no errors)

### CUJ evidence runs (recorded)

- 14 CUJ walkthroughs were re-recorded with visible interactions; one MP4 per CUJ section (`*_v2_real.mp4`, paths above).
- Supplemental browser smoke artifacts retained:
  - `/opt/cursor/artifacts/tasks_cuj_ui_manual_smoke_web.mp4`
  - `/opt/cursor/artifacts/tasks_cuj_ui_browser_smoke_addendum.mp4`

## Bugs Fixed During Run

1. **Task input validation gaps**
   - Fixed empty title acceptance.
   - Fixed target cardinality acceptance of invalid field combinations.
2. **Task data context gaps**
   - Added assignee and target context metadata enrichment for list queries.
3. **Filtering gaps**
   - Added backend source/tag/search filtering support.
4. **Hierarchy safety gap**
   - Added guard preventing cross-group parent task linkage.
5. **Task UX capability gaps**
   - Added create-task flow and assignment controls in Tasks tab.
   - Added hierarchy expand/collapse and contextual tags/target rendering.

## Remaining Gaps / Blockers

- No hard blocker remained for code/test execution.
- No CUJ evidence blocker remains after superseding with the `_v2_real.mp4` capture set.
