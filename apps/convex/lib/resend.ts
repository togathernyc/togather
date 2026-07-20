/**
 * Shared lazy Resend client.
 *
 * Both auth/emailOtp.ts and support/sendErrorReport.ts need a Resend client
 * that's only constructed (and only throws on a missing API key) when an
 * email actually needs to be sent — not at module load, since that would
 * break Convex codegen/import in environments without RESEND_API_KEY set.
 * Pulled out here so the two call sites don't duplicate the same lazy-init
 * logic.
 */

import { Resend } from "resend";

let resendClient: Resend | null = null;

/**
 * Returns a lazily-constructed Resend client, or null if RESEND_API_KEY is
 * not configured in this environment.
 */
export function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}
