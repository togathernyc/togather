#!/bin/bash

# Test script to verify setup.sh works without running the full setup
# This is a dry-run verification

set -e

echo "🔍 Verifying setup.sh script..."
echo ""

# Check script exists and is executable
if [ ! -f "scripts/setup.sh" ]; then
    echo "❌ scripts/setup.sh not found"
    exit 1
fi

if [ ! -x "scripts/setup.sh" ]; then
    echo "❌ scripts/setup.sh is not executable"
    exit 1
fi

echo "✅ Script exists and is executable"

# Check syntax
if bash -n scripts/setup.sh 2>/dev/null; then
    echo "✅ Bash syntax is valid"
else
    echo "❌ Bash syntax errors found"
    exit 1
fi

# Check for key functions
if grep -q "get_random_secret_key" scripts/setup.sh; then
    echo "✅ SECRET_KEY generation found"
else
    echo "❌ SECRET_KEY generation not found"
    exit 1
fi

if grep -q "read -p" scripts/setup.sh; then
    echo "✅ Interactive prompts found"
else
    echo "❌ Interactive prompts not found"
    exit 1
fi

if grep -q ".env" scripts/setup.sh; then
    echo "✅ .env file handling found"
else
    echo "❌ .env file handling not found"
    exit 1
fi

# Check package.json script
if grep -q '"setup":' package.json; then
    echo "✅ package.json setup script found"
else
    echo "❌ package.json setup script not found"
    exit 1
fi

echo ""
echo "✅ All checks passed! Setup script is ready."
echo ""
echo "To run the setup:"
echo "  pnpm run setup"
echo ""

