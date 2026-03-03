# Safe Area Insets Tests

## Overview

This directory contains snapshot tests for verifying safe area insets behavior across different screens in the mobile app. Safe area insets ensure that content is not obscured by device notches, status bars, or navigation bars.

## Test File: safe-area-insets.test.tsx

### Purpose

These tests verify that screens properly handle safe area insets by:

1. **Creating snapshots** of screen layouts with known safe area values
2. **Detecting regressions** when safe area handling changes
3. **Documenting expected behavior** for different screen types

### What is Tested

#### 1. Explore Screen (ExploreScreen)

- **Expected behavior**: NO top padding on main container
- **Reason**: Map should render edge-to-edge, including under the status bar
- **Safe area handling**: Only floating elements (like filter button) respect safe area for positioning

**Tests:**
- Verifies main container has no paddingTop
- Verifies floating elements use insets for positioning
- Creates snapshots with different inset values

#### 2. Inbox Screen (StreamInboxScreen)

- **Expected behavior**: Header HAS top padding
- **Reason**: Header should respect safe area to avoid being obscured by notch
- **Safe area handling**: Header paddingTop = insets.top

**Tests:**
- Verifies header contains paddingTop
- Creates snapshots showing safe area padding
- Tests with different inset values (no notch vs. large notch)

#### 3. Profile Screen (ProfileScreen)

- **Expected behavior**: Header HAS top padding
- **Reason**: Header should respect safe area to avoid being obscured by notch
- **Safe area handling**: Header paddingTop = insets.top + base padding

**Tests:**
- Verifies header contains paddingTop
- Creates snapshots showing safe area padding
- Tests with different inset values

#### 4. Chat Room Screen (ChatRoomScreen)

- **Expected behavior**: Header HAS appropriate top padding
- **Reason**: Header should respect safe area
- **Safe area handling**: Tested in loading state

**Tests:**
- Verifies loading state renders correctly
- Creates snapshots for different inset values

## Test Approach

### Mock Safe Area Insets

Tests use controlled safe area inset values to ensure consistent snapshots:

```typescript
const mockInsets = {
  top: 47,    // iPhone with notch
  right: 0,
  bottom: 34,
  left: 0,
};
```

### Snapshot Testing

Each test creates snapshots that capture:
- Component structure
- Style properties including paddingTop
- Safe area provider configuration

If safe area handling changes, the snapshots will fail, alerting developers to verify the change is intentional.

### Multiple Inset Scenarios

Tests verify behavior with different device configurations:
- **iPhone with notch** (top: 47)
- **iPhone with larger notch** (top: 59)
- **iPad with no notch** (top: 20)

## Running the Tests

```bash
# Run all safe area tests
npm test -- features/__tests__/safe-area-insets.test.tsx

# Update snapshots if changes are intentional
npm test -- features/__tests__/safe-area-insets.test.tsx --updateSnapshot
```

## Interpreting Test Failures

If these tests fail, it means safe area insets behavior has changed:

1. **Review the snapshot diff** to see what changed
2. **Check if the change is intentional**:
   - If YES: Update snapshots with `--updateSnapshot`
   - If NO: Fix the code to restore expected behavior
3. **Test on real devices** to ensure safe area still works correctly

## Common Patterns

### Screens WITH Headers (Inbox, Profile, Chat)

```typescript
<View style={[styles.header, { paddingTop: insets.top }]}>
  <Text>Header Title</Text>
</View>
```

### Screens WITHOUT Headers (Explore)

```typescript
<View style={styles.container}>
  {/* No paddingTop - renders edge-to-edge */}
  <MapComponent />

  {/* Floating elements use insets */}
  <TouchableOpacity style={[styles.button, { top: insets.top + 12 }]}>
    ...
  </TouchableOpacity>
</View>
```

## Related Files

- `/apps/mobile/features/explore/components/ExploreScreen.tsx` - Edge-to-edge map
- `/apps/mobile/features/chat/components/StreamInboxScreen.tsx` - Inbox with safe area
- `/apps/mobile/features/profile/components/ProfileScreen.tsx` - Profile with safe area
- `/apps/mobile/features/chat/components/ChatRoomScreen.tsx` - Chat room

## Snapshot Locations

Snapshots are stored in:
```
/apps/mobile/features/__tests__/__snapshots__/safe-area-insets.test.tsx.snap
```

## Future Enhancements

Potential additions to these tests:

1. **Bottom safe area tests** - Verify home indicator area handling
2. **Landscape orientation tests** - Test safe area in landscape mode
3. **Interactive tests** - Test safe area with keyboard visible
4. **Animation tests** - Verify safe area during screen transitions
