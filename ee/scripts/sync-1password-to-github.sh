#!/bin/bash
# Sync secrets from 1Password to GitHub environment-scoped secrets
#
# Prerequisites:
#   - 1Password CLI (`op`) authenticated (or OP_SERVICE_ACCOUNT_TOKEN set)
#   - GitHub CLI (`gh`) authenticated with repo admin access
#
# Usage:
#   ./ee/scripts/sync-1password-to-github.sh --environment staging
#   ./ee/scripts/sync-1password-to-github.sh --environment production
#   ./ee/scripts/sync-1password-to-github.sh --all
#   ./ee/scripts/sync-1password-to-github.sh --all --dry-run

set -e

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
ENVIRONMENT=""
DRY_RUN=false
SYNC_ALL=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --environment|-e)
      ENVIRONMENT="$2"
      shift 2
      ;;
    --all)
      SYNC_ALL=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 --environment <staging|production> [--dry-run]"
      echo "       $0 --all [--dry-run]"
      echo ""
      echo "Syncs secrets from 1Password vault 'Togather' to GitHub environment secrets."
      echo ""
      echo "Options:"
      echo "  --environment, -e   Target environment (staging or production)"
      echo "  --all               Sync both staging and production"
      echo "  --dry-run           Show what would be synced without making changes"
      echo "  -h, --help          Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [ "$SYNC_ALL" = true ]; then
  ENVIRONMENTS=("staging" "production")
elif [ -n "$ENVIRONMENT" ]; then
  if [ "$ENVIRONMENT" != "staging" ] && [ "$ENVIRONMENT" != "production" ]; then
    echo "Error: environment must be 'staging' or 'production' (got '$ENVIRONMENT')"
    exit 1
  fi
  ENVIRONMENTS=("$ENVIRONMENT")
else
  echo "Error: specify --environment <staging|production> or --all"
  echo "Run with --help for usage"
  exit 1
fi

# ---------------------------------------------------------------------------
# Detect repo from git remote
# ---------------------------------------------------------------------------
REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null)
if [ -z "$REPO" ]; then
  echo "Error: could not detect GitHub repo. Make sure you're in the repo directory and gh is authenticated."
  exit 1
fi

# ---------------------------------------------------------------------------
# Verify prerequisites
# ---------------------------------------------------------------------------
if ! command -v op &> /dev/null; then
  echo "Error: 1Password CLI (op) is not installed."
  echo "Install: https://developer.1password.com/docs/cli/get-started/"
  exit 1
fi

if ! command -v gh &> /dev/null; then
  echo "Error: GitHub CLI (gh) is not installed."
  echo "Install: https://cli.github.com/"
  exit 1
fi

# Verify 1Password auth
if ! op account list &> /dev/null; then
  echo "Error: 1Password CLI is not authenticated."
  echo "Run: op signin"
  exit 1
fi

# Verify GitHub auth
if ! gh auth status &> /dev/null; then
  echo "Error: GitHub CLI is not authenticated."
  echo "Run: gh auth login"
  exit 1
fi

# ---------------------------------------------------------------------------
# Secret definitions
# ---------------------------------------------------------------------------
# These match the secrets previously loaded by load-secrets/action.yml
COMMON_SECRETS=(
  "CONVEX_DEPLOY_KEY"
  "JWT_SECRET"
  "RESEND_API_KEY"
  "TWILIO_ACCOUNT_SID"
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
  "EXPO_TOKEN"
  "EAS_PROJECT_ID"
  "CONVEX_SITE_URL"
)

OPTIONAL_SECRETS=(
  "CLOUDFLARE_API_TOKEN"
  "TF_API_TOKEN"
  "SENTRY_AUTH_TOKEN"
  "EXPO_PUBLIC_MAPBOX_TOKEN"
  "EXPO_PUBLIC_SENTRY_DSN"
  "EXPO_PUBLIC_POSTHOG_API_KEY"
)

# ---------------------------------------------------------------------------
# Sync function
# ---------------------------------------------------------------------------
sync_environment() {
  local env="$1"
  local synced=0
  local skipped=0
  local failed=0

  echo ""
  echo "========================================"
  echo "  Syncing secrets to GitHub"
  echo "  1Password: op://Togather/*/$env"
  echo "  GitHub:    $REPO (environment: $env)"
  if [ "$DRY_RUN" = true ]; then
    echo "  Mode:      DRY RUN"
  fi
  echo "========================================"
  echo ""

  # Sync common secrets
  echo "Common secrets:"
  for KEY in "${COMMON_SECRETS[@]}"; do
    VALUE=$(op read "op://Togather/$KEY/$env" 2>/dev/null || true)
    if [ -n "$VALUE" ]; then
      if [ "$DRY_RUN" = true ]; then
        echo "  [dry-run] Would set $KEY"
      else
        echo -n "  Setting $KEY..."
        if printf '%s' "$VALUE" | gh secret set "$KEY" --env "$env" --repo "$REPO" --body -; then
          echo " done"
        else
          echo " FAILED"
          failed=$((failed + 1))
          continue
        fi
      fi
      synced=$((synced + 1))
    else
      echo "  Skipping $KEY (not found in 1Password)"
      skipped=$((skipped + 1))
    fi
  done

  echo ""

  # Sync optional secrets
  echo "Optional secrets:"
  for KEY in "${OPTIONAL_SECRETS[@]}"; do
    VALUE=$(op read "op://Togather/$KEY/$env" 2>/dev/null || true)
    if [ -n "$VALUE" ]; then
      if [ "$DRY_RUN" = true ]; then
        echo "  [dry-run] Would set $KEY"
      else
        echo -n "  Setting $KEY..."
        if printf '%s' "$VALUE" | gh secret set "$KEY" --env "$env" --repo "$REPO" --body -; then
          echo " done"
        else
          echo " FAILED"
          failed=$((failed + 1))
          continue
        fi
      fi
      synced=$((synced + 1))
    else
      echo "  Skipping $KEY (not found in 1Password)"
      skipped=$((skipped + 1))
    fi
  done

  echo ""

  # Handle IMAGE_CDN_URL alias (same value as R2_PUBLIC_URL)
  R2_URL=$(op read "op://Togather/R2_PUBLIC_URL/$env" 2>/dev/null || true)
  if [ -n "$R2_URL" ]; then
    if [ "$DRY_RUN" = true ]; then
      echo "  [dry-run] Would set IMAGE_CDN_URL (alias for R2_PUBLIC_URL)"
      synced=$((synced + 1))
    else
      echo -n "  Setting IMAGE_CDN_URL (alias for R2_PUBLIC_URL)..."
      if printf '%s' "$R2_URL" | gh secret set "IMAGE_CDN_URL" --env "$env" --repo "$REPO" --body -; then
        echo " done"
        synced=$((synced + 1))
      else
        echo " FAILED"
        failed=$((failed + 1))
      fi
    fi
  fi

  echo ""

  # Summary
  local total=$((synced + skipped + failed))
  echo "========================================"
  echo "  $env sync complete!"
  echo "  Synced:  $synced / $total"
  echo "  Skipped: $skipped / $total"
  if [ "$failed" -gt 0 ]; then
    echo "  Failed:  $failed / $total"
  fi
  echo "========================================"

  if [ "$failed" -gt 0 ]; then
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Run sync for each environment
# ---------------------------------------------------------------------------
EXIT_CODE=0

for ENV in "${ENVIRONMENTS[@]}"; do
  if ! sync_environment "$ENV"; then
    EXIT_CODE=1
  fi
done

exit $EXIT_CODE
