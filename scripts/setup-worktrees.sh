#!/usr/bin/env bash
# Creates or resets git worktrees for Paperclip agents.

set -e

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

# Ensure we're in the main branch
git checkout main
git pull || true

# Create worktrees directory if it doesn't exist
mkdir -p worktrees

for slot in 1 2 3 4; do
  WORKTREE_DIR="worktrees/agent-$slot"
  BRANCH="agent-$slot-dev"

  echo "Setting up slot $slot ($WORKTREE_DIR) with branch $BRANCH..."

  if [ ! -d "$WORKTREE_DIR" ]; then
    # Create the branch if it doesn't exist
    if ! git show-ref --verify --quiet "refs/heads/$BRANCH"; then
      git branch "$BRANCH" main
    fi
    git worktree add "$WORKTREE_DIR" "$BRANCH"
  else
    echo "Worktree $WORKTREE_DIR already exists."
  fi

  # Copy environment
  if [ -f .env.local ]; then
    cp .env.local "$WORKTREE_DIR/.env.local"
  fi
  
  # Install dependencies in the worktree
  (cd "$WORKTREE_DIR" && pnpm install)
  
  echo "Setup for slot $slot complete."
done

echo "All worktrees created in ./worktrees/"