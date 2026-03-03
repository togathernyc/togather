# Chat Feature Architecture

## Overview
The chat feature provides real-time messaging for groups using Convex for backend messaging.

## Current Implementation

### Primary Components

| Component | Purpose | Status |
|-----------|---------|--------|
| `InboxScreen` | Lists user's groups with unread counts | **Active** |
| `ChatRoomScreen` | Displays messages using Convex | **Active** |

## Data Flow

```
+---------------------------------------------------------------------+
|                         INBOX FLOW                                   |
+---------------------------------------------------------------------+
|  1. InboxScreen fetches groups from Convex                          |
|     useQuery(api.functions.groups.myGroups)                         |
|                                                                      |
|  2. For each group, Convex provides:                                |
|     - Unread count                                                   |
|     - Last message preview                                           |
|                                                                      |
|  3. On tap: navigate to /inbox/{groupId}                            |
|     Pass group metadata as route params                              |
+---------------------------------------------------------------------+
                              |
                              v
+---------------------------------------------------------------------+
|                      CHAT ROOM FLOW                                  |
+---------------------------------------------------------------------+
|  1. Receive group ID from route params                              |
|                                                                      |
|  2. Subscribe to messages via Convex:                               |
|     useQuery(api.functions.messages.list, { groupId })              |
|                                                                      |
|  3. If user is leader, show both main and leaders channels          |
|                                                                      |
|  4. Render message components:                                       |
|     - MessageList (messages)                                         |
|     - MessageInput (compose)                                         |
+---------------------------------------------------------------------+
```

## Key Files

```
features/chat/
├── ARCHITECTURE.md              # This file
├── components/
│   ├── InboxScreen.tsx          # Group list with unread counts
│   ├── ChatRoomScreen.tsx       # Chat UI
│   ├── MessageList.tsx          # Message list component
│   ├── MessageInput.tsx         # Message composer
│   ├── EventLinkCard.tsx        # Event card component for chat
│   ├── SystemMessage.tsx        # System message renderer (join/leave)
│   ├── index.ts                 # Barrel exports
│   └── *.test.tsx               # Tests
├── hooks/
│   └── useMessages.ts           # Message hooks
└── services/
    └── (services)
```

## Convex Messaging Integration

### Backend Functions
- `api.functions.messages.list` - Get messages for a group
- `api.functions.messages.send` - Send a message
- `api.functions.messages.markRead` - Mark messages as read

### Real-time Updates
Convex provides real-time subscriptions via `useQuery`. Messages update automatically when new messages arrive.

### Role-Based Access
- **All members**: Access to main channel
- **Leaders/Admins only**: Access to leaders channel
- Frontend shows "Leaders" tab only if user has access

## Styling

### Badge Colors (Group Types)
| Type | Background | Text |
|------|------------|------|
| Dinner Party | `rgba(102, 212, 64, 0.15)` | `#4CAF50` |
| Team | `#FEF0ED` | `#F56848` |
| Table | `#E6F3FF` | `#0A84FF` |
| Public Group | `#F2E5FE` | `#8C10FE` |

### Brand Color
Primary purple: `#8C10FE`

## Testing
- Tests use mocked Convex hooks
- Mock `useQuery` and `useMutation` for testing
