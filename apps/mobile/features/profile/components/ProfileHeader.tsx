import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Avatar, Card } from '@components/ui';
import { Ionicons } from '@expo/vector-icons';
import { Profile } from '../types';

interface ProfileHeaderProps {
  user: Profile | null;
}

export function ProfileHeader({ user }: ProfileHeaderProps) {
  // Filter associated emails to remove the current email
  const linkedEmails = user?.associated_emails?.filter(
    (email) => email !== user?.email
  ) || [];

  return (
    <Card style={styles.profileCard}>
      <View style={styles.profileHeader}>
        <Avatar
          name={`${user?.first_name || ""} ${user?.last_name || ""}`.trim()}
          imageUrl={user?.profile_photo}
          size={80}
        />
        <View style={styles.profileInfo}>
          <Text style={styles.name}>
            {user?.first_name} {user?.last_name}
          </Text>
          <Text style={styles.email}>{user?.email}</Text>
          {user?.phone && (
            <View style={styles.phoneContainer}>
              <Ionicons name="call-outline" size={16} color="#666" />
              <Text style={styles.phone}>{user.phone}</Text>
              {user?.phone_verified && (
                <Ionicons name="checkmark-circle" size={14} color="#34C759" />
              )}
            </View>
          )}
        </View>
      </View>

      {/* Previously Linked Emails Section */}
      {linkedEmails.length > 0 && (
        <View style={styles.linkedEmailsSection}>
          <View style={styles.linkedEmailsHeader}>
            <Ionicons name="mail-outline" size={16} color="#666" />
            <Text style={styles.linkedEmailsTitle}>Previously Linked Emails</Text>
          </View>
          {linkedEmails.map((email, index) => (
            <Text key={index} style={styles.linkedEmail}>
              {email}
            </Text>
          ))}
        </View>
      )}
    </Card>
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
    color: '#1a1a1a',
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: '#8e8e93',
    marginBottom: 6,
  },
  phoneContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  phone: {
    fontSize: 14,
    color: '#8e8e93',
  },
  linkedEmailsSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5e5',
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
    color: '#8e8e93',
  },
  linkedEmail: {
    fontSize: 14,
    color: '#1a1a1a',
    marginLeft: 24,
    marginBottom: 4,
  },
});

