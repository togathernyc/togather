#!/usr/bin/env node

/**
 * Agent Development Script
 *
 * A comprehensive script for running dev servers in agent worktrees.
 * Handles all the setup steps that agents often miss:
 * - Resets Watchman if it's in a bad state
 * - Builds the shared package
 * - Cleans up ports aggressively
 * - Starts dev servers with proper health checks
 * - Optionally launches the simulator and connects
 *
 * Usage:
 *   node scripts/agent-dev.js --agent=1                    # Start dev servers for worker 1
 *   node scripts/agent-dev.js --agent=1 --launch-sim       # Also launch simulator
 *   node scripts/agent-dev.js --agent=1 --build-shared     # Force rebuild shared package
 *   node scripts/agent-dev.js --agent=1 --reset-watchman   # Reset watchman first
 *   node scripts/agent-dev.js --agent=1 --check-only       # Just check if servers are ready
 *   node scripts/agent-dev.js --agent=1 --stop             # Stop servers on agent ports
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Worker configuration
const WORKERS = {
  1: { port: 3001, metro: 19001, udid: 'E2D4D884-4A2C-45C5-9E76-BF55FF3C393F', sim: 'Test Sim 1' },
  2: { port: 3002, metro: 19002, udid: '9857B313-E271-433A-8568-6D994156A2B2', sim: 'Test Sim 2' },
  3: { port: 3003, metro: 19003, udid: 'C3E057E4-77D8-4220-8F25-FC94C96782B1', sim: 'Test Sim 3' },
  4: { port: 3004, metro: 19004, udid: '3BEA97A2-650C-477B-99F0-60934CD74140', sim: 'Test Sim 4' },
};

function log(msg) {
  console.log(`[agent-dev] ${msg}`);
}

function error(msg) {
  console.error(`[agent-dev] ❌ ${msg}`);
}

function success(msg) {
  console.log(`[agent-dev] ✅ ${msg}`);
}

function getAgentNumber() {
  const agentArg = process.argv.find(arg => arg.startsWith('--agent='));
  if (agentArg) {
    const num = parseInt(agentArg.split('=')[1], 10);
    if (!isNaN(num) && num >= 1 && num <= 4) {
      return num;
    }
  }

  // Detect via PAPERCLIP_AGENT_ID
  const agentId = process.env.PAPERCLIP_AGENT_ID;
  if (agentId) {
    try {
      const cwd = process.cwd();
      const repoMatch = cwd.match(/(.+?)(?:\/worktrees\/agent-\d+|$)/);
      const rootDir = repoMatch ? repoMatch[1] : cwd;
      
      const slotsPath = path.join(rootDir, 'config/agent-slots.json');
      if (fs.existsSync(slotsPath)) {
        const slots = JSON.parse(fs.readFileSync(slotsPath, 'utf8'));
        if (slots[agentId]) {
          return slots[agentId];
        }
      }
    } catch (e) {
      log(`Warning: Failed to read agent-slots.json: ${e.message}`);
    }
  }

  error('Missing --agent=N argument (1-4) and no PAPERCLIP_AGENT_ID mapping found.');
  process.exit(1);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

/**
 * Non-blocking sleep using setTimeout
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function killPort(port, label = '') {
  try {
    // Use -sTCP:LISTEN to only kill processes actually listening on the port
    const result = execSync(`lsof -Pi :${port} -sTCP:LISTEN -t 2>/dev/null`, { encoding: 'utf-8' });
    const pids = result.trim().split('\n').filter(Boolean);
    if (pids.length > 0) {
      log(`Killing ${pids.length} process(es) on port ${port}${label ? ` (${label})` : ''}...`);
      for (const pid of pids) {
        try {
          execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: 'ignore' });
        } catch (e) {}
      }
      // Wait for processes to fully terminate
      await sleep(1000);
    }
  } catch (e) {}
}

/**
 * Check if a server endpoint is responding with HTTP 2xx
 * Uses curl -sf which fails silently on non-2xx responses
 * Uses curl's -m flag for timeout (execSync timeout doesn't work)
 */
function checkHealth(port, endpoint = '/health') {
  try {
    execSync(`curl -sf -m 5 http://localhost:${port}${endpoint} 2>/dev/null`, {
      encoding: 'utf-8'
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function resetWatchman() {
  log('Resetting Watchman (aggressive)...');
  try {
    // Step 1: Delete all watches (while watchman is still running)
    try {
      execSync('watchman watch-del-all 2>/dev/null', { stdio: 'ignore' });
    } catch (e) {}

    // Step 2: Shutdown watchman
    execSync('watchman shutdown-server 2>/dev/null', { stdio: 'ignore' });
    await sleep(1000);

    // Step 3: Clear Watchman state directory to fix FSEventStreamStart errors
    const homeDir = process.env.HOME || '/tmp';
    const watchmanStateDir = `${homeDir}/.local/state/watchman`;
    if (fs.existsSync(watchmanStateDir)) {
      log('Clearing Watchman state directory...');
      fs.rmSync(watchmanStateDir, { recursive: true, force: true });
    }

    await sleep(1000);

    // Step 4: Restart watchman
    execSync('watchman version', { stdio: 'ignore' });
    success('Watchman reset complete');
  } catch (e) {
    error('Failed to reset Watchman (it may not be installed)');
  }
}

function buildSharedPackage(worktreePath) {
  // Check for dist/index.js to verify build is complete, not just dist/ existence
  const sharedDistIndex = path.join(worktreePath, 'packages/shared/dist/index.js');
  if (!fs.existsSync(sharedDistIndex)) {
    log('Building @togather/shared package...');
    try {
      execSync('pnpm --filter @togather/shared build', {
        cwd: worktreePath,
        stdio: 'inherit'
      });
      success('Shared package built');
    } catch (e) {
      error('Failed to build shared package');
      process.exit(1);
    }
  } else {
    log('Shared package already built');
  }
}

function launchSimulator(udid) {
  log(`Booting simulator ${udid}...`);
  try {
    execSync(`xcrun simctl boot ${udid} 2>/dev/null`, { stdio: 'ignore' });
  } catch (e) {
    // Already booted
  }

  log('Launching Expo Go...');
  try {
    execSync(`xcrun simctl terminate ${udid} host.exp.Exponent 2>/dev/null`, { stdio: 'ignore' });
  } catch (e) {}

  try {
    execSync(`xcrun simctl launch ${udid} host.exp.Exponent`, { stdio: 'ignore' });
    success('Expo Go launched');
  } catch (e) {
    error('Failed to launch Expo Go. Is it installed on the simulator?');
  }
}

async function waitForServers(backendPort, metroPort, timeout = 60) {
  log(`Waiting for servers (timeout: ${timeout}s)...`);
  const start = Date.now();

  while ((Date.now() - start) < timeout * 1000) {
    const backendOk = checkHealth(backendPort, '/health');
    const metroOk = checkHealth(metroPort, '/');

    if (backendOk && metroOk) {
      success(`Backend :${backendPort} and Metro :${metroPort} are ready`);
      return true;
    }

    await sleep(2000);
  }

  error('Timeout waiting for servers');
  return false;
}

async function stopServers(workerNum) {
  log(`Stopping servers for worker ${workerNum}...`);
  await killPort(WORKERS[workerNum].port, 'backend');
  await killPort(WORKERS[workerNum].metro, 'metro');

  // Also kill any lingering node processes for this worktree
  // Use full path pattern to avoid killing unrelated processes
  try {
    execSync(`pkill -f "worktrees/agent-${workerNum}" 2>/dev/null`, { stdio: 'ignore' });
  } catch (e) {}

  success('Servers stopped');
}

async function main() {
  const agentNum = getAgentNumber();
  const worker = WORKERS[agentNum];

  // Determine worktree path
  const cwd = process.cwd();
  let worktreePath;

  // Check if we're somewhere within a worktree directory
  // Capture both the full path and the worker number from the path
  const worktreeMatch = cwd.match(/(.+?\/worktrees\/agent-(\d+))(?:\/|$)/);
  if (worktreeMatch) {
    const matchedWorkerNum = parseInt(worktreeMatch[2], 10);
    // Validate that the current directory matches the requested agent number
    if (matchedWorkerNum !== agentNum) {
      error(`Current directory is agent-${matchedWorkerNum}, but agent ${agentNum} was specified/detected. This prevents accidentally starting servers in the wrong worktree.`);
      process.exit(1);
    }
    worktreePath = worktreeMatch[1];
  } else {
    // We're in the main Togather repo (not a worktree), point to the worktree
    worktreePath = path.resolve(cwd, `worktrees/agent-${agentNum}`);
  }

  console.log('');
  log(`Worker ${agentNum} Configuration:`);
  log(`  Worktree: ${worktreePath}`);
  log(`  Backend:  http://localhost:${worker.port}`);
  log(`  Metro:    http://localhost:${worker.metro}`);
  log(`  Simulator: ${worker.sim} (${worker.udid})`);
  console.log('');

  // Handle --stop flag
  if (hasFlag('--stop')) {
    await stopServers(agentNum);
    return;
  }

  // Handle --check-only flag
  // Exit code 1 if servers aren't running (useful for scripting)
  if (hasFlag('--check-only')) {
    const backendOk = checkHealth(worker.port, '/health');
    const metroOk = checkHealth(worker.metro, '/');

    console.log('');
    log(`Backend :${worker.port}: ${backendOk ? '✅ Running' : '❌ Not running'}`);
    log(`Metro :${worker.metro}: ${metroOk ? '✅ Running' : '❌ Not running'}`);

    process.exit(backendOk && metroOk ? 0 : 1);
  }

  // Verify worktree exists
  if (!fs.existsSync(worktreePath)) {
    error(`Worktree not found: ${worktreePath}`);
    process.exit(1);
  }

  // Step 1: Reset Watchman if requested or if we detect issues
  if (hasFlag('--reset-watchman')) {
    await resetWatchman();
  }

  // Step 2: Build shared package if needed
  if (hasFlag('--build-shared')) {
    // Force rebuild
    const sharedDist = path.join(worktreePath, 'packages/shared/dist');
    if (fs.existsSync(sharedDist)) {
      fs.rmSync(sharedDist, { recursive: true, force: true });
    }
  }
  buildSharedPackage(worktreePath);

  // Step 3: Clean up ports
  log('Cleaning up ports...');
  await killPort(worker.port, 'backend');
  await killPort(worker.metro, 'metro');

  // Step 4: Start dev servers
  log('Starting dev servers...');

  // CI=true forces Metro to use polling instead of Watchman, avoiding FSEventStreamStart errors
  const devProcess = spawn('pnpm', ['dev', '--local', `--agent=${agentNum}`], {
    cwd: worktreePath,
    stdio: 'inherit',
    detached: false,
    env: { ...process.env, CI: 'true' },
  });

  // Track shutdown state to prevent race conditions
  let isShuttingDown = false;

  // Handle spawn errors (e.g., pnpm not found)
  devProcess.on('error', (err) => {
    error(`Failed to start dev process: ${err.message}`);
    process.exit(1);
  });

  // Handle graceful shutdown
  const gracefulShutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    log('Shutting down...');
    devProcess.kill('SIGTERM');

    // Wait for child process to terminate, then force kill if needed
    await sleep(2000);
    // Use exitCode === null to check if process is still running (killed flag is unreliable)
    if (devProcess.exitCode === null) {
      devProcess.kill('SIGKILL');
      await sleep(500);
    }

    // Clean up ports
    await stopServers(agentNum);
    process.exit(0);
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);

  // If --launch-sim flag, wait for servers and launch
  if (hasFlag('--launch-sim')) {
    (async () => {
      try {
        await sleep(5000);
        const serversReady = await waitForServers(worker.port, worker.metro, 60);
        if (serversReady) {
          launchSimulator(worker.udid);
          console.log('');
          log(`Connect Expo Go to: exp://localhost:${worker.metro}`);
        }
      } catch (e) {
        error(`Failed to launch simulator: ${e.message}`);
      }
    })();
  }

  // Handle child process exit
  devProcess.on('exit', async (code) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    log(`Dev process exited with code ${code}`);
    // Clean up ports before exiting
    await stopServers(agentNum);
    process.exit(code || 0);
  });
}

main().catch(e => {
  error(e.message);
  process.exit(1);
});
