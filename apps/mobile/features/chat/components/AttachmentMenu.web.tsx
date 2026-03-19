/**
 * AttachmentMenu Component (Web-only)
 * 
 * A modal dialog for web that replaces React Native's Alert.alert
 * for showing attachment options (camera, gallery, files, voice)
 */

import React from 'react';
import { Text, Pressable, StyleSheet, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface AttachmentMenuOption {
  text: string;
  onPress?: () => void;
  icon: keyof typeof Ionicons.glyphMap;
}

interface AttachmentMenuProps {
  visible: boolean;
  onClose: () => void;
  options: AttachmentMenuOption[];
}

export function AttachmentMenu({ visible, onClose, options }: AttachmentMenuProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.menu} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Add Attachment</Text>
          {options.map((option, index) => (
            <Pressable
              key={index}
              style={styles.option}
              onPress={() => {
                onClose();
                option.onPress?.();
              }}
            >
              <Ionicons name={option.icon} size={24} color="#007AFF" />
              <Text style={styles.optionText}>{option.text}</Text>
            </Pressable>
          ))}
          <Pressable style={[styles.option, styles.cancelOption]} onPress={onClose}>
            <Ionicons name="close" size={24} color="#666" />
            <Text style={[styles.optionText, styles.cancelText]}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menu: {
    backgroundColor: '#fff',
    borderRadius: 12,
    minWidth: 300,
    maxWidth: 400,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    textAlign: 'center',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  optionText: {
    fontSize: 16,
    color: '#000',
  },
  cancelOption: {
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    marginTop: 8,
  },
  cancelText: {
    color: '#666',
  },
});
