/** Stub of react-native-reanimated for the demo bundle (static, no animation). */
import { View, Text, ScrollView } from "react-native";

export const useAnimatedStyle = () => ({});
export const useSharedValue = <T,>(v: T) => ({ value: v });
export const useDerivedValue = <T,>(fn: () => T) => ({ value: fn() });
export const withSpring = <T,>(v: T) => v;
export const withTiming = <T,>(v: T) => v;
export const withDelay = <T,>(_d: number, v: T) => v;
export const runOnJS =
  <A extends unknown[]>(fn: (...args: A) => void) =>
  (...args: A) =>
    fn?.(...args);
export const interpolate = (v: number) => v;

const Animated = {
  View,
  Text,
  ScrollView,
  createAnimatedComponent: <T,>(c: T) => c,
};
export default Animated;
