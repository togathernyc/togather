/**
 * Stub of expo-modules-core for the demo bundle. Any Expo native module that
 * goes through this gets a benign no-op shim instead of the real native bridge
 * (which can't run on the web).
 */
const noopModule: unknown = new Proxy(
  {},
  { get: () => () => undefined },
);

export const requireNativeModule = () => noopModule;
export const requireOptionalNativeModule = () => null;
export const NativeModulesProxy: Record<string, unknown> = {};

export class EventEmitter {
  addListener() {
    return { remove() {} };
  }
  removeListener() {}
  removeAllListeners() {}
  emit() {}
}
export class NativeModule {}
export class SharedObject {}
export class SharedRef {}
export class CodedError extends Error {}
export class UnavailabilityError extends Error {}

export const Platform = { OS: "web" };
export const uuid = { v4: () => "00000000-0000-0000-0000-000000000000" };

export const PermissionStatus = { GRANTED: "granted", DENIED: "denied", UNDETERMINED: "undetermined" };
const grantedPermission = { granted: true, status: "granted", canAskAgain: true, expires: "never" };
export const createPermissionHook = () => () =>
  [grantedPermission, async () => grantedPermission, async () => grantedPermission];

export default {
  requireNativeModule,
  requireOptionalNativeModule,
  NativeModulesProxy,
  EventEmitter,
  NativeModule,
  SharedObject,
  SharedRef,
  CodedError,
  UnavailabilityError,
  Platform,
  uuid,
  PermissionStatus,
  createPermissionHook,
};
