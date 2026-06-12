/** Stub of expo-router for the demo bundle. Navigation is a no-op. */
import type { ReactNode } from "react";

const noop = () => {};
const routerObj = { push: noop, replace: noop, navigate: noop, back: noop, setParams: noop, dismiss: noop, dismissAll: noop };

export const useRouter = () => routerObj;
export const router = routerObj;
export const useLocalSearchParams = () => ({});
export const useGlobalSearchParams = () => ({});
export const usePathname = () => "/";
export const useSegments = () => [] as string[];
export const useFocusEffect = () => {};
export const useNavigation = () => ({ setOptions: noop, navigate: noop, goBack: noop });
export const Link = ({ children }: { children: ReactNode }) => children;
export const Redirect = () => null;

type Nav = ((props: { children?: ReactNode }) => ReactNode) & { Screen: () => null };
function makeNavigator(): Nav {
  const Comp = ({ children }: { children?: ReactNode }) => children ?? null;
  (Comp as Nav).Screen = () => null;
  return Comp as Nav;
}
export const Stack = makeNavigator();
export const Tabs = makeNavigator();
export const Slot = ({ children }: { children?: ReactNode }) => children ?? null;
