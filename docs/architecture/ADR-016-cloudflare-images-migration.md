# ADR-016: Migration from S3 to Cloudflare R2 + Image Transformations

## Status
Implemented

## Context

We currently store images across multiple systems:
- **AWS S3** (primary) - profile photos, community logos, group previews, meeting covers
- **Convex Storage** - some chat attachments
- **Legacy S3 bucket** (`togather-chat-images`) - one old chat attachment

This system has several issues:
- Inconsistent URL formats in the database (full URLs, relative paths, broken local paths)
- Lambda compression only covers some paths (tech debt around `dinner/previews/` workaround)
- No on-the-fly resizing for thumbnails vs full images
- Multiple storage systems to maintain
- S3 costs will grow as usage increases

## Decision

Migrate to **Cloudflare R2 + Image Transformations** for all image storage and delivery.

**Key decisions:**
- Use **R2** for storage (S3-compatible, generous free tier)
- Use **Cloudflare Image Transformations** for on-the-fly resizing/optimization
- All images are **public** (security through obscurity with random filenames)
- Staging and production **share the same R2 bucket** (data overlaps significantly)
- Maintain a **local mapping file** during migration (S3 key → R2 path) for rollback/audit

### Why R2 + Image Transformations

| Factor | AWS S3 + Lambda | R2 + Transformations |
|--------|-----------------|----------------------|
| **Storage cost** | ~$0.023/GB/month | 10GB free, then $0.015/GB |
| **Optimization** | Custom Lambda (partial) | Built-in transformations |
| **CDN** | Separate CloudFront | Included via Cloudflare |
| **API** | AWS SDK | S3-compatible (minimal changes) |
| **Video path** | Separate solution | R2 stores any file type |

### Configuration

```
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_BUCKET_NAME=togather-images
R2_PUBLIC_URL=https://images.togather.nyc
CLOUDFLARE_ACCOUNT_ID=xxx (existing)
```

### Current Inventory

| Table | Field | Count | Current Format |
|-------|-------|-------|----------------|
| users | profilePhoto | 3,120 | S3 paths: `images/profiles/...` |
| communities | logo | 32 | S3 paths: `church/logo/...` |
| communities | appIcon | 4 | S3 paths: `church/app_icon/...` |
| groups | preview | 105 | S3 paths: `dinner/previews/...` |
| meetings | coverImage | 42 | Mixed (paths, full URLs, broken local paths) |
| **Total** | | **~3,300** | |

**Not migrated (fresh start):**
- `chatMessages.attachments` - existing attachments left as-is; new uploads go to R2
- `groupTypes.icon` - stores icon names (e.g., "people"), not image paths
- `chatChannelMembers.profilePhoto` - denormalized from users table

## Implementation Plan

### Phase 1: R2 Upload Functions

Add R2 upload capability to Convex:

```typescript
// apps/convex/functions/uploads.ts

// Generate presigned URL for direct upload to R2
export const getR2UploadUrl = action({
  args: {
    folder: v.string(), // "profiles", "groups", "meetings", "chat"
    filename: v.string(),
    contentType: v.string(),
  },
  handler: async (ctx, args) => {
    const key = `${args.folder}/${crypto.randomUUID()}-${args.filename}`;
    const presignedUrl = await generateR2PresignedUrl(key, args.contentType);
    return {
      uploadUrl: presignedUrl,
      key,
      publicUrl: `${R2_PUBLIC_URL}/${key}`,
    };
  },
});
```

### Phase 2: Update Storage Format

**New storage format:**
```
# Old format (S3 path)
images/profiles/28_21F1B204-9D18-4DC7-A6C5-330DC8D7603C.jpg

# New format (R2 path with prefix)
r2:profiles/a8f2b3c4-d5e6-7890-image.jpg
```

The `r2:` prefix distinguishes R2 paths from legacy S3 paths.

### Phase 3: Update getMediaUrl()

```typescript
export function getMediaUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;

  // Already a full URL - return as-is
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  // R2 storage (new format)
  if (path.startsWith("r2:")) {
    const r2Path = path.slice(3);
    return `${R2_PUBLIC_URL}/${r2Path}`;
  }

  // Legacy S3 path (backwards compatibility)
  return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${path}`;
}

// Helper for transformed images (resized, optimized)
export function getMediaUrlWithTransform(
  path: string | null | undefined,
  options: { width?: number; height?: number; fit?: 'cover' | 'contain' | 'scale-down' } = {}
): string | undefined {
  const baseUrl = getMediaUrl(path);
  if (!baseUrl) return undefined;

  // Only apply transforms to R2 images served via togather.nyc
  if (!baseUrl.includes('images.togather.nyc')) {
    return baseUrl; // Legacy images - no transforms available
  }

  const transforms = [];
  if (options.width) transforms.push(`width=${options.width}`);
  if (options.height) transforms.push(`height=${options.height}`);
  if (options.fit) transforms.push(`fit=${options.fit}`);

  if (transforms.length === 0) {
    transforms.push('format=auto'); // At minimum, optimize format
  } else {
    transforms.push('format=auto');
  }

  // Cloudflare transform URL format
  const transformString = transforms.join(',');
  const imagePath = baseUrl.replace('https://images.togather.nyc/', '');
  return `https://togather.nyc/cdn-cgi/image/${transformString}/${R2_PUBLIC_URL}/${imagePath}`;
}
```

### Phase 4: Update Mobile Upload Hooks

Files to modify:
- `apps/mobile/features/profile/hooks/useUpdateProfilePhoto.ts`
- `apps/mobile/features/groups/` - group preview upload
- `apps/mobile/features/leader-tools/` - meeting cover upload
- `apps/mobile/features/chat/hooks/useImageUpload.ts`

New upload flow:
1. Client picks image
2. Client calls `getR2UploadUrl` action
3. Client uploads directly to R2 via presigned URL
4. Client calls mutation to save `r2:{key}` to database

### Phase 5: Migration Script

```typescript
// scripts/migrate-images-to-r2.ts

async function migrateImages() {
  const mapping = {
    migrated_at: new Date().toISOString(),
    mappings: [],
    errors: [],
    stats: { total: 0, migrated: 0, skipped: 0, failed: 0 }
  };

  // Tables to migrate (in order):
  // 1. users (profilePhoto) - 3,120 images
  // 2. communities (logo, appIcon) - 36 images
  // 3. groups (preview) - 105 images
  // 4. meetings (coverImage) - 42 images

  // For each image:
  // 1. Download from S3
  // 2. Upload to R2 with new path
  // 3. Update database record with r2:{path}
  // 4. Record mapping

  await fs.writeFile('migration-mapping.json', JSON.stringify(mapping, null, 2));
}
```

### Phase 6: Clean Up

1. Verify all images accessible via R2 URLs
2. Remove S3 upload code
3. Remove Lambda compression function
4. Keep S3 buckets for 30 days as backup
5. Delete S3 buckets after verification period

## Image Transformation Presets

Use these common transformations in the app:

| Use Case | Transform URL |
|----------|---------------|
| Avatar (small) | `/cdn-cgi/image/width=100,height=100,fit=cover,format=auto/...` |
| Avatar (medium) | `/cdn-cgi/image/width=200,height=200,fit=cover,format=auto/...` |
| Card preview | `/cdn-cgi/image/width=400,height=300,fit=cover,format=auto/...` |
| Full image | `/cdn-cgi/image/format=auto,quality=85/...` |

## Rollback Plan

1. `getMediaUrl()` still supports all legacy formats
2. Mapping file allows reverting individual records
3. Can revert upload code to S3 while keeping read compatibility
4. S3 buckets remain for 30 days after migration

## Future: Video Support

R2 stores any file type. For video:
- Upload to R2 same as images
- For streaming/transcoding, integrate Cloudflare Stream later
- Store as `r2:videos/{id}.mp4` or `stream:{streamId}`

## Cost Analysis

**R2 pricing:**
- Storage: 10GB free, then $0.015/GB/month
- Class A ops (writes): 1M free, then $4.50/million
- Class B ops (reads): 10M free, then $0.36/million
- Egress: Free (!)

**At current scale (3,300 images, ~500MB estimated):**
- Storage: Free (well under 10GB)
- Operations: Free (well under limits)
- Transformations: Included with Cloudflare plan

**Projected cost: $0/month** until you exceed 10GB storage (~50,000 images at 200KB average).
