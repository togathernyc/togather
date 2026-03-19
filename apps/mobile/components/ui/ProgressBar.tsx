import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Platform,
} from 'react-native';
import { DEFAULT_PRIMARY_COLOR } from '@utils/styles';
import { useTheme } from '@hooks/useTheme';

interface ProgressBarProps {
  progress: number; // 0 to 1
  height?: number;
  color?: string;
  backgroundColor?: string;
  showPercentage?: boolean;
  style?: any;
  animated?: boolean;
}

export function ProgressBar({
  progress,
  height = 8,
  color = DEFAULT_PRIMARY_COLOR,
  backgroundColor: backgroundColorProp,
  showPercentage = false,
  style,
  animated = true,
}: ProgressBarProps) {
  const { colors } = useTheme();
  const backgroundColor = backgroundColorProp ?? colors.border;
  const animatedProgress = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (animated) {
      Animated.timing(animatedProgress, {
        toValue: Math.max(0, Math.min(1, progress)),
        duration: 300,
        useNativeDriver: false,
      }).start();
    } else {
      animatedProgress.setValue(Math.max(0, Math.min(1, progress)));
    }
  }, [progress, animated, animatedProgress]);

  const width = animatedProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const percentage = Math.round(Math.max(0, Math.min(100, progress * 100)));

  return (
    <View style={[styles.container, { height }, style]}>
      <View
        style={[
          styles.track,
          {
            height,
            backgroundColor,
          },
        ]}
      >
        <Animated.View
          style={[
            styles.fill,
            {
              width,
              height,
              backgroundColor: color,
            },
          ]}
        />
      </View>
      {showPercentage && (
        <Text style={[styles.percentage, { color: colors.text }]}>{percentage}%</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  track: {
    flex: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    borderRadius: 4,
    ...Platform.select({
      web: {
        transition: 'width 0.3s ease',
      },
    }),
  },
  percentage: {
    marginLeft: 12,
    fontSize: 14,
    fontWeight: '600',
    minWidth: 40,
    textAlign: 'right',
  },
});

