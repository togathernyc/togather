import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
} from 'react-native';
import { DEFAULT_PRIMARY_COLOR } from '@utils/styles';
import { useTheme } from '@hooks/useTheme';

interface SwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
  style?: any;
  labelStyle?: any;
  trackColor?: { false: string; true: string };
  thumbColor?: { false: string; true: string };
}

export function Switch({
  value,
  onValueChange,
  label,
  disabled = false,
  style,
  labelStyle,
  trackColor: trackColorProp,
  thumbColor: thumbColorProp,
}: SwitchProps) {
  const { colors } = useTheme();
  const trackColor = trackColorProp ?? { false: colors.border, true: DEFAULT_PRIMARY_COLOR };
  const thumbColor = thumbColorProp ?? { false: colors.surface, true: colors.surface };
  const animatedValue = React.useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: value ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [value, animatedValue]);

  const handlePress = () => {
    if (!disabled) {
      onValueChange(!value);
    }
  };

  const translateX = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 22],
  });

  const backgroundColor = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [trackColor.false, trackColor.true],
  });

  return (
    <View style={[styles.container, style]}>
      {label && (
        <Text style={[styles.label, { color: colors.text }, labelStyle]}>{label}</Text>
      )}
      <TouchableOpacity
        onPress={handlePress}
        disabled={disabled}
        activeOpacity={0.7}
        style={[styles.switchContainer, disabled && styles.disabled]}
      >
        <Animated.View
          style={[
            styles.track,
            {
              backgroundColor,
            },
          ]}
        >
          <Animated.View
            style={[
              styles.thumb,
              {
                backgroundColor: value ? thumbColor.true : thumbColor.false,
                transform: [{ translateX }],
              },
            ]}
          />
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
    marginRight: 12,
  },
  switchContainer: {
    padding: 4,
  },
  disabled: {
    opacity: 0.5,
  },
  track: {
    width: 48,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.1)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
      },
    }),
  },
  thumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.2)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 3,
      },
    }),
  },
});

