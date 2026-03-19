/**
 * File Types Utilities
 *
 * Provides file type validation, MIME type mappings, icons, and
 * native module availability checks for file attachments in chat.
 */

import { NativeModules, Platform } from 'react-native';

// ============================================================================
// Constants
// ============================================================================

/** Maximum file size for uploads (10MB) */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_SIZE_MB = 10;

// ============================================================================
// File Type Definitions
// ============================================================================

export type FileCategory = 'image' | 'document' | 'audio' | 'video' | 'unknown';

export interface FileTypeInfo {
  extension: string;
  mimeTypes: string[];
  category: FileCategory;
  icon: string; // Ionicons name
  label: string;
}

/** Supported file types whitelist */
export const FILE_TYPES: FileTypeInfo[] = [
  // Documents
  { extension: '.pdf', mimeTypes: ['application/pdf'], category: 'document', icon: 'document-text', label: 'PDF' },
  { extension: '.txt', mimeTypes: ['text/plain'], category: 'document', icon: 'document-text-outline', label: 'Text' },
  { extension: '.doc', mimeTypes: ['application/msword'], category: 'document', icon: 'document', label: 'Word' },
  { extension: '.docx', mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], category: 'document', icon: 'document', label: 'Word' },
  { extension: '.xls', mimeTypes: ['application/vnd.ms-excel'], category: 'document', icon: 'grid', label: 'Excel' },
  { extension: '.xlsx', mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], category: 'document', icon: 'grid', label: 'Excel' },
  { extension: '.csv', mimeTypes: ['text/csv', 'application/csv'], category: 'document', icon: 'grid-outline', label: 'CSV' },

  // Audio
  { extension: '.mp3', mimeTypes: ['audio/mpeg', 'audio/mp3'], category: 'audio', icon: 'musical-notes', label: 'MP3' },
  { extension: '.wav', mimeTypes: ['audio/wav', 'audio/x-wav'], category: 'audio', icon: 'musical-notes', label: 'WAV' },
  { extension: '.m4a', mimeTypes: ['audio/m4a', 'audio/x-m4a', 'audio/mp4'], category: 'audio', icon: 'musical-notes', label: 'M4A' },
  { extension: '.aac', mimeTypes: ['audio/aac'], category: 'audio', icon: 'musical-notes', label: 'AAC' },

  // Video
  { extension: '.mp4', mimeTypes: ['video/mp4'], category: 'video', icon: 'videocam', label: 'MP4' },
  { extension: '.mov', mimeTypes: ['video/quicktime'], category: 'video', icon: 'videocam', label: 'MOV' },
  { extension: '.webm', mimeTypes: ['video/webm', 'audio/webm'], category: 'video', icon: 'videocam', label: 'WebM' },

  // Images (for reference, though images use the existing image upload flow)
  { extension: '.jpg', mimeTypes: ['image/jpeg'], category: 'image', icon: 'image', label: 'JPEG' },
  { extension: '.jpeg', mimeTypes: ['image/jpeg'], category: 'image', icon: 'image', label: 'JPEG' },
  { extension: '.png', mimeTypes: ['image/png'], category: 'image', icon: 'image', label: 'PNG' },
  { extension: '.gif', mimeTypes: ['image/gif'], category: 'image', icon: 'image', label: 'GIF' },
  { extension: '.webp', mimeTypes: ['image/webp'], category: 'image', icon: 'image', label: 'WebP' },
  { extension: '.heic', mimeTypes: ['image/heic'], category: 'image', icon: 'image', label: 'HEIC' },
  { extension: '.heif', mimeTypes: ['image/heif'], category: 'image', icon: 'image', label: 'HEIF' },
];

/** Get all supported extensions */
export const SUPPORTED_EXTENSIONS = FILE_TYPES.map(ft => ft.extension);

/** Get all supported MIME types */
export const SUPPORTED_MIME_TYPES = FILE_TYPES.flatMap(ft => ft.mimeTypes);

/** Get document extensions for expo-document-picker */
export const DOCUMENT_EXTENSIONS = FILE_TYPES
  .filter(ft => ft.category === 'document')
  .map(ft => ft.extension);

/** Get audio extensions */
export const AUDIO_EXTENSIONS = FILE_TYPES
  .filter(ft => ft.category === 'audio')
  .map(ft => ft.extension);

/** Get video extensions */
export const VIDEO_EXTENSIONS = FILE_TYPES
  .filter(ft => ft.category === 'video')
  .map(ft => ft.extension);

// ============================================================================
// File Type Detection
// ============================================================================

/**
 * Get file type info from extension
 */
export function getFileTypeByExtension(extension: string): FileTypeInfo | undefined {
  const ext = extension.toLowerCase().startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  return FILE_TYPES.find(ft => ft.extension === ext);
}

/**
 * Get file type info from MIME type
 */
export function getFileTypeByMimeType(mimeType: string): FileTypeInfo | undefined {
  const mime = mimeType.toLowerCase();
  return FILE_TYPES.find(ft => ft.mimeTypes.includes(mime));
}

/**
 * Get file type info from filename
 */
export function getFileTypeFromFilename(filename: string): FileTypeInfo | undefined {
  const ext = '.' + (filename.split('.').pop()?.toLowerCase() || '');
  return getFileTypeByExtension(ext);
}

/**
 * Get file category from filename
 */
export function getFileCategoryFromFilename(filename: string): FileCategory {
  const fileType = getFileTypeFromFilename(filename);
  return fileType?.category ?? 'unknown';
}

/**
 * Get icon name for a file
 */
export function getFileIcon(filename: string): string {
  const fileType = getFileTypeFromFilename(filename);
  return fileType?.icon ?? 'document-outline';
}

/**
 * Get category from MIME type
 */
export function getCategoryFromMimeType(mimeType: string): FileCategory {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('application/') || mimeType.startsWith('text/')) return 'document';
  return 'unknown';
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Check if a file extension is supported
 */
export function isExtensionSupported(extension: string): boolean {
  const ext = extension.toLowerCase().startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  return SUPPORTED_EXTENSIONS.includes(ext);
}

/**
 * Check if a MIME type is supported
 */
export function isMimeTypeSupported(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.includes(mimeType.toLowerCase());
}

/**
 * Check if a file is within size limit
 */
export function isFileSizeValid(sizeBytes: number): boolean {
  return sizeBytes <= MAX_FILE_SIZE_BYTES;
}

/**
 * Validate a file for upload
 */
export function validateFileForUpload(file: {
  name: string;
  size: number;
  mimeType?: string;
}): { valid: boolean; error?: string } {
  // Check extension
  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '');
  if (!isExtensionSupported(ext)) {
    return {
      valid: false,
      error: `File type "${ext}" is not supported. Supported types: PDF, TXT, DOC, DOCX, XLS, XLSX, CSV, MP3, WAV, M4A, AAC, MP4, MOV, WEBM`,
    };
  }

  // Check size
  if (!isFileSizeValid(file.size)) {
    return {
      valid: false,
      error: `File is too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`,
    };
  }

  // Check MIME type if provided
  if (file.mimeType && !isMimeTypeSupported(file.mimeType)) {
    // Log but don't fail - MIME type detection can be unreliable
    console.warn(`[fileTypes] Unknown MIME type: ${file.mimeType} for file: ${file.name}`);
  }

  return { valid: true };
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  if (i === 0) return `${bytes} B`;

  const size = bytes / Math.pow(k, i);
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[i]}`;
}

// ============================================================================
// Native Module Detection
// ============================================================================

// Cache for module detection results
let _documentPickerSupported: boolean | null = null;
let _audioVideoSupported: boolean | null = null;
let _linearGradientSupported: boolean | null = null;

/**
 * Check if a native module is registered, supporting both architectures.
 *
 * Old architecture: modules register on the NativeModules bridge.
 * New architecture (Fabric/TurboModules): modules register via
 * expo-modules-core and are NOT on NativeModules. We use
 * requireNativeModule() which throws if the module isn't linked.
 *
 * Accepts multiple names because some modules use different names
 * on the legacy bridge vs expo-modules-core (e.g. ExpoAV vs ExponentAV).
 */
function hasNativeModule(...moduleNames: string[]): boolean {
  // Legacy bridge check
  for (const name of moduleNames) {
    if (NativeModules[name]) return true;
  }

  // On web, native modules don't exist — skip expo-modules-core
  // (it ships TypeScript source which can't be required on web)
  if (Platform.OS === 'web') {
    return false;
  }

  // New architecture (native only): try expo-modules-core's requireNativeModule
  try {
    const expoModulesCore = require('expo-modules-core');
    for (const name of moduleNames) {
      try {
        expoModulesCore.requireNativeModule(name);
        return true;
      } catch {
        // Try next name
      }
    }
  } catch {
    // expo-modules-core not available
  }

  return false;
}

/**
 * Check if expo-document-picker is available
 *
 * This module is only available after a native build update.
 * Returns false for OTA updates where the module isn't installed.
 */
export function isDocumentPickerSupported(): boolean {
  if (_documentPickerSupported !== null) {
    return _documentPickerSupported;
  }

  if (!hasNativeModule('ExpoDocumentPicker')) {
    _documentPickerSupported = false;
    return false;
  }

  try {
    const DocumentPicker = require('expo-document-picker');
    _documentPickerSupported = !!DocumentPicker?.getDocumentAsync;
    return _documentPickerSupported;
  } catch {
    _documentPickerSupported = false;
    return false;
  }
}

/**
 * Check if expo-av (Audio/Video) is available
 *
 * This module is only available after a native build update.
 * Returns false for OTA updates where the module isn't installed.
 */
export function isAudioVideoSupported(): boolean {
  if (_audioVideoSupported !== null) {
    return _audioVideoSupported;
  }

  // Legacy bridge uses 'ExpoAV' (iOS) / 'ExponentAV' (Android)
  // expo-modules-core uses 'ExponentAV' on both platforms
  if (!hasNativeModule('ExpoAV', 'ExponentAV')) {
    _audioVideoSupported = false;
    return false;
  }

  try {
    const ExpoAV = require('expo-av');
    _audioVideoSupported = !!ExpoAV?.Audio && !!ExpoAV?.Video;
    return _audioVideoSupported;
  } catch {
    _audioVideoSupported = false;
    return false;
  }
}

/**
 * Check if expo-linear-gradient is available
 *
 * This module is only available after a native build that includes it.
 * Returns false for OTA updates on older native builds.
 */
export function isLinearGradientSupported(): boolean {
  if (_linearGradientSupported !== null) {
    return _linearGradientSupported;
  }

  // On web, LinearGradient is JS-only and always available
  if (Platform.OS === 'web') {
    try {
      const LinearGradientModule = require('expo-linear-gradient');
      _linearGradientSupported = !!LinearGradientModule?.LinearGradient;
      return _linearGradientSupported;
    } catch {
      _linearGradientSupported = false;
      return false;
    }
  }

  if (!hasNativeModule('ExpoLinearGradient')) {
    _linearGradientSupported = false;
    return false;
  }

  try {
    const LinearGradientModule = require('expo-linear-gradient');
    _linearGradientSupported = !!LinearGradientModule?.LinearGradient;
    return _linearGradientSupported;
  } catch {
    _linearGradientSupported = false;
    return false;
  }
}

/**
 * Check if voice recording is supported
 *
 * Returns true when:
 * - Native (iOS/Android): expo-av is available (isAudioVideoSupported)
 * - Web: MediaRecorder API and getUserMedia are available
 *
 * Use this to show/hide the Voice Message option in the attachment menu.
 */
export function isVoiceRecordingSupported(): boolean {
  // Web: Use MediaRecorder API
  if (typeof navigator !== 'undefined') {
    const hasMediaDevices = !!navigator.mediaDevices?.getUserMedia;
    const hasMediaRecorder = typeof MediaRecorder !== 'undefined';
    if (hasMediaDevices && hasMediaRecorder) {
      return true;
    }
  }

  // Native: Use expo-av (gated)
  return isAudioVideoSupported();
}

/**
 * Reset cached module detection (for testing)
 */
export function resetModuleDetectionCache(): void {
  _documentPickerSupported = null;
  _audioVideoSupported = null;
  _linearGradientSupported = null;
}
