import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const RATE_FILE = path.join(os.homedir(), ".togather", "rate-limits.json");

interface RateState {
  [bucket: string]: number[]; // timestamps of requests
}

function loadState(): RateState {
  try {
    return JSON.parse(fs.readFileSync(RATE_FILE, "utf-8")) as RateState;
  } catch {
    return {};
  }
}

function saveState(state: RateState): void {
  fs.writeFileSync(RATE_FILE, JSON.stringify(state), { mode: 0o600 });
}

/**
 * Check rate limit. Throws if exceeded.
 * @param bucket - e.g. "send" or "read"
 * @param maxRequests - max requests per window
 * @param windowMs - window size in ms
 */
export function checkRateLimit(
  bucket: string,
  maxRequests: number,
  windowMs: number
): void {
  const state = loadState();
  const now = Date.now();
  const cutoff = now - windowMs;

  // Clean old entries
  const timestamps = (state[bucket] || []).filter((t) => t > cutoff);

  if (timestamps.length >= maxRequests) {
    const oldestInWindow = timestamps[0]!;
    const waitMs = oldestInWindow + windowMs - now;
    const waitSec = Math.ceil(waitMs / 1000);
    throw new Error(
      `Rate limit exceeded for "${bucket}". Try again in ${waitSec}s.`
    );
  }

  timestamps.push(now);
  state[bucket] = timestamps;
  saveState(state);
}
