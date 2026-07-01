import { useEffect, useState } from 'react';

export interface ImageDimensions {
  w: number;
  h: number;
}

/**
 * Load an image and report its natural pixel dimensions. Returns null while the
 * image is loading, when `src` is null, or if the image fails to load.
 *
 * Used to lock a stage box to the floor-plan image's aspect ratio so there is no
 * letterboxing — making stage-% coordinates equal image-% coordinates.
 */
export function useImageDimensions(src: string | null): ImageDimensions | null {
  const [dims, setDims] = useState<ImageDimensions | null>(null);

  useEffect(() => {
    if (!src) {
      setDims(null);
      return;
    }

    let active = true;
    setDims(null);

    const img = new Image();
    img.onload = () => {
      if (active) setDims({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      if (active) setDims(null);
    };
    img.src = src;

    return () => {
      active = false;
      img.onload = null;
      img.onerror = null;
    };
  }, [src]);

  return dims;
}
