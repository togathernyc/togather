#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ALLOWED_BACKENDS_PATH = path.join(__dirname, '..', 'config', 'allowed-backends.json');

function loadAllowedBackends() {
  if (!fs.existsSync(ALLOWED_BACKENDS_PATH)) {
    console.error('❌ Missing backend config: config/allowed-backends.json');
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(ALLOWED_BACKENDS_PATH, 'utf-8'));
  } catch (error) {
    console.error(`❌ Failed to parse backend config: ${error.message}`);
    process.exit(1);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error('❌ Backend config must be an object keyed by backend name.');
    process.exit(1);
  }

  return parsed;
}

function parseBackendFromArgs(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--backend=')) {
      return arg.split('=')[1].trim();
    }
    if (arg === '--backend') {
      const value = argv[i + 1];
      return value ? value.trim() : '';
    }
  }
  return null;
}

function stripBackendArgs(argv) {
  const filtered = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--backend=')) {
      continue;
    }
    if (arg === '--backend') {
      i += 1;
      continue;
    }
    filtered.push(arg);
  }
  return filtered;
}

function allowedBackendLines(names) {
  return names.map(name => `   - ${name}`).join('\n');
}

function failMissingSelection(allowedNames) {
  console.error('');
  console.error('❌ Missing required backend selection.');
  console.error('');
  console.error('Allowed backends:');
  console.error(allowedBackendLines(allowedNames));
  console.error('');
  console.error(`Ask the user: "Which backend should I use: ${allowedNames.join(', ')}?"`);
  console.error('Then rerun: pnpm dev:backend --backend=<choice>');
  console.error('');
  process.exit(1);
}

function failUnknownBackend(selectedBackend, allowedNames) {
  console.error('');
  console.error(`❌ Unknown backend "${selectedBackend}".`);
  console.error('');
  console.error('Allowed backends:');
  console.error(allowedBackendLines(allowedNames));
  console.error('');
  console.error('Ask the user which backend to use, then rerun with pnpm dev:backend --backend=<choice>.');
  console.error('');
  process.exit(1);
}

function failMismatch(variableName, actualValue, expectedValue, backendName) {
  console.error('');
  console.error(`❌ ${variableName} does not match backend "${backendName}".`);
  console.error(`   Expected: ${expectedValue}`);
  console.error(`   Actual:   ${actualValue}`);
  console.error('');
  console.error('Clear conflicting environment values and rerun:');
  console.error(`pnpm dev:backend --backend=${backendName}`);
  console.error('');
  process.exit(1);
}

function main() {
  const allowedBackends = loadAllowedBackends();
  const allowedNames = Object.keys(allowedBackends);
  const args = process.argv.slice(2);
  const selectedBackend = parseBackendFromArgs(args) || process.env.BACKEND_AGENT;

  if (!selectedBackend) {
    failMissingSelection(allowedNames);
  }

  const selectedConfig = allowedBackends[selectedBackend];
  if (!selectedConfig) {
    failUnknownBackend(selectedBackend, allowedNames);
  }

  const expectedDeployment = selectedConfig.CONVEX_DEPLOYMENT;
  const expectedUrl = selectedConfig.EXPO_PUBLIC_CONVEX_URL;

  if (process.env.EXPO_PUBLIC_CONVEX_URL && process.env.EXPO_PUBLIC_CONVEX_URL !== expectedUrl) {
    failMismatch('EXPO_PUBLIC_CONVEX_URL', process.env.EXPO_PUBLIC_CONVEX_URL, expectedUrl, selectedBackend);
  }

  const forwardedArgs = stripBackendArgs(args);
  const child = spawn(
    process.execPath,
    [path.join(__dirname, 'dev.js'), `--backend=${selectedBackend}`, ...forwardedArgs],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        BACKEND_AGENT: selectedBackend,
        CONVEX_DEPLOYMENT: expectedDeployment,
        EXPO_PUBLIC_CONVEX_URL: expectedUrl,
      },
    }
  );

  child.on('error', (error) => {
    console.error(`❌ Failed to start dev flow: ${error.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

main();
