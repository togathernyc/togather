# =============================================================================
# R2 Bucket CORS Configuration
# =============================================================================
#
# Configures CORS on the togather-images R2 bucket to allow browser-based
# uploads (voice memos, images, documents) from web clients.
#
# Without CORS, presigned URL uploads from localhost/togather.nyc fail because
# the browser blocks cross-origin PUT requests to R2.
#
# NOTE: The R2 bucket itself is managed manually (not imported into Terraform).
# This resource only manages the CORS policy.
# =============================================================================

resource "cloudflare_r2_bucket_cors" "togather_images" {
  account_id  = var.cloudflare_account_id
  bucket_name = "togather-images"

  rules = [
    {
      allowed = {
        origins = ["*"]
        methods = ["GET", "PUT", "POST", "HEAD"]
        headers = ["*"]
      }
      expose_headers  = ["ETag"]
      max_age_seconds = 3600
    }
  ]
}
