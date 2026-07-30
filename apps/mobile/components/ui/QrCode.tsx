/**
 * QrCode — renders a QR code with plain `View`s (no `react-native-svg`,
 * no native dependency). Used by the Invite Kit (features/invite) to show
 * a scannable code for the community link and group short links.
 *
 * Each row's consecutive dark modules are run-length-encoded into a single
 * `View` segment (instead of one `View` per module) to keep the render
 * tree small — a version-10 QR is 57x57 modules, which would otherwise be
 * 3,249 individual views.
 */
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { qrModules } from '@utils/qrcodegen';

interface QrCodeProps {
  /** The text/URL to encode. */
  value: string;
  /** Overall rendered size (including quiet zone), in points. Default 200. */
  size?: number;
  /**
   * Color of the dark modules. Defaults to pure black — QR scanners rely
   * on strong light/dark contrast to lock onto finder patterns, so this is
   * the one place in the app that intentionally hardcodes a color instead
   * of using a theme token (a themed "primary color" could be too light,
   * or too close to the white background, to reliably scan).
   */
  color?: string;
  /** Background (light module + quiet zone) color. Default white. */
  backgroundColor?: string;
}

interface RunSegment {
  row: number;
  startCol: number;
  runLength: number;
}

export function QrCode({
  value,
  size = 200,
  color = '#000000',
  backgroundColor = '#ffffff',
}: QrCodeProps) {
  const modules = useMemo(() => qrModules(value), [value]);
  const moduleCount = modules.length;

  const runs = useMemo(() => {
    const segments: RunSegment[] = [];
    for (let row = 0; row < moduleCount; row++) {
      let col = 0;
      while (col < moduleCount) {
        if (!modules[row][col]) {
          col++;
          continue;
        }
        const startCol = col;
        while (col < moduleCount && modules[row][col]) col++;
        segments.push({ row, startCol, runLength: col - startCol });
      }
    }
    return segments;
  }, [modules, moduleCount]);

  // Quiet zone: 4 modules of background on every side, per the QR spec.
  const quietZoneModules = 4;
  const totalModules = moduleCount + quietZoneModules * 2;
  const moduleSize = size / totalModules;

  return (
    <View
      style={[
        styles.container,
        { width: size, height: size, backgroundColor },
      ]}
    >
      {runs.map((run, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: (quietZoneModules + run.startCol) * moduleSize,
            top: (quietZoneModules + run.row) * moduleSize,
            width: run.runLength * moduleSize,
            height: moduleSize,
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
  },
});
