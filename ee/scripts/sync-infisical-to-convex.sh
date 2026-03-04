#!/bin/bash
# Sync secrets to Convex environment variables
#
# Usage (CI - secrets already loaded via load-secrets action):
#   ./scripts/sync-infisical-to-convex.sh [staging|prod]
#
# Usage (local - with Infisical credentials):
#   INFISICAL_CLIENT_ID=xxx INFISICAL_CLIENT_SECRET=xxx ./scripts/sync-infisical-to-convex.sh [staging|prod]
#
# Optional:
#   - CONVEX_DEPLOY_KEY (for CI, otherwise uses logged-in session)

set -e

ENV=${1:-staging}
if [ -z "$INFISICAL_WORKSPACE_ID" ]; then
  echo "Error: INFISICAL_WORKSPACE_ID is not set. Export it before running this script."
  exit 1
fi
PROJECT_ID="$INFISICAL_WORKSPACE_ID"

echo "Syncing secrets to Convex ($ENV environment)..."

# In CI (GitHub Actions), secrets are pre-loaded by the load-secrets action
# For local development, fetch from Infisical
if [ -n "$GITHUB_ACTIONS" ]; then
  echo "Running in CI - using pre-loaded secrets from environment"
else
  echo "Running locally - fetching secrets from Infisical..."

  if [ -z "$INFISICAL_CLIENT_ID" ] || [ -z "$INFISICAL_CLIENT_SECRET" ]; then
    echo "Error: INFISICAL_CLIENT_ID and INFISICAL_CLIENT_SECRET are required for local development"
    exit 1
  fi

  # Login to Infisical
  export INFISICAL_TOKEN=$(infisical login \
    --method=universal-auth \
    --client-id="$INFISICAL_CLIENT_ID" \
    --client-secret="$INFISICAL_CLIENT_SECRET" \
    --silent \
    --plain)

  # Fetch secrets as dotenv format and safely export each one
  # Avoid eval for security - parse line by line instead
  SECRETS=$(infisical export \
    --token="$INFISICAL_TOKEN" \
    --projectId="$PROJECT_ID" \
    --env="$ENV" \
    --format=dotenv)

  while IFS= read -r line; do
    # Skip empty lines and comments
    [[ -z "$line" || "$line" =~ ^# ]] && continue
    # Extract key and value
    key="${line%%=*}"
    value="${line#*=}"
    # Remove surrounding quotes from value
    value=$(echo "$value" | sed "s/^['\"]//;s/['\"]$//")
    # Export to environment
    export "$key=$value"
  done <<< "$SECRETS"
fi

# Keys to sync to Convex (add/remove as needed)
CONVEX_KEYS=(
  "JWT_SECRET"
  "EXPO_ACCESS_TOKEN"
  "RESEND_API_KEY"
  "TWILIO_ACCOUNT_SID"
  "TWILIO_AUTH_TOKEN"
  "TWILIO_API_KEY_SID"
  "TWILIO_API_KEY_SECRET"
  "TWILIO_VERIFY_SERVICE_SID"
  "AWS_ACCESS_KEY_ID"
  "AWS_SECRET_ACCESS_KEY"
  "AWS_S3_BUCKET"
  "AWS_REGION"
  "AWS_S3_COMPRESSED_BUCKET_URL"
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

# Set APP_ENV based on environment
if [ "$ENV" = "prod" ]; then
  npx convex env set APP_ENV=production
  npx convex env set APP_URL=https://togather.nyc
else
  npx convex env set APP_ENV=staging
  npx convex env set APP_URL=https://staging.togather.nyc
fi

# Sync each key from environment
for KEY in "${CONVEX_KEYS[@]}"; do
  # Get value from environment variable
  VALUE="${!KEY}"

  if [ -n "$VALUE" ]; then
    echo "Setting $KEY..."
    npx convex env set "$KEY=$VALUE"
  else
    echo "Warning: $KEY not found in environment"
  fi
done

echo "Done! Synced secrets to Convex."
