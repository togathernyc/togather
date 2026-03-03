import React, { useEffect, useState } from 'react';
import { ImageViewer } from '@/components/ui/ImageViewer';
import { ImageViewerState } from '@/types/image-viewer';

// Manager ref for imperative API
let viewerRef: {
  show: (images: string[], initialIndex?: number) => void;
  hide: () => void;
} | null = null;

export const ImageViewerManager = {
  setRef: (ref: typeof viewerRef) => {
    viewerRef = ref;
  },
  show: (images: string[], initialIndex: number = 0) => {
    if (viewerRef) {
      viewerRef.show(images, initialIndex);
    } else {
      console.warn(
        'ImageViewer ref not set. Use ImageViewerProvider to set the ref.'
      );
    }
  },
  hide: () => {
    if (viewerRef) {
      viewerRef.hide();
    }
  },
};

// Provider Component
interface ImageViewerProviderProps {
  children: React.ReactNode;
}

export function ImageViewerProvider({ children }: ImageViewerProviderProps) {
  const [state, setState] = useState<ImageViewerState>({
    visible: false,
    images: [],
    initialIndex: 0,
  });

  useEffect(() => {
    ImageViewerManager.setRef({
      show: (images: string[], initialIndex: number = 0) => {
        setState({
          visible: true,
          images,
          initialIndex,
        });
      },
      hide: () => {
        setState((prev) => ({
          ...prev,
          visible: false,
        }));
      },
    });
  }, []);

  const handleClose = () => {
    setState((prev) => ({
      ...prev,
      visible: false,
    }));
  };

  return (
    <>
      {children}
      <ImageViewer
        visible={state.visible}
        images={state.images}
        initialIndex={state.initialIndex}
        onClose={handleClose}
      />
    </>
  );
}
