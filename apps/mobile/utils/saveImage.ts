import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform, Alert } from 'react-native';

export async function saveImageToLibrary(
  imageUrl: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (Platform.OS === 'web') {
      // Web: Use browser download
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = imageUrl.split('/').pop() || 'image.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { success: true };
    }

    // Mobile: Request permissions
    const { status } = await MediaLibrary.requestPermissionsAsync();

    if (status !== 'granted') {
      Alert.alert(
        'Permission Required',
        'Please enable photo library access in Settings to save images.',
        [{ text: 'OK' }]
      );
      return { success: false, error: 'Permission denied' };
    }

    // Download to cache
    const filename = imageUrl.split('/').pop() || `image-${Date.now()}.jpg`;
    const cacheDir = FileSystem.cacheDirectory;

    if (!cacheDir) {
      throw new Error('Cache directory not available');
    }

    const fileUri = `${cacheDir}${filename}`;

    await FileSystem.downloadAsync(imageUrl, fileUri);

    // Save to library
    await MediaLibrary.createAssetAsync(fileUri);

    return { success: true };
  } catch (error) {
    console.error('Error saving image:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
