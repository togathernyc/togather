import { Platform } from 'react-native';

/**
 * Creates FormData for meeting cover image upload
 * Handles differences between web and native platforms
 */
export async function createCoverImageFormData(imageUri: string): Promise<FormData> {
  const formData = new FormData();

  // The backend expects 'file' field
  if (Platform.OS === 'web') {
    // For web, convert the URI to a file
    const response = await fetch(imageUri);
    const blob = await response.blob();
    const file = new File([blob], 'cover-image.jpg', { type: 'image/jpeg' });
    formData.append('file', file);
  } else {
    // For native platforms
    const filename = imageUri.split('/').pop() || 'cover-image.jpg';
    const match = /\.(\w+)$/.exec(filename);
    const type = match ? `image/${match[1]}` : 'image/jpeg';

    formData.append('file', {
      uri: imageUri,
      name: filename,
      type,
    } as any);
  }

  return formData;
}
