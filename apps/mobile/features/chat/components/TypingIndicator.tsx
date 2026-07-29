/**
 * TypingIndicator Component
 *
 * Displays who is currently typing in the channel.
 */

import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import type { Id } from '@services/api/convex';
import { useWhatsappShell } from '@hooks/useWhatsappShell';

interface TypingIndicatorProps {
  typingUsers: Array<{
    userId: Id<"users">;
    firstName: string;
    lastName?: string;
  }>;
}

export function TypingIndicator({ typingUsers }: TypingIndicatorProps) {
  // §S4.1: flag-on the chat room paints a doodle wallpaper behind everything
  // between the header and the composer, so this strip's hard-coded gray fill
  // would read as a flat band across it. Flag-off keeps the gray.
  const whatsappShellEnabled = useWhatsappShell();

  if (!typingUsers || typingUsers.length === 0) {
    return null;
  }

  const names = typingUsers.map((u) => u.firstName).join(', ');
  const verb = typingUsers.length === 1 ? 'is' : 'are';

  return (
    <View style={[styles.container, whatsappShellEnabled && styles.waContainer]}>
      <ActivityIndicator size="small" color="#666" style={styles.spinner} />
      <Text style={styles.text}>
        {names} {verb} typing...
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#F5F5F5',
  },
  waContainer: {
    backgroundColor: 'transparent',
  },
  spinner: {
    marginRight: 8,
  },
  text: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
  },
});

