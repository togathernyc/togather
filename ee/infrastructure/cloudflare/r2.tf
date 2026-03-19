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
# Uses the Cloudflare REST API directly because cloudflare_r2_bucket_cors
# requires provider v5+ and we're on v4.x. Can be migrated to the native
# resource when the provider is upgraded.
#
# This is idempotent — re-running replaces the CORS policy with the same rules.
# =============================================================================

resource "terraform_data" "r2_cors" {
  # Re-run if the CORS config changes
  input = jsonencode([
    {
      AllowedOrigins = ["*"]
      AllowedMethods = ["GET", "PUT", "POST", "HEAD"]
      AllowedHeaders = ["*"]
      ExposeHeaders  = ["ETag"]
      MaxAgeSeconds  = 3600
    }
  ])

  provisioner "local-exec" {
    command = <<-EOT
      curl -sf -X PUT \
        "https://api.cloudflare.com/client/v4/accounts/${var.cloudflare_account_id}/r2/buckets/togather-images/cors" \
        -H "Authorization: Bearer ${var.cloudflare_api_token}" \
        -H "Content-Type: application/json" \
        -d '${self.input}'
    EOT
  }
}
