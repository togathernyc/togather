# S3 CORS Configuration for Map Images (Legacy)

> **Note**: This documentation is for the legacy S3 storage system. New uploads use **Cloudflare R2** as the primary storage, which handles CORS automatically via Cloudflare's CDN. This guide is only relevant for legacy images still served from S3. See [ADR-016](../architecture/ADR-016-cloudflare-images-migration.md) for details on the R2 migration.

## Problem
Group profile images cannot be loaded into the map's canvas rendering because the S3 bucket lacks CORS headers. This causes all map markers to show a placeholder "G" instead of the actual group photos.

## Solution
Add CORS configuration to the `togather-production-bucket-compressed` S3 bucket.

## Option 1: AWS Console (Recommended)

1. Go to [AWS S3 Console](https://s3.console.aws.amazon.com/s3/buckets)
2. Click on `togather-production-bucket-compressed` bucket
3. Go to **Permissions** tab
4. Scroll down to **Cross-origin resource sharing (CORS)**
5. Click **Edit**
6. Paste this configuration:

```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "HEAD"],
        "AllowedOrigins": ["*"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3600
    }
]
```

7. Click **Save changes**

## Option 2: AWS CLI

If you have AWS CLI configured with proper credentials:

```bash
# Create a CORS config file
cat > /tmp/cors.json << 'EOF'
{
    "CORSRules": [
        {
            "AllowedHeaders": ["*"],
            "AllowedMethods": ["GET", "HEAD"],
            "AllowedOrigins": ["*"],
            "ExposeHeaders": ["ETag"],
            "MaxAgeSeconds": 3600
        }
    ]
}
EOF

# Apply the CORS configuration
aws s3api put-bucket-cors \
    --bucket togather-production-bucket-compressed \
    --cors-configuration file:///tmp/cors.json
```

## Option 3: Restrict Origins (Production)

For production, you may want to restrict origins to specific domains:

```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "HEAD"],
        "AllowedOrigins": [
            "http://localhost:8081",
            "https://app.{your-domain}",
            "https://{your-domain}"
        ],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3600
    }
]
```

## Verification

After applying the CORS configuration, refresh the map page. The markers should now show actual group photos with colored rings instead of the "G" placeholder.

You can verify CORS headers using curl:

```bash
curl -I -H "Origin: http://localhost:8081" \
    "https://togather-production-bucket-compressed.s3.amazonaws.com/groups/previews/some-image.jpg"
```

You should see these headers in the response:
- `Access-Control-Allow-Origin: *` (or your specific origin)
- `Access-Control-Allow-Methods: GET, HEAD`

## Technical Background

The map uses HTML Canvas to render circular profile photos with colored rings. Canvas has security restrictions that prevent reading pixel data from images loaded from different origins unless the server sends proper CORS headers.

Relevant code: `apps/mobile/features/explore/components/ExploreMap.tsx`
- `img.crossOrigin = 'anonymous'` - requests CORS headers
- `ctx.drawImage(img, ...)` - draws image on canvas
- `canvas.getContext('2d').getImageData(...)` - extracts pixel data for Mapbox
