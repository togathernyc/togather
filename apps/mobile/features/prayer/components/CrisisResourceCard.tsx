/**
 * Crisis resource card.
 *
 * Rendered above a prayer's body when the moderator flagged it as
 * first-person mental-health / crisis content. We DON'T block these
 * prayers — the research from 7 Cups + Crisis Text Line is unanimous:
 * blocking "I want to die" leaves a vulnerable person unsupported. The
 * right move is to publish the prayer AND surface crisis-line links
 * inline so the author (and anyone who comes to pray) sees them.
 *
 * Numbers used are US-centric. Find-a-Helpline is the global escape
 * hatch for other locales.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';

export function CrisisResourceCard() {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { borderColor: '#FFD2D2', backgroundColor: '#FFF6F6' }]}>
      <View style={styles.header}>
        <Ionicons name="heart-circle" size={20} color="#C0392B" />
        <Text style={styles.headerText}>You are not alone</Text>
      </View>
      <Text style={[styles.body, { color: colors.text }]}>
        If you or someone you love is in crisis, please reach out — these lines
        are free, confidential, and 24/7.
      </Text>
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.link}
          onPress={() => Linking.openURL('tel:988')}
          accessibilityRole="link"
          accessibilityLabel="Call or text 9 8 8"
        >
          <Ionicons name="call-outline" size={14} color="#C0392B" />
          <Text style={styles.linkText}>988 — call or text</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.link}
          onPress={() => Linking.openURL('sms:741741&body=HOME')}
          accessibilityRole="link"
          accessibilityLabel="Text Crisis Text Line"
        >
          <Ionicons name="chatbubble-outline" size={14} color="#C0392B" />
          <Text style={styles.linkText}>Text HOME to 741741</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        onPress={() => Linking.openURL('https://findahelpline.com')}
        accessibilityRole="link"
      >
        <Text style={styles.linkSecondary}>Outside the US? findahelpline.com</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  headerText: {
    color: '#C0392B',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 6,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  linkText: {
    color: '#C0392B',
    fontSize: 13,
    fontWeight: '600',
  },
  linkSecondary: {
    color: '#C0392B',
    fontSize: 12,
    fontWeight: '500',
    paddingTop: 2,
  },
});
