#!/bin/bash

# Simplified setup for users who just want to get started fast
# This is a wrapper around the main setup script

echo "🚀 Quick Setup"
echo "=============="
echo ""
echo "This will install all dependencies and configure the project."
echo "Press Ctrl+C to cancel, or wait 3 seconds..."
sleep 3

exec ./scripts/setup.sh

