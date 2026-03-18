/**
 * OTAUpdateModal - Blocking modal for OTA updates
 *
 * Shows a non-dismissible modal when an OTA update is downloading or ready.
 * This ensures users always run the latest OTA version.
 *
 * Safety: Only shown when status is 'downloading' or 'ready' — never during
 * 'checking', 'error', or 'idle'. Offline users won't see this modal because
 * the update check fails silently and status stays 'idle'.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { DEFAULT_PRIMARY_COLOR } from '@utils/styles';
import { useOTAUpdateStatus } from '@providers/OTAUpdateProvider';

export function OTAUpdateModal() {
  const { status } = useOTAUpdateStatus();
  const [isRestarting, setIsRestarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Only block on downloading or ready — never checking, error, or idle
  const isVisible = !__DEV__ && (status === 'downloading' || status === 'ready');
  const isReady = status === 'ready';

  const handleInstall = async () => {
    setError(null);
    setIsRestarting(true);
    try {
      await Updates.reloadAsync();
    } catch (e) {
      setIsRestarting(false);
      setError('Failed to restart. Please close and reopen the app.');
    }
  };

  if (!isVisible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => {}}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.iconContainer}>
            {isReady ? (
              <Ionicons name="checkmark-circle" size={48} color="#34C759" />
            ) : (
              <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
            )}
          </View>

          <Text style={styles.title}>
            {isReady ? 'Update Ready' : 'Updating'}
          </Text>

          <Text style={styles.message}>
            {isReady
              ? 'A new update has been downloaded. Restart to apply it.'
              : 'Downloading the latest update. This will only take a moment.'}
          </Text>

          {error && <Text style={styles.errorText}>{error}</Text>}

          {isReady && (
            <TouchableOpacity
              style={[styles.installButton, isRestarting && styles.installButtonDisabled]}
              onPress={handleInstall}
              activeOpacity={0.8}
              disabled={isRestarting}
            >
              {isRestarting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="refresh-outline" size={20} color="#fff" />
                  <Text style={styles.installButtonText}>{error ? 'Retry' : 'Restart Now'}</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    backgroundColor: '#fff',
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
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  installButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: '100%',
    gap: 8,
  },
  installButtonDisabled: {
    opacity: 0.7,
  },
  installButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
});
