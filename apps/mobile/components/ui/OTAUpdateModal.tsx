/**
 * OTAUpdateModal - Downloading indicator for OTA updates
 *
 * Shows a non-dismissible modal while an OTA update is downloading. Once the
 * update is ready, OTAUpdateProvider auto-applies it via Updates.reloadAsync,
 * so there's no "Restart Now" step — the app just refreshes itself.
 *
 * Offline users never see this modal because the check fails silently and
 * status stays 'idle'.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { DEFAULT_PRIMARY_COLOR } from '@utils/styles';
import { useOTAUpdateStatus } from '@providers/OTAUpdateProvider';
import { useTheme } from '@hooks/useTheme';

export function OTAUpdateModal() {
  const { colors } = useTheme();
  const { status } = useOTAUpdateStatus();

  // Visible while actively downloading, and during the brief 'ready' tick
  // before reloadAsync tears the app down.
  const isVisible = !__DEV__ && (status === 'downloading' || status === 'ready');

  if (!isVisible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => {}}
    >
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <View style={[styles.modal, { backgroundColor: colors.modalBackground }]}>
          <View style={[styles.iconContainer, { backgroundColor: colors.surfaceSecondary }]}>
            <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>Updating</Text>

          <Text style={[styles.message, { color: colors.textSecondary }]}>
            Downloading the latest update. The app will refresh in a moment.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
});
