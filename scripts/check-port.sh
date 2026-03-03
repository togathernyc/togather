#!/bin/bash

# Check if port 8000 is in use and kill it
PORT=8000

if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "⚠️  Port $PORT is already in use. Killing process..."
    # Get the process IDs
    PIDS=$(lsof -ti:$PORT 2>/dev/null)
    if [ ! -z "$PIDS" ]; then
        # Kill only Django/Python processes, not wait-on or other Node tools
        for PID in $PIDS; do
            # Get the full command line to check what process it is
            CMD=$(ps -p $PID -o command= 2>/dev/null)
            # Kill only Python/Django processes, skip Node processes (wait-on, etc.)
            if [[ "$CMD" == *"python"* ]] || [[ "$CMD" == *"manage.py"* ]]; then
                echo "   Killing Django process: $PID"
                kill -9 $PID 2>/dev/null
            elif [[ "$CMD" == *"node"* ]] || [[ "$CMD" == *"wait-on"* ]]; then
                echo "   Skipping Node process: $PID"
            else
                echo "   Killing unknown process: $PID"
                kill -9 $PID 2>/dev/null
            fi
        done
        sleep 1
    fi
    echo "✅ Port $PORT is now free"
fi

