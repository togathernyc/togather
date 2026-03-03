# Image Compression Path Migration - Tech Debt

## Status: SUPERSEDED

> **Note**: This tech debt has been superseded by the migration to **Cloudflare R2 with Image Transformations**. New uploads use R2, and image compression/optimization is handled by Cloudflare Image Transformations (on-the-fly). See [ADR-016](../architecture/ADR-016-cloudflare-images-migration.md) for details.
>
> The documentation below is preserved for historical reference regarding legacy S3 images.

---

## Original Status: ⚠️ TECH DEBT (Legacy)

**Created**: 2025-12-13  
**Priority**: Medium  
**Estimated Effort**: 2-4 hours

---

## Problem

Group preview images and meeting cover images are currently being uploaded to the `dinner/previews/` path instead of their logical paths (`groups/previews/` and `meetings/covers/`). This is a workaround to leverage existing Lambda compression infrastructure.

## Current State

### Upload Paths
- **Group preview images**: `dinner/previews/{filename}` (should be `groups/previews/`)
- **Meeting cover images**: `dinner/previews/{filename}` (should be `meetings/covers/`)

### Why This Exists

The AWS Lambda compression function (`backend-deprecated/lambda_functions/compress_images.py`) only handles these paths:
- ✅ `dinner/previews/`
- ✅ `images/profiles/`
- ✅ `churches/`, `call_to_action/`, `devotional/`
- ✅ `message-images/`
- ❌ `groups/previews/` (not supported)
- ❌ `meetings/covers/` (not supported)

To ensure images are automatically compressed, we're using the `dinner/previews/` path as a temporary workaround.

## Impact

### Positive
- ✅ Images are automatically compressed by Lambda
- ✅ No changes needed to Lambda function immediately
- ✅ Consistent compression quality

### Negative
- ❌ Path doesn't match logical structure (`groups/previews/` vs `dinner/previews/`)
- ❌ Confusing for developers (groups use "dinner" path)
- ❌ Makes it harder to distinguish group images from legacy dinner images
- ❌ Migration complexity when fixing later

## Files Affected

### Backend
- `apps/backend/src/business_logic/groups/services.py`
  - `upload_group_preview_image()` - Uses `dinner/previews/` path
  - `upload_meeting_cover_image()` - Uses `dinner/previews/` path

### Lambda Function
- `backend-deprecated/lambda_functions/compress_images.py`
  - Only handles `dinner/previews/` path (line 176)

## Migration Plan

### Step 1: Update Lambda Function

Add support for new paths in `compress_images.py`:

```python
# In handler function, add:
elif key.startswith('groups/previews/'):
    image = Image.open(response['Body'])
    buffer = resize_dp_images(handle_image_orientation(image), buffer, image.format)
    s3.put_object(Body=buffer, Bucket=os.environ.get('COMPRESSED_BUCKET'), Key=key)
elif key.startswith('meetings/covers/'):
    image = Image.open(response['Body'])
    buffer = resize_dp_images(handle_image_orientation(image), buffer, image.format)
    s3.put_object(Body=buffer, Bucket=os.environ.get('COMPRESSED_BUCKET'), Key=key)
```

### Step 2: Update Backend Upload Paths

Change upload paths in `groups/services.py`:

```python
# Group preview images
file_path = f"groups/previews/{unique_filename}"  # Changed from dinner/previews/

# Meeting cover images  
file_path = f"meetings/covers/{unique_filename}"  # Changed from dinner/previews/
```

### Step 3: Migrate Existing Images

1. Copy existing images from `dinner/previews/` to new paths in S3
2. Update database records to use new paths
3. Verify Lambda compression works for new paths

### Step 4: Update Model Field

Update `Group.preview` field `upload_to` parameter:

```python
# In apps/backend/src/database/models/groups/models.py
preview = models.ImageField(upload_to='groups/previews', blank=True, null=True)
```

## Testing Checklist

- [ ] Lambda function compresses `groups/previews/` images
- [ ] Lambda function compresses `meetings/covers/` images
- [ ] New uploads use correct paths
- [ ] Existing images still load correctly
- [ ] URL generation works for both old and new paths
- [ ] Frontend displays images correctly

## Related Documentation

- Lambda compression: `backend-deprecated/lambda_functions/compress_images.py`
- Image compression workflow: `docs/image-compression-workflow.md`
- S3 path migration: `docs/s3-path-migration-fix.md`

## Notes

- This is a temporary workaround to ensure images are compressed
- The Lambda function is legacy code (`backend-deprecated/`)
- Consider migrating to a more modern compression solution (e.g., AWS Lambda Layers, CloudFront image optimization)
- Database migration may be needed to update existing image paths







