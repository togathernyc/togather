/**
 * Convex Client Setup
 *
 * This module provides the Convex client and React hooks for the mobile app.
 * Authentication is handled via custom JWT tokens stored in AsyncStorage.
 *
 * Authentication Flow:
 * 1. User signs in via sendPhoneOTP + verifyPhoneOTP actions
 * 2. Backend returns JWT tokens (access_token, refresh_token)
 * 3. Tokens are stored in AsyncStorage
 * 4. Authenticated queries/mutations pass token as argument
 */

import { ConvexProvider as BaseConvexProvider, ConvexReactClient } from 'convex/react';
import { FunctionReference, FunctionReturnType, FunctionArgs } from 'convex/server';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Environment } from '@services/environment';

/**
 * Stable JSON serialization with sorted keys for use as memoization keys.
 * Guarantees identical output regardless of property insertion order.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const sorted = Object.keys(value as Record<string, unknown>).sort();
  return '{' + sorted.map(k => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k])).join(',') + '}';
}

// Re-export the API type for use in components
export { api } from '../../../convex/_generated/api';

/**
 * Get the Convex deployment URL
 *
 * Uses Environment.getConvexUrl() which reads from EXPO_PUBLIC_CONVEX_URL.
 * For local development, the dev script (pnpm dev) automatically sets this
 * from the .env.local CONVEX_DEPLOYMENT value.
 *
 * @throws Error if EXPO_PUBLIC_CONVEX_URL is not set
 */
function getConvexUrl(): string {
  return Environment.getConvexUrl();
}

/**
 * Convex client instance
 *
 * This is a singleton instance that should be used throughout the app.
 * It connects to the Convex backend and handles real-time subscriptions.
 */
let _convexClient: ConvexReactClient | null = null;

export function getConvexClient(): ConvexReactClient {
  if (!_convexClient) {
    _convexClient = new ConvexReactClient(getConvexUrl(), {
      // Disable unsavedChangesWarning for React Native - it uses window.addEventListener
      // which doesn't exist in React Native. See: https://docs.convex.dev/quickstart/react-native
      unsavedChangesWarning: false,
    });
  }
  return _convexClient;
}

/**
 * Get the Convex client for non-hook contexts
 *
 * This returns the same ConvexReactClient instance that can be used outside
 * of React hooks, similar to how trpcVanilla was used. The ConvexReactClient
 * has .query(), .mutation(), and .action() methods that work outside hooks.
 *
 * Note: We use ConvexReactClient instead of ConvexHttpClient because
 * ConvexHttpClient (from convex/browser) uses browser-specific APIs like
 * window.addEventListener that don't exist in React Native.
 */
export function getConvexHttpClient(): ConvexReactClient {
  return getConvexClient();
}

/**
 * Convenience export for vanilla (non-hook) Convex client.
 * Use this instead of trpcVanilla for Convex operations outside React.
 *
 * Note: This uses ConvexReactClient which works in React Native.
 * We avoid ConvexHttpClient (from convex/browser) because it uses
 * browser-specific APIs like window.addEventListener.
 *
 * Example usage:
 *   import { convexVanilla, api } from '@services/api/convex';
 *   const result = await convexVanilla.query(api.functions.users.getById, { userId });
 *   await convexVanilla.mutation(api.functions.notifications.mutations.markRead, { ... });
 *   await convexVanilla.action(api.functions.auth.phoneOtp.sendPhoneOTP, { phone });
 */
export const convexVanilla = {
  /**
   * Execute a Convex query function with proper type inference
   */
  query: <Query extends FunctionReference<'query'>>(
    func: Query,
    args: FunctionArgs<Query>
  ): Promise<FunctionReturnType<Query>> => {
    return getConvexClient().query(func, args);
  },

  /**
   * Execute a Convex mutation function with proper type inference
   */
  mutation: <Mutation extends FunctionReference<'mutation'>>(
    func: Mutation,
    args: FunctionArgs<Mutation>
  ): Promise<FunctionReturnType<Mutation>> => {
    return getConvexClient().mutation(func, args);
  },

  /**
   * Execute a Convex action function with proper type inference
   */
  action: <Action extends FunctionReference<'action'>>(
    func: Action,
    args: FunctionArgs<Action>
  ): Promise<FunctionReturnType<Action>> => {
    return getConvexClient().action(func, args);
  },
};

/**
 * ConvexProvider wrapper component
 *
 * Wraps the app with the Convex provider.
 * Must be placed near the root of the component tree.
 *
 * Authentication is managed via JWT tokens stored in AsyncStorage.
 * Use useStoredAuthToken() hook to access the current token.
 */
export function ConvexProvider({ children }: { children: React.ReactNode }) {
  const client = getConvexClient();

  return React.createElement(
    BaseConvexProvider,
    {
      client,
      children,
    }
  );
}

/**
 * Re-export hooks from convex/react for convenience
 */
export {
  useQuery,
  useMutation,
  useAction,
  useConvex,
  usePaginatedQuery,
  useConvexConnectionState,
} from 'convex/react';

// Note: Authentication is handled via JWT tokens stored in AsyncStorage
// Use useStoredAuthToken() to get the current token
// Use authenticatedConvexVanilla for authenticated operations outside React

/**
 * Type helper for Convex document IDs
 */
export type { Id } from '../../../convex/_generated/dataModel';

// ============================================================================
// Authenticated Wrapper Hooks
// ============================================================================

/**
 * Storage key for the auth token (matches AuthProvider)
 */
const AUTH_TOKEN_KEY = 'auth_token';

/**
 * Get the stored auth token from AsyncStorage
 * Returns null if no token is stored
 */
async function getStoredToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(AUTH_TOKEN_KEY);
  } catch (error) {
    console.warn('[Convex] Failed to get auth token from storage:', error);
    return null;
  }
}

/**
 * Synchronous token cache for React hooks
 * Updated by useTokenSync hook
 */
let cachedToken: string | null = null;

/**
 * Hook to sync the token from AsyncStorage to the cache
 * This should be called in a component that renders early in the app
 */
export function useTokenSync() {
  const [token, setToken] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Load token on mount
    getStoredToken().then((t) => {
      cachedToken = t;
      setToken(t);
    });

    // Poll for token changes (in case it's updated elsewhere)
    const interval = setInterval(async () => {
      const newToken = await getStoredToken();
      if (newToken !== cachedToken) {
        cachedToken = newToken;
        setToken(newToken);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return token;
}

/**
 * Hook to get the current auth token
 * Uses the cached token from useTokenSync
 */
export function useStoredAuthToken(): string | null {
  const [token, setToken] = React.useState<string | null>(cachedToken);

  // Load token on mount only - avoid dependency on token to prevent infinite loops
  React.useEffect(() => {
    // Load from storage in case cache isn't initialized
    getStoredToken().then((t) => {
      if (t !== null) {
        cachedToken = t;
        setToken(t);
      }
    });
  }, []); // Empty deps - only run on mount

  // Sync with cache changes via interval (same cadence as useTokenSync).
  // When the access token string changes (e.g. foreground refresh), queries must
  // receive the new JWT — stale tokens can 401 until the user navigates enough
  // to remount hooks. AuthProvider avoids putting `token` in context deps to
  // limit broad re-renders; this hook is the narrow place that should update.
  //
  // Use a ref to compare against the current token so `token` doesn't need
  // to be a dependency. Including it would recreate the interval on every
  // token change, which is wasteful and can cascade re-renders.
  const tokenRef = React.useRef(token);
  tokenRef.current = token;

  React.useEffect(() => {
    const interval = setInterval(() => {
      if (cachedToken !== tokenRef.current) {
        setToken(cachedToken);
      }
    }, 500);

    return () => clearInterval(interval);
  }, []); // Stable interval — reads token via ref

  return token;
}

// Re-export hooks from convex/react for use in wrapper implementations
import { useQuery as useConvexQuery, useMutation as useConvexMutation, useAction as useConvexAction, usePaginatedQuery as useConvexPaginatedQuery } from 'convex/react';

/**
 * Authenticated query hook
 *
 * Wraps useQuery and automatically adds the auth token from AsyncStorage.
 * If no token is available, the query is skipped.
 *
 * @param queryFn - The Convex query function reference
 * @param args - The query arguments (without token)
 * @returns Query result, or undefined if skipped
 *
 * @example
 * ```tsx
 * const notifications = useAuthenticatedQuery(
 *   api.functions.notifications.queries.list,
 *   { limit: 20 }
 * );
 * ```
 */
export function useAuthenticatedQuery<
  Query extends FunctionReference<'query'>,
>(
  queryFn: Query,
  args: Omit<FunctionArgs<Query>, 'token'> | 'skip'
): FunctionReturnType<Query> | undefined {
  const token = useStoredAuthToken();

  // If args is 'skip' or no token, skip the query
  const shouldSkip = args === 'skip' || !token;

  // Memoize query args to avoid creating a new object on every render.
  // Convex does deep comparison internally, but spreading { ...args, token }
  // inline creates a new reference each render which still causes unnecessary
  // work in Convex's comparison logic across 50+ call sites.
  const argsKey = shouldSkip ? 'skip' : stableStringify(args);
  const queryArgs = React.useMemo(
    () =>
      shouldSkip
        ? ('skip' as const)
        : ({ ...(args as Omit<FunctionArgs<Query>, 'token'>), token } as FunctionArgs<Query>),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- argsKey is the serialized form of args
    [shouldSkip, argsKey, token]
  );

  return useConvexQuery(queryFn, queryArgs);
}

/**
 * Authenticated mutation hook
 *
 * Wraps useMutation and returns a function that automatically adds
 * the auth token from AsyncStorage to the mutation args.
 *
 * @param mutationFn - The Convex mutation function reference
 * @returns Async function that executes the mutation with auth token
 *
 * @example
 * ```tsx
 * const markRead = useAuthenticatedMutation(api.functions.notifications.mutations.markRead);
 *
 * // Later:
 * await markRead({ notificationId: 'xxx' });
 * ```
 */
export function useAuthenticatedMutation<
  Mutation extends FunctionReference<'mutation'>,
>(
  mutationFn: Mutation
): (args: Omit<FunctionArgs<Mutation>, 'token'>) => Promise<FunctionReturnType<Mutation>> {
  const mutation = useConvexMutation(mutationFn);

  return React.useCallback(
    async (args: Omit<FunctionArgs<Mutation>, 'token'>) => {
      const token = await getStoredToken();
      if (!token) {
        throw new Error('Not authenticated: no auth token available');
      }

      return mutation({ ...args, token: token } as FunctionArgs<Mutation>);
    },
    [mutation]
  );
}

/**
 * Authenticated action hook
 *
 * Wraps useAction and returns a function that automatically adds
 * the auth token from AsyncStorage to the action args.
 *
 * @param actionFn - The Convex action function reference
 * @returns Async function that executes the action with auth token
 *
 * @example
 * ```tsx
 * const sendOTP = useAuthenticatedAction(api.functions.auth.phoneOtp.sendPhoneOTP);
 *
 * // Later:
 * await sendOTP({ phone: '+1234567890' });
 * ```
 */
export function useAuthenticatedAction<
  Action extends FunctionReference<'action'>,
>(
  actionFn: Action
): (args: Omit<FunctionArgs<Action>, 'token'>) => Promise<FunctionReturnType<Action>> {
  const action = useConvexAction(actionFn);

  return React.useCallback(
    async (args: Omit<FunctionArgs<Action>, 'token'>) => {
      const token = await getStoredToken();
      if (!token) {
        throw new Error('Not authenticated: no auth token available');
      }

      return action({ ...args, token: token } as FunctionArgs<Action>);
    },
    [action]
  );
}

/**
 * Authenticated paginated query hook
 *
 * Wraps usePaginatedQuery and automatically adds the auth token from AsyncStorage.
 * If no token is available, the query is skipped.
 *
 * @param queryFn - The Convex paginated query function reference
 * @param args - The query arguments (without token)
 * @param options - Pagination options (e.g., initialNumItems)
 * @returns Paginated query result with results, status, loadMore, and isLoading
 *
 * @example
 * ```tsx
 * const { results, loadMore, status, isLoading } = useAuthenticatedPaginatedQuery(
 *   api.functions.memberFollowups.list,
 *   { groupId: "xxx" },
 *   { initialNumItems: 50 }
 * );
 * ```
 */
export function useAuthenticatedPaginatedQuery<
  Query extends FunctionReference<'query'>,
>(
  queryFn: Query,
  args: Omit<FunctionArgs<Query>, 'token' | 'paginationOpts'> | 'skip',
  options: { initialNumItems: number }
) {
  const token = useStoredAuthToken();

  // If args is 'skip' or no token, skip the query
  const shouldSkip = args === 'skip' || !token;

  // Memoize query args (same pattern as useAuthenticatedQuery)
  const argsKey = shouldSkip ? 'skip' : stableStringify(args);
  const queryArgs = React.useMemo(
    () =>
      shouldSkip
        ? ('skip' as const)
        : { ...(args as object), token },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- argsKey is the serialized form of args
    [shouldSkip, argsKey, token]
  );

  return useConvexPaginatedQuery(queryFn, queryArgs as any, options);
}

/**
 * Vanilla (non-hook) authenticated Convex client
 *
 * Use this for Convex operations outside of React components.
 * Automatically includes the auth token from AsyncStorage.
 *
 * @example
 * ```ts
 * import { authenticatedConvexVanilla, api } from '@services/api/convex';
 *
 * const notifications = await authenticatedConvexVanilla.query(
 *   api.functions.notifications.queries.list,
 *   { limit: 20 }
 * );
 * ```
 */
export const authenticatedConvexVanilla = {
  /**
   * Execute an authenticated Convex query
   */
  query: async <Query extends FunctionReference<'query'>>(
    func: Query,
    args: Omit<FunctionArgs<Query>, 'token'>
  ): Promise<FunctionReturnType<Query>> => {
    const token = await getStoredToken();
    if (!token) {
      throw new Error('Not authenticated: no auth token available');
    }
    return getConvexClient().query(func, { ...args, token: token } as FunctionArgs<Query>);
  },

  /**
   * Execute an authenticated Convex mutation
   */
  mutation: async <Mutation extends FunctionReference<'mutation'>>(
    func: Mutation,
    args: Omit<FunctionArgs<Mutation>, 'token'>
  ): Promise<FunctionReturnType<Mutation>> => {
    const token = await getStoredToken();
    if (!token) {
      throw new Error('Not authenticated: no auth token available');
    }
    return getConvexClient().mutation(func, { ...args, token: token } as FunctionArgs<Mutation>);
  },

  /**
   * Execute an authenticated Convex action
   */
  action: async <Action extends FunctionReference<'action'>>(
    func: Action,
    args: Omit<FunctionArgs<Action>, 'token'>
  ): Promise<FunctionReturnType<Action>> => {
    const token = await getStoredToken();
    if (!token) {
      throw new Error('Not authenticated: no auth token available');
    }
    return getConvexClient().action(func, { ...args, token: token } as FunctionArgs<Action>);
  },
};
