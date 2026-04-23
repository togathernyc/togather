/**
 * Instagram + LinkedIn row.
 *
 * Instagram: attempts `instagram://user?username=<h>` to deep-link into the
 * native app, falling back to `https://instagram.com/<h>` in the browser.
 * LinkedIn: opens `https://linkedin.com/in/<h>` — the LinkedIn app intercepts
 * this via Universal Links on both platforms.
 */

import React from 'react';
import { View, Text, StyleSheet, Linking, Platform, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';

interface UserProfileSocialsProps {
  instagramHandle: string | null | undefined;
  linkedinHandle: string | null | undefined;
}

export function UserProfileSocials({
  instagramHandle,
  linkedinHandle,
}: UserProfileSocialsProps) {
  const { colors } = useTheme();

  if (!instagramHandle && !linkedinHandle) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      {instagramHandle && (
        <SocialRow
          icon="logo-instagram"
          label={`@${instagramHandle}`}
          onPress={() => openInstagram(instagramHandle)}
          color={colors.text}
          iconColor={colors.textSecondary}
        />
      )}
      {linkedinHandle && (
        <SocialRow
          icon="logo-linkedin"
          label={`linkedin.com/in/${linkedinHandle}`}
          onPress={() => openLinkedIn(linkedinHandle)}
          color={colors.text}
          iconColor={colors.textSecondary}
        />
      )}
    </View>
  );
}

interface SocialRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  color: string;
  iconColor: string;
}

function SocialRow({ icon, label, onPress, color, iconColor }: SocialRowProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.row}
      accessibilityRole="link"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={iconColor} />
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={iconColor} />
    </TouchableOpacity>
  );
}

async function openInstagram(handle: string) {
  const webUrl = `https://instagram.com/${handle}`;
  // On web, skip the `instagram://` deep link — browsers silently no-op
  // on unknown custom schemes, so the tap appears dead. Go straight to web.
  if (Platform.OS === 'web') {
    openExternal(webUrl);
    return;
  }
  const deepLink = `instagram://user?username=${handle}`;
  try {
    const supported = await Linking.canOpenURL(deepLink);
    if (supported) {
      await Linking.openURL(deepLink);
      return;
    }
  } catch {
    // fall through to web
  }
  Linking.openURL(webUrl).catch(() => {
    // Silent — user can retry; better than a modal error on profile view.
  });
}

function openLinkedIn(handle: string) {
  openExternal(`https://linkedin.com/in/${handle}`);
}

function openExternal(url: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  Linking.openURL(url).catch(() => {
    // Silent — see openInstagram comment.
  });
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  label: {
    flex: 1,
    fontSize: 15,
  },
});
