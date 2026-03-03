#!/usr/bin/env node

/**
 * Wrapper script for mobile dev command that handles local backend flags
 *
 * Usage:
 *   pnpm dev              # Start Expo dev server
 *   pnpm dev --agent=N    # Agent N's Metro port (19000+N)
 *
 * Note: This is typically called from the root dev.js script.
 */

const { spawn } = require('child_process');

// Parse --agent=N argument
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

// Get Metro port for an agent
function getMetroPort(agentNum) {
  if (agentNum === 0) {
    return 8081;
  }
  return 19000 + agentNum; // 19001-19004
}

// Get agent number and Metro port
const agentNum = getAgentNumber();
const metroPort = getMetroPort(agentNum);

// Filter out our custom flags from args
const expoArgs = process.argv.slice(2).filter(arg =>
  !arg.startsWith('--agent=')
);

// Add port argument if not already specified
if (!expoArgs.some(arg => arg === '--port' || arg.startsWith('--port='))) {
  expoArgs.push('--port', String(metroPort));
}

const env = {
  ...process.env,
};

if (agentNum > 0) {
  console.log(`🤖 Agent ${agentNum} - Metro: ${metroPort}`);
}

// Start Expo
const expo = spawn('expo', ['start', ...expoArgs], {
  stdio: 'inherit',
  env,
  shell: true,
});

expo.on('error', (error) => {
  console.error('Error starting Expo:', error);
  process.exit(1);
});

expo.on('exit', (code) => {
  process.exit(code || 0);
});

