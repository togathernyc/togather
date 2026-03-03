import { Platform } from 'react-native';

/**
 * Creates FormData for profile photo upload
 * Handles differences between web and native platforms
 */
export async function createProfileFormData(photoUri: string): Promise<FormData> {
  const formData = new FormData();
  
  // The backend expects 'file' field, not 'profile_photo'
  // For web, we need to convert the URI to a file
  if (Platform.OS === 'web') {
    // Fetch the image and convert to blob
    const response = await fetch(photoUri);
    const blob = await response.blob();
    const file = new File([blob], 'profile-photo.jpg', { type: 'image/jpeg' });
    formData.append('file', file);
  } else {
    // For native platforms
    const filename = photoUri.split('/').pop() || 'profile-photo.jpg';
    const match = /\.(\w+)$/.exec(filename);
    const type = match ? `image/${match[1]}` : 'image/jpeg';
    
    formData.append('file', {
      uri: photoUri,
      name: filename,
      type,
    } as any);
  }

  return formData;
}

