/**
 * Test component for image upload functionality
 *
 * This component demonstrates and tests the image upload flow:
 * 1. Pick an image using Expo ImagePicker
 * 2. Upload it using useImageUpload hook
 * 3. Show progress bar during upload
 * 4. Display the returned S3 URL
 *
 * For development/testing purposes only.
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, ActivityIndicator, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useImageUpload } from '../hooks/useImageUpload';

export function ImageUploadTest() {
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { uploadImage, uploading, progress } = useImageUpload();

  const handlePickImage = async () => {
    // Reset state
    setSelectedImageUri(null);
    setUploadedUrl(null);
    setError(null);

    // Request permissions
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permissionResult.granted) {
      setError('Permission to access media library is required');
      return;
    }

    // Pick image
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (result.canceled) {
      return;
    }

    const imageUri = result.assets[0].uri;
    setSelectedImageUri(imageUri);

    // Upload image
    const uploadResult = await uploadImage(imageUri);

    if (uploadResult.error) {
      setError(uploadResult.error);
    } else {
      setUploadedUrl(uploadResult.url);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Image Upload Test</Text>

      <TouchableOpacity
        style={styles.button}
        onPress={handlePickImage}
        disabled={uploading}
      >
        <Text style={styles.buttonText}>
          {uploading ? 'Uploading...' : 'Pick & Upload Image'}
        </Text>
      </TouchableOpacity>

      {uploading && (
        <View style={styles.progressContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.progressText}>{progress}%</Text>
        </View>
      )}

      {selectedImageUri && !uploading && (
        <View style={styles.imageContainer}>
          <Text style={styles.label}>Selected Image:</Text>
          <Image source={{ uri: selectedImageUri }} style={styles.image} />
        </View>
      )}

      {uploadedUrl && (
        <View style={styles.urlContainer}>
          <Text style={styles.label}>Uploaded URL:</Text>
          <Text style={styles.url} selectable>
            {uploadedUrl}
          </Text>
          <Text style={styles.hint}>
            (Stored in Convex storage)
          </Text>
        </View>
      )}

      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Error: {error}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  progressContainer: {
    marginBottom: 20,
    alignItems: 'center',
  },
  progressBar: {
    width: '100%',
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 4,
  },
  progressText: {
    marginTop: 8,
    fontSize: 14,
    color: '#666',
  },
  imageContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  image: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    backgroundColor: '#e0e0e0',
  },
  urlContainer: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
  },
  url: {
    fontSize: 12,
    color: '#007AFF',
    fontFamily: 'monospace',
  },
  hint: {
    fontSize: 11,
    color: '#999',
    marginTop: 8,
    fontStyle: 'italic',
  },
  errorContainer: {
    backgroundColor: '#fff0f0',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ffcccc',
  },
  errorText: {
    color: '#cc0000',
    fontSize: 14,
  },
});
