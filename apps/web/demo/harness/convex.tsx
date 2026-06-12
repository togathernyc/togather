/**
 * Mock of `@services/api/convex` for the demo (no-backend) bundle.
 *
 * Mirrors the real module's export surface (see apps/mobile/jest.setup.js) but
 * resolves every query/mutation/action against the fixtures registry instead of
 * a Convex deployment. `api` is a Proxy that records the access path so the
 * fixtures can be keyed by it (e.g. `api.functions.users.me` -> "functions.users.me").
 */
import { fixtures } from "./fixtures";

function makeApi(path: string[] = []): unknown {
  return new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "__path") return path.join(".");
      if (typeof prop === "symbol") return undefined;
      if (prop === "then") return undefined; // never treat the proxy as a thenable
      return makeApi([...path, String(prop)]);
    },
  });
}

export const api = makeApi() as never;
export const internal = makeApi() as never;

// Per-screen demo entries register their own fixtures here (so they don't all
// have to edit the shared fixtures file). Keyed by dotted api path.
const registry: Record<string, unknown | ((args: unknown) => unknown)> = { ...fixtures };
export function registerFixtures(more: Record<string, unknown | ((args: unknown) => unknown)>) {
  Object.assign(registry, more);
}

function pathOf(fn: unknown): string {
  const p = (fn as { __path?: string } | null)?.__path;
  return p ?? String(fn);
}

function resolveData(fn: unknown, args?: unknown): unknown {
  const entry = registry[pathOf(fn)];
  return typeof entry === "function" ? (entry as (a: unknown) => unknown)(args) : entry;
}

const client = {
  query: async (fn: unknown, args?: unknown) => resolveData(fn, args),
  mutation: async (fn: unknown, args?: unknown) => resolveData(fn, args) ?? null,
  action: async (fn: unknown, args?: unknown) => resolveData(fn, args) ?? null,
};

export const getConvexClient = () => client;
export const getConvexHttpClient = () => client;
export const convexVanilla = client;
export const authenticatedConvexVanilla = client;
export const useConvex = () => client;
export const ConvexProvider = ({ children }: { children: React.ReactNode }) => children;

export function useQuery(fn: unknown, args?: unknown) {
  if (args === "skip") return undefined;
  return resolveData(fn, args);
}
export const useAuthenticatedQuery = useQuery;

export function useMutation(fn: unknown) {
  return async (args?: unknown) => resolveData(fn, args) ?? null;
}
export const useAuthenticatedMutation = useMutation;

export function useAction(fn: unknown) {
  return async (args?: unknown) => resolveData(fn, args) ?? null;
}
export const useAuthenticatedAction = useAction;

export function usePaginatedQuery(fn: unknown, args?: unknown) {
  const data = resolveData(fn, args) as { page?: unknown[] } | unknown[] | undefined;
  const results = Array.isArray(data) ? data : (data?.page ?? []);
  return { results, status: "Exhausted" as const, loadMore: () => {}, isLoading: false };
}

export const useStoredAuthToken = () => "mock-auth-token";
export const useTokenSync = () => "mock-auth-token";
export const useConvexConnectionState = () => ({
  isWebSocketConnected: true,
  hasInflightRequests: false,
  timeOfOldestInflightRequest: null,
  hasEverConnected: true,
  connectionCount: 1,
  failedConnectionCount: 0,
});

export const useConvexAuth = () => ({ isLoading: false, isAuthenticated: true });

// Some app modules import these directly from `convex/react` / `convex/browser`
// (aliased to this file), so provide the class shapes they expect.
export class ConvexReactClient {
  query = client.query;
  mutation = client.mutation;
  action = client.action;
  setAuth() {}
  clearAuth() {}
  watchQuery() {
    return { localQueryResult: () => undefined, onUpdate: () => () => {} };
  }
  close() {
    return Promise.resolve();
  }
}
export const ConvexHttpClient = ConvexReactClient;

// `Id` is used only in type positions in app code; a runtime value isn't needed.
export const Id = undefined as never;

export default { api, internal, useConvex, getConvexClient };
