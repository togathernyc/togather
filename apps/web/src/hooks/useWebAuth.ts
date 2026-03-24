import { useState, useCallback } from "react";

const AUTH_TOKEN_KEY = "togather_auth_token";
const REFRESH_TOKEN_KEY = "togather_refresh_token";

/**
 * Web authentication hook for managing JWT tokens in localStorage.
 *
 * Stores access and refresh tokens from the phone OTP flow.
 * Pages can use `token` to pass to authenticated Convex functions.
 */
export function useWebAuth() {
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  });

  const isAuthenticated = !!token;

  const signIn = useCallback(
    (accessToken: string, refreshToken?: string) => {
      localStorage.setItem(AUTH_TOKEN_KEY, accessToken);
      setToken(accessToken);
      if (refreshToken) {
        localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      }
    },
    []
  );

  const signOut = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    setToken(null);
  }, []);

  return { token, isAuthenticated, signIn, signOut };
}
