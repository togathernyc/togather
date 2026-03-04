#!/bin/bash
# Setup branch protection rules for Togather repository
# Run this after setting up a new repo or to reset protection rules
#
# Prerequisites:
#   - GitHub CLI installed: brew install gh
#   - Authenticated: gh auth login
#
# Usage:
#   ./scripts/setup-branch-protection.sh

set -e

# Get repo info
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "Setting up branch protection for: $REPO"

# Check if user has admin access
echo ""
echo "Checking permissions..."
PERMISSION=$(gh api "repos/$REPO" --jq '.permissions.admin')
if [ "$PERMISSION" != "true" ]; then
  echo "❌ You need admin access to set branch protection rules"
  exit 1
fi
echo "✅ Admin access confirmed"

echo ""
echo "================================================"
echo "Setting up protection for 'main' branch..."
echo "================================================"

gh api "repos/$REPO/branches/main/protection" \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["test-api","test-mobile","lint"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews='{"required_approving_review_count":1,"dismiss_stale_reviews":true,"require_code_owner_reviews":true}' \
  --field restrictions=null \
  --field required_linear_history=false \
  --field allow_force_pushes=false \
  --field allow_deletions=false \
  --field required_conversation_resolution=true \
  --silent

echo "✅ Main branch protected"

echo ""
echo "================================================"
echo "Setting up protection for 'staging' branch..."
echo "================================================"

gh api "repos/$REPO/branches/staging/protection" \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["test-api","test-mobile","lint"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews='{"required_approving_review_count":0,"dismiss_stale_reviews":false,"require_code_owner_reviews":false}' \
  --field restrictions=null \
  --field required_linear_history=false \
  --field allow_force_pushes=false \
  --field allow_deletions=false \
  --field required_conversation_resolution=false \
  --silent

echo "✅ Staging branch protected"

echo ""
echo "================================================"
echo "Branch protection setup complete!"
echo "================================================"
echo ""
echo "Main branch rules:"
echo "  - Requires pull request with 1 approval"
echo "  - Requires status checks to pass"
echo "  - Requires code owner review"
echo "  - Dismisses stale reviews on new commits"
echo "  - Requires conversation resolution"
echo ""
echo "Staging branch rules:"
echo "  - Requires pull request (no approval required)"
echo "  - Requires status checks to pass"
echo ""
echo "To view or modify rules, go to:"
echo "  https://github.com/$REPO/settings/branches"
