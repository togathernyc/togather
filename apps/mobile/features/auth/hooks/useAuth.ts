import { useAction, useMutation, api } from '@services/api/convex';
import { storage } from '@togather/shared/utils';
import { useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Send OTP to a phone number
 *
 * @example
 * const { sendOTP, isPending } = useSendOTP();
 * await sendOTP({ phone: '2025550123', countryCode: 'US' });
 */
export function useSendOTP() {
  const sendPhoneOTP = useAction(api.functions.auth.phoneOtp.sendPhoneOTP);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutateAsync = useCallback(async (args: { phone: string; countryCode?: string }) => {
    setIsPending(true);
    setError(null);
    try {
      const result = await sendPhoneOTP(args);
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [sendPhoneOTP]);

  return {
    mutateAsync,
    mutate: mutateAsync,
    isPending,
    isLoading: isPending,
    error,
  };
}

/**
 * Verify OTP code
 *
 * Verifies the OTP and returns user/community data.
 * Convex Auth handles session tokens automatically.
 *
 * @example
 * const { verifyOTP, isPending } = useVerifyOTP();
 * const result = await verifyOTP({
 *   phone: '2025550123',
 *   code: '123456',
 *   countryCode: 'US'
 * });
 */
export function useVerifyOTP() {
  const verifyPhoneOTP = useAction(api.functions.auth.phoneOtp.verifyPhoneOTP);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof verifyPhoneOTP>> | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const mutateAsync = useCallback(async (args: { phone: string; code: string; countryCode?: string; confirmIdentity?: boolean }) => {
    setIsPending(true);
    setError(null);
    setIsSuccess(false);
    try {
      const result = await verifyPhoneOTP(args);
      setData(result);
      setIsSuccess(true);
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [verifyPhoneOTP]);

  return {
    mutateAsync,
    mutate: mutateAsync,
    isPending,
    isLoading: isPending,
    error,
    data,
    isSuccess,
  };
}

/**
 * Look up if a phone number exists in the system
 *
 * Returns whether the phone exists and associated user info if available.
 *
 * @example
 * const { phoneLookup, isPending } = usePhoneLookup();
 * const result = await phoneLookup({
 *   phone: '2025550123',
 *   countryCode: 'US'
 * });
 */
export function usePhoneLookup() {
  const phoneLookup = useAction(api.functions.auth.login.phoneLookup);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutateAsync = useCallback(async (args: { phone: string; countryCode?: string }) => {
    setIsPending(true);
    setError(null);
    try {
      const result = await phoneLookup(args);
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [phoneLookup]);

  return {
    mutateAsync,
    mutate: mutateAsync,
    isPending,
    isLoading: isPending,
    error,
  };
}

/**
 * Register a new user
 *
 * @example
 * const { registerUser, isPending } = useRegisterUser();
 * await registerUser({
 *   phone: '2025550123',
 *   countryCode: 'US',
 *   firstName: 'John',
 *   lastName: 'Doe',
 *   email: 'john@example.com',
 *   otp: '123456'
 * });
 */
export function useRegisterUser() {
  const registerNewUser = useAction(api.functions.auth.registration.registerNewUser);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutateAsync = useCallback(async (args: {
    phone: string;
    countryCode?: string;
    firstName: string;
    lastName: string;
    email?: string;
    otp: string;
    dateOfBirth?: string;
  }) => {
    setIsPending(true);
    setError(null);
    try {
      const result = await registerNewUser(args);
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [registerNewUser]);

  return {
    mutateAsync,
    mutate: mutateAsync,
    isPending,
    isLoading: isPending,
    error,
  };
}

/**
 * Logout the current user
 *
 * Clears all auth tokens from storage.
 *
 * @example
 * const { logout, isPending } = useLogout();
 * await logout();
 */
export function useLogout() {
  const signout = useMutation(api.functions.authInternal.signout);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutateAsync = useCallback(async () => {
    setIsPending(true);
    setError(null);
    try {
      // Pass the current token so the server can revoke it
      const token = await storage.getItem('access_token');
      await signout({ token: token ?? undefined });
      // Clear tokens from storage
      await storage.removeItem('access_token');
      await storage.removeItem('refresh_token');
      return { success: true };
    } catch (err) {
      // Even if server-side revocation fails, clear local tokens
      await storage.removeItem('access_token');
      await storage.removeItem('refresh_token');
      setError(err as Error);
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [signout]);

  return {
    mutateAsync,
    mutate: mutateAsync,
    isPending,
    isLoading: isPending,
    error,
  };
}

/**
 * Legacy email/password login
 *
 * @example
 * const { login, isPending } = useLegacyLogin();
 * await login({
 *   email: 'user@example.com',
 *   password: 'password123'
 * });
 */
export function useLegacyLogin() {
  const legacyLogin = useAction(api.functions.auth.login.legacyLogin);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof legacyLogin>> | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const mutateAsync = useCallback(async (args: { email: string; password: string }) => {
    setIsPending(true);
    setError(null);
    setIsSuccess(false);
    try {
      const result = await legacyLogin(args);
      setData(result);
      setIsSuccess(true);
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [legacyLogin]);

  return {
    mutateAsync,
    mutate: mutateAsync,
    isPending,
    isLoading: isPending,
    error,
    data,
    isSuccess,
  };
}

/**
 * Select a community after login
 *
 * Used when a user has multiple communities and needs to select one.
 * This mutation uses the authenticated user's session - no need to pass userId.
 *
 * @example
 * const { selectCommunity, isPending } = useSelectCommunity();
 * await selectCommunity({ communityId: 'abc123xyz' }); // Pass Convex ID
 */
export function useSelectCommunity() {
  const selectCommunity = useMutation(api.functions.authInternal.selectCommunityForUser);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutateAsync = useCallback(async (args: { communityId: string }) => {
    setIsPending(true);
    setError(null);
    try {
      // Get token from AsyncStorage
      const token = await AsyncStorage.getItem('auth_token');
      if (!token) {
        throw new Error('Not authenticated');
      }
      const result = await selectCommunity({ communityId: args.communityId as any, token });
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [selectCommunity]);

  return {
    mutateAsync,
    mutate: mutateAsync,
    isPending,
    isLoading: isPending,
    error,
  };
}

/**
 * Get phone verification status for the current user
 *
 * Note: Requires userId to be passed as Convex uses explicit IDs.
 *
 * @example
 * const status = usePhoneStatus(userId);
 * console.log(status?.phone, status?.phoneVerified);
 */
export function usePhoneStatus(userId?: string) {
  // TODO: This needs the user ID, which in Convex would typically come from the auth context
  // For now, this is a placeholder that returns undefined when no userId is provided
  const data = undefined; // Would use useQuery(api.functions.authInternal.phoneStatus, userId ? { userId } : "skip")
  return {
    data,
    isLoading: false,
  };
}

/**
 * Register/verify a phone number for an existing authenticated user
 *
 * This is useful for users who logged in via email/password and need to add
 * phone verification.
 *
 * @example
 * const { registerPhone, isPending } = useRegisterPhone();
 * await registerPhone({
 *   token: 'jwt_token',
 *   phone: '2025550123',
 *   code: '123456',
 *   countryCode: 'US'
 * });
 */
export function useRegisterPhone() {
  const registerPhone = useAction(api.functions.auth.phoneOtp.registerPhone);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutateAsync = useCallback(async (args: {
    token: string;
    phone: string;
    code: string;
    countryCode?: string;
  }) => {
    setIsPending(true);
    setError(null);
    try {
      const result = await registerPhone(args as any);
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [registerPhone]);

  return {
    mutateAsync,
    mutate: mutateAsync,
    isPending,
    isLoading: isPending,
    error,
  };
}

/**
 * Change password for the current user
 *
 * @example
 * const { changePassword, isPending } = useChangePassword();
 * await changePassword({
 *   token: 'jwt_token',
 *   oldPassword: 'old123',
 *   newPassword: 'new456'
 * });
 */
export function useChangePassword() {
  const changePassword = useAction(api.functions.auth.registration.changePassword);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutateAsync = useCallback(async (args: {
    token: string;
    oldPassword: string;
    newPassword: string;
  }) => {
    setIsPending(true);
    setError(null);
    try {
      const result = await changePassword(args as any);
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [changePassword]);

  return {
    mutateAsync,
    mutate: mutateAsync,
    isPending,
    isLoading: isPending,
    error,
  };
}
