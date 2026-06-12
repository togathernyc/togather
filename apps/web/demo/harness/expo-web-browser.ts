/** Stub of expo-web-browser for the demo bundle. */
export const openBrowserAsync = async () => ({ type: "cancel" as const });
export const dismissBrowser = async () => {};
export const maybeCompleteAuthSession = () => {};
export const WebBrowserPresentationStyle = {} as Record<string, string>;
export default { openBrowserAsync, dismissBrowser, maybeCompleteAuthSession };
