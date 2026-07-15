/**
 * ImageViewer (Web) — mouse-friendly full-screen image viewer.
 *
 * The native `ImageViewer.tsx` builds zoom/pan entirely from touch gestures
 * (pinch / finger-drag / double-tap via react-native-gesture-handler). A mouse
 * can't pinch, so on the desktop dashboard there was no way to zoom into a plan
 * image and pan around.
 *
 * This web-only sibling re-implements the same viewer with plain DOM so a mouse
 * works the way you'd expect:
 *   - scroll wheel / trackpad zooms, centered on the pointer
 *   - click-and-drag pans once zoomed in
 *   - double-click toggles fit <-> zoomed
 *   - a small toolbar (- / zoom% / + / fit) drives the same zoom
 *
 * It deliberately adds NO new dependency (per the repo's native-safety rules a
 * web-only UI library would pull a second React into apps/mobile and break
 * native rendering) and shares the exact props of the native viewer
 * (`visible`, `images`, `initialIndex`, `onClose`) so `ImageViewerProvider`
 * needs no change. The native `ImageViewer.tsx` is untouched, so phones are
 * unaffected.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveImageToLibrary } from '@/utils/saveImage';
import { ToastManager } from './Toast';
import { useTheme } from '@hooks/useTheme';

// Match the native viewer's zoom limits (see MIN_SCALE / MAX_SCALE there).
const MIN_SCALE = 1;
const MAX_SCALE = 5;
// Native double-tap zooms to 2.5x; mirror that for double-click.
const DOUBLE_CLICK_SCALE = 2.5;
// Below this pointer travel a press counts as a click (not a drag), so a plain
// click on the backdrop still closes the viewer.
const CLICK_MOVE_THRESHOLD = 4;

interface ImageViewerProps {
  visible: boolean;
  images: string[];
  initialIndex: number;
  onClose: () => void;
}

interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

const FIT: Transform = { scale: MIN_SCALE, tx: 0, ty: 0 };

// Clamp a requested zoom level to the viewer's limits (mirrors the native
// MIN_SCALE / MAX_SCALE). Exported for unit testing the zoom-bounds edge case.
export function clampScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

// Keep the image from being dragged entirely out of view: at scale s the image
// can travel at most half the extra size in each direction. Exported for tests.
export function clampPan(tx: number, ty: number, scale: number, w: number, h: number): { tx: number; ty: number } {
  const maxX = ((scale - 1) * w) / 2;
  const maxY = ((scale - 1) * h) / 2;
  // `+ 0` normalizes a `-0` result (Math.max(-0, …)) to a plain 0.
  return {
    tx: Math.max(-maxX, Math.min(maxX, tx)) + 0,
    ty: Math.max(-maxY, Math.min(maxY, ty)) + 0,
  };
}

export function ImageViewer({ visible, images, initialIndex, onClose }: ImageViewerProps) {
  const { colors } = useTheme();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [transform, setTransform] = useState<Transform>(FIT);
  const [isSaving, setIsSaving] = useState(false);
  const [errored, setErrored] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // Drag state kept in a ref so pointer handlers don't re-subscribe every move.
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTx: number;
    startTy: number;
    moved: boolean;
  } | null>(null);

  const zoomed = transform.scale > MIN_SCALE;

  // Reset to the requested slide (and to "fit") whenever the viewer opens.
  useEffect(() => {
    if (visible) {
      setCurrentIndex(initialIndex);
      setTransform(FIT);
    }
  }, [visible, initialIndex]);

  // Reset zoom whenever the visible slide changes (arrows, dots, keyboard).
  useEffect(() => {
    setTransform(FIT);
    setErrored(false);
  }, [currentIndex]);

  const containerSize = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { w: rect?.width ?? 0, h: rect?.height ?? 0 };
  }, []);

  const applyScale = useCallback(
    (nextScale: number, originX?: number, originY?: number) => {
      setTransform((prev) => {
        const clamped = clampScale(nextScale);
        if (clamped === MIN_SCALE) return FIT;
        const { w, h } = containerSize();
        // Zoom centered on the pointer: keep the content point under the cursor
        // fixed. Pointer offset is measured from the container centre because
        // the image is centred with transform-origin at the middle.
        let tx = prev.tx;
        let ty = prev.ty;
        if (originX != null && originY != null && prev.scale > 0) {
          const ratio = clamped / prev.scale;
          tx = originX - (originX - prev.tx) * ratio;
          ty = originY - (originY - prev.ty) * ratio;
        }
        const panned = clampPan(tx, ty, clamped, w, h);
        return { scale: clamped, tx: panned.tx, ty: panned.ty };
      });
    },
    [containerSize],
  );

  const zoomIn = useCallback(() => applyScale(transform.scale + 0.5), [applyScale, transform.scale]);
  const zoomOut = useCallback(() => applyScale(transform.scale - 0.5), [applyScale, transform.scale]);
  const resetZoom = useCallback(() => setTransform(FIT), []);

  const toggleZoom = useCallback(
    (originX?: number, originY?: number) => {
      if (zoomed) {
        setTransform(FIT);
      } else {
        applyScale(DOUBLE_CLICK_SCALE, originX, originY);
      }
    },
    [zoomed, applyScale],
  );

  const goToPrevious = useCallback(() => {
    setCurrentIndex((i) => Math.max(0, i - 1));
  }, []);

  const goToNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(images.length - 1, i + 1));
  }, [images.length]);

  const handleSave = useCallback(async () => {
    const url = images[currentIndex];
    if (isSaving || !url) return;
    setIsSaving(true);
    const result = await saveImageToLibrary(url);
    setIsSaving(false);
    if (result.success) {
      ToastManager.success('Image saved to your library');
    } else {
      ToastManager.error('Failed to save image');
    }
  }, [images, currentIndex, isSaving]);

  // Wheel zoom must call preventDefault to stop the page scrolling, which React's
  // synthetic (passive) onWheel can't do — attach a non-passive native listener.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !visible) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const originX = e.clientX - rect.left - rect.width / 2;
      const originY = e.clientY - rect.top - rect.height / 2;
      // deltaY < 0 => wheel up => zoom in.
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setTransform((prev) => {
        const clamped = clampScale(prev.scale * factor);
        if (clamped === MIN_SCALE) return FIT;
        const ratio = prev.scale > 0 ? clamped / prev.scale : 1;
        const tx = originX - (originX - prev.tx) * ratio;
        const ty = originY - (originY - prev.ty) * ratio;
        const panned = clampPan(tx, ty, clamped, rect.width, rect.height);
        return { scale: clamped, tx: panned.tx, ty: panned.ty };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [visible]);

  // Keyboard: Esc closes, arrows navigate multi-image sets.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goToPrevious();
      else if (e.key === 'ArrowRight') goToNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClose, goToPrevious, goToNext]);

  // Lock body scroll while the viewer is open.
  useEffect(() => {
    if (!visible || typeof document === 'undefined') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [visible]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startTx: transform.tx,
        startTy: transform.ty,
        moved: false,
      };
    },
    [transform.tx, transform.ty],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > CLICK_MOVE_THRESHOLD) {
        drag.moved = true;
      }
      // Panning only makes sense while zoomed in.
      if (!zoomed) return;
      const { w, h } = containerSize();
      const panned = clampPan(drag.startTx + dx, drag.startTy + dy, transform.scale, w, h);
      setTransform((prev) => ({ ...prev, tx: panned.tx, ty: panned.ty }));
    },
    [zoomed, containerSize, transform.scale],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  // A plain click (no drag) on the dark backdrop at fit closes the viewer —
  // matching the native TouchableWithoutFeedback backdrop. A drag that panned
  // the image must not close it.
  const handleBackdropClick = useCallback(() => {
    const drag = dragRef.current;
    const moved = drag?.moved ?? false;
    if (!moved && !zoomed) onClose();
  }, [zoomed, onClose]);

  const currentImage = images[currentIndex];

  const transformStyle = useMemo<React.CSSProperties>(
    () => ({
      transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
      transition: dragRef.current ? 'none' : 'transform 0.12s ease-out',
    }),
    [transform],
  );

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      {/* Header: close (left) + counter (right) */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          zIndex: 3,
          pointerEvents: 'none',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ ...iconButtonStyle, pointerEvents: 'auto' }}
        >
          <CloseIcon />
        </button>
        {images.length > 1 && (
          <div style={{ ...pillStyle, pointerEvents: 'auto' }}>
            {currentIndex + 1} of {images.length}
          </div>
        )}
      </div>

      {/* Zoom toolbar + hint */}
      <div
        style={{
          position: 'absolute',
          top: 60,
          left: 0,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          zIndex: 3,
          pointerEvents: 'none',
        }}
      >
        <div style={{ ...toolbarStyle, pointerEvents: 'auto' }}>
          <button
            type="button"
            onClick={zoomOut}
            aria-label="Zoom out"
            disabled={transform.scale <= MIN_SCALE}
            style={toolbarButtonStyle(transform.scale <= MIN_SCALE)}
          >
            −
          </button>
          <span style={{ color: '#fff', fontSize: 13, minWidth: 48, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(transform.scale * 100)}%
          </span>
          <button
            type="button"
            onClick={zoomIn}
            aria-label="Zoom in"
            disabled={transform.scale >= MAX_SCALE}
            style={toolbarButtonStyle(transform.scale >= MAX_SCALE)}
          >
            +
          </button>
          <div style={{ width: 1, height: 20, backgroundColor: 'rgba(255,255,255,0.25)' }} />
          <button
            type="button"
            onClick={resetZoom}
            aria-label="Fit to screen"
            disabled={!zoomed}
            style={{ ...toolbarButtonStyle(!zoomed), width: 'auto', paddingLeft: 10, paddingRight: 10, fontSize: 13 }}
          >
            Fit
          </button>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
          Scroll to zoom · drag to pan · double-click to reset
        </span>
      </div>

      {/* Image area — the backdrop for this region closes on plain click at fit */}
      <div
        ref={containerRef}
        onClick={handleBackdropClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(e) => {
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) {
            toggleZoom(e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2);
          } else {
            toggleZoom();
          }
        }}
        style={{
          position: 'absolute',
          top: 96,
          left: 0,
          right: 0,
          bottom: 88,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: zoomed ? (dragRef.current?.moved ? 'grabbing' : 'grab') : 'auto',
        }}
      >
        {errored ? (
          <span style={{ color: colors.textSecondary, fontSize: 16 }}>Failed to load image</span>
        ) : (
          <img
            src={currentImage}
            alt=""
            draggable={false}
            onError={() => setErrored(true)}
            // Stop clicks/double-clicks on the image bubbling to the backdrop
            // (a click on the image must never close the viewer).
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              ...transformStyle,
            }}
          />
        )}
      </div>

      {/* Navigation arrows */}
      {images.length > 1 && (
        <>
          {currentIndex > 0 && (
            <button
              type="button"
              onClick={goToPrevious}
              aria-label="Previous image"
              style={{ ...arrowButtonStyle, left: 16 }}
            >
              <ChevronIcon direction="left" />
            </button>
          )}
          {currentIndex < images.length - 1 && (
            <button
              type="button"
              onClick={goToNext}
              aria-label="Next image"
              style={{ ...arrowButtonStyle, right: 16 }}
            >
              <ChevronIcon direction="right" />
            </button>
          )}
        </>
      )}

      {/* Dot indicators */}
      {images.length > 1 && (
        <div
          style={{
            position: 'absolute',
            bottom: 100,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            gap: 8,
            zIndex: 3,
          }}
        >
          {images.map((_, index) => (
            <span
              key={index}
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: '#fff',
                opacity: index === currentIndex ? 1 : 0.3,
                transform: index === currentIndex ? 'scale(1.2)' : 'scale(0.8)',
              }}
            />
          ))}
        </div>
      )}

      {/* Footer: Done + Save */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 88,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: '0 24px',
          zIndex: 3,
        }}
      >
        <button type="button" onClick={onClose} style={doneButtonStyle}>
          Done
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          style={{ ...saveButtonStyle, backgroundColor: colors.link, opacity: isSaving ? 0.6 : 1 }}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// --- inline styles / small SVG icons (no icon dependency needed on web) ---

const iconButtonStyle: React.CSSProperties = {
  width: 44,
  height: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
};

const pillStyle: React.CSSProperties = {
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  padding: '6px 12px',
  borderRadius: 16,
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  backgroundColor: 'rgba(0, 0, 0, 0.55)',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 20,
  padding: '4px 8px',
};

function toolbarButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    width: 30,
    height: 30,
    borderRadius: 15,
    border: 'none',
    background: 'transparent',
    color: '#fff',
    fontSize: 18,
    lineHeight: '18px',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.35 : 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

const arrowButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  width: 48,
  height: 48,
  borderRadius: 24,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 3,
  padding: 0,
};

const doneButtonStyle: React.CSSProperties = {
  flex: 1,
  maxWidth: 240,
  height: 48,
  borderRadius: 12,
  backgroundColor: 'rgba(255, 255, 255, 0.2)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  color: '#fff',
  fontSize: 16,
  fontWeight: 600,
  cursor: 'pointer',
};

const saveButtonStyle: React.CSSProperties = {
  flex: 1,
  maxWidth: 240,
  height: 48,
  borderRadius: 12,
  border: 'none',
  color: '#fff',
  fontSize: 16,
  fontWeight: 600,
  cursor: 'pointer',
};

function CloseIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {direction === 'left' ? <polyline points="15 6 9 12 15 18" /> : <polyline points="9 6 15 12 9 18" />}
    </svg>
  );
}
