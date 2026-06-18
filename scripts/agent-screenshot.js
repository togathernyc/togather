#!/usr/bin/env node
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

async function main() {
  const args = process.argv.slice(2);
  let port = '19001';
  let urlPath = '/';
  let outputPath = '/tmp/screenshot.png';

  for (const arg of args) {
    if (arg.startsWith('--port=')) port = arg.split('=')[1];
    if (arg.startsWith('--path=')) urlPath = arg.split('=')[1];
    if (arg.startsWith('--output=')) outputPath = arg.split('=')[1];
  }

  // Ensure output directory exists
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const url = `http://localhost:${port}${urlPath}`;
  console.log(`Taking screenshot of ${url} ...`);

  const browser = await chromium.launch();
  // Simulate iPhone 14 Pro
  const context = await browser.newContext({
    ...devices['iPhone 14 Pro'],
    colorScheme: 'dark'
  });
  
  const page = await context.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
  } catch (e) {
    console.warn(`Warning: Navigation to ${url} may not have fully finished: ${e.message}`);
  }
  
  // Wait an extra second for any animations
  await page.waitForTimeout(1000);
  
  await page.screenshot({ path: outputPath, fullPage: true });
  console.log(`Saved screenshot to ${outputPath}`);

  await browser.close();
}

main().catch(err => {
  console.error('Screenshot failed:', err);
  process.exit(1);
});