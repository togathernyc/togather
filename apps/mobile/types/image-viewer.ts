export interface ImageViewerImage {
  url: string;
  thumbnailUrl?: string;
  id?: string | number;
}

export interface ImageViewerState {
  visible: boolean;
  images: string[];
  initialIndex: number;
}
