# S3 Bucket Public Access Configuration (Legacy)

> **Note**: This documentation is for the legacy S3 storage system. New uploads use **Cloudflare R2** as the primary storage, which is configured for public access by default via Cloudflare's CDN. This guide is only relevant for legacy images still served from S3. See [ADR-016](../architecture/ADR-016-cloudflare-images-migration.md) for details on the R2 migration.

## Problem
Group preview images are stored in `togather-production-bucket-compressed` but the bucket is not publicly accessible, causing images to fail loading in the app.

## Solution
Configure the S3 bucket to allow public read access for images while maintaining security.

---

## Step 1: Configure Bucket Policy (Recommended)

### Option A: AWS Console (Easiest)

1. Go to [AWS S3 Console](https://s3.console.aws.amazon.com/s3/buckets)
2. Click on `togather-production-bucket-compressed` bucket
3. Go to **Permissions** tab
4. Scroll down to **Bucket policy**
5. Click **Edit**
6. Paste this policy:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::togather-production-bucket-compressed/*"
        }
    ]
}
```

7. Click **Save changes**

### Option B: AWS CLI

```bash
# Create bucket policy file
cat > /tmp/bucket-policy.json << 'EOF'
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::togather-production-bucket-compressed/*"
        }
    ]
}
EOF

# Apply the bucket policy
aws s3api put-bucket-policy \
    --bucket togather-production-bucket-compressed \
    --policy file:///tmp/bucket-policy.json
```

---

## Step 2: Configure Block Public Access Settings

Even with a bucket policy, AWS may block public access by default. You need to allow it:

### Option A: AWS Console

1. In the same bucket (`togather-production-bucket-compressed`)
2. Go to **Permissions** tab
3. Scroll to **Block public access (bucket settings)**
4. Click **Edit**
5. **Uncheck** the following (or keep them checked but understand the policy will override):
   - ✅ Block all public access (if you want to be more restrictive)
   - OR uncheck all individual settings:
     - ❌ Block public access to buckets and objects granted through new access control lists (ACLs)
     - ❌ Block public access to buckets and objects granted through any access control lists (ACLs)
     - ❌ Block public access to buckets and objects granted through new public bucket or access point policies
     - ❌ Block public and cross-account access to buckets and objects through any public bucket or access point policies

**Note:** If you keep "Block all public access" checked, the bucket policy above won't work. You need to uncheck it.

6. Click **Save changes**
7. Type `confirm` when prompted

### Option B: AWS CLI

```bash
# Allow public access (unblock)
aws s3api put-public-access-block \
    --bucket togather-production-bucket-compressed \
    --public-access-block-configuration \
    "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"
```

---

## Step 3: Verify Configuration

### Test Public Access

```bash
# Test if an image URL is accessible (replace with actual image path)
curl -I https://togather-production-bucket-compressed.s3.amazonaws.com/groups/previews/4B030EED-6EB2-422C-AB21-3C5A837F1D64_854b60ed.jpg

# Should return HTTP 200 OK
```

### Check Bucket Policy

```bash
aws s3api get-bucket-policy \
    --bucket togather-production-bucket-compressed \
    --query Policy \
    --output text | python3 -m json.tool
```

### Check Public Access Block Settings

```bash
aws s3api get-public-access-block \
    --bucket togather-production-bucket-compressed
```

---

## Security Considerations

### ✅ Recommended: Restrict to Specific Paths

If you only want to make images public (not all files), use a more restrictive policy:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObjectForImages",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": [
                "arn:aws:s3:::togather-production-bucket-compressed/groups/previews/*",
                "arn:aws:s3:::togather-production-bucket-compressed/meetings/covers/*",
                "arn:aws:s3:::togather-production-bucket-compressed/media/images/profiles/*"
            ]
        }
    ]
}
```

### ✅ Alternative: Use CloudFront with Signed URLs

For better security and performance:
1. Set up CloudFront distribution in front of S3
2. Use CloudFront signed URLs or cookies
3. Keep S3 bucket private
4. Update `AWS_S3_COMPRESSED_BUCKET_URL` to CloudFront URL

---

## Troubleshooting

### Images Still Not Loading

1. **Check CORS Configuration** (if loading from browser):
   - See `docs/s3-cors-configuration.md`
   - Add CORS headers for browser access

2. **Verify Bucket Policy**:
   ```bash
   aws s3api get-bucket-policy --bucket togather-production-bucket-compressed
   ```

3. **Check Public Access Block**:
   ```bash
   aws s3api get-public-access-block --bucket togather-production-bucket-compressed
   ```

4. **Test Direct URL Access**:
   - Open image URL directly in browser
   - Should load without authentication

5. **Check Object ACLs** (if using ACLs):
   ```bash
   aws s3api get-object-acl \
       --bucket togather-production-bucket-compressed \
       --key groups/previews/your-image.jpg
   ```

### Common Errors

- **403 Forbidden**: Bucket policy not applied or Block Public Access is enabled
- **404 Not Found**: Object doesn't exist or wrong path
- **CORS Error**: Need to configure CORS (see `docs/s3-cors-configuration.md`)

---

## Related Documentation

- CORS Configuration: `docs/s3-cors-configuration.md`
- S3 Fix Summary: `docs/archive/fixes/S3_FIX_SUMMARY.md`




