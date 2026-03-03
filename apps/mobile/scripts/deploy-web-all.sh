#!/bin/bash
# Deploy web app and update all subdomain aliases to the same deployment
#
# Usage: ./scripts/deploy-web-all.sh [--prod]

set -e

# Get domain config from shared package
BASE_DOMAIN=$(node -e "const { DOMAIN_CONFIG } = require('../../../packages/shared/src/config/domain.js'); console.log(DOMAIN_CONFIG.baseDomain);")

# Community subdomain aliases to update
ALIASES=("fount" "demo-community")

# Check for --prod flag
PROD_FLAG=""
if [[ "$1" == "--prod" ]]; then
  PROD_FLAG="--prod"
  echo "🚀 Deploying to PRODUCTION..."
else
  echo "🧪 Deploying preview (use --prod for production)..."
fi

# Build and deploy
echo "📦 Building and deploying web app..."
npx expo export --platform web --clear

# Deploy and capture the deployment ID
DEPLOY_OUTPUT=$(npx eas-cli deploy $PROD_FLAG --json --non-interactive 2>&1)
DEPLOYMENT_ID=$(echo "$DEPLOY_OUTPUT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$DEPLOYMENT_ID" ]; then
  echo "❌ Failed to get deployment ID"
  echo "Output: $DEPLOY_OUTPUT"
  exit 1
fi

echo "✅ Deployed with ID: $DEPLOYMENT_ID"

# Update all aliases to point to the same deployment
echo ""
echo "🔗 Updating subdomain aliases..."
for ALIAS in "${ALIASES[@]}"; do
  echo "   Updating alias: $ALIAS"
  npx eas-cli deploy:alias --alias "$ALIAS" --id "$DEPLOYMENT_ID" --non-interactive
done

echo ""
echo "🎉 All deployments updated!"
echo ""
echo "URLs:"
echo "   Production: https://togather.expo.app"
for ALIAS in "${ALIASES[@]}"; do
  echo "   $ALIAS: https://$ALIAS.$BASE_DOMAIN"
done
