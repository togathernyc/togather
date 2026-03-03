/**
 * Mock for Convex generated server module
 *
 * This mock allows unit tests to import from authInternal.ts
 * without pulling in the real Convex runtime.
 */

// Type for function handler
type Handler<Args, Result> = (ctx: any, args: Args) => Promise<Result>;

// Mock query function - returns an object with the handler
export const query = <Args, Result>(config: {
  args: any;
  handler: Handler<Args, Result>;
}) => ({
  handler: config.handler,
  _type: "query" as const,
});

// Mock mutation function
export const mutation = <Args, Result>(config: {
  args: any;
  handler: Handler<Args, Result>;
}) => ({
  handler: config.handler,
  _type: "mutation" as const,
});

// Mock internalQuery function
export const internalQuery = <Args, Result>(config: {
  args: any;
  handler: Handler<Args, Result>;
}) => ({
  handler: config.handler,
  _type: "internalQuery" as const,
});

// Mock internalMutation function
export const internalMutation = <Args, Result>(config: {
  args: any;
  handler: Handler<Args, Result>;
}) => ({
  handler: config.handler,
  _type: "internalMutation" as const,
});

// Mock action function
export const action = <Args, Result>(config: {
  args: any;
  handler: Handler<Args, Result>;
}) => ({
  handler: config.handler,
  _type: "action" as const,
});

// Mock internalAction function
export const internalAction = <Args, Result>(config: {
  args: any;
  handler: Handler<Args, Result>;
}) => ({
  handler: config.handler,
  _type: "internalAction" as const,
});
