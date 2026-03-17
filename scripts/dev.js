#!/usr/bin/env node

/**
 * Development script for Convex + Expo
 *
 * Usage:
 *   pnpm dev              # Run Convex dev + Expo together
 *   pnpm dev --mobile     # Run only Expo (if Convex is already running)
 *   pnpm dev --convex     # Run only Convex dev
 *   pnpm dev --agent=N    # Use worker N's Metro port (19000+N) for parallel development
 *   pnpm dev --backend=<name> # Explicit backend selection (required in Cursor agent mode)
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ALLOWED_BACKENDS_PATH = path.join(__dirname, '..', 'config', 'allowed-backends.json');
let allowedBackendsCache = null;

function loadAllowedBackends() {
  if (allowedBackendsCache) {
    return allowedBackendsCache;
  }

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

  allowedBackendsCache = parsed;
  return allowedBackendsCache;
}

function getAllowedBackendNames() {
  return Object.keys(loadAllowedBackends());
}

function parseBackendFromArgs() {
  for (let i = 0; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg.startsWith('--backend=')) {
      return arg.split('=')[1].trim();
    }
    if (arg === '--backend') {
      const next = process.argv[i + 1];
      return next ? next.trim() : '';
    }
  }
  return null;
}

function getSelectedBackend() {
  return parseBackendFromArgs() || process.env.BACKEND_AGENT || null;
}

function isAgentCloudContext() {
  return (
    process.env.CURSOR_AGENT === '1' ||
    process.env.CURSOR_AGENT === 'true' ||
    Boolean(process.env.CLOUD_AGENT_INJECTED_SECRET_NAMES) ||
    Boolean(process.env.CLOUD_AGENT_ALL_SECRET_NAMES)
  );
}

function formatAllowedBackends() {
  return getAllowedBackendNames().map(name => `   - ${name}`).join('\n');
}

function enforceAgentBackendSelection(env) {
  if (!isAgentCloudContext()) {
    return null;
  }

  const selectedBackend = getSelectedBackend();
  const allowedBackends = loadAllowedBackends();
  const selectedConfig = selectedBackend ? allowedBackends[selectedBackend] : null;

  if (!selectedBackend) {
    console.error('');
    console.error('❌ Explicit backend selection is required in Cursor agent mode.');
    console.error('');
    console.error('Allowed backends:');
    console.error(formatAllowedBackends());
    console.error('');
    console.error(`Ask the user: "Which backend should I use: ${getAllowedBackendNames().join(', ')}?"`);
    console.error('Then rerun: pnpm dev:backend --backend=<choice>');
    console.error('');
    process.exit(1);
  }

  if (!selectedConfig) {
    console.error('');
    console.error(`❌ Unknown backend "${selectedBackend}" in agent mode.`);
    console.error('');
    console.error('Allowed backends:');
    console.error(formatAllowedBackends());
    console.error('');
    process.exit(1);
  }

  if (
    env.EXPO_PUBLIC_CONVEX_URL &&
    env.EXPO_PUBLIC_CONVEX_URL !== selectedConfig.EXPO_PUBLIC_CONVEX_URL
  ) {
    console.error('');
    console.error(`❌ EXPO_PUBLIC_CONVEX_URL mismatch for backend "${selectedBackend}".`);
    console.error(`   Expected: ${selectedConfig.EXPO_PUBLIC_CONVEX_URL}`);
    console.error(`   Actual:   ${env.EXPO_PUBLIC_CONVEX_URL}`);
    console.error('');
    console.error(`Run: pnpm dev:backend --backend=${selectedBackend}`);
    console.error('');
    process.exit(1);
  }

  env.BACKEND_AGENT = selectedBackend;
  env.CONVEX_DEPLOYMENT = selectedConfig.CONVEX_DEPLOYMENT;
  env.EXPO_PUBLIC_CONVEX_URL = selectedConfig.EXPO_PUBLIC_CONVEX_URL;
  console.log(`🔒 Backend locked: ${selectedBackend}`);
  return selectedBackend;
}

/**
 * Check if dependencies need to be installed by comparing lockfile hash
 * @returns {boolean} True if pnpm install should be run
 */
function needsInstall() {
  const lockfilePath = path.join(__dirname, '..', 'pnpm-lock.yaml');
  const hashMarkerPath = path.join(__dirname, '..', 'node_modules', '.pnpm-lock-hash');

  // If node_modules doesn't exist, definitely need install
  if (!fs.existsSync(path.join(__dirname, '..', 'node_modules'))) {
    return true;
  }

  // If lockfile doesn't exist, skip check
  if (!fs.existsSync(lockfilePath)) {
    return false;
  }

  // Get current lockfile hash (use mtime + size for speed, not full content hash)
  const stats = fs.statSync(lockfilePath);
  const currentHash = `${stats.mtimeMs}-${stats.size}`;

  // Check stored hash
  if (!fs.existsSync(hashMarkerPath)) {
    return true;
  }

  const storedHash = fs.readFileSync(hashMarkerPath, 'utf-8').trim();
  return currentHash !== storedHash;
}

/**
 * Update the stored lockfile hash marker
 */
function updateLockfileHash() {
  const lockfilePath = path.join(__dirname, '..', 'pnpm-lock.yaml');
  const hashMarkerPath = path.join(__dirname, '..', 'node_modules', '.pnpm-lock-hash');

  if (!fs.existsSync(lockfilePath)) {
    return;
  }

  const stats = fs.statSync(lockfilePath);
  const currentHash = `${stats.mtimeMs}-${stats.size}`;

  fs.writeFileSync(hashMarkerPath, currentHash);
}

/**
 * Run pnpm install if lockfile has changed
 */
function ensureDependencies() {
  if (!needsInstall()) {
    return;
  }

  console.log('📦 Lockfile changed - installing dependencies...');
  try {
    execSync('pnpm install', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
    updateLockfileHash();
    console.log('✅ Dependencies installed\n');
  } catch (e) {
    console.error('❌ Failed to install dependencies');
    process.exit(1);
  }
}

/**
 * Parse --agent=N argument
 * @returns {number} Agent number (0 for default, 1-4 for workers)
 */
function getAgentNumber() {
  const agentArg = process.argv.find(arg => arg.startsWith('--agent='));
  if (!agentArg) return 0;

  const agentNum = parseInt(agentArg.split('=')[1], 10);
  if (isNaN(agentNum) || agentNum < 1 || agentNum > 4) {
    console.error('❌ Invalid --agent value. Must be 1-4');
    process.exit(1);
  }
  return agentNum;
}

/**
 * Get Metro port for an agent
 * @param {number} agentNum - Agent number (0 for default, 1-4 for workers)
 * @returns {number}
 */
function getMetroPort(agentNum) {
  if (agentNum === 0) {
    return 8081;
  }
  return 19000 + agentNum; // 19001-19004
}

/**
 * Kill any process using the specified port
 * @param {number} port - Port number to clear
 * @param {string} [label] - Optional label for logging
 */
function killProcessOnPort(port, label = '') {
  try {
    const result = execSync(`lsof -Pi :${port} -sTCP:LISTEN -t 2>/dev/null`, { encoding: 'utf-8' });
    if (!result.trim()) {
      return;
    }

    const pids = result.trim().split('\n').filter(Boolean);
    const portLabel = label ? ` (${label})` : '';
    console.log(`🔄 Killing ${pids.length} process(es) on port ${port}${portLabel}...`);

    for (const pid of pids) {
      try {
        execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: 'ignore' });
      } catch (e) {
        // Process might have already exited
      }
    }

    execSync('sleep 1', { stdio: 'ignore' });
    console.log(`✅ Port ${port} is now free`);
  } catch (e) {
    // No process on port or lsof failed
  }
}

function quoteCommand(cmd) {
  if (!cmd) return '""';
  const escaped = cmd.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Read CONVEX_DEPLOYMENT from .env.local and derive EXPO_PUBLIC_CONVEX_URL
 * @returns {string|null} The Convex URL, or null if not found
 */
function getConvexUrlFromEnvLocal() {
  const envLocalPath = path.join(__dirname, '..', '.env.local');

  if (!fs.existsSync(envLocalPath)) {
    return null;
  }

  const content = fs.readFileSync(envLocalPath, 'utf-8');
  const lines = content.split('\n');

  // Look for existing EXPO_PUBLIC_CONVEX_URL
  for (const line of lines) {
    const match = line.match(/^EXPO_PUBLIC_CONVEX_URL\s*=\s*(.+)/);
    if (match) {
      return match[1].replace(/['"]/g, '').trim();
    }
  }

  // Derive from CONVEX_DEPLOYMENT (format: "dev:slug-name" or "prod:slug-name")
  for (const line of lines) {
    const match = line.match(/^CONVEX_DEPLOYMENT\s*=\s*(.+)/);
    if (match) {
      const deployment = match[1].replace(/['"]/g, '').trim();
      // Extract slug (e.g., "dev:<deployment-name>" -> "<deployment-name>")
      const slug = deployment.includes(':') ? deployment.split(':')[1] : deployment;
      return `https://${slug}.convex.cloud`;
    }
  }

  return null;
}

/**
 * Check if Convex environment variables are configured
 * @returns {boolean} True if JWT_SECRET is set with a real value
 */
function checkConvexEnvVars() {
  try {
    const result = execSync('npx convex env list 2>/dev/null', { encoding: 'utf-8' });
    // Check JWT_SECRET exists and has a non-empty value
    const hasJWT = result.split('\n').some(line => {
      if (!line.startsWith('JWT_SECRET=')) return false;
      const value = line.substring('JWT_SECRET='.length);
      return value && value !== '""' && value !== "''" && value.length > 2;
    });
    return hasJWT;
  } catch (e) {
    return false;
  }
}

/**
 * Check if 1Password CLI is installed
 * @returns {boolean}
 */
function has1PasswordCLI() {
  try {
    execSync('which op 2>/dev/null', { encoding: 'utf-8' });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Check if user is logged into 1Password
 * @returns {boolean}
 */
function is1PasswordLoggedIn() {
  try {
    execSync('op account list 2>/dev/null', { encoding: 'utf-8' });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Sync environment variables from 1Password to Convex
 */
function syncConvexEnvVars() {
  console.log('🔄 Syncing environment variables to Convex...');

  const convexKeys = [
    'JWT_SECRET', 'EXPO_ACCESS_TOKEN', 'RESEND_API_KEY',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
    'TWILIO_API_KEY_SID', 'TWILIO_API_KEY_SECRET', 'TWILIO_VERIFY_SERVICE_SID',
    'PLANNING_CENTER_CLIENT_ID', 'PLANNING_CENTER_CLIENT_SECRET',
    'OTP_TEST_PHONE_NUMBERS',
    'CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME', 'R2_PUBLIC_URL'
  ];

  try {
    // Set APP_ENV
    execSync('npx convex env set APP_ENV=development 2>/dev/null', { stdio: 'ignore' });
    execSync('npx convex env set APP_URL=http://localhost:8081 2>/dev/null', { stdio: 'ignore' });

    // Sync each key from 1Password
    let synced = 0;
    for (const key of convexKeys) {
      process.stdout.write(`   ${key}...`);
      try {
        const value = execSync(
          `op read "op://Togather/${key}/dev" 2>/dev/null`,
          { encoding: 'utf-8' }
        ).trim();
        if (value) {
          execSync(`npx convex env set "${key}=${value}" 2>/dev/null`, { stdio: 'ignore' });
          console.log(' ✓');
          synced++;
        } else {
          console.log(' (empty)');
        }
      } catch (e) {
        console.log(' ✗');
      }
    }

    console.log(`✅ Synced ${synced} environment variables to Convex`);
    return true;
  } catch (e) {
    console.error('❌ Failed to sync environment variables:', e.message);
    return false;
  }
}

function startConcurrently(names, colors, commands, env) {
  const quotedCommands = commands.map(quoteCommand);
  const concurrently = spawn(
    'pnpm',
    [
      'exec',
      'concurrently',
      '-n',
      names,
      '-c',
      colors,
      ...quotedCommands
    ],
    {
      stdio: 'inherit',
      env,
      shell: true,
    }
  );

  concurrently.on('error', (error) => {
    console.error('Error starting dev servers:', error);
    process.exit(1);
  });

  concurrently.on('exit', (code) => {
    process.exit(code || 0);
  });
}

function main() {
  const env = { ...process.env };

  // Enforce explicit backend selection in Cursor agent/cloud environments.
  enforceAgentBackendSelection(env);

  // Ensure dependencies are up to date
  ensureDependencies();

  // Check for flags
  const mobileOnly = process.argv.includes('--mobile');
  const convexOnly = process.argv.includes('--convex');

  // Get agent number and port
  const agentNum = getAgentNumber();
  const metroPort = getMetroPort(agentNum);
  const inAgentCloud = isAgentCloudContext();

  // Show agent info if using parallel development
  if (agentNum > 0) {
    console.log(`🤖 Agent ${agentNum} - Metro port: ${metroPort}`);
  }

  // Kill Expo if running on target port
  killProcessOnPort(metroPort, 'Metro');

  if (convexOnly) {
    // Convex only mode
    console.log('🔧 Starting Convex dev server...');
    startConcurrently('convex', 'magenta', ['npx convex dev'], env);
    return;
  }

  // Check for mobile .env file (contains Mapbox token, etc.)
  const mobileEnvPath = path.join(__dirname, '..', 'apps', 'mobile', '.env');
  if (!fs.existsSync(mobileEnvPath)) {
    console.error('');
    console.error('❌ Mobile environment not configured!');
    console.error('');
    if (has1PasswordCLI()) {
      console.error('   Run the setup script first:');
      console.error('');
      console.error('   1. op signin');
      console.error('   2. ./scripts/setup-env.sh');
    } else {
      console.error('   Create apps/mobile/.env with your environment variables.');
      console.error('   See .env.example and docs/secrets.md for required values.');
    }
    console.error('');
    console.error('   See CLAUDE.md for full setup instructions.');
    console.error('');
    process.exit(1);
  }

  // For mobile-only or full dev mode, we need the Convex URL
  // Only non-agent local dev may derive it from .env.local
  if (!env.EXPO_PUBLIC_CONVEX_URL) {
    if (inAgentCloud) {
      console.error('');
      console.error('❌ Missing EXPO_PUBLIC_CONVEX_URL for selected backend in agent mode.');
      console.error('   Run with explicit backend selection:');
      console.error(`   pnpm dev:backend --backend=<${getAllowedBackendNames().join('|')}>`);
      console.error('');
      process.exit(1);
    }

    const convexUrl = getConvexUrlFromEnvLocal();
    if (convexUrl) {
      env.EXPO_PUBLIC_CONVEX_URL = convexUrl;
      console.log(`📡 Convex URL: ${convexUrl}`);
    } else {
      // No .env.local found - show setup instructions
      console.error('');
      console.error('❌ No Convex deployment found!');
      console.error('');
      console.error('   First-time setup required:');
      console.error('');
      console.error('   1. Run "npx convex dev" to create your personal Convex deployment');
      console.error('      (This opens a browser to login and create your project)');
      console.error('');
      console.error('   2. Run "./scripts/setup-env.sh" to sync environment variables');
      console.error('');
      console.error('   3. Run "pnpm dev" again');
      console.error('');
      console.error('   See CLAUDE.md for full setup instructions.');
      console.error('');
      process.exit(1);
    }
  } else {
    console.log(`📡 Convex URL: ${env.EXPO_PUBLIC_CONVEX_URL}`);
  }

  // Check if Convex environment variables are configured
  if (!checkConvexEnvVars()) {
    console.log('');
    console.log('⚠️  Convex environment variables not configured.');
    console.log('');

    // Try auto-sync from 1Password if available
    if (!has1PasswordCLI()) {
      console.log('   Set environment variables manually using the Convex dashboard');
      console.log('   or the CLI:');
      console.log('');
      console.log('     npx convex env set JWT_SECRET=your-secret');
      console.log('');
      console.log('   See docs/secrets.md for required variables.');
      console.log('   The app will start, but some features may not work without secrets.');
      console.log('');
    } else if (!is1PasswordLoggedIn()) {
      console.error('❌ Not logged into 1Password!');
      console.error('');
      console.error('   Run "op signin" first, then run "pnpm dev" again.');
      console.error('');
      process.exit(1);
    } else {
      // Auto-sync from 1Password
      if (!syncConvexEnvVars()) {
        console.error('');
        console.error('   Failed to sync. Try running "./scripts/setup-env.sh" manually.');
        console.error('');
        process.exit(1);
      }
      console.log('');
    }
  }

  if (mobileOnly) {
    // Mobile only mode (assumes Convex is running separately)
    console.log('📱 Starting Expo (Convex should be running separately)...');
    startConcurrently(
      'mobile',
      'green',
      [`cd apps/mobile && expo start --port ${metroPort}`],
      env
    );
    return;
  }

  // Default: run both Convex and Expo
  console.log('🚀 Starting Convex + Expo development servers...');
  console.log('   Convex: Syncing functions to cloud');
  console.log(`   Expo:   http://localhost:${metroPort}`);
  console.log('');

  const commands = [
    'npx convex dev',
    `cd apps/mobile && expo start --port ${metroPort}`
  ];

  startConcurrently('convex,mobile', 'magenta,green', commands, env);
}

main();
