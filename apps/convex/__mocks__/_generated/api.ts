/**
 * Mock for Convex generated API module
 *
 * This mock allows unit tests to import from function files
 * without pulling in the real Convex API references.
 */

// Mock internal API references
export const internal = new Proxy(
  {},
  {
    get: (_target, prop) => {
      // Return a proxy for nested access (e.g., internal.functions.foo)
      return new Proxy(
        {},
        {
          get: () => {
            // Return a mock function reference
            return "mock-internal-function-reference";
          },
        }
      );
    },
  }
);

// Mock api export
export const api = new Proxy(
  {},
  {
    get: (_target, prop) => {
      return new Proxy(
        {},
        {
          get: () => {
            return "mock-api-function-reference";
          },
        }
      );
    },
  }
);
