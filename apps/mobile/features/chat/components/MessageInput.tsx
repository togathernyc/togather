/**
 * MessageInput Component
 *
 * Composing and sending messages with @mentions, image upload, link previews, and typing indicators.
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  TextInput,
  Pressable,
  Text,
  Image,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Keyboard,
  Animated,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import type { Id } from '@services/api/convex';
import { useImageUpload } from '../hooks/useImageUpload';
import { useFileUpload, type SelectedFile } from '../hooks/useFileUpload';
import { useSendMessage } from '../hooks/useConvexSendMessage';
import { useConnectionStatus } from '@providers/ConnectionProvider';
import { useTypingIndicators } from '../hooks/useTypingIndicators';
import { useChannelMembers } from '../hooks/useChannelMembers';
import { useLinkPreview } from '../hooks/useLinkPreview';
import { LinkPreviewCard } from './LinkPreviewCard';
import { FilePreview } from './FilePreview';
import { extractFirstExternalUrl } from '../utils/eventLinkUtils';
import {
  isDocumentPickerSupported,
  isVoiceRecordingSupported,
  SUPPORTED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
  getFileCategoryFromFilename,
  type FileCategory,
} from '../utils/fileTypes';
import { useTheme } from '@hooks/useTheme';
import { VoiceRecorderBar } from './VoiceRecorderBar';
import { AttachmentPanel } from './AttachmentPanel';
import { useDraftStore } from '../../../stores/draftStore';

interface MessageInputProps {
  channelId: Id<"chatChannels"> | null;
  replyToMessage?: {
    _id: Id<"chatMessages">;
    content: string;
    senderName: string;
  } | null;
  onCancelReply?: () => void;
  /** Hide the reply preview banner (useful for thread page where context is already clear) */
  hideReplyPreview?: boolean;
  /** External send function (from parent, with optimistic/offline support) */
  externalSendMessage?: (content: string, options?: any) => Promise<void>;
  /** External sending state (from parent) */
  externalIsSending?: boolean;
}

interface ChannelMember {
  userId: Id<"users">;
  displayName: string;
  profilePhoto?: string;
}

interface MentionMatch {
  searchText: string;
  startIndex: number;
}

const MAX_INPUT_LINES = 8;
const LINE_HEIGHT = 20;
const INPUT_PADDING_VERTICAL = 10;
const TYPING_STOP_DELAY = 3000; // 3 seconds
const LINK_PREVIEW_DEBOUNCE = 500; // 500ms debounce for URL detection

/**
 * Detect @ mention pattern in text
 */
const detectMentionPattern = (text: string, cursorPosition: number): MentionMatch | null => {
  // Find last @ before cursor
  const textBeforeCursor = text.slice(0, cursorPosition);
  const lastAtIndex = textBeforeCursor.lastIndexOf('@');

  if (lastAtIndex === -1) return null;

  // Get search text after @
  const searchText = textBeforeCursor.slice(lastAtIndex + 1);

  // Check if there's a space after @ (invalid mention)
  if (searchText.includes(' ')) return null;

  return { searchText, startIndex: lastAtIndex };
};

/**
 * Filter members by search text
 */
const filterMembers = (members: ChannelMember[], searchText: string): ChannelMember[] => {
  if (!searchText) return members;

  const lowerSearch = searchText.toLowerCase();
  return members.filter(member =>
    member.displayName.toLowerCase().includes(lowerSearch)
  );
};

export function MessageInput({ channelId, replyToMessage, onCancelReply, hideReplyPreview, externalSendMessage, externalIsSending }: MessageInputProps) {
  const { colors: themeColors } = useTheme();
  const { getDraft, setDraft: saveDraft, clearDraft } = useDraftStore();
  const initialDraft = channelId ? getDraft(channelId) : '';
  const [text, setText] = useState(initialDraft);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [mentionMatch, setMentionMatch] = useState<MentionMatch | null>(null);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [uploadedImageUrls, setUploadedImageUrls] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [uploadedFile, setUploadedFile] = useState<{ storagePath: string; name: string; category: FileCategory } | null>(null);
  const [nativeScrollEnabled, setNativeScrollEnabled] = useState(false);
  const [debouncedText, setDebouncedText] = useState('');
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const isWeb = Platform.OS === 'web';
  const prevChannelIdRef = useRef(channelId);

  // Restore draft when switching channels
  useEffect(() => {
    if (channelId && channelId !== prevChannelIdRef.current) {
      // Save current draft for the previous channel before switching
      if (prevChannelIdRef.current && text) {
        saveDraft(prevChannelIdRef.current, text);
      }
      // Load draft for the new channel
      const draft = getDraft(channelId);
      setText(draft);
      setNativeScrollEnabled(false);
      prevChannelIdRef.current = channelId;
    }
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const textInputRef = useRef<TextInput>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const linkPreviewDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const rotateAnim = useRef(new Animated.Value(0)).current;

  // Connection status for offline hint
  const { isEffectivelyOffline } = useConnectionStatus();

  // Hooks
  const { uploadImage, uploading: imageUploading, progress: imageProgress, reset: resetImageUpload } = useImageUpload();
  const { uploadFile, uploading: fileUploading, progress: fileProgress, reset: resetFileUpload, isAvailable: isFileUploadAvailable } = useFileUpload();
  // Use external send function if provided (lifted from parent for optimistic/offline support)
  // Fall back to internal hook for backwards compatibility (e.g., thread views)
  const internalHook = useSendMessage(externalSendMessage ? null : channelId);
  const sendMessage = externalSendMessage ?? internalHook.sendMessage;
  const isSending = externalIsSending ?? internalHook.isSending;
  const { setTyping } = useTypingIndicators(channelId);
  const { members } = useChannelMembers(channelId);

  // Combined upload state
  const uploading = imageUploading || fileUploading;
  const progress = imageUploading ? imageProgress : fileProgress;

  // Extract first external URL from debounced text for link preview
  const externalUrl = useMemo(() => extractFirstExternalUrl(debouncedText), [debouncedText]);

  // Fetch link preview for the detected URL
  const { preview: linkPreview, loading: linkPreviewLoading, dismiss: dismissLinkPreview, isDismissed: isLinkPreviewDismissed } = useLinkPreview(externalUrl);

  // Filter members for autocomplete
  const filteredMembers = mentionMatch
    ? filterMembers(members, mentionMatch.searchText)
    : [];

  const showMentionAutocomplete = mentionMatch !== null && filteredMembers.length > 0;

  /**
   * Handle text change with mention detection and debounced link preview
   */
  const handleTextChange = useCallback((newText: string) => {
    setText(newText);

    // Persist draft for the current channel
    if (channelId) {
      saveDraft(channelId, newText);
    }

    // Use text length as cursor position when typing (more reliable than stale cursorPosition state)
    // onSelectionChange fires AFTER onChangeText, so cursorPosition would be stale here
    const currentCursorPos = newText.length;
    const match = detectMentionPattern(newText, currentCursorPos);
    setMentionMatch(match);

    // Debounce URL detection for link preview
    if (linkPreviewDebounceRef.current) {
      clearTimeout(linkPreviewDebounceRef.current);
    }
    linkPreviewDebounceRef.current = setTimeout(() => {
      setDebouncedText(newText);
    }, LINK_PREVIEW_DEBOUNCE);

    // Broadcast typing status
    if (newText.length > 0) {
      setTyping(true);

      // Clear existing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Stop typing after delay
      typingTimeoutRef.current = setTimeout(() => {
        setTyping(false);
      }, TYPING_STOP_DELAY);
    } else {
      setTyping(false);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    }
  }, [setTyping, channelId, saveDraft]);

  /**
   * Handle cursor position change
   */
  const handleSelectionChange = useCallback((event: any) => {
    const position = event.nativeEvent.selection.start;
    setCursorPosition(position);

    // Re-check mention pattern at new cursor position
    const match = detectMentionPattern(text, position);
    setMentionMatch(match);
  }, [text]);

  /**
   * Insert mention into text
   * Uses format @[Display Name] to support names with spaces
   */
  const insertMention = useCallback((member: ChannelMember) => {
    if (!mentionMatch) return;

    const beforeMention = text.slice(0, mentionMatch.startIndex);
    const afterMention = text.slice(cursorPosition);
    // Use bracketed format to support names with spaces: @[John Smith]
    const newText = `${beforeMention}@[${member.displayName}] ${afterMention}`;

    setText(newText);
    setMentionMatch(null);

    // Focus input and set cursor after mention
    // +3 accounts for @, [, and ] characters, +1 for trailing space
    const newCursorPos = mentionMatch.startIndex + member.displayName.length + 4;
    textInputRef.current?.focus();
    setTimeout(() => {
      textInputRef.current?.setNativeProps({
        selection: { start: newCursorPos, end: newCursorPos },
      });
    }, 0);
  }, [text, cursorPosition, mentionMatch]);

  /**
   * Pick images from gallery (supports multi-select)
   */
  const pickImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: 10,
        quality: 0.8,
      });

      if (!result.canceled && result.assets.length > 0) {
        const imageUris = result.assets.map(asset => asset.uri);
        setSelectedImages(prev => [...prev, ...imageUris]);

        // Upload images in parallel
        const uploadPromises = imageUris.map(async (uri) => {
          const uploadResult = await uploadImage(uri);
          if (uploadResult.error) {
            console.error('[MessageInput] Upload failed for:', uri, uploadResult.error);
            return null;
          }
          return uploadResult.url;
        });

        const results = await Promise.all(uploadPromises);
        const successfulUrls = results.filter((url): url is string => url !== null);
        setUploadedImageUrls(prev => [...prev, ...successfulUrls]);

        // Remove failed uploads from selected images
        const failedCount = imageUris.length - successfulUrls.length;
        if (failedCount > 0) {
          console.warn(`[MessageInput] ${failedCount} images failed to upload`);
        }
      }
    } catch (error) {
      console.error('[MessageInput] Image picker error:', error);
    }
  }, [uploadImage]);

  /**
   * Pick a document file (PDF, DOC, audio, video, etc.)
   */
  const pickFile = useCallback(async () => {
    if (!isFileUploadAvailable) {
      Alert.alert(
        'Update Required',
        'File attachments require the latest version of the app. Please update from the App Store.',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      // Dynamic import for expo-document-picker
      const DocumentPicker = require('expo-document-picker');

      const result = await DocumentPicker.getDocumentAsync({
        type: SUPPORTED_MIME_TYPES,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) {
        return;
      }

      const asset = result.assets[0];

      // Validate file size
      if (asset.size && asset.size > MAX_FILE_SIZE_BYTES) {
        Alert.alert(
          'File Too Large',
          `Maximum file size is ${MAX_FILE_SIZE_MB}MB. Please compress your file before uploading.`,
          [{ text: 'OK' }]
        );
        return;
      }

      const file: SelectedFile = {
        uri: asset.uri,
        name: asset.name || 'file',
        size: asset.size || 0,
        mimeType: asset.mimeType || 'application/octet-stream',
      };

      // Set selected file for preview
      setSelectedFile(file);

      // Upload the file
      const uploadResult = await uploadFile(file);

      if (uploadResult.error) {
        console.error('[MessageInput] File upload failed:', uploadResult.error);
        Alert.alert('Upload Failed', uploadResult.error);
        setSelectedFile(null);
        resetFileUpload();
      } else {
        setUploadedFile({
          storagePath: uploadResult.storagePath,
          name: uploadResult.name,
          category: uploadResult.category,
        });
      }
    } catch (error) {
      console.error('[MessageInput] Document picker error:', error);
      Alert.alert('Error', 'Failed to pick file. Please try again.');
      setSelectedFile(null);
    }
  }, [isFileUploadAvailable, uploadFile, resetFileUpload]);

  /**
   * Take photo with camera
   */
  const takePhoto = useCallback(async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        console.warn('[MessageInput] Camera permission denied');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const imageUri = result.assets[0].uri;
        setSelectedImages(prev => [...prev, imageUri]);

        // Upload image
        const uploadResult = await uploadImage(imageUri);
        if (uploadResult.error) {
          console.error('[MessageInput] Upload failed:', uploadResult.error);
          // Remove from selected images on failure
          setSelectedImages(prev => prev.filter(uri => uri !== imageUri));
          resetImageUpload();
        } else if (uploadResult.url) {
          setUploadedImageUrls(prev => [...prev, uploadResult.url]);
        }
      }
    } catch (error) {
      console.error('[MessageInput] Camera error:', error);
    }
  }, [uploadImage, resetImageUpload]);

  /**
   * Handle voice memo send - upload file and send message
   */
  const handleVoiceMemoSend = useCallback(
    async (file: { uri: string; name: string; size: number; mimeType: string; waveform: number[]; durationMs: number }) => {
      if (!channelId) return;
      const uploadResult = await uploadFile({
        uri: file.uri,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
      });
      if (uploadResult.error) {
        throw new Error(uploadResult.error);
      }
      await sendMessage('', {
        attachments: [
          {
            type: 'audio',
            url: uploadResult.storagePath,
            name: uploadResult.name,
            waveform: file.waveform,
            duration: file.durationMs,
          },
        ],
        parentMessageId: replyToMessage?._id,
      });
      if (replyToMessage && onCancelReply) {
        onCancelReply();
      }
    },
    [channelId, uploadFile, sendMessage, replyToMessage, onCancelReply]
  );

  /**
   * Handle attachment button press - toggle inline panel
   */
  const handleAttachmentPress = useCallback(() => {
    setShowAttachmentMenu(prev => {
      const next = !prev;
      Animated.timing(rotateAnim, {
        toValue: next ? 1 : 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
      if (next && Platform.OS !== 'web') {
        Keyboard.dismiss();
      }
      return next;
    });
  }, [rotateAnim]);

  /**
   * Remove selected image by index
   */
  const removeImage = useCallback((index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
    setUploadedImageUrls(prev => prev.filter((_, i) => i !== index));
  }, []);

  /**
   * Clear all selected images
   */
  const clearAllImages = useCallback(() => {
    setSelectedImages([]);
    setUploadedImageUrls([]);
    resetImageUpload();
  }, [resetImageUpload]);

  /**
   * Remove selected file
   */
  const removeFile = useCallback(() => {
    setSelectedFile(null);
    setUploadedFile(null);
    resetFileUpload();
  }, [resetFileUpload]);

  /**
   * Extract mentioned user IDs from text
   * Supports bracketed format @[Display Name] for names with spaces
   */
  const extractMentionedUserIds = useCallback((messageText: string): Id<"users">[] => {
    const mentionedIds: Id<"users">[] = [];
    // Match bracketed mentions: @[Display Name]
    const mentionRegex = /@\[([^\]]+)\]/g;
    let match;

    while ((match = mentionRegex.exec(messageText)) !== null) {
      const mentionedName = match[1];
      const member = members.find(m => m.displayName === mentionedName);
      if (member) {
        mentionedIds.push(member.userId);
      }
    }

    return mentionedIds;
  }, [members]);

  /**
   * Send message
   */
  const handleSend = useCallback(async () => {
    if (!channelId) return;

    const trimmedText = text.trim();
    const hasImages = uploadedImageUrls.length > 0;
    const hasFile = uploadedFile !== null;

    if (!trimmedText && !hasImages && !hasFile) return;

    try {
      // Extract mentioned user IDs
      const mentionedUserIds = extractMentionedUserIds(trimmedText);

      // Build attachments from uploaded images and files
      const attachments: Array<{ type: string; url: string; name?: string }> = [];

      // Add image attachments
      if (hasImages) {
        uploadedImageUrls.forEach(url => {
          attachments.push({ type: 'image', url });
        });
      }

      // Add file attachment (documents, audio, video)
      if (hasFile && uploadedFile) {
        attachments.push({
          type: uploadedFile.category, // 'document', 'audio', or 'video'
          url: uploadedFile.storagePath,
          name: uploadedFile.name,
        });
      }

      // Send message
      // Pass hideLinkPreview if the user dismissed the link preview before sending
      await sendMessage(trimmedText, {
        attachments: attachments.length > 0 ? attachments : undefined,
        mentionedUserIds: mentionedUserIds.length > 0 ? mentionedUserIds : undefined,
        parentMessageId: replyToMessage?._id,
        hideLinkPreview: isLinkPreviewDismissed ? true : undefined,
      });

      // Clear input and draft
      setText('');
      setDebouncedText('');
      setNativeScrollEnabled(false);
      if (channelId) clearDraft(channelId);
      setSelectedImages([]);
      setUploadedImageUrls([]);
      setSelectedFile(null);
      setUploadedFile(null);
      resetImageUpload();
      resetFileUpload();
      setMentionMatch(null);
      setTyping(false);

      // Clear typing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Cancel reply
      if (replyToMessage && onCancelReply) {
        onCancelReply();
      }
    } catch (error) {
      console.error('[MessageInput] Send failed:', error);
    }
  }, [
    channelId,
    text,
    uploadedImageUrls,
    uploadedFile,
    sendMessage,
    extractMentionedUserIds,
    replyToMessage,
    onCancelReply,
    resetImageUpload,
    resetFileUpload,
    setTyping,
    isLinkPreviewDismissed,
    clearDraft,
  ]);

  /**
   * Keyboard visibility listener
   */
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, () => {
      setIsKeyboardVisible(true);
      setShowAttachmentMenu(false);
      Animated.timing(rotateAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setIsKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [rotateAnim]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (linkPreviewDebounceRef.current) {
        clearTimeout(linkPreviewDebounceRef.current);
      }
      setTyping(false);
    };
  }, [setTyping]);

  const canSend = (text.trim().length > 0 || uploadedImageUrls.length > 0 || uploadedFile !== null) && !isSending && !uploading;

  // Build attachment panel options (WhatsApp-style grid)
  const attachmentOptions = React.useMemo(() => {
    const options: Array<{ id: string; label: string; icon: keyof typeof Ionicons.glyphMap; iconColor?: string; onPress: () => void }> = [
      { id: 'photos', label: 'Photos', icon: 'images', iconColor: '#007AFF', onPress: pickImage },
      { id: 'camera', label: 'Camera', icon: 'camera', iconColor: '#333', onPress: takePhoto },
    ];
    if (isVoiceRecordingSupported()) {
      options.push({
        id: 'voice',
        label: 'Voice',
        icon: 'mic',
        iconColor: '#E74C3C',
        onPress: () => setIsVoiceRecording(true),
      });
    }
    return options;
  }, [takePhoto, pickImage, pickFile]);

  const handleOptionPress = useCallback((option: { onPress: () => void }) => {
    setShowAttachmentMenu(false);
    Animated.timing(rotateAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
    option.onPress();
  }, [rotateAnim]);

  const plusRotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '45deg'],
  });

  return (
    <View style={[styles.container, { backgroundColor: themeColors.surface, borderTopColor: themeColors.border }]}>
      {/* Mention Autocomplete */}
      {showMentionAutocomplete && (
        <View style={[styles.autocompleteContainer, { borderBottomColor: themeColors.border, backgroundColor: themeColors.surface }]}>
          <FlatList
            data={filteredMembers}
            keyExtractor={(item) => item.userId}
            renderItem={({ item }) => (
              <Pressable
                style={[styles.autocompleteItem, { borderBottomColor: themeColors.borderLight }]}
                onPress={() => insertMention(item)}
              >
                {item.profilePhoto ? (
                  <Image
                    source={{ uri: item.profilePhoto }}
                    style={styles.autocompleteAvatar}
                  />
                ) : (
                  <View style={[styles.autocompleteAvatar, styles.autocompleteAvatarPlaceholder]}>
                    <Text style={styles.autocompleteAvatarText}>
                      {item.displayName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                <Text style={[styles.autocompleteName, { color: themeColors.text }]}>{item.displayName}</Text>
              </Pressable>
            )}
            style={styles.autocompleteList}
            keyboardShouldPersistTaps="handled"
          />
        </View>
      )}

      {/* Reply Preview */}
      {replyToMessage && !hideReplyPreview && !isVoiceRecording && (
        <View style={[styles.replyPreview, { backgroundColor: themeColors.surfaceSecondary, borderLeftColor: themeColors.link }]}>
          <View style={styles.replyContent}>
            <Text style={[styles.replyLabel, { color: themeColors.link }]}>Replying to {replyToMessage.senderName}</Text>
            <Text style={[styles.replyText, { color: themeColors.textSecondary }]} numberOfLines={1}>
              {replyToMessage.content}
            </Text>
          </View>
          <Pressable onPress={onCancelReply} style={styles.replyCancel}>
            <Ionicons name="close" size={20} color={themeColors.textSecondary} />
          </Pressable>
        </View>
      )}

      {/* Image Previews */}
      {selectedImages.length > 0 && !isVoiceRecording && (
        <View style={styles.imagePreviewContainer}>
          <FlatList
            data={selectedImages}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item, index) => `${item}-${index}`}
            contentContainerStyle={styles.imagePreviewList}
            renderItem={({ item: uri, index }) => (
              <View style={styles.imagePreview}>
                <Image source={{ uri }} style={styles.previewImage} />

                {/* Upload Progress (show on last item while uploading) */}
                {uploading && index === selectedImages.length - 1 && (
                  <View style={styles.uploadOverlay}>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text style={styles.uploadProgress}>{Math.round(progress)}%</Text>
                  </View>
                )}

                {/* Remove Button */}
                <Pressable
                  style={styles.removeImageButton}
                  onPress={() => removeImage(index)}
                  disabled={uploading}
                >
                  <Ionicons name="close-circle" size={24} color="#fff" />
                </Pressable>
              </View>
            )}
          />
          {selectedImages.length > 1 && (
            <Text style={[styles.imageCount, { color: themeColors.textSecondary }]}>{selectedImages.length} photos</Text>
          )}
        </View>
      )}

      {/* File Preview (before sending) */}
      {selectedFile && !isVoiceRecording && (
        <FilePreview
          name={selectedFile.name}
          size={selectedFile.size}
          category={getFileCategoryFromFilename(selectedFile.name)}
          uploading={fileUploading}
          progress={fileProgress}
          onRemove={removeFile}
          disabled={fileUploading}
        />
      )}

      {/* Link Preview (before sending) - compact when keyboard visible */}
      {externalUrl && !isLinkPreviewDismissed && (linkPreview || linkPreviewLoading) && !isVoiceRecording && (
        <View style={styles.linkPreviewContainer}>
          {linkPreview ? (
            <LinkPreviewCard
              preview={linkPreview}
              embedded
              showDismiss
              onDismiss={dismissLinkPreview}
              compact={isKeyboardVisible}
            />
          ) : (
            <LinkPreviewCard
              preview={{ url: externalUrl }}
              embedded
              showDismiss
              onDismiss={dismissLinkPreview}
              loading
              compact={isKeyboardVisible}
            />
          )}
        </View>
      )}

      {/* Offline Hint */}
      {isEffectivelyOffline && !isVoiceRecording && (
        <View style={styles.offlineHint}>
          <Ionicons name="time-outline" size={12} color={themeColors.textTertiary} />
          <Text style={[styles.offlineHintText, { color: themeColors.textTertiary }]}>Messages will be sent when you're back online</Text>
        </View>
      )}

      {/* Voice Recorder Bar (replaces input when recording) */}
      {isVoiceRecording ? (
        <VoiceRecorderBar
          onSend={handleVoiceMemoSend}
          onCancel={() => {
            setIsVoiceRecording(false);
            setShowAttachmentMenu(false);
            rotateAnim.setValue(0);
          }}
        />
      ) : (
      <>
      {/* Input Row */}
      <View style={styles.inputRow}>
        {/* Attachment Button (rotates to x when panel open) */}
        <Pressable
          style={styles.iconButton}
          onPress={handleAttachmentPress}
          disabled={uploading || isSending}
        >
          <Animated.View style={{ transform: [{ rotate: plusRotation }] }}>
            <Ionicons name="add" size={28} color={uploading ? themeColors.textDisabled : themeColors.link} />
          </Animated.View>
        </Pressable>

        {/* Text Input */}
        <TextInput
          ref={textInputRef}
          style={[
            styles.input,
            isWeb ? styles.inputWeb : styles.inputNative,
            { borderColor: themeColors.border, backgroundColor: themeColors.inputBackground, color: themeColors.text },
          ]}
          value={text}
          onChangeText={handleTextChange}
          onSelectionChange={handleSelectionChange}
          onContentSizeChange={isWeb ? undefined : (event) => {
            const contentHeight = event.nativeEvent.contentSize.height;
            const maxContentHeight = LINE_HEIGHT * MAX_INPUT_LINES;
            setNativeScrollEnabled(contentHeight >= maxContentHeight);
          }}
          placeholder="Message..."
          placeholderTextColor={themeColors.textTertiary}
          multiline
          scrollEnabled={isWeb ? true : nativeScrollEnabled}
          maxLength={2000}
          editable={!uploading && !isSending}
        />

        {/* Send Button */}
        <Pressable
          style={[styles.sendButton, { backgroundColor: themeColors.link }, !canSend && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!canSend}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="send" size={20} color="#fff" />
          )}
        </Pressable>
      </View>

      {/* Inline Attachment Panel (below input row) */}
      <AttachmentPanel
        visible={showAttachmentMenu}
        options={attachmentOptions}
        onOptionPress={handleOptionPress}
      />
      </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
  },
  autocompleteContainer: {
    maxHeight: 200,
    borderBottomWidth: 1,
  },
  autocompleteList: {
    maxHeight: 200,
  },
  autocompleteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
  },
  autocompleteAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 12,
  },
  autocompleteAvatarPlaceholder: {
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  autocompleteAvatarText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  autocompleteName: {
    fontSize: 16,
  },
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderLeftWidth: 3,
  },
  replyContent: {
    flex: 1,
  },
  replyLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  replyText: {
    fontSize: 14,
  },
  replyCancel: {
    padding: 4,
  },
  imagePreviewContainer: {
    paddingVertical: 8,
  },
  imagePreviewList: {
    paddingHorizontal: 12,
    gap: 8,
  },
  imagePreview: {
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
  },
  previewImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  imageCount: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
  linkPreviewContainer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  uploadOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadProgress: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
  },
  removeImageButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 12,
  },
  offlineHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 12,
    gap: 4,
  },
  offlineHintText: {
    fontSize: 11,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    gap: 8,
  },
  iconButton: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: INPUT_PADDING_VERTICAL,
    fontSize: 16,
    maxHeight: LINE_HEIGHT * MAX_INPUT_LINES + INPUT_PADDING_VERTICAL * 2,
  },
  inputNative: {
    minHeight: 40,
  },
  inputWeb: {
    minHeight: 40,
    height: 'auto' as any,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
});
