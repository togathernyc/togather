import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useAuth } from '@providers/AuthProvider';
import { FormInput, Button, ImagePicker } from '@components/ui';
import { profileSchema, ProfileFormData } from '../types';
import { useUpdateProfile, useUpdateProfilePhoto, useRemoveProfilePhoto } from '../hooks';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useTheme } from '@hooks/useTheme';

interface EditProfileFormProps {
  onCancel?: () => void;
}

export function EditProfileForm({ onCancel }: EditProfileFormProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();
  const [profileImage, setProfileImage] = useState<string | null>(user?.profile_photo || null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // Format date from YYYY-MM-DD to MM/DD/YYYY for display
  const formatDateForDisplay = (dateStr: string | undefined): string => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return '';
    return `${parts[1]}/${parts[2]}/${parts[0]}`;
  };

  // Auto-insert slashes as the user types digits (MM/DD/YYYY).
  // The birthday field uses a number-pad keyboard that has no "/" key,
  // so we format on input instead of requiring the user to type it.
  const formatBirthdayInput = (text: string): string => {
    const cleaned = text.replace(/\D/g, '');
    if (cleaned.length <= 2) return cleaned;
    if (cleaned.length <= 4) return `${cleaned.substring(0, 2)}/${cleaned.substring(2)}`;
    return `${cleaned.substring(0, 2)}/${cleaned.substring(2, 4)}/${cleaned.substring(4, 8)}`;
  };

  // MM/DD-only input formatter for the Profile Information birthday field.
  // Same idea as `formatBirthdayInput` but caps at 4 digits (month + day).
  const formatBirthdayMdInput = (text: string): string => {
    const cleaned = text.replace(/\D/g, '').slice(0, 4);
    if (cleaned.length <= 2) return cleaned;
    return `${cleaned.substring(0, 2)}/${cleaned.substring(2)}`;
  };

  // Seed the M/D birthday from separate month/day fields on the user, which
  // are how the Convex `users` table stores this value.
  const formatBirthdayMdFromUser = (
    month: number | undefined,
    day: number | undefined,
  ): string => {
    if (!month || !day) return '';
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${mm}/${dd}`;
  };

  // Validate date string in MM/DD/YYYY format
  const validateDate = useCallback((dateStr: string): { valid: boolean; dateForApi?: string; error?: string } => {
    if (!dateStr) return { valid: true }; // Optional field

    const parts = dateStr.split('/');
    if (parts.length !== 3) {
      return { valid: false, error: 'Please enter a valid date (MM/DD/YYYY)' };
    }

    const [month, day, year] = parts.map(Number);
    if (!month || !day || !year) {
      return { valid: false, error: 'Please enter a valid date (MM/DD/YYYY)' };
    }

    if (month < 1 || month > 12) {
      return { valid: false, error: 'Month must be between 1 and 12' };
    }
    if (day < 1 || day > 31) {
      return { valid: false, error: 'Day must be between 1 and 31' };
    }
    if (year < 1900 || year > new Date().getFullYear()) {
      return { valid: false, error: 'Please enter a valid year' };
    }

    const date = new Date(year, month - 1, day);
    if (date.getMonth() !== month - 1 || date.getDate() !== day) {
      return { valid: false, error: 'Please enter a valid date' };
    }

    // Format as YYYY-MM-DD for API
    const yearStr = String(year);
    const monthStr = String(month).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    return { valid: true, dateForApi: `${yearStr}-${monthStr}-${dayStr}` };
  }, []);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      first_name: user?.first_name || '',
      last_name: user?.last_name || '',
      email: user?.email || '',
      phone: user?.phone || '',
      date_of_birth: formatDateForDisplay(user?.date_of_birth),
      zip_code: user?.zip_code || '',
      bio: (user as any)?.bio || '',
      instagram_handle: (user as any)?.instagram_handle || '',
      linkedin_handle: (user as any)?.linkedin_handle || '',
      birthday_md: formatBirthdayMdFromUser(
        (user as any)?.birthday_month,
        (user as any)?.birthday_day,
      ),
      location: (user as any)?.location || '',
    },
  });

  const updateProfileMutation = useUpdateProfile();
  const updatePhotoMutation = useUpdateProfilePhoto();
  const removePhotoMutation = useRemoveProfilePhoto();

  const onSubmit = async (data: ProfileFormData) => {
    try {
      // Validate and transform date if provided
      const transformedData = { ...data };
      if (data.date_of_birth) {
        const validation = validateDate(data.date_of_birth);
        if (!validation.valid) {
          Alert.alert('Invalid Date', validation.error || 'Please enter a valid date');
          return;
        }
        transformedData.date_of_birth = validation.dateForApi;
      }
      await updateProfileMutation.mutateAsync(transformedData);
    } catch {
      // Error handled in mutation
    }
  };

  const handleImageSelected = async (imageUri: string) => {
    setProfileImage(imageUri);
    setIsUploadingImage(true);
    try {
      await updatePhotoMutation.mutateAsync(imageUri);
      setIsUploadingImage(false);
    } catch {
      // Error handled in mutation
      setProfileImage(user?.profile_photo || null);
      setIsUploadingImage(false);
    }
  };

  const handleImageRemoved = async () => {
    setProfileImage(null);
    setIsUploadingImage(true);
    try {
      await removePhotoMutation.mutateAsync();
      setIsUploadingImage(false);
    } catch {
      // Error handled in mutation
      setProfileImage(user?.profile_photo || null);
      setIsUploadingImage(false);
    }
  };

  return (
    <>
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Profile Photo</Text>
        <View style={styles.imagePickerContainer}>
          <ImagePicker
            currentImage={profileImage || undefined}
            onImageSelected={handleImageSelected}
            onImageRemoved={handleImageRemoved}
            buttonText="Change Photo"
            aspect={[1, 1]}
            maxWidth={512}
            maxHeight={512}
            quality={0.8}
          />
          {isUploadingImage && (
            <View style={styles.uploadIndicator}>
              <ActivityIndicator size="small" color={primaryColor} />
              <Text style={[styles.uploadText, { color: colors.textSecondary }]}>Uploading...</Text>
            </View>
          )}
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Personal Information</Text>
        
        <FormInput
          name="first_name"
          control={control}
          label="First Name"
          required
          error={errors.first_name}
          placeholder="Enter your first name"
          autoCapitalize="words"
        />

        <FormInput
          name="last_name"
          control={control}
          label="Last Name"
          required
          error={errors.last_name}
          placeholder="Enter your last name"
          autoCapitalize="words"
        />

        <FormInput
          name="email"
          control={control}
          label="Email"
          required
          error={errors.email}
          placeholder="Enter your email"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <FormInput
          name="phone"
          control={control}
          label="Phone (Optional)"
          error={errors.phone}
          placeholder="Enter your phone number"
          keyboardType="phone-pad"
        />

        <FormInput
          control={control}
          name="zip_code"
          label="ZIP Code"
          placeholder="Enter ZIP code"
          keyboardType="number-pad"
          maxLength={5}
        />

        <FormInput
          name="date_of_birth"
          control={control}
          label="Birthday"
          error={errors.date_of_birth}
          placeholder="MM/DD/YYYY"
          keyboardType="number-pad"
          maxLength={10}
          formatValue={formatBirthdayInput}
        />
      </View>

      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Profile Information</Text>

        <FormInput
          name="bio"
          control={control}
          label="Bio"
          error={errors.bio}
          placeholder="Tell others about yourself"
          multiline
          numberOfLines={4}
          maxLength={500}
        />

        <FormInput
          name="instagram_handle"
          control={control}
          label="Instagram"
          error={errors.instagram_handle}
          placeholder="@yourhandle"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <FormInput
          name="linkedin_handle"
          control={control}
          label="LinkedIn"
          error={errors.linkedin_handle}
          placeholder="linkedin.com/in/your-slug"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <FormInput
          name="birthday_md"
          control={control}
          label="Birthday (M/D)"
          error={errors.birthday_md}
          placeholder="MM/DD"
          keyboardType="number-pad"
          maxLength={5}
          formatValue={formatBirthdayMdInput}
        />

        <FormInput
          name="location"
          control={control}
          label="Location"
          error={errors.location}
          placeholder="City, State"
          maxLength={100}
        />
      </View>

      <View style={styles.buttonContainer}>
        <Button
          onPress={handleSubmit(onSubmit)}
          disabled={isSubmitting || updateProfileMutation.isPending}
          loading={isSubmitting || updateProfileMutation.isPending}
          style={styles.saveButton}
        >
          Save Changes
        </Button>

        <Button
          onPress={onCancel || (() => router.back())}
          variant="secondary"
          disabled={isSubmitting || updateProfileMutation.isPending}
          style={styles.cancelButton}
        >
          Cancel
        </Button>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  section: {
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.05)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
      },
    }),
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 20,
  },
  imagePickerContainer: {
    marginBottom: 8,
  },
  uploadIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    gap: 8,
  },
  uploadText: {
    fontSize: 14,
  },
  buttonContainer: {
    gap: 12,
    marginTop: 8,
  },
  saveButton: {
    width: '100%',
  },
  cancelButton: {
    width: '100%',
  },
});

