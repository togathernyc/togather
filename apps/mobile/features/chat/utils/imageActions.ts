/**
 * Image and event action utilities for saving, sharing, and copying
 */
import * as MediaLibrary from 'expo-media-library';
import { downloadAsync, Paths } from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';
// Using React Native Share API instead of expo-sharing to avoid native module dependency
import { Alert, ActionSheetIOS, Platform, Share } from 'react-native';
import { DOMAIN_CONFIG } from '@togather/shared';

/**
 * Save an image from a URL to the device's photo library
 */
export const saveImageToLibrary = async (imageUrl: string) => {
  try {
    if (Platform.OS === 'web') {
      // Web: Use browser download
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = imageUrl.split('/').pop() || 'event-image.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }

    // Mobile: Request permission to access the photo library
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant photo library access to save images.');
      return;
    }

    // Download the image to cache directory
    const filename = imageUrl.split('/').pop() || `event-image-${Date.now()}.jpg`;
    const fileUri = `${Paths.cache}/${filename}`;
    await downloadAsync(imageUrl, fileUri);

    // Save to media library
    await MediaLibrary.createAssetAsync(fileUri);
    Alert.alert('Saved', 'Image saved to your photo library.');
  } catch (error) {
    Alert.alert('Error', 'Failed to save image.');
    console.error('Save image error:', error);
  }
};

/**
 * Share an image URL using the device's share sheet
 * Note: Uses RN Share API which shares the URL, not the file itself
 */
export const shareImage = async (imageUrl: string) => {
  try {
    await Share.share({
      message: imageUrl,
      url: imageUrl, // iOS only - will show image preview
    });
  } catch (error) {
    if ((error as any).message !== 'User did not share') {
      Alert.alert('Error', 'Failed to share image.');
      console.error('Share image error:', error);
    }
  }
};

/**
 * Show action sheet for image long press with save and share options
 * @param imageUrl - The URL of the image to save or share
 */
export const handleImageLongPress = (imageUrl: string) => {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Cancel', 'Save to Photos', 'Share'],
        cancelButtonIndex: 0,
      },
      (buttonIndex) => {
        if (buttonIndex === 1) {
          saveImageToLibrary(imageUrl);
        } else if (buttonIndex === 2) {
          shareImage(imageUrl);
        }
      }
    );
  } else {
    // For Android, use Alert with buttons
    Alert.alert(
      'Image Options',
      '',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save to Photos', onPress: () => saveImageToLibrary(imageUrl) },
        { text: 'Share', onPress: () => shareImage(imageUrl) },
      ]
    );
  }
};

/**
 * Copy event link to clipboard
 */
export const copyEventLink = async (shortId: string) => {
  try {
    const eventUrl = DOMAIN_CONFIG.eventShareUrl(shortId);
    await Clipboard.setStringAsync(eventUrl);
  } catch (error) {
    Alert.alert('Error', 'Failed to copy link.');
    console.error('Copy link error:', error);
  }
};

/**
 * Share event link using native share sheet
 */
export const shareEventLink = async (shortId: string, eventTitle?: string) => {
  try {
    const eventUrl = DOMAIN_CONFIG.eventShareUrl(shortId);
    await Share.share({
      message: eventTitle ? `${eventTitle}\n${eventUrl}` : eventUrl,
      url: eventUrl, // iOS only
    });
  } catch (error) {
    if ((error as any).message !== 'User did not share') {
      Alert.alert('Error', 'Failed to share link.');
      console.error('Share link error:', error);
    }
  }
};

/**
 * Show action sheet for event card long press with copy and share options
 * @param shortId - The short ID of the event
 * @param eventTitle - Optional event title for sharing context
 */
export const handleEventLongPress = (shortId: string, eventTitle?: string) => {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Cancel', 'Copy Link', 'Share'],
        cancelButtonIndex: 0,
      },
      (buttonIndex) => {
        if (buttonIndex === 1) {
          copyEventLink(shortId);
        } else if (buttonIndex === 2) {
          shareEventLink(shortId, eventTitle);
        }
      }
    );
  } else {
    Alert.alert(
      'Event Options',
      '',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Copy Link', onPress: () => copyEventLink(shortId) },
        { text: 'Share', onPress: () => shareEventLink(shortId, eventTitle) },
      ]
    );
  }
};
