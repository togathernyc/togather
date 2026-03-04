#!/bin/bash
# =============================================================================
# Togather Environment Setup Script (1Password)
# =============================================================================
# Fetches secrets from 1Password and generates .env files for local development.
#
# Prerequisites:
#   1. 1Password CLI: brew install 1password-cli
#   2. Sign in: op signin
#
# Usage:
#   ./scripts/setup-env.sh [environment]
#
# Environments:
#   dev (default)  - Local development
#   staging        - Staging environment
#   production     - Production (use with caution!)
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

    if ! command -v op &> /dev/null; then
        echo -e "${RED}Error: 1Password CLI not installed${NC}"
        echo ""
        echo "This script requires the 1Password CLI to fetch secrets."
        echo ""
        echo "Options:"
        echo "  1. Install 1Password CLI: brew install 1password-cli"
        echo "  2. Set up environment manually:"
        echo "     - Copy .env.example to .env.local and fill in values"
        echo "     - Create apps/mobile/.env with EXPO_PUBLIC_* variables"
        echo "     - Set Convex env vars via: npx convex env set KEY=value"
        echo "     - See docs/secrets.md for required variables"
        exit 1
    fi
    echo -e "  ${GREEN}✓${NC} 1Password CLI installed"

    if ! op account list &>/dev/null; then
        echo -e "${RED}Error: Not signed into 1Password${NC}"
        echo ""
        echo "Run: op signin"
        exit 1
    fi
    echo -e "  ${GREEN}✓${NC} Signed into 1Password"

    echo ""
}

# -----------------------------------------------------------------------------
# Generate .env files
# -----------------------------------------------------------------------------

generate_mobile_env() {
    echo -e "${YELLOW}Generating Mobile .env...${NC}"

    local mobile_env="${ROOT_DIR}/apps/mobile/.env"

    # EXPO_PUBLIC_* secrets to fetch from 1Password
    local EXPO_KEYS="EXPO_PUBLIC_MAPBOX_TOKEN EXPO_PUBLIC_CONVEX_URL EXPO_PUBLIC_SENTRY_DSN EXPO_PUBLIC_PROJECT_ID EXPO_PUBLIC_POSTHOG_API_KEY"

    > "$mobile_env"

    for key in $EXPO_KEYS; do
        local value
        value=$(op read "op://Togather/${key}/${ENV}" 2>/dev/null || true)
        if [ -n "$value" ]; then
            echo "${key}=${value}" >> "$mobile_env"
            echo -e "  ${GREEN}✓${NC} ${key}"
        else
            echo -e "  ${YELLOW}⚠${NC} ${key} (not found)"
        fi
    done

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

    # Set APP_ENV for dev environment
    echo -e "  Setting APP_ENV=development..."
    npx convex env set APP_ENV=development 2>/dev/null || true
    npx convex env set APP_URL=http://localhost:8081 2>/dev/null || true

    # Keys to sync to Convex
    local CONVEX_KEYS="JWT_SECRET EXPO_ACCESS_TOKEN RESEND_API_KEY TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_API_KEY_SID TWILIO_API_KEY_SECRET TWILIO_VERIFY_SERVICE_SID PLANNING_CENTER_CLIENT_ID PLANNING_CENTER_CLIENT_SECRET OTP_TEST_PHONE_NUMBERS CLOUDFLARE_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME R2_PUBLIC_URL"

    # Sync each key from 1Password
    local synced=0
    local skipped=0
    for key in $CONVEX_KEYS; do
        local value
        value=$(op read "op://Togather/${key}/${ENV}" 2>/dev/null || true)
        if [ -n "$value" ]; then
            echo -e "  Setting $key..."
            npx convex env set "$key=$value" 2>/dev/null || true
            ((synced++)) || true
        else
            ((skipped++)) || true
        fi
    done

    echo -e "  ${GREEN}✓${NC} Synced $synced variables to Convex ($skipped not found in 1Password)"
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
    echo "  dev         Development (default)"
    echo "  staging     Staging"
    echo "  production  Production"
    echo ""
    echo "Examples:"
    echo "  ./scripts/setup-env.sh             # Dev environment"
    echo "  ./scripts/setup-env.sh staging     # Staging environment"
    echo ""
    echo "Prerequisites:"
    echo "  1. Install 1Password CLI: brew install 1password-cli"
    echo "  2. Sign in: op signin"
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
