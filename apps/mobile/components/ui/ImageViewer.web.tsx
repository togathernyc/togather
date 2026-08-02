/**
 * ImageViewer (Web) — mouse-friendly zoom/pan.
 *
 * The native viewer (ImageViewer.tsx) zooms with react-native-gesture-handler
 * pinch/pan/double-tap gestures, which a mouse can't produce: on desktop web a
 * plan image opens and there is no way to magnify it. Metro/webpack resolve
 * this `.web.tsx` sibling on web only, so the native file stays untouched.
 *
 * Same props as the native viewer, so `providers/ImageViewerProvider.tsx`
 * needs no change. Visual language (colors, header/footer, arrows, dots) is
 * copied from the native viewer so it reads as the same component.
 *
 * Pointer plumbing is deliberately DOM-level: react-native-web does not
 * forward `onWheel`/`onMouseDown` from <View>, and a wheel listener must be
 * registered with `{ passive: false }` for `preventDefault()` to stop the page
 * from scrolling. Move/up listeners live on `window` so a drag that leaves the
 * viewport still ends cleanly.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { saveImageToLibrary } from '@/utils/saveImage';
import { ToastManager } from './Toast';
import { useTheme } from '@hooks/useTheme';

// Reserved vertical space (added to safe-area insets) so the contained image
// stays clear of the header toolbar and the Done/Save footer buttons.
const HEADER_HEIGHT = 60;
const FOOTER_HEIGHT = 80;

// Zoom limits match the native viewer's MIN_SCALE / MAX_SCALE / DOUBLE_TAP_SCALE.
const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_CLICK_SCALE = 2.5;
// Multiplier for the −/+ toolbar buttons.
const BUTTON_ZOOM_STEP = 1.25;
// Wheel delta → zoom factor. Tuned so one trackpad flick is ~1 step.
const WHEEL_SENSITIVITY = 0.0015;
// A press that moves less than this is a click (close), not a pan.
const DRAG_SLOP_PX = 4;

interface Transform {
  scale: number;
  x: number;
  y: number;
}

const FIT: Transform = { scale: 1, x: 0, y: 0 };

/**
 * Keep the image from being dragged entirely off the stage: at scale `s` the
 * overflow in each axis is `size * (s - 1)`, so half of that is the furthest
 * the center may travel before an edge crosses the middle of the stage.
 */
function clampTransform(next: Transform, width: number, height: number): Transform {
  const maxX = Math.max(0, (width * (next.scale - 1)) / 2);
  const maxY = Math.max(0, (height * (next.scale - 1)) / 2);
  return {
    scale: next.scale,
    x: Math.min(Math.max(next.x, -maxX), maxX),
    y: Math.min(Math.max(next.y, -maxY), maxY),
  };
}

/**
 * Zoom to `targetScale` while keeping the image point under (`px`, `py`) —
 * coordinates relative to the stage center — pinned under the cursor.
 *
 * The rendered position of an image point `u` is `p = u * s + t`, so holding
 * `p` fixed across a scale change gives `t' = p - (p - t) * s' / s`.
 */
function zoomAt(
  current: Transform,
  targetScale: number,
  px: number,
  py: number,
  width: number,
  height: number,
): Transform {
  const scale = Math.min(Math.max(targetScale, MIN_SCALE), MAX_SCALE);
  if (scale === MIN_SCALE) return FIT;
  const ratio = scale / current.scale;
  return clampTransform(
    {
      scale,
      x: px - (px - current.x) * ratio,
      y: py - (py - current.y) * ratio,
    },
    width,
    height,
  );
}

interface ImageViewerProps {
  visible: boolean;
  images: string[];
  initialIndex: number;
  onClose: () => void;
}

export function ImageViewer({
  visible,
  images,
  initialIndex,
  onClose,
}: ImageViewerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [transform, setTransform] = useState<Transform>(FIT);
  // Stage DOM node kept in state (not a ref) so listener effects re-run when
  // the node appears — the Modal mounts its children lazily.
  const [stageNode, setStageNode] = useState<HTMLElement | null>(null);

  // Mirror of `transform` for DOM handlers, which close over a stale render.
  const transformRef = useRef<Transform>(FIT);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const applyTransform = useCallback((next: Transform) => {
    transformRef.current = next;
    setTransform(next);
  }, []);

  const resetZoom = useCallback(() => {
    applyTransform(FIT);
  }, [applyTransform]);

  const handleStageRef = useCallback((node: View | null) => {
    setStageNode((node as unknown as HTMLElement) ?? null);
  }, []);

  const stageSize = useCallback(() => {
    const rect = stageNode?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }, [stageNode]);

  // Zoom from the toolbar buttons: centered on the stage, not the pointer.
  const zoomByStep = useCallback(
    (factor: number) => {
      const { width, height } = stageSize();
      applyTransform(
        zoomAt(transformRef.current, transformRef.current.scale * factor, 0, 0, width, height),
      );
    },
    [applyTransform, stageSize],
  );

  // Reset zoom when the slide changes or the viewer (re)opens, so the next
  // image never inherits the previous one's pan offset.
  useEffect(() => {
    applyTransform(FIT);
    setLoading(true);
    setError(false);
  }, [currentIndex, applyTransform]);

  useEffect(() => {
    if (visible) {
      setCurrentIndex(initialIndex);
      applyTransform(FIT);

      fadeAnim.setValue(0);
      scaleAnim.setValue(0.9);

      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 0.9, duration: 300, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, initialIndex, fadeAnim, scaleAnim, applyTransform]);

  // Wheel / trackpad zoom, centered on the pointer.
  useEffect(() => {
    if (!stageNode) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stageNode.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * WHEEL_SENSITIVITY);
      applyTransform(
        zoomAt(
          transformRef.current,
          transformRef.current.scale * factor,
          event.clientX - rect.left - rect.width / 2,
          event.clientY - rect.top - rect.height / 2,
          rect.width,
          rect.height,
        ),
      );
    };

    // passive: false — a passive listener may not call preventDefault(), and
    // without it the browser scrolls the page behind the viewer.
    stageNode.addEventListener('wheel', handleWheel, { passive: false });
    return () => stageNode.removeEventListener('wheel', handleWheel);
  }, [stageNode, applyTransform]);

  // Drag to pan while zoomed; a press that never moves is a backdrop click and
  // closes the viewer, matching the native TouchableWithoutFeedback backdrop.
  useEffect(() => {
    if (!stageNode) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      // Suppress the browser's native image-drag ghost and text selection.
      event.preventDefault();

      const rect = stageNode.getBoundingClientRect();
      const start = transformRef.current;
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!moved && Math.abs(dx) + Math.abs(dy) > DRAG_SLOP_PX) moved = true;
        if (!moved || transformRef.current.scale <= MIN_SCALE) return;
        applyTransform(
          clampTransform(
            { scale: start.scale, x: start.x + dx, y: start.y + dy },
            rect.width,
            rect.height,
          ),
        );
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        if (!moved && transformRef.current.scale <= MIN_SCALE) {
          onCloseRef.current();
        }
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    };

    const handleDoubleClick = (event: MouseEvent) => {
      const rect = stageNode.getBoundingClientRect();
      if (transformRef.current.scale > MIN_SCALE) {
        applyTransform(FIT);
        return;
      }
      applyTransform(
        zoomAt(
          transformRef.current,
          DOUBLE_CLICK_SCALE,
          event.clientX - rect.left - rect.width / 2,
          event.clientY - rect.top - rect.height / 2,
          rect.width,
          rect.height,
        ),
      );
    };

    stageNode.addEventListener('mousedown', handleMouseDown);
    stageNode.addEventListener('dblclick', handleDoubleClick);
    return () => {
      stageNode.removeEventListener('mousedown', handleMouseDown);
      stageNode.removeEventListener('dblclick', handleDoubleClick);
    };
  }, [stageNode, applyTransform]);

  // Affordance: grab cursor only when there is something to pan.
  useEffect(() => {
    if (!stageNode) return;
    stageNode.style.cursor = transform.scale > MIN_SCALE ? 'grab' : 'default';
  }, [stageNode, transform.scale]);

  const handleSave = async () => {
    if (isSaving || !images[currentIndex]) return;

    setIsSaving(true);
    const result = await saveImageToLibrary(images[currentIndex]);
    setIsSaving(false);

    if (result.success) {
      ToastManager.success('Image saved to your library');
    } else {
      ToastManager.error('Failed to save image');
    }
  };

  const goToPrevious = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  const goToNext = () => {
    if (currentIndex < images.length - 1) setCurrentIndex(currentIndex + 1);
  };

  // Reserve space so the contained image doesn't render behind the header
  // toolbar or the Done/Save buttons (same reasoning as the native viewer).
  const topReserve = insets.top + HEADER_HEIGHT;
  const bottomReserve = insets.bottom + FOOTER_HEIGHT;
  const imageUrl = images[currentIndex];
  const zoomPercent = Math.round(transform.scale * 100);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        {/* Dark Backdrop */}
        <View style={styles.backdrop} />

        <Animated.View
          style={[styles.content, { transform: [{ scale: scaleAnim }] }]}
          pointerEvents="box-none"
        >
          {/* Stage — owns wheel/drag/double-click; sits under the chrome. */}
          <View
            ref={handleStageRef}
            style={[styles.stage, { paddingTop: topReserve, paddingBottom: bottomReserve }]}
          >
            {loading && !error && (
              <View style={styles.loadingContainer} pointerEvents="none">
                <ActivityIndicator size="large" color="#fff" />
              </View>
            )}
            {error ? (
              <View style={styles.errorContainer} pointerEvents="none">
                <Ionicons name="image-outline" size={64} color={colors.textSecondary} />
                <Text style={[styles.errorText, { color: colors.textSecondary }]}>
                  Failed to load image
                </Text>
              </View>
            ) : (
              // pointerEvents none: every mouse event belongs to the stage, so
              // a drag started on the image is handled by one listener set.
              <View
                pointerEvents="none"
                style={[
                  styles.imageWrap,
                  {
                    transform: [
                      { translateX: transform.x },
                      { translateY: transform.y },
                      { scale: transform.scale },
                    ],
                  },
                ]}
              >
                <Image
                  source={{ uri: imageUrl }}
                  style={styles.image}
                  resizeMode="contain"
                  onLoadStart={() => setLoading(true)}
                  onLoadEnd={() => setLoading(false)}
                  onError={() => {
                    setLoading(false);
                    setError(true);
                  }}
                />
              </View>
            )}
          </View>

          {/* Header: close · zoom toolbar · counter */}
          <View style={[styles.header, { paddingTop: insets.top + 16 }]} pointerEvents="box-none">
            <View style={styles.headerSide}>
              <TouchableOpacity
                onPress={onClose}
                style={styles.closeButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={32} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={styles.zoomToolbar}>
              <TouchableOpacity
                onPress={() => zoomByStep(1 / BUTTON_ZOOM_STEP)}
                style={styles.zoomButton}
                disabled={transform.scale <= MIN_SCALE}
                accessibilityLabel="Zoom out"
              >
                <Ionicons
                  name="remove"
                  size={20}
                  color={transform.scale <= MIN_SCALE ? 'rgba(255, 255, 255, 0.4)' : '#fff'}
                />
              </TouchableOpacity>

              <Text style={styles.zoomLabel}>{zoomPercent}%</Text>

              <TouchableOpacity
                onPress={() => zoomByStep(BUTTON_ZOOM_STEP)}
                style={styles.zoomButton}
                disabled={transform.scale >= MAX_SCALE}
                accessibilityLabel="Zoom in"
              >
                <Ionicons
                  name="add"
                  size={20}
                  color={transform.scale >= MAX_SCALE ? 'rgba(255, 255, 255, 0.4)' : '#fff'}
                />
              </TouchableOpacity>

              <View style={styles.zoomDivider} />

              <TouchableOpacity
                onPress={resetZoom}
                style={styles.zoomButton}
                accessibilityLabel="Fit image"
              >
                <Ionicons name="scan-outline" size={18} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={[styles.headerSide, styles.headerSideRight]}>
              {images.length > 1 && (
                <View style={styles.counterContainer}>
                  <Text style={styles.counterText}>
                    {currentIndex + 1} of {images.length}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Navigation Arrows */}
          {images.length > 1 && (
            <>
              {currentIndex > 0 && (
                <TouchableOpacity
                  style={[styles.arrowButton, styles.leftArrow]}
                  onPress={goToPrevious}
                  hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
                >
                  <View style={styles.arrowCircle}>
                    <Ionicons name="chevron-back" size={28} color="#fff" />
                  </View>
                </TouchableOpacity>
              )}

              {currentIndex < images.length - 1 && (
                <TouchableOpacity
                  style={[styles.arrowButton, styles.rightArrow]}
                  onPress={goToNext}
                  hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
                >
                  <View style={styles.arrowCircle}>
                    <Ionicons name="chevron-forward" size={28} color="#fff" />
                  </View>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* Dot Indicators */}
          {images.length > 1 && (
            <View style={styles.dotContainer} pointerEvents="none">
              {images.map((_, index) => (
                <View
                  key={`${images[index]}-${index}`}
                  style={[
                    styles.dot,
                    index === currentIndex
                      ? styles.dotActive
                      : { opacity: 0.3, transform: [{ scale: 0.8 }] },
                  ]}
                />
              ))}
            </View>
          )}

          <Text style={styles.hintText} pointerEvents="none">
            Scroll to zoom · drag to pan · double-click to reset
          </Text>

          {/* Footer */}
          <View
            style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}
            pointerEvents="box-none"
          >
            <TouchableOpacity onPress={onClose} style={[styles.button, styles.doneButton]}>
              <Text style={styles.buttonText}>Done</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSave}
              style={[styles.button, styles.saveButton, { backgroundColor: colors.link }]}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
  },
  content: {
    ...StyleSheet.absoluteFillObject,
  },
  stage: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  headerSide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSideRight: {
    justifyContent: 'flex-end',
  },
  closeButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 20,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 4,
  },
  zoomButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    minWidth: 48,
    textAlign: 'center',
  },
  zoomDivider: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  counterContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  counterText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  imageWrap: {
    width: '100%',
    height: '100%',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    marginTop: 12,
  },
  dotContainer: {
    position: 'absolute',
    bottom: 140,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  dotActive: {
    opacity: 1,
    transform: [{ scale: 1.2 }],
  },
  hintText: {
    position: 'absolute',
    bottom: 104,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
  },
  arrowButton: {
    position: 'absolute',
    top: '50%',
    marginTop: -24,
    zIndex: 10,
  },
  leftArrow: {
    left: 16,
  },
  rightArrow: {
    right: 16,
  },
  arrowCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 12,
    zIndex: 10,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  doneButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  saveButton: {
    // backgroundColor applied inline via colors.link
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
