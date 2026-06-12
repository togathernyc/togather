/**
 * Stub of react-native-gesture-handler for the demo bundle. Gestures are no-ops
 * (the screens we render have web fallbacks that don't depend on gestures).
 */
import type { ReactNode } from "react";

// Chainable no-op so `Gesture.Pan().onUpdate(...).onEnd(...)` works.
const chain: unknown = new Proxy(function () {}, {
  get: () => () => chain,
  apply: () => chain,
});

export const Gesture: Record<string, () => unknown> = new Proxy(
  {},
  { get: () => () => chain },
) as Record<string, () => unknown>;

export const GestureDetector = ({ children }: { children: ReactNode }) => children;
export const GestureHandlerRootView = ({ children }: { children: ReactNode }) => children;
export const Swipeable = ({ children }: { children: ReactNode }) => children;
export const RectButton = ({ children }: { children: ReactNode }) => children;
export const BorderlessButton = ({ children }: { children: ReactNode }) => children;
export const TouchableOpacity = ({ children }: { children: ReactNode }) => children;

export default { Swipeable, GestureHandlerRootView };
