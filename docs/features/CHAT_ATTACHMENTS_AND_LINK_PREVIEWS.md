# Chat Attachments & Link Previews Implementation

> **For AI Agents:** You are the orchestrator. Spawn parallel agents for exploration and implementation. Make incremental commits after each logical unit. Do not try to implement everything yourself - delegate to focused subagents.

## Overview

Two features requested by David Walker Jr.:
1. **File Attachments** - Support PDF, Word, Excel, CSV, TXT, audio, video (not just photos)
2. **Link Previews** - Show Open Graph preview cards for URLs (dismissable before sending)

## Critical Constraints

### Native Module Gating
The app is actively used with OTA updates. New native modules won't exist until users update their app.

- `expo-document-picker` - Required for file picking (hide feature if unavailable)
- `expo-av` - Required for audio/video playback (fallback to download link if unavailable)
- Link previews require NO native modules (safe to ship via OTA)

### File Size Limit
- **10MB maximum** - Prevents large video uploads
- Show clear error: "File too large. Maximum size is 10MB. Please compress before uploading."

---

## Phase 1: Link Previews (No Native Deps - OTA Safe)

### Status: [ ] Not Started / [ ] In Progress / [x] Completed

### 1.1 Backend: OG Metadata Fetching
- [ ] Create `apps/convex/functions/linkPreview.ts`
  - [ ] `fetchOgMetadata` action that fetches URL and parses OG tags
  - [ ] Handle errors gracefully (return null on failure)
  - [ ] Extract: title, description, image, siteName, favicon
- [ ] Add HTTP endpoint to `apps/convex/http.ts`
  - [ ] `GET /api/link-preview?url=<encoded_url>`
  - [ ] Rate limit consideration (optional)

**Commit after:** "feat(chat): add Open Graph metadata fetching endpoint"

### 1.2 Frontend: Link Preview Utilities
- [ ] Update `apps/mobile/features/chat/utils/eventLinkUtils.ts`
  - [ ] Add `isTogatherLink(url)` - returns true for togather.nyc URLs
  - [ ] Add `extractFirstExternalUrl(text)` - returns first non-Togather URL
  - [ ] Add `getDomainFromUrl(url)` - extracts domain for display

**Commit after:** "feat(chat): add link preview utility functions"

### 1.3 Frontend: useLinkPreview Hook
- [ ] Create `apps/mobile/features/chat/hooks/useLinkPreview.ts`
  - [ ] Fetch OG data from Convex HTTP endpoint
  - [ ] In-memory cache with 5-minute TTL
  - [ ] Return `{ data, isLoading, error }`
  - [ ] Skip fetch for togather.nyc URLs

**Commit after:** "feat(chat): add useLinkPreview hook with caching"

### 1.4 Frontend: LinkPreviewCard Component
- [ ] Create `apps/mobile/features/chat/components/LinkPreviewCard.tsx`
  - [ ] Props: `url`, `isMyMessage?`, `onDismiss?`, `embedded?`
  - [ ] Loading skeleton state
  - [ ] Error state (just show domain, no card)
  - [ ] Display: image (or favicon fallback), title, description, site name
  - [ ] Tappable to open URL in browser
  - [ ] Optional X button for dismiss (when `onDismiss` provided)
  - [ ] Style similar to EventLinkCard

**Commit after:** "feat(chat): add LinkPreviewCard component"

### 1.5 Frontend: MessageInput Integration
- [ ] Update `apps/mobile/features/chat/components/MessageInput.tsx`
  - [ ] Add state: `linkPreview: { url: string } | null`
  - [ ] Add state: `linkPreviewDismissed: boolean`
  - [ ] Detect URLs in text with 500ms debounce
  - [ ] Show LinkPreviewCard below text input (above send button)
  - [ ] Handle dismiss (set `linkPreviewDismissed = true`)
  - [ ] Reset dismissed state when URL changes
  - [ ] Clear preview after successful send

**Commit after:** "feat(chat): add link preview to message composer"

### 1.6 Frontend: MessageItem Integration
- [ ] Update `apps/mobile/features/chat/components/MessageItem.tsx`
  - [ ] Extract first external URL from message content
  - [ ] Skip if message already has EventLinkCard (togather.nyc links)
  - [ ] Render LinkPreviewCard below message text
  - [ ] Don't duplicate - if URL is in text and has preview, that's fine

**Commit after:** "feat(chat): render link previews in chat messages"

### 1.7 Testing & Review
- [ ] Test with Spotify, YouTube, Twitter, generic website links
- [ ] Test dismiss functionality in composer
- [ ] Test that togather.nyc links still show EventLinkCard
- [ ] Test failed fetch (shows URL only, no error)
- [ ] Code review for Phase 1

**Commit after:** "test(chat): verify link preview functionality"

---

## Phase 2: File Attachments Backend

### Status: [ ] Not Started / [ ] In Progress / [ ] Completed

### 2.1 File Type Constants
- [ ] Update `apps/convex/functions/uploads.ts`
  - [ ] Add `MAX_FILE_SIZE = 10 * 1024 * 1024` (10MB)
  - [ ] Add `DOCUMENT_EXTENSIONS` and `DOCUMENT_CONTENT_TYPES`
    - PDF, TXT, DOC, DOCX, XLS, XLSX, CSV
  - [ ] Add `AUDIO_EXTENSIONS` and `AUDIO_CONTENT_TYPES`
    - MP3, WAV, M4A, AAC
  - [ ] Add `VIDEO_EXTENSIONS` and `VIDEO_CONTENT_TYPES`
    - MP4, MOV, WEBM
  - [ ] Combine into `ALL_ALLOWED_*` arrays (includes existing images)

**Commit after:** "feat(uploads): add file type whitelist for chat attachments"

### 2.2 File Upload Action
- [ ] Create `getR2FileUploadUrl` action in `apps/convex/functions/uploads.ts`
  - [ ] Args: `fileName`, `contentType`, `fileSize`, `folder`
  - [ ] Validate file size <= 10MB
  - [ ] Validate extension in whitelist
  - [ ] Validate content type in whitelist
  - [ ] Generate presigned R2 upload URL
  - [ ] Return `{ uploadUrl, storagePath }`

**Commit after:** "feat(uploads): add getR2FileUploadUrl action with validation"

### 2.3 Server-side Message Validation (Optional)
- [ ] Update `apps/convex/functions/messaging/messages.ts`
  - [ ] In `sendMessage`, validate attachment mimeTypes are in whitelist
  - [ ] Reject messages with disallowed file types

**Commit after:** "feat(messaging): validate attachment types server-side"

---

## Phase 3: File Attachments Frontend

### Status: [ ] Not Started / [ ] In Progress / [ ] Completed

### 3.1 Install Dependencies
- [ ] Run: `cd apps/mobile && pnpm add expo-document-picker expo-av`
- [ ] Verify in package.json

**Commit after:** "chore(mobile): add expo-document-picker and expo-av"

### 3.2 File Type Utilities
- [ ] Create `apps/mobile/features/chat/utils/fileTypes.ts`
  - [ ] `ALLOWED_DOCUMENT_TYPES`, `ALLOWED_AUDIO_TYPES`, `ALLOWED_VIDEO_TYPES`
  - [ ] `MAX_FILE_SIZE = 10 * 1024 * 1024`
  - [ ] `isAllowedFileType(mimeType)` - check against whitelist
  - [ ] `getFileCategory(mimeType)` - returns 'document' | 'audio' | 'video' | 'image'
  - [ ] `formatFileSize(bytes)` - "1.2 MB", "500 KB"
  - [ ] `getFileIcon(mimeType)` - returns Ionicons name
  - [ ] `isDocumentPickerSupported()` - check if native module available
  - [ ] `isAudioVideoSupported()` - check if expo-av available

**Commit after:** "feat(chat): add file type utilities and native module checks"

### 3.3 useFileUpload Hook
- [ ] Create `apps/mobile/features/chat/hooks/useFileUpload.ts`
  - [ ] Follow pattern from `useImageUpload.ts`
  - [ ] Call `getR2FileUploadUrl` instead of `getR2UploadUrl`
  - [ ] Track upload progress
  - [ ] Return `{ uploadFile, uploading, progress, reset }`

**Commit after:** "feat(chat): add useFileUpload hook"

### 3.4 FilePreview Component
- [ ] Create `apps/mobile/features/chat/components/FilePreview.tsx`
  - [ ] Props: `file: { uri, name, size, mimeType }`, `onRemove`, `uploading?`, `progress?`
  - [ ] Show file icon based on type
  - [ ] Show filename (truncated) and size
  - [ ] Show upload progress indicator
  - [ ] X button to remove

**Commit after:** "feat(chat): add FilePreview component"

### 3.5 FileAttachment Component
- [ ] Create `apps/mobile/features/chat/components/FileAttachment.tsx`
  - [ ] Props: `attachment`, `isOwnMessage`
  - [ ] Show file icon, name, size
  - [ ] Download button that opens URL via Linking
  - [ ] Works even without native modules (download always works)

**Commit after:** "feat(chat): add FileAttachment component"

### 3.6 AudioPlayer Component (Gated)
- [ ] Create `apps/mobile/features/chat/components/AudioPlayer.tsx`
  - [ ] Check `isAudioVideoSupported()` first
  - [ ] If not supported: render download button fallback
  - [ ] If supported: use expo-av Audio
  - [ ] Play/pause button, progress slider, duration display

**Commit after:** "feat(chat): add AudioPlayer component with native fallback"

### 3.7 VideoPlayer Component (Gated)
- [ ] Create `apps/mobile/features/chat/components/VideoPlayer.tsx`
  - [ ] Check `isAudioVideoSupported()` first
  - [ ] If not supported: render download button fallback
  - [ ] If supported: use expo-av Video with native controls
  - [ ] Thumbnail/poster support

**Commit after:** "feat(chat): add VideoPlayer component with native fallback"

### 3.8 MessageInput: File Picker Integration
- [ ] Update `apps/mobile/features/chat/components/MessageInput.tsx`
  - [ ] Import expo-document-picker (dynamic/try-catch)
  - [ ] Add `selectedFiles` state (array like selectedImages)
  - [ ] Check `isDocumentPickerSupported()` to show/hide option
  - [ ] Add "Choose File" to action sheet (only if supported)
  - [ ] Implement `pickFile()`:
    - [ ] Validate file size <= 10MB
    - [ ] Validate file type in whitelist
    - [ ] Show Alert if invalid
    - [ ] Add to selectedFiles state
  - [ ] Render FilePreview components
  - [ ] Include files in sendMessage attachments

**Commit after:** "feat(chat): add file picker to message composer"

### 3.9 MessageItem: File Rendering
- [ ] Update `apps/mobile/features/chat/components/MessageItem.tsx`
  - [ ] Categorize attachments by type (image, document, audio, video)
  - [ ] Render ImageAttachmentsGrid for images (existing)
  - [ ] Render AudioPlayer for audio attachments
  - [ ] Render VideoPlayer for video attachments
  - [ ] Render FileAttachment for document attachments

**Commit after:** "feat(chat): render file attachments in messages"

### 3.10 Testing & Review
- [ ] Test on NEW native build:
  - [ ] Document picker appears and works
  - [ ] Audio/video playback works
  - [ ] 10MB limit enforced
  - [ ] Invalid file types rejected
- [ ] Test on OLD app version (OTA only):
  - [ ] "Choose File" option hidden
  - [ ] Audio/video show download button
  - [ ] Document attachments show download button
- [ ] Code review for Phase 3

**Commit after:** "test(chat): verify file attachment functionality"

---

## Orchestration Instructions

### For AI Agents

When implementing this feature:

1. **Read this file first** - Understand the full scope before starting

2. **Work in phases** - Complete Phase 1 (link previews) before Phase 2-3 (file attachments)

3. **Spawn parallel agents** for independent tasks:
   ```
   Phase 1 parallelization:
   - Agent A: Backend (1.1, 1.2)
   - Agent B: Frontend utilities & hook (1.2, 1.3)
   - Agent C: Components (1.4)
   Then integrate (1.5, 1.6) sequentially

   Phase 3 parallelization:
   - Agent A: Utilities & hook (3.2, 3.3)
   - Agent B: Preview components (3.4, 3.5)
   - Agent C: Player components (3.6, 3.7)
   Then integrate (3.8, 3.9) sequentially
   ```

4. **Commit after each checkbox section** - Don't batch unrelated changes

5. **Update this file** - Check off completed items as you go

6. **Code review at phase boundaries** - Don't rush through all phases

### Resumption

If work is interrupted:
1. Read this file to see what's checked off
2. Find the last commit message to understand where you stopped
3. Continue from the next unchecked item
4. Update checkboxes as you complete items

---

## File Reference

### Backend Files
- `apps/convex/functions/uploads.ts` - File upload with R2
- `apps/convex/functions/messaging/messages.ts` - Message mutations
- `apps/convex/http.ts` - HTTP routes
- `apps/convex/schema.ts` - Database schema (already supports attachments)

### Frontend Files
- `apps/mobile/features/chat/components/MessageInput.tsx` - Message composer
- `apps/mobile/features/chat/components/MessageItem.tsx` - Message rendering
- `apps/mobile/features/chat/components/EventLinkCard.tsx` - Pattern to follow
- `apps/mobile/features/chat/hooks/useImageUpload.ts` - Pattern to follow
- `apps/mobile/features/chat/utils/eventLinkUtils.ts` - URL utilities

### New Files to Create
- `apps/convex/functions/linkPreview.ts`
- `apps/mobile/features/chat/hooks/useLinkPreview.ts`
- `apps/mobile/features/chat/hooks/useFileUpload.ts`
- `apps/mobile/features/chat/utils/fileTypes.ts`
- `apps/mobile/features/chat/components/LinkPreviewCard.tsx`
- `apps/mobile/features/chat/components/FilePreview.tsx`
- `apps/mobile/features/chat/components/FileAttachment.tsx`
- `apps/mobile/features/chat/components/AudioPlayer.tsx`
- `apps/mobile/features/chat/components/VideoPlayer.tsx`
