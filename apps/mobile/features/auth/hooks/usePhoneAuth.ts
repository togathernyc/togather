import { useState, useCallback } from "react";
import { useAction, api, convexVanilla } from "@services/api/convex";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { formatAuthError } from "../utils/formatAuthError";
import { useAuth } from "@/providers/AuthProvider";

type PhoneAuthStep =
  | "phone"
  | "otp"
  | "confirm_identity"
  | "user_type"
  | "claim_email"
  | "claim_verify"
  | "claim_request"
  | "legacy"
  | "new_user_profile";

interface PhoneLookupResult {
  exists: boolean;
  has_verified_phone: boolean;
  can_use_legacy_login: boolean;
  user_name?: string;
  communities?: Array<{ id: number | string; name: string }>;
  active_community?: { id: number | string; name: string; logo: string | null } | null;
}

interface SendOTPResult {
  success: boolean;
  expiresIn: number;
  rateLimitRemaining?: number;
}

export function usePhoneAuth() {
  const [step, setStep] = useState<PhoneAuthStep>("phone");
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("US");
  const [otp, setOtp] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [otpInfo, setOtpInfo] = useState<SendOTPResult | null>(null);
  const [phoneLookup, setPhoneLookup] = useState<PhoneLookupResult | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const [verifiedOtp, setVerifiedOtp] = useState("");
  const [phoneVerificationToken, setPhoneVerificationToken] = useState("");
  const [foundUser, setFoundUser] = useState<{
    user_name: string;
    communities: Array<{ id: number | string; name: string }>;
  } | null>(null);
  const [claimEmail, setClaimEmail] = useState("");
  const [triedEmails, setTriedEmails] = useState<string[]>([]);

  // Loading states
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isSendingOTP, setIsSendingOTP] = useState(false);
  const [isVerifyingOTP, setIsVerifyingOTP] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Result states
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [legacyResult, setLegacyResult] = useState<any>(null);
  const [isVerifySuccess, setIsVerifySuccess] = useState(false);
  const [isLegacySuccess, setIsLegacySuccess] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Auth provider for session management
  const { signIn: authSignIn } = useAuth();

  // Convex actions (used via hooks for reactive UI loading states)
  const phoneLookupAction = useAction(api.functions.auth.login.phoneLookup);
  const sendPhoneOTPAction = useAction(api.functions.auth.phoneOtp.sendPhoneOTP);
  // Note: verifyPhoneOTP and legacyLogin are called via convexVanilla.action
  // to handle JWT token storage before calling authSignIn

  // Phone lookup using Convex
  const lookupPhone = useCallback(async () => {
    setIsLookingUp(true);
    try {
      const data = await phoneLookupAction({ phone, countryCode });

      // Map Convex response to expected format
      const lookupResult: PhoneLookupResult = {
        exists: data.exists,
        has_verified_phone: data.hasVerifiedPhone,
        can_use_legacy_login: false, // Not used in current flow
        user_name: data.userName || undefined,
        communities: data.communities?.filter(Boolean).map(c => ({
          id: c!.id,
          name: c!.name,
        })),
        active_community: data.activeCommunity
          ? {
              id: data.activeCommunity.id,
              name: data.activeCommunity.name,
              logo: data.activeCommunity.logo,
            }
          : null,
      };
      setPhoneLookup(lookupResult);

      if (data.exists) {
        // Phone exists - store user info if available
        setIsNewUser(false);
        if (data.userName && data.communities) {
          setFoundUser({
            user_name: data.userName,
            communities: data.communities.filter(Boolean).map(c => ({
              id: c!.id,
              name: c!.name,
            })),
          });
        }
      } else {
        // Phone doesn't exist - new user flow
        setIsNewUser(true);
        setFoundUser(null);
      }

      // After lookup, send OTP
      await sendOTP();
    } catch (err: any) {
      setError(formatAuthError(err));
    } finally {
      setIsLookingUp(false);
    }
  }, [phone, countryCode, phoneLookupAction]);

  // Send OTP using Convex
  const sendOTP = useCallback(async () => {
    setIsSendingOTP(true);
    try {
      const data = await sendPhoneOTPAction({ phone, countryCode });
      setOtpInfo({
        success: data.success,
        expiresIn: data.expiresIn,
      });
      setStep("otp");
      setError("");
    } catch (err: any) {
      const errorMessage = formatAuthError(err);
      setError(errorMessage);
      // Check for rate limit error
      if (err?.message?.includes("rate") || err?.message?.includes("limit")) {
        setError(`Rate limit exceeded. ${errorMessage}`);
      }
    } finally {
      setIsSendingOTP(false);
    }
  }, [phone, countryCode, sendPhoneOTPAction]);

  // Verify OTP using Convex JWT-based flow
  const verifyOTP = useCallback(async () => {
    setIsVerifyingOTP(true);
    try {
      // Call verifyPhoneOTP action which returns JWT tokens
      const data = await convexVanilla.action(api.functions.auth.phoneOtp.verifyPhoneOTP, {
        phone,
        code: otp,
        countryCode,
      });

      if (!data.verified) {
        throw new Error("Verification failed");
      }

      // Check if this is a new user (no user returned)
      if (!data.user) {
        // New user - store OTP and verification token, go to user_type screen
        setVerifiedOtp(otp);
        if (data.phoneVerificationToken) {
          setPhoneVerificationToken(data.phoneVerificationToken);
        }
        setStep("user_type");
        return;
      }

      // Existing user - store tokens and sign in
      console.log("[usePhoneAuth] OTP verified, storing tokens...");

      // Store tokens in AsyncStorage
      if (data.access_token) {
        await AsyncStorage.setItem("auth_token", data.access_token);
      }
      if (data.refresh_token) {
        await AsyncStorage.setItem("convex_refresh_token", data.refresh_token);
      }
      await AsyncStorage.setItem("convex_user_id", data.user.id);

      console.log("[usePhoneAuth] Tokens stored, calling AuthProvider signIn...");

      // Call AuthProvider signIn with user ID and tokens
      await authSignIn(data.user.id, {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
      });

      console.log("[usePhoneAuth] AuthProvider signIn completed successfully");

      // Auth is now ready
      setIsAuthReady(true);

      // Store result for existing users
      setVerifyResult(data);
      setIsVerifySuccess(true);
    } catch (err: any) {
      setError(formatAuthError(err));
      // Clear OTP on error to let user retry
      setOtp("");
    } finally {
      setIsVerifyingOTP(false);
    }
  }, [phone, otp, countryCode, authSignIn]);

  // Legacy login using Convex JWT-based flow
  const legacyLogin = useCallback(async () => {
    setIsLoggingIn(true);
    try {
      // Call legacyLogin action which returns JWT tokens
      const data = await convexVanilla.action(api.functions.auth.login.legacyLogin, {
        email,
        password,
      });

      console.log("[usePhoneAuth] Legacy login successful, storing tokens...");

      // Store tokens in AsyncStorage
      if (data.access_token) {
        await AsyncStorage.setItem("auth_token", data.access_token);
      }
      if (data.refresh_token) {
        await AsyncStorage.setItem("convex_refresh_token", data.refresh_token);
      }
      await AsyncStorage.setItem("convex_user_id", data.user.id);

      // Call AuthProvider signIn with user ID and tokens
      await authSignIn(data.user.id, {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
      });

      console.log("[usePhoneAuth] AuthProvider signIn completed for legacy login");

      setLegacyResult({
        ...data,
        requiresPhoneVerification: data.requiresPhoneVerification,
      });
      setIsLegacySuccess(true);
    } catch (err: any) {
      setError(formatAuthError(err));
    } finally {
      setIsLoggingIn(false);
    }
  }, [email, password, authSignIn]);

  // Resend OTP
  const resendOTP = useCallback(() => {
    setOtp("");
    setError("");
    sendOTP();
  }, [sendOTP]);

  // Go back to phone step
  const goBackToPhone = useCallback(() => {
    setStep("phone");
    setOtp("");
    setError("");
    setOtpInfo(null);
    setIsNewUser(false);
    setVerifiedOtp("");
    setPhoneVerificationToken("");
    setIsVerifySuccess(false);
    setVerifyResult(null);
  }, []);

  // Switch to legacy login
  const switchToLegacy = useCallback(() => {
    setStep("legacy");
    setError("");
  }, []);

  // Switch back to phone login from legacy
  const switchToPhone = useCallback(() => {
    setStep("phone");
    setError("");
    setPhone("");
    setIsLegacySuccess(false);
    setLegacyResult(null);
  }, []);

  // Handle phone submit
  const handlePhoneSubmit = useCallback(() => {
    if (!phone.trim()) {
      setError("Please enter your phone number");
      return;
    }
    setError("");
    lookupPhone();
  }, [phone, lookupPhone]);

  // Handle OTP submit
  const handleOTPSubmit = useCallback(() => {
    if (otp.length !== 6) {
      setError("Please enter the 6-digit code");
      return;
    }
    setError("");
    // Always verify OTP on server - verifyOTP handles both new and existing users
    verifyOTP();
  }, [otp, verifyOTP]);

  // Handle legacy login submit
  const handleLegacySubmit = useCallback(() => {
    if (!email.trim()) {
      setError("Please enter your email");
      return;
    }
    if (!password.trim()) {
      setError("Please enter your password");
      return;
    }
    setError("");
    legacyLogin();
  }, [email, password, legacyLogin]);

  return {
    // State
    step,
    phone,
    countryCode,
    otp,
    email,
    password,
    error,
    otpInfo,
    phoneLookup,
    isNewUser,
    verifiedOtp,
    phoneVerificationToken,
    foundUser,
    claimEmail,
    triedEmails,

    // Setters
    setPhone,
    setCountryCode,
    setOtp,
    setEmail,
    setPassword,
    setError,
    setClaimEmail,
    setTriedEmails,

    // Loading states
    isLookingUp,
    isSendingOTP,
    isVerifyingOTP,
    isLoggingIn,
    isLoading: isLookingUp || isSendingOTP || isVerifyingOTP || isLoggingIn,

    // Actions
    handlePhoneSubmit,
    handleOTPSubmit,
    handleLegacySubmit,
    resendOTP,
    goBackToPhone,
    switchToLegacy,
    switchToPhone,

    // Results
    verifyResult,
    legacyResult,
    isVerifySuccess,
    isLegacySuccess,
    isAuthReady,
  };
}
