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
# 1b. Auto-merge switches (always set, with safe defaults)
# ---------------------------------------------------------------------------
# Unlike secrets, these are on/off config where "unset = off" is how an
# operator disables the feature. set_convex_env skips empty values, so routing
# them through the optional loop below would mean removing AUTO_MERGE_ENABLED
# from 1Password/GitHub does NOT clear a previously-synced "true" — auto-merge
# would keep running. Set them explicitly every sync so 1Password fully controls
# them: blank/remove the item to disable, set it to "true" to arm.
echo "Setting auto-merge switches..."
set_convex_env "AUTO_MERGE_ENABLED" "${AUTO_MERGE_ENABLED:-false}"
set_convex_env "AUTO_MERGE_METHOD" "${AUTO_MERGE_METHOD:-squash}"

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
  "TWILIO_SMS_NUMBER"
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
  "STRIPE_SECRET_KEY"
  "STRIPE_WEBHOOK_SECRET"
  "STRIPE_PRODUCT_ID"
  # Dev-assistant bot (@Togather pipeline). Optional — synced only when present.
  # Sourced from 1Password via sync-1password-to-github.sh (OPTIONAL_SECRETS),
  # then exported into the deploy env by .github/actions/load-secrets.
  "CLAUDE_ROUTINES_TRIGGER_URL"
  "CLAUDE_ROUTINES_TOKEN"
  "DEV_ASSISTANT_CALLBACK_SECRET"
  # Dev-assistant merge/deploy secrets. Read by Convex functions
  # (apps/convex/functions/devAssistant/actions.ts, apps/convex/http.ts), so
  # they MUST reach the Convex env — not just GitHub. Optional: missing items
  # are skipped (a token that transiently fails to load must not wipe the live
  # Convex value).
  #   GH_MIRROR_TOKEN   - PAT for in-app merge, auto-merge, and prod-deploy
  #                       dispatch (needs Issues + Contents + Actions r/w).
  #   GH_WEBHOOK_SECRET - HMAC secret for the inbound PR-closed webhook. Named
  #                       GH_*, not GITHUB_*, because GitHub reserves the
  #                       GITHUB_ secret-name prefix (`gh secret set GITHUB_*`
  #                       -> 422). Falls back to DEV_ASSISTANT_CALLBACK_SECRET.
  # The AUTO_MERGE_* switches are handled in section 1b (set explicitly, not
  # skipped) so removing the source item actually disables auto-merge.
  "GH_MIRROR_TOKEN"
  "GH_WEBHOOK_SECRET"
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
