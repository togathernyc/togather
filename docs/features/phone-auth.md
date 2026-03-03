# Phone-First Authentication Flow

## Overview

The phone-first authentication flow is designed for the multi-tenant Togather app, where users can belong to multiple communities. This flow handles:

- **New users** who have never used the app
- **Returning users** whose phone number is already in the system
- **Legacy users** who have accounts but no verified phone number
- **Account recovery** for users who can't access their original email

## Motivation

The legacy email-based authentication had several issues:

1. **Duplicate accounts** - Users created multiple accounts with different emails
2. **Forgotten credentials** - Users forgot which email they used
3. **Community context** - Users belong to multiple communities, complicating login
4. **Phone verification** - Many accounts had unverified or incorrect phone numbers

Phone-first auth solves these by:
- Using phone as primary identifier (harder to forget)
- Showing users their existing accounts before creating new ones
- Providing clear paths for legacy account recovery

## Flow Diagrams

### Main Authentication Flow

```
                              PHONE SIGN-IN
                         Enter phone number
                              [Next]
                                    |
                                    v
                              OTP VERIFY
                    Enter 6-digit code sent to phone
                         [Back]  [Verify]
                                    |
                    +---------------+---------------+
                    |                               |
                    v                               v
          Phone found in DB                Phone NOT found
                    |                               |
                    v                               v
            IS THIS YOU?                   NEW OR RETURNING?

  "We found an account with      "We couldn't find an account
   this phone number"             with this phone number"

  Name: John Doe                 [I'm New] - Create new account
  Communities:
  - Fount Church                 [I Have an Account] - Claim
  - Grace Chapel                             existing account

  [Back] [No] [Yes, that's me]   [Back]
          |           |                       |              |
          |           |                       |              |
    +-----+           +-----+           +-----+              +-----+
    v                       v           v                          v
Goes to              LOGGED IN      Goes to                 CLAIM ACCOUNT
"New or Returning"    (JWT tokens)  Community               (see below)
screen                              Search ->
                                    Sign Up
```

### Account Claim Flow (Returning Users)

```
                         CLAIM ACCOUNT - EMAIL
              "Enter an email associated with your account"

                     [email input field]

                     [Back]  [Send Code]

           "Can't access your email? Request manual review"
                                    |
                    +---------------+---------------+
                    |                               |
                    v                               v
           Email found in DB               "Can't access email"
                    |                         clicked
                    v                               |
     CLAIM ACCOUNT - VERIFY                        |
                                                   |
  "Enter the 6-digit code sent                     |
   to j***@gmail.com"                              |
                                                   |
      [OTP input field]                            |
                                                   |
      [Back]  [Verify]                             |
                                                   |
  "Try a different email"                          |
          |                                        |
          v                                        v
    CONFIRM MODAL                   REQUEST MANUAL REVIEW
    "Link Account?"
    "This will link your             Name: [_______________]
     phone to this account"          Community: [_______________]
                                     Phone: (auto-filled)
    [Cancel] [Link Account]          Possible emails:
          |                            [_______________]
          v                            [+ Add another]
    LOGGED IN
    (JWT tokens,                     CONFIRM: "Submit Request?"
     phone linked
     to account)                     [Back]  [Submit Request]
                                               |
                                               v
                                     Request submitted
                                     "We'll contact you within
                                      48 hours"
```

## API Endpoints (tRPC)

All auth endpoints are in the `auth` router. Access via `trpc.auth.<procedure>`.

### Phone Lookup

**Procedure:** `auth.phoneLookup`

Checks if a phone number exists in the system.

**Input:**
```typescript
{
  phone: string;
  countryCode?: string; // Default: "US"
}
```

**Response (phone found):**
```typescript
{
  exists: true;
  hasVerifiedPhone: boolean;
  userName: string | null;
  communities: Array<{
    id: number;
    name: string;
    logo: string | null;
    logoFallback: string | null;
  }>;
  activeCommunity: { id: number; name: string; logo: string | null } | null;
}
```

**Response (phone not found):**
```typescript
{
  exists: false;
  hasVerifiedPhone: false;
  userName: null;
  communities: [];
  activeCommunity: null;
}
```

---

### Send Phone OTP

**Procedure:** `auth.sendPhoneOTP`

Sends OTP to a phone number via Twilio Verify.

**Input:**
```typescript
{
  phone: string;
  countryCode?: string; // Default: "US"
}
```

**Response:**
```typescript
{
  success: true;
  expiresIn: 300; // 5 minutes
}
```

---

### Verify Phone OTP

**Procedure:** `auth.verifyPhoneOTP`

Verifies phone OTP and optionally confirms identity.

**Input:**
```typescript
{
  phone: string;
  code: string;
  countryCode?: string; // Default: "US"
  confirmIdentity?: boolean; // Default: true
}
```

**Response (success with single community):**
```typescript
{
  verified: true;
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    phoneVerified: true;
    communityId: number;
  };
  communities: Array<{ id: number; name: string; ... }>;
}
```

**Response (multiple communities - needs selection):**
```typescript
{
  verified: true;
  requiresCommunitySelection: true;
  accessToken: string;
  refreshToken: string;
  communities: Array<{ id: number; name: string; role: number; isAdmin: boolean; ... }>;
  user: { ... };
}
```

---

### Claim Account

**Procedure:** `auth.claimAccount`

Multi-action endpoint for claiming a legacy account.

**Actions:**

1. **lookup** - Check if email exists
```typescript
{
  action: "lookup";
  email: string;
  phone: string;
}
```
Response:
```typescript
{
  user_found: boolean;
  masked_email: string | null; // "u***@example.com"
}
```

2. **send_otp** - Send OTP to email via Twilio Verify
```typescript
{
  action: "send_otp";
  email: string;
  phone: string;
}
```
Response:
```typescript
{
  user_found: true;
  masked_email: string;
  otp_sent: true;
}
```

3. **verify_and_link** - Verify OTP and link phone to account
```typescript
{
  action: "verify_and_link";
  email: string;
  code: string;
  phone: string;
}
```
Response:
```typescript
{
  verified: true;
  access_token: string;
  refresh_token: string;
  communities: Array<{ id: number; name: string; ... }>;
  user: { ... };
}
```

---

### Submit Account Claim Request

**Procedure:** `auth.submitAccountClaimRequest`

Submit a manual review request for account recovery.

**Input:**
```typescript
{
  name: string;
  communityName: string;
  phone: string;
  countryCode?: string;
  possibleEmails: string[];
}
```

**Response:**
```typescript
{
  success: true;
  request_id: string;
  message: "Your request has been submitted for review";
}
```

## Frontend Routes

| Route | Screen | Purpose |
|-------|--------|---------|
| `/(auth)/signin` | PhoneSignInScreen | Enter phone number |
| `/(auth)/verify-otp` | OTP verification | Enter 6-digit phone code |
| `/(auth)/confirm-identity` | ConfirmIdentityScreen | "Is this you?" confirmation |
| `/(auth)/user-type` | UserTypeScreen | "New or Returning?" choice |
| `/(auth)/claim-account/email` | ClaimEmailScreen | Enter email to claim |
| `/(auth)/claim-account/verify` | ClaimVerifyScreen | Verify email OTP |
| `/(auth)/claim-account/request-review` | RequestReviewScreen | Manual review form |
| `/(auth)/community-search` | CommunitySearchScreen | Search for community |
| `/(auth)/signup` | SignUpScreen | Create new account |

## State Machine

The `usePhoneAuth` hook manages auth state through these steps:

```typescript
type AuthStep =
  | "phone"           // Enter phone number
  | "otp"             // Verify phone OTP
  | "confirm_identity" // "Is this you?"
  | "user_type"       // "New or Returning?"
  | "claim_email"     // Enter email to claim
  | "claim_verify"    // Verify email OTP
  | "claim_request"   // Manual review form
  | "community_search" // Search for community
  | "signup";         // Create account
```

State includes:
- `phone` - User's phone number
- `foundUser` - User info if phone found (name, communities)
- `claimEmail` - Email being used for account claim
- `triedEmails` - Emails that failed verification (for retry flow)

## UX Requirements

### Back Button Policy

**Reversible steps** (show back button):
- Phone entry -> Exit auth
- OTP verify -> Back to phone
- Confirm identity -> Back to OTP (to re-verify)
- User type selection -> Back to confirm identity
- Claim email entry -> Back to user type
- Claim verify -> Back to email entry
- Request review -> Back to email entry

### Confirmation Modal Policy

**Irreversible actions** require confirmation popup:

1. **"No, that's not me"** on confirm identity screen
   - Warning: "This will unlink this phone from the shown account"
   - Buttons: [Cancel] [Continue]

2. **"Link Account"** after email OTP verification
   - Warning: "This will permanently link your phone number to this account"
   - Buttons: [Cancel] [Link Account]

3. **"Submit Request"** on manual review form
   - Warning: "Submit this request for manual review?"
   - Buttons: [Cancel] [Submit]

## Database Models

### LegacyAccountClaim

Stores manual review requests from users who can't verify via email.

```sql
-- Prisma model (legacy_account_claim table)
model legacy_account_claim {
  id              BigInt   @id @default(autoincrement())
  name            String
  community_name  String
  phone           String
  possible_emails Json     @default("[]")
  status          String   @default("pending") // pending, resolved, rejected
  resolved_by_id  BigInt?
  resolved_at     DateTime?
  notes           String   @default("")
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
}
```

## Testing

### Test Credentials

Use the test credentials from the seed script (`npx convex run functions/seed:seedDemoData`). Search for "Demo Community" when testing.

**Notes:**
- A bypass OTP code is configured for test phone numbers (via `OTP_TEST_PHONE_NUMBERS` env var)
- In local dev or DEBUG mode, the bypass code works for any phone number
- Email OTP also accepts the bypass code in DEBUG mode

### Test Scenarios

1. **Returning user, confirms identity**
   - Enter phone -> OTP -> "Yes that's me" -> Logged in

2. **Returning user, rejects identity**
   - Enter phone -> OTP -> "No" (confirm) -> User type -> Choose path

3. **New user**
   - Enter phone -> OTP -> User type -> "I'm New" -> Community search -> Signup

4. **Legacy user, claims via email**
   - Enter phone -> OTP -> User type -> "I Have an Account" -> Enter email -> Verify OTP (confirm) -> Logged in

5. **Legacy user, can't access email**
   - Enter phone -> OTP -> User type -> "I Have an Account" -> "Can't access email" -> Fill form (confirm) -> Request submitted

## OTP Implementation

### Twilio Verify

OTP is handled by Twilio Verify service:

- **Phone OTP**: Sent via SMS channel
- **Email OTP**: Sent via email channel
- **Rate limiting**: Handled by Twilio (no Redis required)
- **Code expiry**: Managed by Twilio (typically 10 minutes)
- **Verification tracking**: Automatic attempt limits

```typescript
// apps/api-trpc/src/lib/twilio.ts

// Send OTP
await sendOTP(normalizedPhone);

// Verify OTP
const isValid = await verifyOTP(normalizedPhone, code);

// Email OTP
await sendEmailOTP(email);
const isValid = await verifyEmailOTP(email, code);
```

### Magic Code Bypass

The magic code `000000` is accepted in these scenarios:

1. **Test phones** - Numbers in `OTP_TEST_PHONE_NUMBERS` env var
2. **Local development** - When `NODE_ENV !== 'production'`
3. **Debug mode** - When `DEBUG=true`

## Security Considerations

1. **Rate Limiting** - Phone and email OTP rate limiting is handled by Twilio Verify

2. **OTP Expiry** - Managed by Twilio Verify (typically 10 minutes)

3. **Phone Replacement** - When linking a phone to an account, any existing phone on another account is NOT replaced (conflict error returned)

4. **Token Security** - JWT tokens with configurable expiry

## Related Files

### Backend (tRPC)
- `apps/api-trpc/src/routers/auth.ts` - Auth router with all procedures
- `apps/api-trpc/src/lib/twilio.ts` - Twilio Verify integration (OTP)
- `apps/api-trpc/src/lib/jwt.ts` - JWT token generation/verification
- `apps/api-trpc/src/lib/phone.ts` - Phone number normalization

### Frontend
- `packages/shared/src/api/` - tRPC client and types
- `apps/mobile/features/auth/hooks/usePhoneAuth.ts` - State machine hook
- `apps/mobile/components/ui/ConfirmModal.tsx` - Confirmation dialog
- `apps/mobile/app/(auth)/` - Auth screen routes

## Deployment Notes

1. Ensure Twilio is configured:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN` or `TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET`
   - `TWILIO_VERIFY_SERVICE_SID`
   - `TWILIO_PHONE_NUMBER` (for direct SMS fallback)

2. Set test phone configuration:
   - `OTP_TEST_PHONE_NUMBERS` - Comma-separated list of test phones
   - `DEBUG=true` - Enable magic code for all phones (dev only)
