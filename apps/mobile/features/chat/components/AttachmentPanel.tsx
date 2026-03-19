/**
 * AttachmentPanel - Inline WhatsApp-style attachment options panel
 *
 * Rendered below the message input (NOT a modal). Animates height
 * to expand/collapse. Grid of circular icon buttons.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface AttachmentOption {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  onPress: () => void;
}

interface AttachmentPanelProps {
  visible: boolean;
  options: AttachmentOption[];
  onOptionPress: (option: AttachmentOption) => void;
}

const PANEL_HEIGHT = 160;

export function AttachmentPanel({ visible, options, onOptionPress }: AttachmentPanelProps) {
  const heightAnim = useRef(new Animated.Value(0)).current;
  const [pressedId, setPressedId] = useState<string | null>(null);

  useEffect(() => {
    Animated.timing(heightAnim, {
      toValue: visible ? PANEL_HEIGHT : 0,
      duration: visible ? 250 : 200,
      useNativeDriver: false,
    }).start();
  }, [visible, heightAnim]);

  return (
    <Animated.View style={[styles.container, { height: heightAnim }]}>
      <View style={styles.inner}>
        <View style={styles.grid}>
          {options.map((option) => (
            <Pressable
              key={option.id}
              onPress={() => onOptionPress(option)}
              onPressIn={() => setPressedId(option.id)}
              onPressOut={() => setPressedId(null)}
            >
              <View
                style={[
                  styles.optionItem,
                  pressedId === option.id && styles.optionItemPressed,
                ]}
              >
                <View
                  style={[
                    styles.iconCircle,
                    option.iconColor
                      ? { backgroundColor: `${option.iconColor}18` }
                      : undefined,
                  ]}
                >
                  <Ionicons
                    name={option.icon}
                    size={26}
                    color={option.iconColor || '#007AFF'}
                  />
                </View>
                <Text style={styles.optionLabel}>{option.label}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  inner: {
    backgroundColor: '#F5F0E8',
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  grid: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'flex-start',
  },
  optionItem: {
    alignItems: 'center',
    width: 72,
    opacity: 1,
  },
  optionItemPressed: {
    opacity: 0.6,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
      default: {},
    }),
  },
  optionLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#333',
    textAlign: 'center',
  },
});
