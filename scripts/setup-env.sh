#!/bin/bash
# =============================================================================
# Togather Environment Setup Script (Infisical)
# =============================================================================
# Fetches secrets from Infisical and generates .env files for local development.
#
# Prerequisites:
#   1. Infisical CLI: brew install infisical/get-cli/infisical
#   2. Login: infisical login
#
# Usage:
#   ./scripts/setup-env.sh [environment]
#
# Environments:
#   dev (default)  - Local development
#   staging        - Staging environment
#   prod           - Production (use with caution!)
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Configuration
ENV="${1:-dev}"
if [ -z "$INFISICAL_WORKSPACE_ID" ]; then
    echo -e "${RED}Error: INFISICAL_WORKSPACE_ID is not set${NC}"
    echo ""
    echo "Set it in your shell profile or .env file:"
    echo "  export INFISICAL_WORKSPACE_ID=your-workspace-id"
    exit 1
fi
PROJECT_ID="$INFISICAL_WORKSPACE_ID"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Togather Environment Setup${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Project:     ${GREEN}togather${NC}"
echo -e "Environment: ${GREEN}${ENV}${NC}"
echo ""

# -----------------------------------------------------------------------------
# Check prerequisites
# -----------------------------------------------------------------------------

check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"

    if ! command -v infisical &> /dev/null; then
        echo -e "${RED}Error: Infisical CLI not installed${NC}"
        echo ""
        echo "Install with:"
        echo "  brew install infisical/get-cli/infisical"
        exit 1
    fi
    echo -e "  ${GREEN}✓${NC} Infisical CLI installed"

    if [ -z "$INFISICAL_TOKEN" ]; then
        if ! infisical user get token &>/dev/null; then
            echo -e "${RED}Error: Not logged into Infisical${NC}"
            echo ""
            echo "Run: infisical login"
            exit 1
        fi
        echo -e "  ${GREEN}✓${NC} Logged into Infisical"
    else
        echo -e "  ${GREEN}✓${NC} Using INFISICAL_TOKEN"
    fi

    echo ""
}

# -----------------------------------------------------------------------------
# Generate .env files
# -----------------------------------------------------------------------------

generate_mobile_env() {
    echo -e "${YELLOW}Generating Mobile .env...${NC}"

    local mobile_env="${ROOT_DIR}/apps/mobile/.env"

    # Export only EXPO_PUBLIC_* secrets for mobile
    infisical export \
        --projectId="$PROJECT_ID" \
        --env="$ENV" \
        --format=dotenv \
        | grep "^EXPO_PUBLIC_" > "$mobile_env" || true

    echo -e "  ${GREEN}✓${NC} Created ${mobile_env}"
}

# -----------------------------------------------------------------------------
# Sync environment variables to Convex
# -----------------------------------------------------------------------------

sync_convex_env() {
    local env_local="${ROOT_DIR}/.env.local"

    # Check if Convex deployment exists
    if [ ! -f "$env_local" ]; then
        echo -e "${YELLOW}Skipping Convex env sync (no deployment yet)${NC}"
        echo -e "  Run 'npx convex dev' first to create your deployment,"
        echo -e "  then run this script again to sync environment variables."
        return 0
    fi

    echo -e "${YELLOW}Syncing environment variables to Convex...${NC}"

    # Fetch all secrets from Infisical and save to temp file
    local secrets_file=$(mktemp)
    infisical export \
        --projectId="$PROJECT_ID" \
        --env="$ENV" \
        --format=dotenv > "$secrets_file"

    # Set APP_ENV for dev environment
    echo -e "  Setting APP_ENV=development..."
    npx convex env set APP_ENV=development 2>/dev/null || true
    npx convex env set APP_URL=http://localhost:8081 2>/dev/null || true

    # Keys to sync to Convex
    local CONVEX_KEYS="JWT_SECRET EXPO_ACCESS_TOKEN RESEND_API_KEY TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_API_KEY_SID TWILIO_API_KEY_SECRET TWILIO_VERIFY_SERVICE_SID AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_S3_BUCKET AWS_REGION AWS_S3_COMPRESSED_BUCKET_URL PLANNING_CENTER_CLIENT_ID PLANNING_CENTER_CLIENT_SECRET OTP_TEST_PHONE_NUMBERS CLOUDFLARE_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME R2_PUBLIC_URL"

    # Sync each key by grepping from secrets file
    local synced=0
    local skipped=0
    for key in $CONVEX_KEYS; do
        local line=$(grep "^${key}=" "$secrets_file" 2>/dev/null || true)
        if [ -n "$line" ]; then
            local value="${line#*=}"
            # Remove surrounding quotes
            value=$(echo "$value" | sed "s/^['\"]//;s/['\"]$//")
            echo -e "  Setting $key..."
            npx convex env set "$key=$value" 2>/dev/null || true
            ((synced++)) || true
        else
            ((skipped++)) || true
        fi
    done

    rm -f "$secrets_file"
    echo -e "  ${GREEN}✓${NC} Synced $synced variables to Convex ($skipped not found in Infisical)"
}

# -----------------------------------------------------------------------------
# Print next steps
# -----------------------------------------------------------------------------

print_next_steps() {
    local env_local="${ROOT_DIR}/.env.local"

    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  Setup Complete!${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    if [ ! -f "$env_local" ]; then
        echo "Next steps (first-time setup):"
        echo ""
        echo "  1. Create your personal Convex deployment:"
        echo "     npx convex dev"
        echo ""
        echo "  2. Run this script again to sync env vars to Convex:"
        echo "     ./scripts/setup-env.sh"
        echo ""
        echo "  3. Seed test data (in a new terminal):"
        echo "     npx convex run functions/seed:seedDemoData"
        echo ""
        echo "  4. Start development servers:"
        echo "     pnpm dev"
        echo ""
    else
        echo "Next steps:"
        echo ""
        echo "  1. Start development servers:"
        echo "     pnpm dev"
        echo ""
    fi

    echo "  Login with:"
    echo "     Phone: 2025550123"
    echo "     Code:  000000"
    echo ""
}

# -----------------------------------------------------------------------------
# Help
# -----------------------------------------------------------------------------

print_help() {
    echo "Usage: ./scripts/setup-env.sh [environment]"
    echo ""
    echo "Environments:"
    echo "  dev      Development (default)"
    echo "  staging  Staging"
    echo "  prod     Production"
    echo ""
    echo "Examples:"
    echo "  ./scripts/setup-env.sh          # Dev environment"
    echo "  ./scripts/setup-env.sh staging  # Staging environment"
    echo ""
    echo "Environment Variables:"
    echo "  INFISICAL_TOKEN  Machine identity token (for CI/CD)"
    echo ""
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

main() {
    case "${1:-}" in
        help|--help|-h)
            print_help
            ;;
        *)
            check_prerequisites
            generate_mobile_env
            sync_convex_env
            print_next_steps
            ;;
    esac
}

main "$@"
