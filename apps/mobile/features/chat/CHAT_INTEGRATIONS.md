# Chat Integrations Design

This document outlines the architecture for custom chat integrations like meeting cards, polls, and other rich content.

## Architecture Overview

### Content Types

Messages use the `contentType` field to determine rendering:

| Type | Description | Data Location |
|------|-------------|---------------|
| `text` | Plain text with optional mentions | `content` field |
| `image` | Image attachment(s) | `attachments[]` |
| `file` | File attachment(s) | `attachments[]` |
| `system` | System messages | `content` field |

### Rich Content Detection

Rather than requiring special content types, we detect rich content inline:

1. **URL Detection** - Scan message `content` for special URLs
2. **Component Rendering** - Render appropriate component based on URL pattern

### URL Patterns

| Pattern | Component | Example |
|---------|-----------|---------|
| `togather.nyc/e/{shortId}` | `EventLinkCard` | Meeting/event card with RSVP |
| `togather.nyc/g/{groupId}` | `GroupLinkCard` | Group preview card |
| `togather.nyc/poll/{id}` | `PollCard` | Interactive poll (future) |

## Implementation

### 1. Meeting Cards (Event Links)

**Detection:** Regex pattern `togather\.nyc/e/([a-zA-Z0-9]+)`

**Component:** `EventLinkCard` (already exists)
- Fetches event by shortId
- Shows cover image, title, date, location
- RSVP options with progress bars
- Access control handled automatically

**Integration Point:** `MessageItem.tsx` renders `EventLinkCard` when URL detected

### 2. Polls (Future)

**Content Type:** `poll`

**Schema Addition:**
```typescript
// In attachments or new metadata field
{
  type: "poll",
  question: string,
  options: Array<{ id: number, text: string }>,
  votes: Record<optionId, userId[]>,
  isOpen: boolean,
  expiresAt?: number,
}
```

**Features:**
- Single/multi-select voting
- Real-time vote counts
- Expiration support
- Anonymous voting option

### 3. Image Multi-Select

**Changes to MessageInput:**
- Enable `allowsMultipleSelection: true`
- Disable `allowsEditing` (mutually exclusive)
- Update state to handle `string[]` instead of `string`
- Show horizontal scroll of image previews
- Upload images in parallel

## File Structure

```
features/chat/
├── components/
│   ├── MessageItem.tsx          # Main message renderer
│   ├── EventLinkCard.tsx        # Meeting card (exists)
│   ├── EventLinkPreview.tsx     # Composer preview (exists)
│   ├── PollCard.tsx             # Poll component (future)
│   └── richContent/
│       ├── detectRichContent.ts # URL/content detection
│       └── RichContentRenderer.tsx
├── hooks/
│   ├── useConvexSendMessage.ts  # Send with attachments
│   ├── useImageUpload.ts        # Single → multi upload
│   └── usePollVote.ts           # Poll voting (future)
└── utils/
    └── eventLinkUtils.ts        # Event URL detection (exists)
```

## Integration Steps

### Phase 1: Meeting Cards (Now)
1. ✅ EventLinkCard component exists
2. → Detect togather.nyc/e/ URLs in MessageItem
3. → Render EventLinkCard inline
4. → Hide raw URL when card renders

### Phase 2: Multi-Image (Now)
1. → Enable allowsMultipleSelection
2. → Update state for multiple images
3. → Add horizontal preview scroll
4. → Parallel upload handling

### Phase 3: Polls (Future)
1. Add poll creation UI
2. Create poll schema/mutations
3. Build PollCard component
4. Add vote tracking

## Notes

- All rich content respects access control
- Cards fallback to plain URLs if data unavailable
- Real-time updates via Convex subscriptions
- Mobile-first design with responsive layouts
