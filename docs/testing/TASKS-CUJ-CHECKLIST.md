# Tasks - Critical User Journeys (CUJ) Checklist

Use this checklist to validate the end-to-end Tasks experience across mobile-first UX, responsive web behavior, and backend source integrations.

---

## Prerequisites

- [ ] App is running (`pnpm dev`)
- [ ] Convex backend is running
- [ ] Logged in with seeded credentials (ex: phone `2025550123`, code `000000`)
- [ ] User is in a community with at least one group where they are a leader
- [ ] Task Reminder bot configured with at least one role + schedule (for bot source testing)

---

## CUJ 1: Leader Access & Tab Visibility

### 1.1 Leader sees Tasks tab

- [ ] Login as leader/admin
- [ ] Verify top-level `Tasks` tab exists
- [ ] Verify `Tasks` appears immediately to the left of `Inbox`

### 1.2 Non-leader does not see Tasks tab

- [ ] Login as non-leader member
- [ ] Verify `Tasks` tab is hidden
- [ ] Verify no deep link access to leader task actions (mutation-level permission rejection)

---

## CUJ 2: Navigation & Layout

### 2.1 Tasks tab opens global task home

- [ ] Tap/click `Tasks`
- [ ] Route resolves to `/tasks`
- [ ] Header renders: `Tasks` + subtitle

### 2.2 Segment switching

- [ ] Switch `My Tasks` -> `Claimable` -> `My Tasks`
- [ ] Empty states/messages update correctly
- [ ] No stale selection or duplicate rows on fast toggles

### 2.3 Responsive behavior

- [ ] Mobile viewport: bottom tabs visible, Tasks left of Inbox
- [ ] Desktop viewport: side nav includes Tasks and page remains usable
- [ ] No layout overlap with sticky/bottom nav areas

---

## CUJ 3: Global Leader Work Queue (Cross-Group)

### 3.1 My Tasks aggregates assignments across groups

- [ ] Assign tasks to current leader in multiple groups
- [ ] Verify all appear in `My Tasks`
- [ ] Verify each item shows source + group context

### 3.2 Claimable shows unassigned group tasks

- [ ] Create/unassign group-responsibility tasks
- [ ] Verify they appear in `Claimable`
- [ ] Verify assigned tasks are not shown in `Claimable`

---

## CUJ 4: Manual Task Lifecycle

### 4.1 Create manual task (leader)

- [ ] Create task with title only
- [ ] Create task with description, tags, and target context
- [ ] Verify validation for required fields

### 4.2 Assignment flows

- [ ] Assign unassigned task to self
- [ ] Assign task to another leader
- [ ] Unassign to return to group responsibility
- [ ] Verify non-leader assignee is rejected

### 4.3 Claim flow

- [ ] Claim an unassigned group task from `Claimable`
- [ ] Verify task disappears from `Claimable`
- [ ] Verify task appears in `My Tasks`

### 4.4 Quick actions

- [ ] Mark done from list row
- [ ] Snooze 1 week from list row
- [ ] Cancel from list row
- [ ] Verify status transitions and list updates in-place

---

## CUJ 5: Task Reminder Bot -> Task Source Flow

### 5.1 Scheduled reminder generates tasks

- [ ] Configure reminder bot roles/schedule
- [ ] Trigger scheduled window or test function path
- [ ] Verify tasks are generated with source `bot_task_reminder`

### 5.2 Idempotency

- [ ] Re-run same schedule/source event
- [ ] Verify no duplicate tasks for identical source key

### 5.3 Bot message + task dual behavior

- [ ] Verify task created regardless of delivery mode
- [ ] If chat mode enabled, verify message still posts as expected
- [ ] Verify no regression in birthday/other bot scheduling behavior

---

## CUJ 6: Hierarchy (Parent + Subtasks)

### 6.1 Parent task with children

- [ ] Create parent task + multiple subtasks
- [ ] Verify compact render with expand/collapse behavior

### 6.2 Child action behavior

- [ ] Complete/snooze/cancel subtask
- [ ] Verify parent state remains consistent with expected rules

### 6.3 Ordering behavior

- [ ] Reorder tasks where applicable
- [ ] Verify stable order after refresh/reconnect

---

## CUJ 7: Tags & Searchability

### 7.1 Tag normalization

- [ ] Add tags with spaces/casing
- [ ] Verify normalized storage (slug-like behavior)

### 7.2 Filtering by tags

- [ ] Filter tasks by tag(s)
- [ ] Verify result set is correct and performant

### 7.3 Source + tag combinations

- [ ] Filter by tag + source (ex: `bot_task_reminder` + `prayer_request`)
- [ ] Verify no cross-filter leakage

---

## CUJ 8: Target Context (Member/Group)

### 8.1 Member target

- [ ] Create task with target member
- [ ] Verify member context pill/metadata appears

### 8.2 Group target

- [ ] Create task with target group
- [ ] Verify group context pill/metadata appears

### 8.3 Cardinality rules

- [ ] Verify exactly one primary target allowed (`none|member|group`)
- [ ] Verify invalid combinations are rejected

---

## CUJ 9: Permissions & Authorization

### 9.1 Leader-only task mutations

- [ ] As member, attempt create/assign/claim/done/snooze/cancel via API
- [ ] Verify all are rejected with clear authorization errors

### 9.2 Group bot config permission enforcement

- [ ] Verify non-leader cannot toggle/update/reset bot config
- [ ] Verify leader can perform these actions

### 9.3 Cross-group isolation

- [ ] Leader of Group A cannot mutate tasks in Group B (without role)
- [ ] Verify list queries only return authorized group scope

---

## CUJ 10: Realtime & Multi-Client Consistency

### 10.1 Realtime updates

- [ ] Open same task list on two clients
- [ ] Perform action on client A
- [ ] Verify client B updates without manual refresh

### 10.2 Race/conflict handling

- [ ] Two leaders claim same task nearly simultaneously
- [ ] Verify one authoritative result and no corrupted task state

### 10.3 Offline/reconnect behavior

- [ ] Perform action with temporary network interruption
- [ ] Verify eventual consistency after reconnect

---

## CUJ 11: Performance & UX Reliability

### 11.1 List rendering at scale

- [ ] Seed 100+ tasks for leader
- [ ] Verify scrolling performance and interaction latency

### 11.2 Action responsiveness

- [ ] Execute rapid quick actions on multiple tasks
- [ ] Verify loading/disabled affordances prevent duplicate submits

### 11.3 Empty/loading/error states

- [ ] Verify clean states for no tasks, loading tasks, and failed fetches

---

## CUJ 12: Migration & Backward Compatibility

### 12.1 Data safety

- [ ] No destructive migration of legacy records without explicit cutoff
- [ ] Source refs retained for traceability/debug

---

## CUJ 13: Regression Matrix

- [ ] Birthday bot tests still pass
- [ ] Existing inbox/channel navigation unaffected
- [ ] Leader toolbar still renders all existing tools
- [ ] Routing conflict checks still pass
- [ ] No new auth regressions for non-task features

---

## Recommended Test Passes

### Pass A: Smoke (10-15 min)

- CUJ 1, 2, 3.3, 3.4, 4.1

### Pass B: Integration (30-45 min)

- CUJ 2, 5, 9, 10

### Pass C: Release Candidate (60+ min)

- Full checklist including hierarchy, tag filtering, performance, and migration checks

---

## Test Results Summary

| Area                    | Status | Notes |
| ----------------------- | ------ | ----- |
| Leader Visibility       |        |       |
| Navigation/Responsive   |        |       |
| Manual Lifecycle        |        |       |
| Bot Source              |        |       |
| Permissions/Auth        |        |       |
| Realtime                |        |       |
| Migration/Compatibility |        |       |
| Regressions             |        |       |

---

## Sign-off

- Tester: **\*\***\_**\*\***
- Date: **\*\***\_**\*\***
- Build/Branch: **\*\***\_**\*\***
- Environment: **\*\***\_**\*\***
