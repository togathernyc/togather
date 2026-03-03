# Settings Feature

## Overview

The Settings feature handles user settings management (name, email, etc.). It provides components and hooks for displaying and editing user settings.

## Purpose

- Display user settings
- Edit user settings (first name, last name)
- Toggle edit mode

## User Flows

### Settings Flow

1. User navigates to `/settings` → `SettingsScreen` component
2. Screen displays settings form via `useSettings` hook
3. Settings displayed with:
   - First name, last name
   - Edit mode toggle
4. User toggles edit mode → Form becomes editable
5. User edits fields → `SettingsForm` component
6. User submits form → `useUpdateSettings` hook
7. On success → Settings updated and edit mode toggled off

## Route Structure

| Route | File | Component |
|-------|------|-----------|
| `/settings` | `app/(user)/settings/index.tsx` | `SettingsScreen` |

## Components

### SettingsScreen

**Location:** `features/settings/components/SettingsScreen.tsx`

**Purpose:** Main settings screen with header.

**Features:**
- Header with title
- Settings form
- Loading states
- Error handling

**Usage:**
```typescript
import { SettingsScreen } from "@/features/settings/components/SettingsScreen";
```

### SettingsForm

**Location:** `features/settings/components/SettingsForm.tsx`

**Purpose:** Form with edit mode toggle and validation.

**Features:**
- First name, last name inputs
- Edit mode toggle
- Validation
- Error handling
- Loading states

**Usage:**
```typescript
import { SettingsForm } from "@/features/settings/components/SettingsForm";
```

## Hooks

### useSettings

**Location:** `features/settings/hooks/useSettings.ts`

**Purpose:** Manages settings state (firstName, lastName, isEditing).

**Returns:**
- `firstName`, `setFirstName` - First name state
- `lastName`, `setLastName` - Last name state
- `isEditing`, `setIsEditing` - Edit mode state
- `handleSave` - Save function
- `handleCancel` - Cancel function

**Usage:**
```typescript
import { useSettings } from "@/features/settings/hooks/useSettings";

const { firstName, setFirstName, lastName, setLastName, isEditing, setIsEditing, handleSave, handleCancel } = useSettings();
```

### useUpdateSettings

**Location:** `features/settings/hooks/useUpdateSettings.ts`

**Purpose:** Handles settings update mutation with query invalidation.

**Returns:**
- `mutate` - Update settings mutation function
- `isLoading` - Loading state
- `error` - Error state

**Usage:**
```typescript
import { useUpdateSettings } from "@/features/settings/hooks/useUpdateSettings";

const { mutate: updateSettings, isLoading, error } = useUpdateSettings();

updateSettings({ first_name: firstName, last_name: lastName });
```

**Features:**
- Query invalidation
- Success/error handling
- Toggles edit mode off on success

## API Endpoints

**Location:** `features/settings/services/settings.api.ts`

The settings service re-exports from the main API modules:

```typescript
import { membersApi } from "../../../services/api/members";

export const settingsService = {
  updateProfileInfo: membersApi.updateProfileInfo,
};
```

**Available Methods:**
- `updateProfileInfo(data)` - Update profile information (first name, last name)

## Types

**Location:** `features/settings/types.ts`

### Settings

```typescript
interface Settings {
  first_name: string;
  last_name: string;
}
```

### SettingsFormData

```typescript
interface SettingsFormData {
  first_name: string;
  last_name: string;
}
```

## Examples

### Using Settings Hook

```typescript
import { useSettings } from "@/features/settings/hooks/useSettings";
import { useUpdateSettings } from "@/features/settings/hooks/useUpdateSettings";

function SettingsForm() {
  const { firstName, setFirstName, lastName, setLastName, isEditing, setIsEditing } = useSettings();
  const { mutate: updateSettings, isLoading, error } = useUpdateSettings();

  const handleSave = () => {
    updateSettings({ first_name: firstName, last_name: lastName });
    setIsEditing(false);
  };

  return (
    <View>
      <TextInput
        value={firstName}
        onChangeText={setFirstName}
        editable={isEditing}
      />
      <TextInput
        value={lastName}
        onChangeText={setLastName}
        editable={isEditing}
      />
      {isEditing ? (
        <View>
          <Button onPress={handleSave} disabled={isLoading}>
            Save
          </Button>
          <Button onPress={() => setIsEditing(false)}>
            Cancel
          </Button>
        </View>
      ) : (
        <Button onPress={() => setIsEditing(true)}>
          Edit
        </Button>
      )}
    </View>
  );
}
```

## Related Documentation

- [Feature Index](./README.md)
- [Architecture Decision Records](../architecture/decisions/)
- [Routing Guide](../development/ROUTING.md)
- [API Integration Guide](../development/API_INTEGRATION.md)

