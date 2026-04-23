/**
 * User bio with URLs auto-linkified via the shared `<LinkifiedText>`.
 * Renders nothing when the bio is blank so the page stays compact.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@hooks/useTheme';
import { LinkifiedText } from '@features/shared/utils/linkify';

interface UserProfileBioProps {
  bio: string | null | undefined;
}

export function UserProfileBio({ bio }: UserProfileBioProps) {
  const { colors } = useTheme();

  if (!bio || bio.trim().length === 0) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>About</Text>
      <LinkifiedText
        content={bio}
        style={[styles.body, { color: colors.text }]}
        linkStyle={{ color: colors.link, textDecorationLine: 'underline' }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
  },
});
