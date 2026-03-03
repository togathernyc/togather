#!/bin/bash

# Kill any Expo processes on a specified port (default: 8081)
# Usage: ./kill-expo.sh [port]
# Examples:
#   ./kill-expo.sh       # Kill process on port 8081
#   ./kill-expo.sh 19001 # Kill process on port 19001 (worker 1)
#   ./kill-expo.sh 19002 # Kill process on port 19002 (worker 2)

PORT=${1:-8081}

PIDS=$(lsof -Pi :$PORT -sTCP:LISTEN -t 2>/dev/null)
if [ -n "$PIDS" ]; then
    echo "⚠️  Port $PORT (Metro) is already in use. Killing process..."
    echo "$PIDS" | xargs kill -9 2>/dev/null
    sleep 1

    # Check if process is still running (stuck in uninterruptible state)
    STILL_RUNNING=$(lsof -Pi :$PORT -sTCP:LISTEN -t 2>/dev/null)
    if [ -n "$STILL_RUNNING" ]; then
        echo "⚠️  Process stuck. Close browser tabs to localhost:$PORT or restart your machine."
    else
        echo "✅ Port $PORT is now free"
    fi
fi

