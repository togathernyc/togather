/** Stub of react-native-safe-area-context for the demo bundle (zero insets). */
import type { ReactNode } from "react";

const zero = { top: 0, bottom: 0, left: 0, right: 0 };

export const useSafeAreaInsets = () => zero;
export const useSafeAreaFrame = () => ({ x: 0, y: 0, width: 0, height: 0 });
export const SafeAreaProvider = ({ children }: { children: ReactNode }) => children;
export const SafeAreaView = ({ children }: { children: ReactNode }) => children;
export const SafeAreaInsetsContext = { Consumer: ({ children }: { children: (i: typeof zero) => ReactNode }) => children(zero) };
export const initialWindowMetrics = { insets: zero, frame: { x: 0, y: 0, width: 0, height: 0 } };
