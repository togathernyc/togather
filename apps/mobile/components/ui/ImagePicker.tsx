import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
// Note: expo-image-picker needs to be installed: npx expo install expo-image-picker
// For now, we'll use a placeholder that shows the interface
let ExpoImagePicker: any = null;
try {
  ExpoImagePicker = require('expo-image-picker');
} catch (e) {
  // expo-image-picker not installed yet
  console.warn('expo-image-picker not installed. Install with: npx expo install expo-image-picker');
}
import { Ionicons } from '@expo/vector-icons';
import { AppImage } from './AppImage';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useTheme } from '@hooks/useTheme';

interface ImagePickerProps {
  onImageSelected: (imageUri: string) => void;
  onImageRemoved?: () => void;
  currentImage?: string;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  aspect?: [number, number];
  allowsEditing?: boolean;
  buttonText?: string;
  style?: any;
  isUploading?: boolean; // Show loading overlay while uploading
}

export function ImagePickerComponent({
  onImageSelected,
  onImageRemoved,
  currentImage,
  maxWidth = 1024,
  maxHeight = 1024,
  quality = 0.8,
  aspect,
  allowsEditing = true,
  buttonText = 'Select Image',
  style,
  isUploading = false,
}: ImagePickerProps) {
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();
  const [isLoading, setIsLoading] = useState(false);

  const requestPermissions = async () => {
    if (!ExpoImagePicker) {
      Alert.alert(
        'Not Available',
        'Image picker requires expo-image-picker. Please install it with: npx expo install expo-image-picker'
      );
      return false;
    }

    if (Platform.OS !== 'web') {
      const { status } = await ExpoImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Sorry, we need camera roll permissions to select images!'
        );
        return false;
      }
    }
    return true;
  };

  const pickImage = async () => {
    if (!ExpoImagePicker) {
      Alert.alert(
        'Not Available',
        'Image picker requires expo-image-picker. Please install it with: npx expo install expo-image-picker'
      );
      return;
    }

    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    setIsLoading(true);
    try {
      const result = await ExpoImagePicker.launchImageLibraryAsync({
        mediaTypes: ExpoImagePicker.MediaTypeOptions.Images,
        allowsEditing,
        aspect,
        quality,
        maxWidth,
        maxHeight,
      });

      if (!result.canceled && result.assets[0]) {
        onImageSelected(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick image');
      console.error('ImagePicker error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const takePhoto = async () => {
    if (!ExpoImagePicker) {
      Alert.alert(
        'Not Available',
        'Image picker requires expo-image-picker. Please install it with: npx expo install expo-image-picker'
      );
      return;
    }

    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    // Request camera permission
    if (Platform.OS !== 'web') {
      const { status } = await ExpoImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Sorry, we need camera permissions to take photos!'
        );
        return;
      }
    }

    setIsLoading(true);
    try {
      const result = await ExpoImagePicker.launchCameraAsync({
        allowsEditing,
        aspect,
        quality,
        maxWidth,
        maxHeight,
      });

      if (!result.canceled && result.assets[0]) {
        onImageSelected(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to take photo');
      console.error('Camera error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const showImageOptions = () => {
    if (Platform.OS === 'web') {
      // Web: Camera not available, go straight to file picker
      pickImage();
      return;
    }
    Alert.alert(
      'Select Image',
      'Choose an option',
      [
        { text: 'Camera', onPress: takePhoto },
        { text: 'Photo Library', onPress: pickImage },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true }
    );
  };

  return (
    <View style={[styles.container, style]}>
      {currentImage ? (
        <View style={styles.imageContainer}>
          <AppImage
            source={currentImage}
            style={styles.image}
            optimizedWidth={600}
            placeholder={{ type: 'icon', icon: 'image-outline' }}
          />
          {isUploading && (
            <View style={styles.uploadingOverlay}>
              <ActivityIndicator size="large" color={primaryColor} />
              <Text style={styles.uploadingText}>Uploading...</Text>
            </View>
          )}
          <View style={styles.imageActions}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={showImageOptions}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={primaryColor} />
              ) : (
                <Ionicons name="refresh" size={20} color={primaryColor} />
              )}
              <Text style={[styles.actionButtonText, { color: primaryColor }]}>Change</Text>
            </TouchableOpacity>
            {onImageRemoved && (
              <TouchableOpacity
                style={[styles.actionButton, styles.removeButton]}
                onPress={onImageRemoved}
                disabled={isLoading}
              >
                <Ionicons name="trash" size={20} color={colors.destructive} />
                <Text style={[styles.actionButtonText, { color: colors.destructive }]}>
                  Remove
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.selectButton, { borderColor: primaryColor, backgroundColor: colors.buttonSecondary }]}
          onPress={showImageOptions}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={primaryColor} />
          ) : (
            <>
              <Ionicons name="image-outline" size={24} color={primaryColor} />
              <Text style={[styles.selectButtonText, { color: primaryColor }]}>{buttonText}</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  selectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 8,
    gap: 8,
  },
  selectButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  imageContainer: {
    position: 'relative',
  },
  image: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    resizeMode: 'cover',
  },
  uploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  uploadingText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  imageActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  removeButton: {},
  removeButtonText: {},
});

