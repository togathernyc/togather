# Phone-First Auth - Test Scenarios

This document outlines all Critical User Journeys (CUJs) for testing the phone-first authentication flow.

## Test Credentials

Use the test credentials from the seed script (`npx convex run functions/seed:seedDemoData`).
- **Test Community**: Search for "Demo Community"

---

## 1. New User Journeys

### 1A. Brand New User - Creates Account

**State**: Phone number NOT in database

**Journey**:
```
Enter Phone → Send OTP → Verify OTP → "New or Returning?" screen
→ Tap "I'm New" → Profile Form (name, email, birthday)
→ Verify Email OTP → Select Community → Account Created → App Home
```

**To Test**: Use a phone number that doesn't exist in DB (e.g., random number)

---

### 1B. Returning User - Claims Existing Account via Email

**State**: Phone NOT in database, but user has existing account with email

**Journey**:
```
Enter Phone → Send OTP → Verify OTP → "New or Returning?" screen
→ Tap "I have an account" → Enter Email → Email Found
→ Send Email OTP → Verify Email OTP → Phone linked to account
→ Select Community → App Home
```

**To Test**: Use new phone + existing email from another account

---

### 1C. Returning User - Email Not Found (Manual Claim)

**State**: Phone NOT in database, email also not found

**Journey**:
```
Enter Phone → Send OTP → Verify OTP → "New or Returning?" screen
→ Tap "I have an account" → Enter Email → Email NOT Found
→ "Can't find account" screen → Submit Manual Claim Request
→ Confirmation shown (admin will review)
```

**To Test**: Use new phone + non-existent email

---

## 2. Existing User Journeys (Phone Found)

### 2A. Existing User - Confirms Identity, Single Community

**State**: Phone in database, phone_verified=True, belongs to 1 community, has active_community set

**Journey**:
```
Enter Phone → Send OTP → "Is this you? [FirstName L.]" screen
→ Tap "Yes, that's me" → Verify OTP → Direct login to App Home
```

**To Test**: Use test phone (2025550123) with verified phone, single community, active_community set

---

### 2B. Existing User - Confirms Identity, Multiple Communities

**State**: Phone in database, phone_verified=True, belongs to 2+ communities

**Journey**:
```
Enter Phone → Send OTP → "Is this you? [FirstName L.]" screen
→ Tap "Yes, that's me" → Verify OTP → Community Selection screen
→ Select Community → App Home
```

**To Test**: User with multiple community memberships

---

### 2C. Existing User - Confirms Identity, No Active Community

**State**: Phone in database, phone_verified=True, active_community=NULL

**Journey**:
```
Enter Phone → Send OTP → "Is this you? [FirstName L.]" screen
→ Tap "Yes, that's me" → Verify OTP → Community Selection screen
→ Select Community → App Home
```

**To Test**: Clear user's active_community in DB

---

### 2D. Existing User - Rejects Identity ("Not Me")

**State**: Phone in database (wrong person's phone)

**Journey**:
```
Enter Phone → Send OTP → "Is this you? [FirstName L.]" screen
→ Tap "No, that's not me" → Verify OTP (to prove phone ownership)
→ Phone unlinked from wrong account → "New or Returning?" screen
→ (continues as 1A, 1B, or 1C)
```

**To Test**: Need phone linked to different user, then say "not me"

---

### 2E. Existing User - Unverified Phone

**State**: Phone in database, phone_verified=False

**Journey**:
```
Enter Phone → Send OTP → "Is this you? [FirstName L.]" screen
→ Tap "Yes, that's me" → Verify OTP → phone_verified set to True
→ Community Selection (or direct if active_community) → App Home
```

**To Test**: Set phone_verified=False in DB for test user

---

## 3. Legacy Login Journeys

### 3A. Legacy Login - Already Has Verified Phone

**State**: User with email/password, phone_verified=True

**Journey**:
```
Enter Phone → "Is this you?" → Tap "Sign in another way"
→ Legacy Login screen → Enter email/password
→ Login successful → Community Selection → App Home
```

**To Test**: Use test email/password

---

### 3B. Legacy Login - Needs Phone Verification

**State**: User with email/password, phone_verified=False or no phone

**Journey**:
```
Phone lookup fails OR user chooses legacy login
→ Legacy Login screen → Enter email/password
→ Login successful → "Verify your phone" screen
→ Enter phone → Send OTP → Verify OTP → Phone linked
→ Community Selection → App Home
```

**To Test**: User with email but no verified phone

---

## 4. Edge Cases

### 4A. Phone Already Linked to Another Account (During Claim)

**State**: Trying to link phone that's already linked elsewhere

**Journey**:
```
... → Verify Email OTP → Attempt to link phone
→ Error: "This phone number is already linked to another account"
```

---

### 4B. Email Already Registered (New User)

**State**: New user tries to use existing email

**Journey**:
```
... → Profile Form → Enter existing email → Verify Email OTP
→ Select Community → Registration fails
→ Error: "This email address is already registered"
```

---

### 4C. Deactivated Community Member

**State**: User was removed/deactivated from community

**Journey**:
```
... → Community Selection → Select former community
→ Error: "Sorry, you can't join this community. Contact admins."
```

---

### 4D. OTP Expired

**State**: User waits too long (>5 min) before entering OTP

**Journey**:
```
... → Enter expired OTP
→ Error: "Verification code has expired. Please request a new one."
→ Tap "Resend Code" → New OTP sent
```

---

### 4E. Max OTP Attempts Exceeded

**State**: User enters wrong OTP 5 times

**Journey**:
```
... → Enter wrong OTP (5 times)
→ Error: "Too many failed attempts. Please request a new code."
```

---

### 4F. Rate Limited (Too Many OTP Requests)

**State**: User requests >3 OTPs in 1 hour

**Journey**:
```
... → Tap "Resend Code" (4th time)
→ Error: "Too many requests. Please try again in X minutes."
```

---

## Quick Reference Matrix

| # | User State | Phone in DB | Phone Verified | Communities | Flow |
|---|------------|-------------|----------------|-------------|------|
| 1A | New user | No | - | 0 | Phone → OTP → New → Profile → Email Verify → Community |
| 1B | Returning (claim) | No | - | 0 | Phone → OTP → Returning → Email → Link → Community |
| 1C | Returning (manual) | No | - | 0 | Phone → OTP → Returning → Email fail → Manual claim |
| 2A | Existing (single) | Yes | Yes | 1 + active | Phone → "Is this you?" → OTP → Direct login |
| 2B | Existing (multi) | Yes | Yes | 2+ | Phone → "Is this you?" → OTP → Select community |
| 2C | Existing (no active) | Yes | Yes | 1+ | Phone → "Is this you?" → OTP → Select community |
| 2D | Wrong person | Yes | - | - | Phone → "Not me" → OTP → Unlink → New/Returning |
| 2E | Unverified phone | Yes | No | 1+ | Phone → "Is this you?" → OTP → Verify → Community |
| 3A | Legacy (verified) | Yes | Yes | 1+ | Legacy login → Community |
| 3B | Legacy (unverified) | No/Yes | No | 1+ | Legacy login → Verify phone → Community |
