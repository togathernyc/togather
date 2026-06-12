/** Stub of expo-file-system (and /legacy) for the demo bundle. */
export const FileSystemUploadType = { BINARY_CONTENT: 0, MULTIPART: 1 };
export const uploadAsync = async () => ({ status: 200, body: "", headers: {} });
export const getInfoAsync = async () => ({ exists: false, isDirectory: false });
export const readAsStringAsync = async () => "";
export const writeAsStringAsync = async () => {};
export const deleteAsync = async () => {};
export const downloadAsync = async (_uri: string, fileUri: string) => ({ uri: fileUri, status: 200 });
export const makeDirectoryAsync = async () => {};
export const documentDirectory = "";
export const cacheDirectory = "";
export default {
  FileSystemUploadType,
  uploadAsync,
  getInfoAsync,
  readAsStringAsync,
  writeAsStringAsync,
  deleteAsync,
  downloadAsync,
  makeDirectoryAsync,
  documentDirectory,
  cacheDirectory,
};
