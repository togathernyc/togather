# Image Compression Workflow

## Current Architecture

Images are compressed using an AWS Lambda function that's triggered by S3 upload events.

### Workflow

1. **Upload to Regular Bucket**: Images are uploaded to `togather-production-bucket`
2. **S3 Event Trigger**: S3 triggers Lambda function when file is uploaded
3. **Lambda Compression**: Lambda function:
   - Reads image from regular bucket
   - Resizes/compresses image (using PIL/Pillow)
   - Handles EXIF orientation
   - Saves compressed version to `togather-production-bucket-compressed`
4. **URL Generation**: Frontend uses URLs pointing to compressed bucket

### Lambda Function

**Location**: `backend-deprecated/lambda_functions/compress_images.py`

**Currently Handles**:
- `dinner/previews/` - Resizes to DP_IMAGE_WIDTH (maintains aspect ratio)
- `images/profiles/` - Square crop and resize
- `churches/`, `call_to_action/`, `devotional/` - 80% resize
- `message-images/` - 70% resize

**Missing**: `groups/previews/` and `meetings/covers/` paths

### Current Issue

Group preview images are being uploaded directly to the compressed bucket, bypassing Lambda compression. This means:
- ✅ Images are uploaded successfully
- ❌ Images are NOT compressed/resized
- ❌ Images may be larger than needed

## Solutions

### Option 1: Upload to Regular Bucket + Update Lambda (Recommended)

**Pros:**
- Uses existing compression infrastructure
- Consistent with other image types
- Automatic compression via Lambda

**Cons:**
- Requires Lambda function update
- Requires S3 event configuration

**Steps:**
1. Change upload to use regular bucket (`default_storage`)
2. Update Lambda function to handle `groups/previews/` path
3. Lambda will automatically compress and save to compressed bucket

### Option 2: Compress in Backend Before Upload

**Pros:**
- No Lambda changes needed
- Immediate compression
- Full control over compression settings

**Cons:**
- Adds backend processing time
- Requires PIL/Pillow dependency
- Duplicates compression logic

**Steps:**
1. Add PIL/Pillow compression logic to backend
2. Compress image before uploading
3. Upload compressed version directly to compressed bucket

### Option 3: Upload Directly to Compressed Bucket (Current)

**Pros:**
- Simple, no Lambda needed
- Fast upload

**Cons:**
- No compression
- Larger file sizes
- Higher bandwidth costs

## Recommendation

**Use Option 1** - Upload to regular bucket and update Lambda to handle `groups/previews/`:

1. Revert upload to use `default_storage` (regular bucket)
2. Update Lambda function to handle `groups/previews/` path (same logic as `dinner/previews`)
3. Lambda will automatically compress and save to compressed bucket

This maintains consistency with the existing architecture and ensures all images are properly compressed.




