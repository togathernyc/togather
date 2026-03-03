# Run Sheet Feature Implementation Checklist

> **For Orchestrator Agents:** This is your source of truth. Check items off as you complete them.
> If you're a new agent picking this up, start from the first unchecked item.

## Status Legend
- `[ ]` = Not started
- `[~]` = In progress
- `[x]` = Complete
- `[!]` = Blocked/Issue

---

## Pre-Implementation Setup

- [x] Read the full plan at `~/.claude/plans/sharded-forging-squirrel.md`
- [x] Ensure `pnpm dev` is running (Convex + Expo)
- [x] Verify you can access the app in Playwright (web)

---

## Phase 1: Schema & Backend Foundation

### 1.1 Extend runSheetConfig schema
- [x] **TEST:** Write test for `chipConfig` field validation in schema
- [x] **IMPL:** Add `chipConfig` to `runSheetConfig` in `apps/convex/schema.ts`
- [x] **VERIFY:** Run `npx convex dev` - schema deploys without errors

### 1.2 Update mutation
- [x] **TEST:** Write test for `updateRunSheetConfig` accepting `chipConfig`
- [x] **IMPL:** Update `updateRunSheetConfig` in `apps/convex/functions/groups/mutations.ts`
- [x] **VERIFY:** Test passes

### 1.3 Add attachment support to PCO API
- [x] **TEST:** Write test for `fetchPlanItems` including attachments
- [x] **IMPL:** Add `PcoAttachment` interface to `apps/convex/lib/pcoServicesApi.ts`
- [x] **IMPL:** Update `fetchPlanItems` include parameter to add `attachments`
- [x] **IMPL:** Process attachments in response
- [x] **VERIFY:** Test passes

### 1.4 Update RunSheetItem interface
- [x] **IMPL:** Add `attachments` field to `RunSheetItem` in `apps/convex/functions/pcoServices/runSheet.ts`
- [x] **VERIFY:** TypeScript compiles without errors

---

## Phase 2: Settings Reorganization

### 2.1 Reorder sections in toolbar-settings
- [x] **IMPL:** Move "Toolbar Tools" section above "Toolbar Visibility" in `apps/mobile/app/(user)/leader-tools/[group_id]/toolbar-settings.tsx`
- [x] **VERIFY (Playwright):** Open toolbar settings, verify Toolbar Tools appears before Toolbar Visibility

### 2.2 Add gear icons to Toolbar Tools
- [x] **IMPL:** Add gear icon (Settings icon) next to each tool in Toolbar Tools section
- [x] **IMPL:** Gear icon navigates to `/leader-tools/${group_id}/tool-settings/${toolId}`
- [x] **VERIFY (Playwright):** Tap gear icon, verify navigation works

### 2.3 Create tool-settings route
- [x] **IMPL:** Create `apps/mobile/app/(user)/leader-tools/[group_id]/tool-settings/[tool_id].tsx`
- [x] **IMPL:** Route to appropriate settings component based on `tool_id`
- [x] **VERIFY (Playwright):** Navigate to runsheet tool settings, see Run Sheet settings UI

### 2.4 Remove Run Sheet Settings from toolbar-settings
- [x] **IMPL:** Remove the "Run Sheet Settings" section from `toolbar-settings.tsx` (moved to tool-specific)
- [x] **VERIFY:** No duplicate settings sections

---

## Phase 3: Run Sheet Tool Settings Screen

### 3.1 Create RunSheetToolSettings component
- [x] **IMPL:** Create `apps/mobile/features/leader-tools/components/RunSheetToolSettings.tsx`
- [x] **IMPL:** Move service type selection from toolbar-settings to here
- [x] **VERIFY (Playwright):** Service type checkboxes appear and work

### 3.2 Create ChipConfigEditor component
- [x] **IMPL:** Create `apps/mobile/features/leader-tools/components/ChipConfigEditor.tsx`
- [x] **IMPL:** Display list of available categories from PCO
- [x] **IMPL:** Add visibility toggle (Switch) for each category
- [x] **IMPL:** Add up/down arrow buttons for reordering
- [x] **VERIFY (Playwright):** Can toggle visibility and reorder chips

### 3.3 Wire up chip config persistence
- [x] **IMPL:** Connect ChipConfigEditor to `updateRunSheetConfig` mutation
- [x] **IMPL:** Load existing config on mount
- [ ] **VERIFY (Playwright):** Change config, reload, config persists

---

## Phase 4: Auto PCO Channel Sync on Group Join

### 4.1 Create checkAndSyncUserToAutoChannels action
- [x] **TEST:** Write test for new user being auto-added to PCO sync channel
- [x] **IMPL:** Add `checkAndSyncUserToAutoChannels` internal action in `apps/convex/functions/pcoServices/rotation.ts`
- [x] **IMPL:** Add `getAutoChannelConfigsForGroup` internal query
- [x] **VERIFY:** Test passes

### 4.2 Trigger from group membership
- [x] **IMPL:** In `apps/convex/functions/groupMembers.ts`, after `syncUserChannelMembershipsLogic()`, schedule the new action
- [x] **IMPL:** In `apps/convex/functions/groups/mutations.ts` (join mutation), schedule the new action
- [ ] **VERIFY:** Add member to group, verify they appear in PCO sync channel

---

## Phase 5: Update RunSheetScreen UI

### 5.1 Chip configuration in UI
- [x] **IMPL:** Update `availableRoles` useMemo in `apps/mobile/features/leader-tools/components/RunSheetScreen.tsx`
- [x] **IMPL:** Filter out categories in `chipConfig.hidden`
- [x] **IMPL:** Sort by `chipConfig.order`
- [ ] **VERIFY (Playwright):** Hidden chips don't appear, order matches config

### 5.2 Collapsible headers
- [x] **IMPL:** Add `collapsedHeaders` state (Set<string>)
- [x] **IMPL:** Make section headers pressable with chevron icons
- [x] **IMPL:** Filter items to hide children of collapsed headers
- [x] **IMPL:** Persist collapsed state to AsyncStorage
- [ ] **VERIFY (Playwright):** Tap header, items collapse; reload app, state persists

### 5.3 Attachments in expanded items
- [x] **IMPL:** Check if item has attachments in expanded content section
- [x] **IMPL:** Show "View Document" button for PDFs/Google Docs
- [x] **IMPL:** Use `Linking.openURL()` to open attachment
- [ ] **VERIFY (Playwright):** Expand item with attachment, tap button, opens external link

---

## Phase 6: Review Cycle & Deployment

### 6.1 Create PR
- [x] Create feature branch
- [x] Commit all changes
- [x] Push to remote
- [x] Create PR to main (https://github.com/togathernyc/togather/pull/344)

### 6.2 CI & Review
- [ ] All CI checks pass
- [ ] Run `/review-cycle` to handle bot reviews
- [ ] All conversations resolved

### 6.3 Staging Verification
- [ ] Merge to staging
- [ ] Verify on staging environment
- [ ] Test all features manually

### 6.4 Production Deployment
- [ ] Promote staging to production (GitHub action)
- [ ] Verify on production
- [ ] Mark feature complete

---

## Files Modified (Reference)

| File | Status |
|------|--------|
| `apps/convex/schema.ts` | [x] |
| `apps/convex/functions/groups/mutations.ts` | [x] |
| `apps/convex/lib/pcoServicesApi.ts` | [x] |
| `apps/convex/functions/pcoServices/runSheet.ts` | [x] |
| `apps/convex/functions/pcoServices/rotation.ts` | [x] |
| `apps/convex/functions/groupMembers.ts` | [x] |
| `apps/mobile/app/(user)/leader-tools/[group_id]/toolbar-settings.tsx` | [x] |
| `apps/mobile/app/(user)/leader-tools/[group_id]/tool-settings/[tool_id].tsx` | [x] NEW |
| `apps/mobile/features/leader-tools/components/RunSheetToolSettings.tsx` | [x] NEW |
| `apps/mobile/features/leader-tools/components/ChipConfigEditor.tsx` | [x] NEW |
| `apps/mobile/features/leader-tools/components/RunSheetScreen.tsx` | [x] |

---

## Notes & Issues

_Add any blockers, discoveries, or notes here as you work:_

```
<!-- Example:
2026-02-03: Found that PCO API doesn't include attachments by default, need to add include param
2026-02-03: AsyncStorage key format: runsheet_collapsed_${groupId}
-->
```

---

## Quick Commands

```bash
# Start dev
pnpm dev

# Run Convex only
pnpm dev --convex

# Run tests
npx convex test

# Check Convex logs
pnpm convex:logs

# Test credentials
# Phone: 2025550123
# Code: 000000
# Community: "Demo Community"
```
