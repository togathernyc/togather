/** Stub of expo-linking for the demo bundle. */
export const openURL = async () => {};
export const canOpenURL = async () => true;
export const getInitialURL = async () => null;
export const createURL = (path: string) => path;
export const parse = (url: string) => ({ path: url, queryParams: {} });
export const useURL = () => null;
export default { openURL, canOpenURL, getInitialURL, createURL, parse, useURL };
