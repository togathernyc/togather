# S3 Path Migration Fix - dinner/previews → groups/previews

> **Note**: This documentation is for the legacy S3 storage system. New uploads use **Cloudflare R2** as the primary storage. See [ADR-016](../architecture/ADR-016-cloudflare-images-migration.md) for details on the R2 migration.

## Problem

When groups were migrated from the legacy `Dinner` model to the new `Group` model, preview image paths were copied directly:
- **Legacy path**: `dinner/previews/filename.jpg` (from Dinner model)
- **New path**: `groups/previews/filename.jpg` (from Group model)

This causes issues because:
1. Migrated groups still have `dinner/previews/` paths in the database
2. New uploads go to `groups/previews/`
3. The URL generation function needs to handle both paths

## Solution

Updated `get_compressed_media_url()` to automatically convert legacy paths:

```python
# Legacy path: dinner/previews/filename.jpg
# Automatically converted to: groups/previews/filename.jpg
```

## Files Changed

- `apps/backend/src/database/models/utils/media.py` - Updated `get_compressed_media_url()` function

## Testing

After this fix:
1. Old groups with `dinner/previews/` paths will automatically use `groups/previews/` URLs
2. New uploads continue to work correctly
3. Both paths are handled transparently

## Migration Paths

If you need to verify or migrate existing paths in the database:

```python
# Check groups with legacy paths
from src.database.models.groups.models import Group

legacy_groups = Group.objects.filter(preview__startswith='dinner/previews/')
print(f"Found {legacy_groups.count()} groups with legacy paths")

# Update paths (if needed)
for group in legacy_groups:
    if group.preview:
        new_path = group.preview.replace('dinner/previews/', 'groups/previews/', 1)
        group.preview = new_path
        group.save(update_fields=['preview'])
```

## Related

- Group migration: `apps/backend/src/database/models/groups/management/commands/migrate_dinners_to_groups.py`
- Preview fix command: `apps/backend/src/database/models/groups/management/commands/fix_group_previews.py`




