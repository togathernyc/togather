# Image Loading Testing Strategy

This document outlines the testing strategy to prevent image loading issues in the Togather app.

## Overview

Images are critical to user experience. This strategy ensures images load correctly across:
- Community logos (auth flows, settings)
- Group images (lists, details, search)
- User profile photos (chat, member lists)
- Event cover images (event details, lists)

## Historical Issues

### Issue 1: Missing Group Images (Jan 2026)
- **Problem**: Group images not showing on detail pages
- **Root Cause**: Backend `groups.getById` query not calling `getMediaUrl()` on the `preview` field
- **Fix**: Updated query to transform path to full URL
- **Prevention**: Unit tests for all image-returning queries (see below)

### Issue 2: Missing Community Logos (Jan 2026)
- **Problem**: Community logos showing initials instead of images on selection screen
- **Root Cause**: `users.me` query missing `communityLogo` field in response
- **Fix**: Added `communityLogo: getMediaUrl(community.logo)` to response
- **Prevention**: Response shape tests (see below)

### Issue 3: Complex Fallback System (Jan 2026)
- **Problem**: Dual URL system (`source` + `fallbackSource`) caused confusion and inconsistencies
- **Root Cause**: Some functions used `getMediaUrl()` (single), others used `getMediaUrls()` (dual)
- **Fix**: Standardized on single URL system - backend handles optimization transparently
- **Prevention**: Architectural documentation + linting rules (see below)

## Current Architecture (Single URL System)

### Backend Pattern
```typescript
// ✓ CORRECT: Backend returns ONE URL
export const getById = query({
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    return {
      ...group,
      preview: getMediaUrl(group.preview), // Single URL
    };
  },
});
```

### Frontend Pattern
```typescript
// ✓ CORRECT: Frontend receives ONE URL
<AppImage
  source={group.preview}  // No fallbackSource prop
  placeholder={{ type: 'initials', name: group.name }}
/>
```

### Environment-Based Optimization
```typescript
// getMediaUrl() in apps/convex/lib/utils.ts
export function getMediaUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;

  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION || "us-east-1";

  // Future: When compressed images ready, return compressed URL here
  // For now: Always return original S3 URL
  return `https://${bucket}.s3.${region}.amazonaws.com/${path}`;
}
```

## Testing Pyramid

### 1. Unit Tests (Fast, Many)

#### Test: Image URL Construction
```typescript
// apps/convex/__tests__/image-utils.test.ts
import { describe, it, expect } from 'vitest';
import { getMediaUrl } from '../lib/utils';

describe('getMediaUrl', () => {
  beforeEach(() => {
    process.env.AWS_S3_BUCKET = 'test-bucket';
    process.env.AWS_REGION = 'us-east-1';
  });

  it('returns undefined for null path', () => {
    expect(getMediaUrl(null)).toBeUndefined();
    expect(getMediaUrl(undefined)).toBeUndefined();
  });

  it('returns undefined when path is empty string', () => {
    expect(getMediaUrl('')).toBeUndefined();
  });

  it('constructs correct S3 URL for path', () => {
    const url = getMediaUrl('communities/logo.png');
    expect(url).toBe('https://test-bucket.s3.us-east-1.amazonaws.com/communities/logo.png');
  });

  it('returns existing URL unchanged', () => {
    const existingUrl = 'https://example.com/image.png';
    expect(getMediaUrl(existingUrl)).toBe(existingUrl);
  });

  it('handles paths with special characters', () => {
    const url = getMediaUrl('groups/1/preview_abc123.jpg');
    expect(url).toContain('groups/1/preview_abc123.jpg');
  });

  it('returns undefined when bucket not configured', () => {
    delete process.env.AWS_S3_BUCKET;
    expect(getMediaUrl('path/to/image.png')).toBeUndefined();
  });
});
```

#### Test: Query Response Shapes
```typescript
// apps/convex/__tests__/query-response-shapes.test.ts
import { describe, it, expect } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../schema';

describe('Query Response Shapes - Images', () => {
  it('users.me returns community logos', async () => {
    const t = convexTest(schema);

    // Setup: Create user with community
    const userId = await t.run(async (ctx) => {
      const communityId = await ctx.db.insert('communities', {
        name: 'Test Community',
        logo: 'communities/logo.png',
      });
      const userId = await ctx.db.insert('users', {
        phone: '+12025550100',
        firstName: 'Test',
      });
      await ctx.db.insert('userCommunities', {
        userId,
        communityId,
        roles: 3,
      });
      return userId;
    });

    // Test: Query should return logo URL
    const result = await t.query('functions/users:me', {});

    expect(result).toBeTruthy();
    expect(result.communityMemberships).toHaveLength(1);
    expect(result.communityMemberships[0]).toHaveProperty('communityLogo');
    expect(result.communityMemberships[0].communityLogo).toMatch(/^https:\/\//);
    expect(result.communityMemberships[0].communityLogo).toContain('s3.amazonaws.com');
  });

  it('groups.getById returns preview URL', async () => {
    const t = convexTest(schema);

    const groupId = await t.run(async (ctx) => {
      const communityId = await ctx.db.insert('communities', { name: 'Test' });
      const groupTypeId = await ctx.db.insert('groupTypes', {
        communityId,
        name: 'Test Type',
        slug: 'test',
        isActive: true,
        createdAt: Date.now(),
        displayOrder: 1,
      });
      return await ctx.db.insert('groups', {
        communityId,
        groupTypeId,
        name: 'Test Group',
        preview: 'groups/1/preview.jpg',
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.query('functions/groups:getById', { groupId });

    expect(result).toBeTruthy();
    expect(result.preview).toMatch(/^https:\/\//);
    expect(result.preview).toContain('groups/1/preview.jpg');
  });

  it('meetings.getByShortId returns cover image URL', async () => {
    const t = convexTest(schema);

    const shortId = await t.run(async (ctx) => {
      const communityId = await ctx.db.insert('communities', { name: 'Test' });
      const groupTypeId = await ctx.db.insert('groupTypes', {
        communityId,
        name: 'Test Type',
        slug: 'test',
        isActive: true,
        createdAt: Date.now(),
        displayOrder: 1,
      });
      const groupId = await ctx.db.insert('groups', {
        communityId,
        groupTypeId,
        name: 'Test Group',
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert('meetings', {
        groupId,
        scheduledAt: Date.now(),
        status: 'scheduled',
        meetingType: 1,
        createdAt: Date.now(),
        shortId: 'test123',
        coverImage: 'meetings/cover.jpg',
      });
      return 'test123';
    });

    const result = await t.query('functions/meetings:getByShortId', { shortId });

    expect(result).toBeTruthy();
    expect(result.coverImage).toMatch(/^https:\/\//);
    expect(result.coverImage).toContain('meetings/cover.jpg');
  });
});
```

### 2. Integration Tests (Medium Speed, Some)

#### Test: End-to-End API Flow
```typescript
// apps/mobile/__tests__/integration/image-loading.test.ts
import { renderHook, waitFor } from '@testing-library/react-native';
import { useQuery } from '@services/api/convex';

describe('Image Loading Integration', () => {
  it('community selection receives valid logo URLs', async () => {
    const { result } = renderHook(() =>
      useQuery(api.functions.users.me, {})
    );

    await waitFor(() => expect(result.current).toBeTruthy());

    const memberships = result.current?.communityMemberships || [];
    memberships.forEach(membership => {
      if (membership.communityLogo) {
        expect(membership.communityLogo).toMatch(/^https:\/\/.*s3.*amazonaws\.com/);
      }
    });
  });

  it('group list receives valid preview URLs', async () => {
    const { result } = renderHook(() =>
      useQuery(api.functions.groups.listForUser, {})
    );

    await waitFor(() => expect(result.current).toBeTruthy());

    const groups = result.current || [];
    groups.forEach(group => {
      if (group.preview) {
        expect(group.preview).toMatch(/^https:\/\/.*s3.*amazonaws\.com/);
      }
    });
  });
});
```

### 3. E2E Visual Tests (Slow, Few)

#### Test: Playwright Visual Regression
```typescript
// apps/mobile/__tests__/e2e/image-loading.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Image Loading E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Login as test user
    await page.goto('/auth/signin');
    await page.fill('[data-testid="phone-input"]', '2025550123');
    await page.click('[data-testid="submit-button"]');
    await page.fill('[data-testid="otp-input"]', '000000');
    await page.click('[data-testid="verify-button"]');
  });

  test('community logos display (not initials fallback)', async ({ page }) => {
    await page.goto('/auth/community-selection');
    await page.waitForSelector('[data-testid="community-item"]');

    // Check all community avatars
    const avatars = page.locator('[data-testid="community-avatar"]');
    const count = await avatars.count();

    for (let i = 0; i < count; i++) {
      const avatar = avatars.nth(i);

      // Should have an img element with src containing s3.amazonaws.com
      const img = avatar.locator('img[src*="s3.amazonaws.com"]');
      await expect(img).toBeVisible({ timeout: 5000 });

      // Should NOT show initials fallback (single/double letter text)
      const initialsText = avatar.locator('text=/^[A-Z]{1,2}$/');
      await expect(initialsText).not.toBeVisible();
    }
  });

  test('group images display on detail page', async ({ page }) => {
    // Navigate to a group
    await page.goto('/(tabs)/search');
    await page.click('[data-testid="group-card"]:first-child');

    // Wait for group detail page
    await page.waitForSelector('[data-testid="group-header-image"]');

    // Verify header image loaded
    const headerImg = page.locator('[data-testid="group-header-image"] img');
    await expect(headerImg).toBeVisible();
    await expect(headerImg).toHaveAttribute('src', /s3\.amazonaws\.com/);

    // Should not show placeholder icon
    const placeholderIcon = page.locator('[data-testid="group-header-image"] svg');
    await expect(placeholderIcon).not.toBeVisible();
  });

  test('event cover images display', async ({ page }) => {
    await page.goto('/e/test-event-123');

    // Verify cover image loads
    const coverImg = page.locator('[data-testid="event-cover-image"]');
    await expect(coverImg).toBeVisible();
    await expect(coverImg).toHaveAttribute('src', /s3\.amazonaws\.com/);
  });

  test('user profile photos display in chat', async ({ page }) => {
    await page.goto('/(tabs)/inbox');
    await page.click('[data-testid="chat-room"]:first-child');

    // Check message avatars
    const messageAvatars = page.locator('[data-testid="message-avatar"]');
    const count = await messageAvatars.count();

    if (count > 0) {
      const firstAvatar = messageAvatars.first();
      const img = firstAvatar.locator('img[src*="s3.amazonaws.com"]');
      await expect(img).toBeVisible();
    }
  });
});
```

### 4. Snapshot Tests (Visual Regression)

```typescript
// apps/mobile/__tests__/visual/image-components.test.tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import { AppImage } from '@components/ui/AppImage';
import { Avatar } from '@components/ui/Avatar';

describe('Image Component Snapshots', () => {
  it('AppImage renders with S3 URL', () => {
    const { toJSON } = render(
      <AppImage
        source="https://test-bucket.s3.us-east-1.amazonaws.com/test.jpg"
        style={{ width: 100, height: 100 }}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('AppImage renders placeholder when source is null', () => {
    const { toJSON } = render(
      <AppImage
        source={null}
        placeholder={{ type: 'icon', icon: 'image', iconColor: '#ccc' }}
        style={{ width: 100, height: 100 }}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('Avatar renders with image URL', () => {
    const { toJSON } = render(
      <Avatar
        imageUrl="https://test-bucket.s3.us-east-1.amazonaws.com/profile.jpg"
        name="Test User"
        size={48}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('Avatar renders initials when imageUrl is null', () => {
    const { toJSON } = render(
      <Avatar
        imageUrl={null}
        name="Test User"
        size={48}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });
});
```

## Pre-Deployment Checklist

Before deploying changes that affect images:

### Backend Checklist
- [ ] All queries returning image paths call `getMediaUrl()`
- [ ] All image fields use `?? null` (not `?? undefined`)
- [ ] `AWS_S3_BUCKET` and `AWS_REGION` environment variables set in Convex
- [ ] No references to removed `*Fallback` fields

### Frontend Checklist
- [ ] Components use single `source` or `imageUrl` prop (no `fallbackSource`)
- [ ] All image paths come from backend (no frontend URL construction)
- [ ] Placeholder configuration exists for null/failed images

### Data Checklist
- [ ] Communities have `logo` field populated
- [ ] Groups have `preview` field populated
- [ ] Users have `profilePhoto` field populated (or null)
- [ ] Meetings have `coverImage` field populated (or null)

### Testing Checklist
- [ ] Unit tests pass (`pnpm test`)
- [ ] Integration tests pass
- [ ] E2E tests pass (Playwright)
- [ ] Manual testing on:
  - [ ] Community selection screen
  - [ ] Group list screen
  - [ ] Group detail screen
  - [ ] Event detail screen
  - [ ] Chat/inbox screen
  - [ ] User profile screen

## Monitoring

### Production Monitoring
Add logging to track image load failures:

```typescript
// In AppImage component
const [loadError, setLoadError] = useState(false);

const handleError = useCallback(() => {
  setLoadError(true);

  // Log to monitoring service
  if (__DEV__) {
    console.warn('Image failed to load:', source);
  } else {
    // Report to Sentry in production
    Sentry.captureMessage('Image load failed', {
      extra: {
        source,
        component: 'AppImage',
      },
    });
  }

  onError?.();
}, [source, onError]);
```

### Metrics to Track
- **Image load success rate**: % of images that load successfully
- **Average load time**: Time from mount to image display
- **Fallback usage rate**: % of times placeholder/initials are shown
- **Failed URLs**: Which URLs are failing most often

### Alerts
Set up alerts for:
- Image load success rate drops below 95%
- Specific communities/groups with >50% image failures
- AWS S3 bucket misconfiguration (all images fail)

## Linting Rules

Add ESLint rules to enforce patterns:

```javascript
// .eslintrc.js
module.exports = {
  rules: {
    // Prevent using fallbackSource (removed prop)
    'no-restricted-syntax': [
      'error',
      {
        selector: 'JSXAttribute[name.name="fallbackSource"]',
        message: 'fallbackSource is deprecated. Use single source prop only.',
      },
      {
        selector: 'JSXAttribute[name.name="fallbackImageUrl"]',
        message: 'fallbackImageUrl is deprecated. Use single imageUrl prop only.',
      },
    ],
  },
};
```

## Future: Compressed Image Pipeline

When compressed images are ready:

### Backend Update (Single Location)
```typescript
// apps/convex/lib/utils.ts - Only file that needs changes
export function getMediaUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;

  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION || "us-east-1";
  const compressedBucket = process.env.AWS_S3_COMPRESSED_BUCKET;

  if (!bucket) return undefined;

  // NEW: Check if compressed image exists
  // If yes, return compressed URL
  // If no, return original URL
  if (compressedBucket && await imageExistsInCompressedBucket(path)) {
    return `https://${compressedBucket}.s3.${region}.amazonaws.com/${path}`;
  }

  // Fallback to original
  return `https://${bucket}.s3.${region}.amazonaws.com/${path}`;
}
```

### Frontend Changes
**NONE!** Frontend receives single URL, doesn't care if it's compressed or original.

### Testing for Compression
Add test to verify compression preference:
```typescript
it('returns compressed URL when available', async () => {
  process.env.AWS_S3_COMPRESSED_BUCKET = 'compressed-bucket';
  mockImageExists(true);

  const url = await getMediaUrl('test.jpg');
  expect(url).toContain('compressed-bucket');
});

it('falls back to original when compressed unavailable', async () => {
  process.env.AWS_S3_COMPRESSED_BUCKET = 'compressed-bucket';
  mockImageExists(false);

  const url = await getMediaUrl('test.jpg');
  expect(url).toContain('original-bucket');
  expect(url).not.toContain('compressed-bucket');
});
```

## Summary

This testing strategy ensures:
1. **Fast feedback**: Unit tests catch URL construction issues immediately
2. **API contract validation**: Integration tests ensure queries return expected shapes
3. **Visual verification**: E2E tests confirm images actually display to users
4. **Regression prevention**: Snapshot tests catch unintended component changes
5. **Production safety**: Monitoring and alerts catch issues in production
6. **Future-proof**: Architecture supports optimization without frontend changes

**Key Principle**: Backend owns image URL construction. Frontend just displays what it receives.
