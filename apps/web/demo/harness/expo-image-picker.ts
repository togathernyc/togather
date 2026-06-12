/** Stub of expo-image-picker for the demo bundle (no native picker). */
export const MediaTypeOptions = { Images: "Images", Videos: "Videos", All: "All" };
export const launchImageLibraryAsync = async () => ({ canceled: true, assets: null });
export const launchCameraAsync = async () => ({ canceled: true, assets: null });
export const requestMediaLibraryPermissionsAsync = async () => ({ granted: true, status: "granted" });
export const requestCameraPermissionsAsync = async () => ({ granted: true, status: "granted" });
export default {
  MediaTypeOptions,
  launchImageLibraryAsync,
  launchCameraAsync,
  requestMediaLibraryPermissionsAsync,
  requestCameraPermissionsAsync,
};
