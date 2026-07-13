#!/usr/bin/env bash
# Make the repo's Claude Code permission allowlist take effect on unattended
# runners (dev-assistant Routines / Claude Code on the web).
#
# Project-level permissions.allow rules in .claude/settings.json are gated
# behind the workspace-trust dialog, and non-interactive sessions never show
# that dialog — so on a fresh clone the allow rules are read but IGNORED,
# while deny rules always apply. See:
# https://code.claude.com/docs/en/permissions#project-allow-rules-and-workspace-trust
#
# Run this from the environment's setup script (after the clone exists). It
# makes the checked-in allowlist effective two independent ways:
#   1. copies it into user-level ~/.claude/settings.json, which is never
#      trust-gated;
#   2. pre-seeds workspace trust for the clone path, so the project settings
#      also apply as written.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node - "$REPO_ROOT" <<'EOF'
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = process.argv[2];
const repoSettings = JSON.parse(
  fs.readFileSync(path.join(repoRoot, '.claude', 'settings.json'), 'utf8'),
);
const allow = repoSettings.permissions?.allow ?? [];

const userSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
fs.mkdirSync(path.dirname(userSettingsPath), { recursive: true });
let userSettings = {};
try {
  userSettings = JSON.parse(fs.readFileSync(userSettingsPath, 'utf8'));
} catch {}
userSettings.permissions = userSettings.permissions ?? {};
userSettings.permissions.allow = [
  ...new Set([...(userSettings.permissions.allow ?? []), ...allow]),
];
fs.writeFileSync(userSettingsPath, JSON.stringify(userSettings, null, 2) + '\n');

const claudeJsonPath = path.join(os.homedir(), '.claude.json');
let claudeJson = {};
try {
  claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
} catch {}
claudeJson.projects = claudeJson.projects ?? {};
claudeJson.projects[repoRoot] = {
  ...(claudeJson.projects[repoRoot] ?? {}),
  hasTrustDialogAccepted: true,
};
fs.writeFileSync(claudeJsonPath, JSON.stringify(claudeJson, null, 2) + '\n');

console.log(
  `Applied ${allow.length} allow rules to ${userSettingsPath}; trusted ${repoRoot}`,
);
EOF
