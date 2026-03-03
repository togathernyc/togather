# Chat Image Upload Implementation

This document describes the image upload infrastructure for chat messages.

## Current Status: Using Convex Storage

The image upload functionality uses **Convex built-in storage**, the same pattern used for profile photo uploads. Images are stored directly in Convex and served via Convex URLs.

## Architecture

### Files

1. **`utils/imageUpload.ts`** - Validation utilities
   - `isValidImageUri()` - Validates image URIs before upload
   - `getContentTypeFromUri()` - Extracts content type from URI
   - `isSupportedImageType()` - Checks if file extension is supported

2. **`hooks/useImageUpload.ts`** - React hook for upload with state management
   - Uses Convex `generateUploadUrl` mutation to get upload URL
   - Uses `expo-file-system` (native) or `fetch` (web) to upload file
   - Uses Convex `confirmUpload` mutation to finalize and get public URL
   - Tracks upload progress (0-100%)
   - Manages uploading state
   - Handles errors

3. **`components/ImageUploadTest.tsx`** - Test component for development
   - Demonstrates complete upload flow
   - Uses Expo ImagePicker for image selection
   - Shows progress bar during upload
   - Displays returned Convex URL

## Usage

### Basic Usage

```typescript
import { useImageUpload } from '@/features/chat/hooks/useImageUpload';

function ChatComponent() {
  const { uploadImage, uploading, progress } = useImageUpload();

  const handleImageSelect = async (imageUri: string) => {
    const result = await uploadImage(imageUri);

    if (result.error) {
      console.error('Upload failed:', result.error);
    } else {
      // Use result.url in chat message
      console.log('Image uploaded to:', result.url);
    }
  };

  return (
    <View>
      {uploading && <ProgressBar progress={progress} />}
      {/* ... */}
    </View>
  );
}
```

## Upload Flow

1. **Generate Upload URL**: Call Convex `generateUploadUrl` mutation
2. **Upload File**: POST file to the returned URL using:
   - `expo-file-system/uploadAsync` on native (iOS/Android)
   - `fetch` with blob on web
3. **Confirm Upload**: Call Convex `confirmUpload` mutation with the storageId
4. **Get Public URL**: The confirm mutation returns the public URL to use

## Image Validation

Before uploading, images are validated:
- Must have valid URI format (file://, data:, content://, assets-library://, ph://)

Supported image types:
- JPEG (.jpg, .jpeg)
- PNG (.png)
- GIF (.gif)
- WebP (.webp)
- HEIC/HEIF (.heic, .heif)

## Error Handling

The hook handles these error cases:
- Invalid URI format
- Network errors during upload
- Failed to get upload URL
- Failed to confirm upload

## Integration with Chat Messages

When sending a message with an image:

```typescript
// In MessageInput component
const sendMessageWithImage = async (imageUri: string, text: string) => {
  // 1. Upload image first
  const { url, error } = await uploadImage(imageUri);

  if (error) {
    showError('Failed to upload image');
    return;
  }

  // 2. Send message with image URL
  await sendMessage(text, {
    attachments: [{
      type: 'image',
      url: url,
    }],
  });
};
```

## References

- [Convex File Storage Docs](https://docs.convex.dev/file-storage)
- [Expo ImagePicker Docs](https://docs.expo.dev/versions/latest/sdk/imagepicker/)
- [Expo FileSystem Docs](https://docs.expo.dev/versions/latest/sdk/filesystem/)
