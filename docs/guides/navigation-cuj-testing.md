# Navigation CUJ Testing Guide

This guide documents Critical User Journeys (CUJs) for navigation testing in the Togather mobile app. These flows can be tested manually or automated using Playwright.

## Test Credentials

Use the test credentials from the seed script. See `CLAUDE.md` for details.

## CUJ 1: Chat Room Navigation

### 1.1 Chat Room → Members → Back
**Steps:**
1. Navigate to Inbox tab (`/(tabs)/chat`)
2. Tap on a group chat to open the chat room (`/inbox/{channel_id}`)
3. Tap the 3-dots menu icon in the header
4. Tap "Members"
5. Verify: Navigated to Members page (`/leader-tools/{group_id}/members`)
6. Tap the back button
7. **Expected**: Returns to the chat room (`/inbox/{channel_id}`)
8. **Previously broken**: Was navigating to Leader Tools hub instead

### 1.2 Chat Room → Events → Back
**Steps:**
1. From chat room, tap 3-dots menu
2. Tap "Events"
3. Verify: Navigated to Events page (`/leader-tools/{group_id}/events`)
4. Tap the back button
5. **Expected**: Returns to the chat room

### 1.3 Chat Room → Attendance → Back
**Steps:**
1. From chat room, tap 3-dots menu (as leader)
2. Tap "Attendance"
3. Verify: Navigated to Attendance page (`/leader-tools/{group_id}/attendance`)
4. Tap the back button
5. **Expected**: Returns to the chat room

### 1.4 Chat Room → Group Page → Back
**Steps:**
1. From chat room, tap 3-dots menu (as leader)
2. Tap "Group Page"
3. Verify: Navigated to Group Detail page (`/groups/{group_id}`)
4. Tap the back button
5. **Expected**: Returns to the chat room

## CUJ 2: Leader Tools Hub Navigation

### 2.1 Leader Tools → Group Chat
**Steps:**
1. Navigate to Leader Tools hub (`/leader-tools/{group_id}`)
2. Tap "Group Chat" button at bottom
3. **Expected**: Navigates directly to chat room (`/inbox/{channel_id}`)
4. **Previously broken**: Was navigating to inbox list (`/(tabs)/chat`)

### 2.2 Leader Tools → Members
**Steps:**
1. From Leader Tools hub, tap "Members" menu item
2. Verify: Navigated to Members page
3. Tap back button
4. **Expected**: Returns to Leader Tools hub (correct behavior since we came from hub)

### 2.3 Leader Tools → Events
**Steps:**
1. From Leader Tools hub, tap "Events" menu item
2. Verify: Navigated to Events page
3. Tap back button
4. **Expected**: Returns to Leader Tools hub

### 2.4 Leader Tools → Attendance
**Steps:**
1. From Leader Tools hub, tap "Attendance" button at bottom
2. Verify: Navigated to Attendance page
3. Tap back button
4. **Expected**: Returns to Leader Tools hub

## CUJ 3: Deep Link / Direct URL Navigation

### 3.1 Direct to Members Page
**Steps:**
1. Navigate directly to `/leader-tools/{group_id}/members`
2. Tap back button
3. **Expected**: Falls back to Leader Tools hub (no history stack)

### 3.2 Direct to Events Page
**Steps:**
1. Navigate directly to `/leader-tools/{group_id}/events`
2. Tap back button
3. **Expected**: Falls back to Leader Tools hub

## Playwright Test Example

```typescript
import { test, expect } from '@playwright/test';

test.describe('Chat Navigation CUJs', () => {
  test.beforeEach(async ({ page }) => {
    // Login flow
    await page.goto('http://localhost:8081');
    await page.waitForTimeout(3000);

    // If on signin page, login
    if (page.url().includes('signin')) {
      await page.getByText('Sign in with Email').click();
      await page.getByRole('textbox', { name: 'Email' }).fill('user@example.com');
      await page.getByRole('textbox', { name: 'Password' }).fill(process.env.TEST_PASSWORD || '<password-from-secrets-manager>');
      await page.getByText('Sign In', { exact: true }).click();
      await page.waitForTimeout(3000);

      // Select community if needed
      if (page.url().includes('select-community')) {
        await page.getByRole('textbox', { name: 'Search communities...' }).fill('fount');
        await page.waitForTimeout(2000);
        await page.getByText('FOUNT').click();
        await page.waitForTimeout(3000);
      }
    }
  });

  test('CUJ 1.1: Chat → Members → Back returns to chat', async ({ page }) => {
    // Navigate to inbox
    await page.goto('http://localhost:8081/chat');
    await page.waitForTimeout(2000);

    // Click on a chat
    await page.getByText('Test Street').click();
    await page.waitForTimeout(1000);

    const chatUrl = page.url();
    expect(chatUrl).toContain('/inbox/');

    // Open menu and go to Members
    await page.locator('[data-testid="chat-menu"]').click(); // Adjust selector as needed
    await page.getByText('Members').click();
    await page.waitForTimeout(1000);

    expect(page.url()).toContain('/members');

    // Go back
    await page.goBack(); // or click back button
    await page.waitForTimeout(1000);

    // Should return to chat, not leader-tools hub
    expect(page.url()).toContain('/inbox/');
    expect(page.url()).not.toContain('/leader-tools/');
  });

  test('CUJ 2.1: Leader Tools → Group Chat goes to chat room', async ({ page }) => {
    // Navigate directly to leader tools
    await page.goto('http://localhost:8081/leader-tools/{group_id}');
    await page.waitForTimeout(3000);

    // Click Group Chat
    await page.getByText('Group Chat').click();
    await page.waitForTimeout(1000);

    // Should be at chat room, not inbox list
    expect(page.url()).toContain('/inbox/');
    expect(page.url()).toContain('church1_group');
  });
});
```

## Route Reference

| Screen | Route Pattern | Back Fallback |
|--------|---------------|---------------|
| Inbox (list) | `/(tabs)/chat` | - |
| Chat Room | `/inbox/{channel_id}` | `/(tabs)/chat` |
| Leader Tools Hub | `/leader-tools/{group_id}` | Previous or `/(tabs)/chat` |
| Members | `/leader-tools/{group_id}/members` | Previous or Leader Tools Hub |
| Events | `/leader-tools/{group_id}/events` | Previous or Leader Tools Hub |
| Attendance | `/leader-tools/{group_id}/attendance` | Previous or Leader Tools Hub |
| Attendance Edit | `/leader-tools/{group_id}/attendance/edit?eventDate=` | Previous or Attendance |
| Group Detail (Public) | `/groups/{group_id}` | Previous or `/groups` |

## Navigation Pattern

All screens should use this consistent back navigation pattern:

```typescript
const handleBack = () => {
  if (router.canGoBack()) {
    router.back();
  } else {
    // Fallback when no history (deep link, refresh, etc.)
    router.push('/fallback-route');
  }
};
```

## Known Issues Fixed

1. **Members page back navigation** (fixed in commit 75888e29): Was always using `router.push()` to Leader Tools hub instead of `router.back()`.

2. **Group Chat button navigation** (fixed in commit 75888e29): Was navigating to inbox list (`/(tabs)/chat`) instead of directly to the chat room (`/inbox/{channel_id}`).
