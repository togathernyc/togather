/**
 * BirthdayCollectionModal
 *
 * This modal collects birthday from users who don't have one on file.
 * Used for:
 * - COPPA compliance (age verification)
 * - Birthday celebrations in community
 * - Age-appropriate content filtering
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@providers/AuthProvider';
import { useAuthenticatedMutation, api } from '@services/api/convex';
import { useTheme } from '@hooks/useTheme';

interface BirthdayCollectionModalProps {
  onCompleted?: () => void;
}

/**
 * Modal that prompts users to enter their birthday if they don't have one on file.
 * This modal is non-dismissible - users must provide their birthday to proceed.
 */
export function BirthdayCollectionModal({ onCompleted }: BirthdayCollectionModalProps) {
  const { user, isLoading: authLoading, isAuthenticated, refreshUser } = useAuth();
  const [birthday, setBirthday] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  // Use mutation hook for auth-aware updates
  const updateUser = useAuthenticatedMutation(api.functions.users.update);

  // Terms acceptance is enforced server-side at signup, so authentication
  // already implies acceptance. Show the modal whenever an authed user is
  // missing a date_of_birth.
  const shouldShow = isAuthenticated && !authLoading && user && !user.date_of_birth;

  // Format input as MM/DD/YYYY
  const handleBirthdayChange = useCallback((text: string) => {
    // Remove non-numeric characters
    const cleaned = text.replace(/\D/g, '');

    // Format as MM/DD/YYYY
    let formatted = '';
    if (cleaned.length > 0) {
      formatted = cleaned.substring(0, 2);
    }
    if (cleaned.length > 2) {
      formatted += '/' + cleaned.substring(2, 4);
    }
    if (cleaned.length > 4) {
      formatted += '/' + cleaned.substring(4, 8);
    }

    setBirthday(formatted);
    setError(null);
  }, []);

  const validateBirthday = useCallback((dateStr: string): { valid: boolean; date?: Date; error?: string } => {
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

    // Verify the date is valid (handles cases like Feb 31)
    if (date.getMonth() !== month - 1 || date.getDate() !== day) {
      return { valid: false, error: 'Please enter a valid date' };
    }

    // Check if user is at least 13 years old (COPPA compliance)
    const today = new Date();
    const age = today.getFullYear() - date.getFullYear();
    const monthDiff = today.getMonth() - date.getMonth();
    const dayDiff = today.getDate() - date.getDate();
    if (age < 13 || (age === 13 && (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)))) {
      return { valid: false, error: 'You must be at least 13 years old' };
    }

    // Check if date is not in the future
    if (date > today) {
      return { valid: false, error: 'Birthday cannot be in the future' };
    }

    return { valid: true, date };
  }, []);

  const handleSubmit = useCallback(async () => {
    const validation = validateBirthday(birthday);

    if (!validation.valid) {
      setError(validation.error || 'Invalid date');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Format date as YYYY-MM-DD for API (avoiding timezone issues)
      const year = validation.date!.getFullYear();
      const month = String(validation.date!.getMonth() + 1).padStart(2, '0');
      const day = String(validation.date!.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      await updateUser({
        dateOfBirth: dateStr,
      });

      // Refresh user to update the context with new birthday
      await refreshUser();

      onCompleted?.();
    } catch (err) {
      console.error('Error saving birthday:', err);
      setError('Failed to save birthday. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [birthday, validateBirthday, updateUser, refreshUser, onCompleted]);

  if (!shouldShow) {
    return null;
  }

  return (
    <Modal
      visible={true}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={[styles.overlay, { backgroundColor: colors.overlay }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.container, { backgroundColor: colors.modalBackground, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.content}>
            <Text style={[styles.title, { color: colors.text }]}>When's Your Birthday?</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              We use your birthday to celebrate with your community and show you age-appropriate content.
            </Text>

            <View style={styles.inputContainer}>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surfaceSecondary, color: colors.text }]}
                value={birthday}
                onChangeText={handleBirthdayChange}
                placeholder="MM/DD/YYYY"
                placeholderTextColor={colors.inputPlaceholder}
                keyboardType="number-pad"
                maxLength={10}
                autoFocus
              />
              {error && <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>}
            </View>

            <View style={[styles.infoSection, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                Your birthday helps us:
              </Text>
              <View style={styles.bulletList}>
                <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>• Celebrate your special day with the community</Text>
                <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>• Ensure age-appropriate experiences</Text>
                <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>• Connect you with others in your life stage</Text>
              </View>
            </View>
          </View>

          <View style={[styles.buttonContainer, { borderTopColor: colors.border, backgroundColor: colors.modalBackground }]}>
            <TouchableOpacity
              style={[styles.submitButton, { backgroundColor: colors.link }, (saving || birthday.length < 10) && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={saving || birthday.length < 10}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitButtonText}>Continue</Text>
              )}
            </TouchableOpacity>
            <Text style={[styles.privacyNote, { color: colors.textTertiary }]}>
              Your birthday is kept private and only shared with community leaders.
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    borderRadius: 20,
    width: '92%',
    maxWidth: 500,
    maxHeight: '90%',
    overflow: 'hidden',
    ...Platform.select({
      web: {
        boxShadow: '0px 10px 40px rgba(0, 0, 0, 0.2)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.2,
        shadowRadius: 40,
        elevation: 10,
      },
    }),
  },
  content: {
    padding: 24,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 22,
  },
  inputContainer: {
    marginBottom: 24,
  },
  input: {
    borderRadius: 12,
    padding: 16,
    fontSize: 24,
    textAlign: 'center',
    fontWeight: '600',
    letterSpacing: 2,
  },
  errorText: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  infoSection: {
    borderRadius: 12,
    padding: 16,
  },
  infoText: {
    fontSize: 15,
    marginBottom: 8,
  },
  bulletList: {
    marginLeft: 8,
  },
  bulletItem: {
    fontSize: 14,
    lineHeight: 22,
  },
  buttonContainer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  submitButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  privacyNote: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    paddingBottom: 8,
  },
});
