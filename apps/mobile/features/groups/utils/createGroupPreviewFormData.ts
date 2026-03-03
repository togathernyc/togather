import { Platform } from 'react-native';

/**
 * Creates FormData for group preview image upload
 * Handles differences between web and native platforms
 */
export async function createGroupPreviewFormData(imageUri: string): Promise<FormData> {
  const formData = new FormData();

  // The backend expects 'file' field
  if (Platform.OS === 'web') {
    // For web, convert the URI to a file
    const response = await fetch(imageUri);
    const blob = await response.blob();
    const file = new File([blob], 'group-preview.jpg', { type: 'image/jpeg' });
    formData.append('file', file);
  } else {
    // For native platforms (iOS/Android)
    // Extract filename from URI or use default
    const filename = imageUri.split('/').pop() || 'group-preview.jpg';
    // Remove query parameters if present (e.g., file:///path/image.jpg?width=800)
    const cleanFilename = filename.split('?')[0];
    const match = /\.(\w+)$/.exec(cleanFilename);
    const type = match ? `image/${match[1]}` : 'image/jpeg';

    console.log('Creating FormData for native platform:', {
      uri: imageUri.substring(0, 50) + '...',
      filename: cleanFilename,
      type,
    });

    // For React Native, we need to append the file object with uri, name, and type
    formData.append('file', {
      uri: imageUri,
      name: cleanFilename,
      type,
    } as any);
  }

  return formData;
}

