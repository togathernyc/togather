/**
 * TypingIndicator Component
 *
 * Displays who is currently typing in the channel.
 */

import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import type { Id } from '@services/api/convex';

interface TypingIndicatorProps {
  typingUsers: Array<{
    userId: Id<"users">;
    firstName: string;
    lastName?: string;
  }>;
}

export function TypingIndicator({ typingUsers }: TypingIndicatorProps) {
  if (!typingUsers || typingUsers.length === 0) {
    return null;
  }

  const names = typingUsers.map((u) => u.firstName).join(', ');
  const verb = typingUsers.length === 1 ? 'is' : 'are';

  return (
    <View style={styles.container}>
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
  spinner: {
    marginRight: 8,
  },
  text: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
  },
});

