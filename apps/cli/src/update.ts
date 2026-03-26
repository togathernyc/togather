import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const UPDATE_CHECK_FILE = path.join(os.homedir(), ".togather", "last-update-check.json");
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
declare const __LATEST_URL__: string;

const LATEST_URL = __LATEST_URL__;

interface LatestInfo {
  version: string;
  url: string;
}

interface CheckState {
  lastCheck: number;
  lastVersion: string;
}

function loadCheckState(): CheckState | null {
  try {
    return JSON.parse(fs.readFileSync(UPDATE_CHECK_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function saveCheckState(state: CheckState): void {
  const dir = path.dirname(UPDATE_CHECK_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(UPDATE_CHECK_FILE, JSON.stringify(state), { mode: 0o600 });
}

function getCurrentVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")
    );
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function checkForUpdates(): Promise<void> {
  try {
    const state = loadCheckState();
    const now = Date.now();

    // Skip if checked recently
    if (state && now - state.lastCheck < CHECK_INTERVAL_MS) {
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(LATEST_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return;

    const latest: LatestInfo = await res.json();
    const current = getCurrentVersion();

    saveCheckState({ lastCheck: now, lastVersion: latest.version });

    if (compareVersions(latest.version, current) > 0) {
      console.log(
        `\nUpdate available: ${current} → ${latest.version}`
      );
      console.log(`Updating...`);

      try {
        execFileSync("npm", ["install", "-g", latest.url], { stdio: "inherit" });
        console.log(`Updated to ${latest.version}\n`);
      } catch {
        console.log(
          `Auto-update failed. Run manually: npm install -g ${latest.url}\n`
        );
      }
    }
  } catch {
    // Silent fail — don't block CLI usage if update check fails
  }
}
