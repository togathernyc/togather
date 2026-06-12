/** Stub of @/services/environment for the demo bundle (avoids expo-constants). */
export const Environment = {
  current: { type: "production", isStaging: false, isProduction: true },
  isStaging: () => false,
  isProduction: () => true,
  getConvexUrl: () => "",
  getApiBaseUrl: () => "",
  getStreamChannelId: (id: string) => id,
  parseStreamChannelId: (id: string) => ({ baseId: id }),
};
export default Environment;
