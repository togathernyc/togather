/**
 * Authentication Module
 *
 * Re-exports all authentication-related actions for the Convex API.
 *
 * Module Structure:
 * - phoneOtp.ts     - Phone OTP: sendPhoneOTP, verifyPhoneOTP, registerPhone, sendSMS (internal)
 * - emailOtp.ts     - Email OTP helpers (internal, used by accountClaim)
 * - registration.ts - User registration: registerNewUser, signup, changePassword
 * - login.ts        - Login flows: phoneLookup, legacyLogin, selectCommunity
 * - tokens.ts       - Token management: refreshToken, updateLastActivity
 * - accountClaim.ts - Account claiming: claimAccount, submitAccountClaimRequest
 * - helpers.ts      - Shared helpers (internal)
 */

// Phone OTP Authentication
export { sendPhoneOTP, verifyPhoneOTP, registerPhone, sendSMS } from "./phoneOtp";

// User Registration
export { registerNewUser, signup, changePassword } from "./registration";

// Login Flows
export { phoneLookup, legacyLogin, selectCommunity } from "./login";

// Token Management
export { refreshToken, updateLastActivity } from "./tokens";

// Account Claiming
export { claimAccount, submitAccountClaimRequest } from "./accountClaim";
