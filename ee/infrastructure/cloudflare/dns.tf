# =============================================================================
# DNS Records for togather.nyc
# =============================================================================
#
# This file manages all DNS records for the togather.nyc domain.
# To add a new record, add a new resource block below.
#
# ARCHITECTURE:
# All web traffic flows through Cloudflare Workers (proxied = true):
#   1. DNS resolves to Cloudflare's edge network
#   2. Cloudflare Worker routes intercept ALL traffic
#   3. Worker handles bot detection and serves OG meta tags for social previews
#   4. Worker forwards requests to EAS Hosting for the actual app
#
# The CNAME targets below act as fallback origins but are typically not used
# since the Worker fetches from EAS Hosting directly.
#
# After making changes:
#   1. Run `terraform plan` to preview changes
#   2. Create a PR for review
#   3. On merge, GitHub Actions will run `terraform apply`
#
# =============================================================================

locals {
  zone_id = data.cloudflare_zone.togather.id
}

# -----------------------------------------------------------------------------
# Root Domain - Cloudflare Worker -> EAS Hosting
# -----------------------------------------------------------------------------
# Traffic is intercepted by Cloudflare Worker which:
#   - Detects bots and serves OG meta tags for social previews
#   - Forwards all other requests to EAS Hosting
# The CNAME target is a fallback origin (Worker fetches from EAS directly)

resource "cloudflare_record" "root" {
  zone_id         = local.zone_id
  name            = "@"
  type            = "CNAME"
  content         = "origin.expo.app"
  proxied         = true
  comment         = "Root domain - proxied through Cloudflare Worker -> EAS Hosting"
  allow_overwrite = true
}

# www redirect to root (also proxied through Worker)
resource "cloudflare_record" "www" {
  zone_id         = local.zone_id
  name            = "www"
  type            = "CNAME"
  content         = "origin.expo.app"
  proxied         = true
  comment         = "www subdomain - proxied through Cloudflare Worker"
  allow_overwrite = true
}

# -----------------------------------------------------------------------------
# Staging Subdomain - Cloudflare Worker -> EAS Hosting (Staging)
# -----------------------------------------------------------------------------
# Same architecture as production - Worker intercepts and routes to EAS
resource "cloudflare_record" "staging" {
  zone_id         = local.zone_id
  name            = "staging"
  type            = "CNAME"
  content         = "origin.expo.app"
  proxied         = true
  comment         = "Staging web app - proxied through Cloudflare Worker"
  allow_overwrite = true
}

# -----------------------------------------------------------------------------
# Images Subdomain - Cloudflare R2 + Image Transformations
# -----------------------------------------------------------------------------
# Note: This is typically configured as a custom domain on R2, not a DNS record.
# If needed as a CNAME, uncomment and configure.

# resource "cloudflare_record" "images" {
#   zone_id = local.zone_id
#   name    = "images"
#   type    = "CNAME"
#   content = "<r2-public-bucket-url>"
#   proxied = true
#   comment = "Image CDN - Cloudflare R2"
# }

# -----------------------------------------------------------------------------
# Wildcard Subdomain - Community Subdomains
# -----------------------------------------------------------------------------
# This allows *.togather.nyc to route through Cloudflare for community subdomains
# like fount.togather.nyc, demo-community.togather.nyc, etc.
# Worker routes handle these subdomains the same as the root domain.

resource "cloudflare_record" "wildcard" {
  zone_id         = local.zone_id
  name            = "*"
  type            = "CNAME"
  content         = "origin.expo.app"
  proxied         = true
  comment         = "Wildcard for community subdomains - proxied through Cloudflare Worker"
  allow_overwrite = true
}

# -----------------------------------------------------------------------------
# API Subdomain - Convex HTTP Actions (production: artful-echidna-883)
# -----------------------------------------------------------------------------
# Serves the routes in apps/convex/http.ts (public REST API /api/v1/*, webhooks,
# link-preview metadata) from a branded URL. The default
# artful-echidna-883.convex.site URL keeps working - this is purely additive.
#
# proxied MUST stay false (DNS only):
#   1. Convex provisions and serves the TLS certificate itself; a proxied
#      record breaks certificate issuance/verification.
#   2. The link-preview Worker has a *.togather.nyc/* route
#      (apps/link-preview/wrangler.toml). Proxying api.togather.nyc would send
#      every API request through that Worker, which would misroute it as a
#      community subdomain. DNS-only records bypass Workers entirely.
# This explicit record takes precedence over the proxied wildcard (*) above.

resource "cloudflare_record" "api" {
  zone_id         = local.zone_id
  name            = "api"
  type            = "CNAME"
  content         = "convex.domains"
  proxied         = false
  comment         = "Convex HTTP Actions custom domain (production) - must stay DNS-only"
  allow_overwrite = true
}

# Convex domain-ownership verification for api.togather.nyc
resource "cloudflare_record" "api_convex_verification" {
  zone_id         = local.zone_id
  name            = "_convex_domains.api"
  type            = "TXT"
  content         = "artful-echidna-883"
  comment         = "Convex custom domain verification for api.togather.nyc"
  allow_overwrite = true
}

# -----------------------------------------------------------------------------
# Email Records (if using Resend or other email service)
# -----------------------------------------------------------------------------
# Uncomment and configure if you have email sending set up

# SPF Record
# resource "cloudflare_record" "spf" {
#   zone_id = local.zone_id
#   name    = "@"
#   type    = "TXT"
#   content = "v=spf1 include:_spf.resend.com ~all"
#   comment = "SPF record for email sending"
# }

# DKIM Record (Resend)
# resource "cloudflare_record" "dkim" {
#   zone_id = local.zone_id
#   name    = "resend._domainkey"
#   type    = "TXT"
#   content = "<your-dkim-value>"
#   comment = "DKIM record for Resend email"
# }

# -----------------------------------------------------------------------------
# Verification Records (Apple, Google, etc.)
# -----------------------------------------------------------------------------
# Add any domain verification records here

# Example: Apple App Site Association
# resource "cloudflare_record" "apple_verification" {
#   zone_id = local.zone_id
#   name    = "@"
#   type    = "TXT"
#   content = "apple-domain-verification=..."
# }
