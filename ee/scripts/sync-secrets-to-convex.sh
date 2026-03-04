#!/bin/bash
# Sync secrets to Convex environment variables
#
# Expects secrets to be pre-loaded as environment variables:
#   - In CI: loaded by the 1Password GitHub Action
#   - Locally: use `op run` to inject secrets from 1Password
#
# Usage (CI - secrets loaded by 1Password action):
#   ./ee/scripts/sync-secrets-to-convex.sh [staging|production]
#
# Usage (local - with 1Password CLI):
#   op run --env-file=.env -- ./ee/scripts/sync-secrets-to-convex.sh staging
#
# Optional:
#   - CONVEX_DEPLOY_KEY (for CI, otherwise uses logged-in session)

set -e

# ---------------------------------------------------------------------------
# Parse environment argument
# ---------------------------------------------------------------------------
ENV="${1:-staging}"

if [ "$ENV" != "staging" ] && [ "$ENV" != "production" ]; then
  echo "Error: environment must be 'staging' or 'production' (got '$ENV')"
  echo "Usage: $0 [staging|production]"
  exit 1
fi

# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------
echo "========================================"
echo "  Syncing secrets to Convex"
echo "  Environment: $ENV"
echo "========================================"
echo ""

# ---------------------------------------------------------------------------
# Track sync results
# ---------------------------------------------------------------------------
SYNCED=0
SKIPPED=0

# Helper: set a Convex env var and update counters
set_convex_env() {
  local key="$1"
  local value="$2"

  if [ -n "$value" ]; then
    echo "  Setting $key..."
    npx convex env set "$key=$value"
    SYNCED=$((SYNCED + 1))
  else
    echo "  Skipping $key (not set in environment)"
    SKIPPED=$((SKIPPED + 1))
  fi
}

# ---------------------------------------------------------------------------
# 1. Set APP_ENV and APP_URL based on environment
# ---------------------------------------------------------------------------
echo "Setting app environment variables..."

if [ "$ENV" = "production" ]; then
  set_convex_env "APP_ENV" "production"
  set_convex_env "APP_URL" "https://togather.nyc"
else
  set_convex_env "APP_ENV" "staging"
  set_convex_env "APP_URL" "https://staging.togather.nyc"
fi

echo ""

# ---------------------------------------------------------------------------
# 2. Whitelist of secret keys to sync
# ---------------------------------------------------------------------------
SECRET_KEYS=(
  "JWT_SECRET"
  "EXPO_ACCESS_TOKEN"
  "RESEND_API_KEY"
  "TWILIO_ACCOUNT_SID"
  "TWILIO_AUTH_TOKEN"
  "TWILIO_API_KEY_SID"
  "TWILIO_API_KEY_SECRET"
  "TWILIO_VERIFY_SERVICE_SID"
  "PLANNING_CENTER_CLIENT_ID"
  "PLANNING_CENTER_CLIENT_SECRET"
  "OTP_TEST_PHONE_NUMBERS"
  "CLOUDFLARE_ACCOUNT_ID"
  "R2_ACCESS_KEY_ID"
  "R2_SECRET_ACCESS_KEY"
  "R2_BUCKET_NAME"
  "R2_PUBLIC_URL"
  "SLACK_BOT_TOKEN"
  "SLACK_SIGNING_SECRET"
  "OPENAI_SECRET_KEY"
)

# ---------------------------------------------------------------------------
# 3. Sync each secret from environment variables
# ---------------------------------------------------------------------------
echo "Syncing secrets..."

for KEY in "${SECRET_KEYS[@]}"; do
  VALUE="${!KEY}"
  set_convex_env "$KEY" "$VALUE"
done

echo ""

# ---------------------------------------------------------------------------
# 4. Summary
# ---------------------------------------------------------------------------
TOTAL=$((SYNCED + SKIPPED))
echo "========================================"
echo "  Sync complete!"
echo "  Synced:  $SYNCED / $TOTAL"
echo "  Skipped: $SKIPPED / $TOTAL"
echo "========================================"

if [ "$SKIPPED" -gt 0 ]; then
  echo ""
  echo "Warning: $SKIPPED keys were skipped because they were not set in the environment."
  echo "Make sure secrets are loaded before running this script."
fi
