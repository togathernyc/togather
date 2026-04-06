import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Avatar, Card } from '@components/ui';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import { useRouter } from 'expo-router';
import { Profile } from '../types';

interface ProfileHeaderProps {
  user: Profile | null;
}

export function ProfileHeader({ user }: ProfileHeaderProps) {
  const { colors } = useTheme();
  const router = useRouter();
  // Filter associated emails to remove the current email
  const linkedEmails = user?.associated_emails?.filter(
    (email) => email !== user?.email
  ) || [];

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => router.push('/(user)/edit-profile')}
    >
    <Card style={styles.profileCard}>
      <View style={styles.profileHeader}>
        <Avatar
          name={`${user?.first_name || ""} ${user?.last_name || ""}`.trim()}
          imageUrl={user?.profile_photo}
          size={80}
        />
        <View style={styles.profileInfo}>
          <Text style={[styles.name, { color: colors.text }]}>
            {user?.first_name} {user?.last_name}
          </Text>
          <Text style={[styles.email, { color: colors.textSecondary }]}>{user?.email}</Text>
          {user?.phone && (
            <View style={styles.phoneContainer}>
              <Ionicons name="call-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.phone, { color: colors.textSecondary }]}>{user.phone}</Text>
              {user?.phone_verified && (
                <Ionicons name="checkmark-circle" size={14} color={colors.success} />
              )}
            </View>
          )}
        </View>
        <Ionicons name="create-outline" size={20} color={colors.iconSecondary} />
      </View>

      {/* Previously Linked Emails Section */}
      {linkedEmails.length > 0 && (
        <View style={[styles.linkedEmailsSection, { borderTopColor: colors.border }]}>
          <View style={styles.linkedEmailsHeader}>
            <Ionicons name="mail-outline" size={16} color={colors.textSecondary} />
            <Text style={[styles.linkedEmailsTitle, { color: colors.textSecondary }]}>Previously Linked Emails</Text>
          </View>
          {linkedEmails.map((email, index) => (
            <Text key={index} style={[styles.linkedEmail, { color: colors.text }]}>
              {email}
            </Text>
          ))}
        </View>
      )}
    </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  profileCard: {
    marginTop: 12,
    marginHorizontal: 16,
    padding: 20,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileInfo: {
    flex: 1,
    marginLeft: 16,
  },
  name: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    marginBottom: 6,
  },
  phoneContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  phone: {
    fontSize: 14,
  },
  linkedEmailsSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  linkedEmailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  linkedEmailsTitle: {
    fontSize: 13,
    fontWeight: '500',
  },
  linkedEmail: {
    fontSize: 14,
    marginLeft: 24,
    marginBottom: 4,
  },
});

