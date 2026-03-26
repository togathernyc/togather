import { api } from "../api.js";
import { getClient } from "../client.js";
import { saveSession, clearSession } from "../session.js";

export async function sendOtp(phone: string) {
  const client = getClient();

  console.log(`Sending verification code to ${phone}...`);
  try {
    await client.action(api.functions.auth.phoneOtp.sendPhoneOTP, { phone });
    console.log("Code sent. Run: togather verify <phone> <code>");
  } catch (err: any) {
    console.error("Failed to send OTP:", err.message);
    process.exit(1);
  }
}

export async function verify(
  phone: string,
  code: string,
  options: { community?: string }
) {
  const client = getClient();

  console.log("Verifying...");
  let result: any;
  try {
    result = await client.action(api.functions.auth.phoneOtp.verifyPhoneOTP, {
      phone,
      code,
    });
  } catch (err: any) {
    console.error("Verification failed:", err.message);
    process.exit(1);
  }

  if (!result.verified) {
    console.error("Invalid code.");
    process.exit(1);
  }

  if (result.requiresIdentityFlow || !result.access_token) {
    console.error(
      "This phone number requires additional setup. Please use the app first."
    );
    process.exit(1);
  }

  let accessToken = result.access_token!;
  let refreshToken = result.refresh_token!;
  let communityId = result.user?.activeCommunityId;
  let communityName = result.user?.activeCommunityName;

  // Handle multiple communities
  const communities = (result.communities || []).filter(
    (c: any): c is NonNullable<typeof c> => c !== null
  );

  if (result.requiresCommunitySelection && communities.length) {
    if (!options.community) {
      console.log("\nYour communities:");
      communities.forEach((c: any, i: number) => {
        console.log(`  ${i + 1}. ${c.name}`);
      });
      console.error(
        `\nMultiple communities found. Re-run with: togather send-otp ${phone}\nThen: togather verify ${phone} <code> --community <number>`
      );
      process.exit(1);
    }

    const idx = parseInt(options.community, 10) - 1;
    if (idx < 0 || idx >= communities.length) {
      console.error(
        `Invalid community index. Must be 1-${communities.length}.`
      );
      process.exit(1);
    }

    const selected = communities[idx]!;
    console.log(`Selecting ${selected.name}...`);

    try {
      const selectResult = await client.action(
        api.functions.auth.login.selectCommunity,
        {
          communityId: selected.id,
          token: accessToken,
        }
      );
      accessToken = selectResult.access_token;
      refreshToken = selectResult.refresh_token;
      communityId = selectResult.communityId;
      communityName = selectResult.communityName;
    } catch (err: any) {
      console.error("Failed to select community:", err.message);
      process.exit(1);
    }
  }

  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

  saveSession({
    accessToken,
    refreshToken,
    expiresAt,
    communityId,
    communityName,
    userId: result.user?.id,
    userName: result.user
      ? `${result.user.firstName} ${result.user.lastName}`
      : undefined,
    phone,
  });

  console.log(
    `Logged in as ${result.user?.firstName || "user"}${communityName ? ` (${communityName})` : ""}`
  );
}

export async function logout() {
  clearSession();
  console.log("Logged out.");
}
