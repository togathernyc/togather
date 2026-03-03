# Explore Components Overview

## Component Files Created

1. **ExploreBottomSheet.tsx** - Main bottom sheet with 3 snap points
2. **GroupPreviewCard.tsx** - Detailed group preview card
3. **index.ts** - Barrel export for easy imports
4. **__tests__/GroupPreviewCard.test.tsx** - Unit tests (all passing ✅)

---

## Visual Layout Guide

### ExploreBottomSheet - 3 Snap Points

```
┌─────────────────────────────────────┐
│                                     │
│          MAP VIEW AREA              │
│                                     │
│                                     │
│     (Groups shown as markers)       │
│                                     │
│                                     │
│                                     │
└─────────────────────────────────────┘
          ↑
          │
┌─────────────────────────────────────┐
│         ════════ (handle)           │  ← 15% COLLAPSED
│   Swipe up to explore groups        │
│   [Chip] [Chip] [Chip]             │
└─────────────────────────────────────┘
```

```
┌─────────────────────────────────────┐
│                                     │
│          MAP VIEW AREA              │
│     (Less visible)                  │
└─────────────────────────────────────┘
          ↑
          │
┌─────────────────────────────────────┐
│         ════════ (handle)           │  ← 50% HALF
│  ┌───────────────────────────────┐  │
│  │  ┌─────────────────────────┐  │  │
│  │  │                         │  │  │
│  │  │    Group Image/Icon     │  │  │
│  │  │                         │  │  │
│  │  └─────────────────────────┘  │  │
│  │                               │  │
│  │  [DINNER PARTY]               │  │
│  │  Young Professionals Study    │  │
│  │  📍 San Francisco, CA         │  │
│  │  👤👤👤👤 +11  15 members      │  │
│  │                               │  │
│  │  [View Details]    [Join]    │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

```
┌─────────────────────────────────────┐
│         ════════ (handle)           │  ← 95% FULL
│                                     │
│  ┌───────────────────────────────┐  │
│  │   Group Item 1                │  │
│  ├───────────────────────────────┤  │
│  │   Group Item 2                │  │
│  ├───────────────────────────────┤  │
│  │   Group Item 3                │  │
│  ├───────────────────────────────┤  │
│  │   Group Item 4                │  │
│  └───────────────────────────────┘  │
│                                     │
│     (Your list content here)        │
│                                     │
│                                     │
│                                     │
└─────────────────────────────────────┘
```

---

## GroupPreviewCard Anatomy

```
┌───────────────────────────────────────┐
│  ┌─────────────────────────────────┐  │
│  │                                 │  │
│  │       Group Image               │  │  200px height
│  │       or Initials               │  │
│  │                                 │  │
│  └─────────────────────────────────┘  │
│                                       │
│  [DINNER PARTY]  ← Type Badge         │
│                                       │
│  Young Professionals Bible Study      │  ← Group Name
│                                       │
│  📍 San Francisco, CA                 │  ← Location
│                                       │
│  👤 👤 👤 👤 +11                      │  ← Member Avatars
│  15 members                           │
│                                       │
│  ┌────────────┐  ┌────────────────┐  │
│  │   View     │  │      Join      │  │  ← Action Buttons
│  │  Details   │  │                │  │
│  └────────────┘  └────────────────┘  │
└───────────────────────────────────────┘
```

---

## Features

### ExploreBottomSheet

✅ Three snap points: 15%, 50%, 95%
✅ Smooth animations with @gorhom/bottom-sheet
✅ Auto-displays selected group at 50% snap
✅ Callback when expanding to full view
✅ Works on iOS, Android, and Web
✅ Proper shadow/elevation styling

### GroupPreviewCard

✅ Displays group image or generated placeholder
✅ Shows type badge with proper styling
✅ Location display (city/state or full address)
✅ Member avatars with overflow count
✅ Singular/plural member count
✅ View Details and Join action buttons
✅ Navigation to group detail page
✅ Follows existing GroupSearchItem patterns

---

## Color Palette

- **Primary Purple**: `#8C10FE`
- **Light Purple** (badge bg): `#F3E8FF`
- **Text Dark**: `#333`
- **Text Medium**: `#666`
- **Text Light**: `#999`
- **Border/Divider**: `#E5E5E5`
- **Background**: `#fff`
- **Handle**: `#D1D5DB`

---

## Dependencies

All required dependencies are already installed:

- `@gorhom/bottom-sheet` v5.2.8 ✅
- `react-native-reanimated` v4.1.1 ✅
- `react-native-gesture-handler` v2.28.0 ✅

GestureHandlerRootView is already wrapping the app in `_layout.tsx` ✅

---

## Import Paths

```typescript
// Import both components
import { ExploreBottomSheet, GroupPreviewCard } from "@features/explore/components";

// Import types
import { Group } from "@features/groups/types";

// Import utilities (if needed)
import { getGroupTypeLabel } from "@features/groups/utils";
```

---

## Testing

Tests are located in:
`features/explore/components/__tests__/GroupPreviewCard.test.tsx`

Run tests:
```bash
npm test -- features/explore/components/__tests__/GroupPreviewCard.test.tsx
```

All 7 tests passing ✅

---

## Next Steps

1. **Create the map view** that will sit behind the bottom sheet
2. **Integrate the bottom sheet** into your Explore screen
3. **Add filter chips** to the collapsed (15%) state
4. **Create the list view component** for the full (95%) state
5. **Implement the Join functionality** in GroupPreviewCard

---

## Platform Support

- ✅ iOS
- ✅ Android
- ✅ Web (with proper shadow fallbacks)

The bottom sheet v5 has full web support, so this will work seamlessly across all platforms.
