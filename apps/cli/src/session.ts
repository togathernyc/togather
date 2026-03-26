import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SESSION_DIR = path.join(os.homedir(), ".togather");
const SESSION_FILE = path.join(SESSION_DIR, "session.json");

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  communityId?: string;
  communityName?: string;
  userId?: string;
  userName?: string;
  phone?: string;
}

export function loadSession(): Session | null {
  try {
    const data = fs.readFileSync(SESSION_FILE, "utf-8");
    return JSON.parse(data) as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), {
    mode: 0o600,
  });
}

export function clearSession(): void {
  try {
    fs.unlinkSync(SESSION_FILE);
  } catch {
    // already gone
  }
}

export function requireSession(): Session {
  const session = loadSession();
  if (!session) {
    console.error("Not logged in. Run: togather send-otp <phone>");
    process.exit(1);
  }
  return session;
}
