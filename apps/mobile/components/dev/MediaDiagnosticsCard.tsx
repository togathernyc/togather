/**
 * MediaDiagnosticsCard
 *
 * On-screen, copy-pasteable dump of media/native-module diagnostics. Rendered
 * on the surfaces where animated GIFs render blank and chat video falls back
 * to the download card on the staging build, so a tester can copy the raw
 * output directly off the device instead of reading it back from Sentry.
 *
 * Self-contained and defensive — every path is guarded so it never throws and
 * never crashes the host screen.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { getMediaDiagnostics } from '@/features/chat/utils/fileTypes';

interface MediaDiagnosticsCardProps {
  /** Extra fields merged into the diagnostics object (e.g. { tier }). */
  extra?: Record<string, unknown>;
  /** Optional label shown in the card title. */
  label?: string;
}

export function MediaDiagnosticsCard({ extra, label }: MediaDiagnosticsCardProps) {
  const [copied, setCopied] = useState(false);

  let text: string;
  try {
    text = JSON.stringify({ ...getMediaDiagnostics(), ...(extra || {}) }, null, 2);
  } catch (e) {
    text = `error building diagnostics: ${String(e)}`;
  }

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore clipboard failures — the text is still selectable on screen.
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>
          📋 MEDIA DIAGNOSTICS{label ? ` — ${label}` : ''} (tap Copy)
        </Text>
        <TouchableOpacity style={styles.copyButton} onPress={handleCopy}>
          <Text style={styles.copyButtonText}>{copied ? 'Copied!' : 'Copy'}</Text>
        </TouchableOpacity>
      </View>
      <Text
        selectable
        style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11, color: '#18181b' }}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#f4f4f5',
    borderWidth: 1,
    borderColor: '#d4d4d8',
    borderRadius: 8,
    padding: 12,
    marginVertical: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#18181b',
    marginRight: 8,
  },
  copyButton: {
    backgroundColor: '#18181b',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  copyButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
