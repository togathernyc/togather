# Explore Components

This directory contains the bottom sheet components for the Explore feature.

## Components

### ExploreBottomSheet

A bottom sheet component with three snap points for exploring groups on the map.

**Props:**
- `selectedGroup: Group | null` - The currently selected group to preview
- `onExpandFull?: () => void` - Callback when the sheet expands to full (95%)
- `children?: React.ReactNode` - Content to show in the full view (typically a list)

**Snap Points:**
- **15% (Collapsed)**: Shows drag handle and filter chips placeholder
- **50% (Half)**: Shows selected group preview card
- **95% (Full)**: Shows full list view content (children)

**Usage Example:**
```tsx
import { ExploreBottomSheet } from "@features/explore/components";
import { Group } from "@features/groups/types";

function ExploreScreen() {
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);

  return (
    <View style={{ flex: 1 }}>
      {/* Map View */}
      <MapView onMarkerPress={(group) => setSelectedGroup(group)} />

      {/* Bottom Sheet */}
      <ExploreBottomSheet
        selectedGroup={selectedGroup}
        onExpandFull={() => console.log("Expanded to full view")}
      >
        {/* List content for full view */}
        <GroupList groups={allGroups} />
      </ExploreBottomSheet>
    </View>
  );
}
```

### GroupPreviewCard

A card component showing detailed information about a group, designed for the bottom sheet preview.

**Props:**
- `group: Group` - The group to display

**Features:**
- Group image or placeholder with initials
- Type badge
- Group name
- Location info
- Member avatars with count
- "View Details" and "Join" action buttons

**Usage Example:**
```tsx
import { GroupPreviewCard } from "@features/explore/components";

function GroupPreview({ group }: { group: Group }) {
  return <GroupPreviewCard group={group} />;
}
```

## Dependencies

- `@gorhom/bottom-sheet` v5 - Bottom sheet implementation
- `react-native-reanimated` - Required by bottom-sheet
- `react-native-gesture-handler` - Required by bottom-sheet

These are already installed and configured in the app.

## Styling

The components follow the app's design system:
- Primary purple: `#8C10FE`
- Text: `#333`
- Muted text: `#666`
- Border: `#E5E5E5`
- Background: `#fff`

Components use shadows that work on both mobile and web platforms.
