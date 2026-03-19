/**
 * WaveformBars - Reusable waveform bar visualization
 *
 * WhatsApp-inspired bar display for voice memo recording and preview.
 * During recording: bars show live metering. During preview: bars show played fraction.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';

const BAR_WIDTH = 3;
const BAR_MARGIN = 1;
const MIN_HEIGHT = 4;
const MAX_HEIGHT = 32;
const BAR_COUNT = 40;

interface WaveformBarsProps {
  /** Normalized values 0-1 for each bar height */
  meteringData: number[];
  /** During preview: 0-1 indicating how much has been played */
  playedFraction?: number;
  /** Bar count (default 40) */
  barCount?: number;
  /** Accent color for played bars (defaults to #666) */
  accentColor?: string;
  /** Container height (defaults to MAX_HEIGHT) */
  height?: number;
}

export function WaveformBars({
  meteringData,
  playedFraction = 1,
  barCount = BAR_COUNT,
  accentColor = '#666',
  height = MAX_HEIGHT,
}: WaveformBarsProps) {
  const bars: number[] = [];
  const minH = MIN_HEIGHT * (height / MAX_HEIGHT);
  const maxH = height;

  if (meteringData.length > 0) {
    for (let i = 0; i < barCount; i++) {
      const idx = Math.floor((i / barCount) * meteringData.length);
      bars.push(meteringData[idx] ?? 0);
    }
  } else {
    for (let i = 0; i < barCount; i++) {
      bars.push(0.3);
    }
  }

  return (
    <View style={[styles.container, { height }]}>
      {bars.map((value, index) => {
        const barHeight = minH + value * (maxH - minH);
        const isPlayed = (index + 1) / barCount <= playedFraction;
        return (
          <View
            key={index}
            style={[
              styles.bar,
              {
                height: barHeight,
                backgroundColor: accentColor,
                opacity: isPlayed ? 1 : 0.4,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: MAX_HEIGHT,
  },
  bar: {
    width: BAR_WIDTH,
    marginHorizontal: BAR_MARGIN / 2,
    borderRadius: 1,
  },
});
