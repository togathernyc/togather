# Profile Feature

## Overview

The Profile feature handles user profile viewing and editing, including photo upload. It provides components and hooks for displaying profile information, editing profile details, and managing profile photos.

## Purpose

- Display user profile information
- Edit profile details (name, email, phone, etc.)
- Upload and update profile photo
- Remove profile photo

## User Flows

### Profile View Flow

1. User navigates to `/profile` → `ProfileScreen` component
2. Screen fetches user profile via `useProfile` hook
3. Profile displayed with:
   - Profile header (avatar, name, email, phone)
   - Profile menu (Edit Profile, Settings, Search Groups)
4. User clicks "Edit Profile" → Navigates to `/edit-profile`
5. User clicks "Logout" → Logs out and redirects to sign in

### Edit Profile Flow

1. User navigates to `/edit-profile` → `EditProfileScreen` component
2. Screen fetches user profile via `useProfile` hook
3. Profile form displayed with:
   - Photo upload
   - First name, last name
   - Email, phone
   - Other profile fields
4. User edits fields → `EditProfileForm` component
5. User uploads photo → `useUpdateProfilePhoto` hook
6. User submits form → `useUpdateProfile` hook
7. On success → Profile updated and user redirected to profile

## Route Structure

| Route | File | Component |
|-------|------|-----------|
| `/profile` | `app/(user)/profile/index.tsx` | `ProfileScreen` |
| `/edit-profile` | `app/(user)/edit-profile/index.tsx` | `EditProfileScreen` |

## Components

### ProfileScreen

**Location:** `features/profile/components/ProfileScreen.tsx`

**Purpose:** Main profile screen with logout functionality.

**Features:**
- Profile header
- Profile menu
- Logout button
- Navigation to edit profile

**Usage:**
```typescript
import { ProfileScreen } from "@/features/profile/components/ProfileScreen";
```

### ProfileHeader

**Location:** `features/profile/components/ProfileHeader.tsx`

**Purpose:** Profile header with avatar, name, email, and phone.

**Features:**
- Avatar display
- User name
- Email display
- Phone display

**Usage:**
```typescript
import { ProfileHeader } from "@/features/profile/components/ProfileHeader";
```

### ProfileMenu

**Location:** `features/profile/components/ProfileMenu.tsx`

**Purpose:** Menu items for Edit Profile, Settings, and Search Groups.

**Features:**
- Edit Profile menu item
- Settings menu item
- Search Groups menu item
- Navigation handlers

**Usage:**
```typescript
import { ProfileMenu } from "@/features/profile/components/ProfileMenu";
```

### EditProfileScreen

**Location:** `features/profile/components/EditProfileScreen.tsx`

**Purpose:** Main edit profile screen with header.

**Features:**
- Header with back button
- Edit profile form
- Loading states
- Error handling

**Usage:**
```typescript
import { EditProfileScreen } from "@/features/profile/components/EditProfileScreen";
```

### EditProfileForm

**Location:** `features/profile/components/EditProfileForm.tsx`

**Purpose:** Complete edit profile form with photo upload and form fields.

**Features:**
- Photo upload
- First name, last name inputs
- Email, phone inputs
- Other profile fields
- Validation
- Error handling
- Loading states

**Usage:**
```typescript
import { EditProfileForm } from "@/features/profile/components/EditProfileForm";
```

## Hooks

### useProfile

**Location:** `features/profile/hooks/useProfile.ts`

**Purpose:** Fetches user profile data.

**Returns:**
- `data` - Profile data
- `isLoading` - Loading state
- `error` - Error state
- `refetch` - Refetch function

**Usage:**
```typescript
import { useProfile } from "@/features/profile/hooks/useProfile";

const { data: profile, isLoading, error } = useProfile();
```

### useUpdateProfile

**Location:** `features/profile/hooks/useUpdateProfile.ts`

**Purpose:** Handles profile information updates.

**Returns:**
- `mutate` - Update profile mutation function
- `isLoading` - Loading state
- `error` - Error state

**Usage:**
```typescript
import { useUpdateProfile } from "@/features/profile/hooks/useUpdateProfile";

const { mutate: updateProfile, isLoading, error } = useUpdateProfile();

updateProfile({ first_name, last_name, email, phone });
```

**Features:**
- Query invalidation
- Success/error handling

### useUpdateProfilePhoto

**Location:** `features/profile/hooks/useUpdateProfilePhoto.ts`

**Purpose:** Handles profile photo uploads.

**Returns:**
- `mutate` - Update photo mutation function
- `isLoading` - Loading state
- `error` - Error state

**Usage:**
```typescript
import { useUpdateProfilePhoto } from "@/features/profile/hooks/useUpdateProfilePhoto";

const { mutate: updatePhoto, isLoading, error } = useUpdateProfilePhoto();

updatePhoto(imageUri);
```

**Features:**
- FormData handling
- Query invalidation
- Success/error handling

### useRemoveProfilePhoto

**Location:** `features/profile/hooks/useUpdateProfilePhoto.ts`

**Purpose:** Handles profile photo removal.

**Returns:**
- `mutate` - Remove photo mutation function
- `isLoading` - Loading state
- `error` - Error state

**Usage:**
```typescript
import { useRemoveProfilePhoto } from "@/features/profile/hooks/useUpdateProfilePhoto";

const { mutate: removePhoto, isLoading, error } = useRemoveProfilePhoto();

removePhoto();
```

**Features:**
- Query invalidation
- Success/error handling

## API Endpoints

**Location:** `features/profile/services/profile.api.ts`

The profile service re-exports from the main API modules:

```typescript
import { membersApi } from "../../../services/api/members";

export const profileService = {
  getUserByToken: membersApi.getUserByToken,
  updateProfileInfo: membersApi.updateProfileInfo,
  updateProfilePhoto: membersApi.updateProfilePhoto,
  removeProfilePhoto: membersApi.removeProfilePhoto,
};
```

**Available Methods:**
- `getUserByToken()` - Get user profile
- `updateProfileInfo(data)` - Update profile information
- `updateProfilePhoto(formData)` - Update profile photo
- `removeProfilePhoto()` - Remove profile photo

## Utilities

### createProfileFormData

**Location:** `features/profile/utils/createProfileFormData.ts`

**Purpose:** Creates FormData for profile photo uploads (handles web and native platforms).

**Usage:**
```typescript
import { createProfileFormData } from "@/features/profile/utils/createProfileFormData";

const formData = createProfileFormData(imageUri);
```

**Features:**
- Handles web platform (File object)
- Handles native platform (URI)
- Creates FormData with correct format

## Types

**Location:** `features/profile/types.ts`

### Profile

```typescript
interface Profile {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  profile_photo?: string;
  // ... other profile fields
}
```

### ProfileFormData

```typescript
interface ProfileFormData {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  // ... other profile fields
}
```

## Examples

### Using Profile Hook

```typescript
import { useProfile } from "@/features/profile/hooks/useProfile";

function ProfileScreen() {
  const { data: profile, isLoading, error } = useProfile();

  if (isLoading) return <LoadingSkeleton />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <View>
      <ProfileHeader profile={profile} />
      <ProfileMenu />
    </View>
  );
}
```

### Using Update Profile Hook

```typescript
import { useUpdateProfile } from "@/features/profile/hooks/useUpdateProfile";

function EditProfileForm() {
  const { mutate: updateProfile, isLoading, error } = useUpdateProfile();
  const [formData, setFormData] = useState({ first_name: "", last_name: "", email: "", phone: "" });

  const handleSubmit = () => {
    updateProfile(formData);
  };

  return (
    <View>
      <TextInput value={formData.first_name} onChangeText={(text) => setFormData({ ...formData, first_name: text })} />
      <TextInput value={formData.last_name} onChangeText={(text) => setFormData({ ...formData, last_name: text })} />
      <TextInput value={formData.email} onChangeText={(text) => setFormData({ ...formData, email: text })} />
      <Button onPress={handleSubmit} disabled={isLoading}>
        Save
      </Button>
    </View>
  );
}
```

### Using Update Photo Hook

```typescript
import { useUpdateProfilePhoto } from "@/features/profile/hooks/useUpdateProfilePhoto";
import { createProfileFormData } from "@/features/profile/utils/createProfileFormData";

function PhotoUpload() {
  const { mutate: updatePhoto, isLoading, error } = useUpdateProfilePhoto();

  const handlePhotoSelect = async (imageUri) => {
    const formData = createProfileFormData(imageUri);
    updatePhoto(formData);
  };

  return (
    <View>
      <ImagePicker onSelect={handlePhotoSelect} />
      {isLoading && <ActivityIndicator />}
      {error && <Text>{error.message}</Text>}
    </View>
  );
}
```

## Related Documentation

- [Feature Index](./README.md)
- [Architecture Decision Records](../architecture/decisions/)
- [Routing Guide](../development/ROUTING.md)
- [API Integration Guide](../development/API_INTEGRATION.md)

