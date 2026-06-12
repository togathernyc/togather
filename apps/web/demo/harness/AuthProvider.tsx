/**
 * Mock of `@/providers/AuthProvider` for the demo bundle. Provides a fake
 * signed-in user with a current community so screens that read `useAuth()`
 * render their authenticated state. All actions are no-ops.
 */
import { createContext, useContext, type ReactNode } from "react";

const defaultAuth = {
  user: { id: "demo-user", firstName: "Alex", lastName: "Rivera", email: "alex@example.com" },
  community: { id: "fount", name: "FOUNT", logo: null as string | null },
  token: "mock-auth-token",
  isAuthenticated: true,
  isLoading: false,
  setCommunity: async () => {},
  clearCommunity: async () => {},
  refreshUser: async () => {},
  signIn: async () => {},
  logout: async () => {},
  setUser: () => {},
};

export const AuthContext = createContext<typeof defaultAuth>(defaultAuth);

export function AuthProvider({ children, value }: { children: ReactNode; value?: typeof defaultAuth }) {
  return <AuthContext.Provider value={value ?? defaultAuth}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export default AuthProvider;
