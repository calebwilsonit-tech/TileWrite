import type { PictureFormat, Raster } from './pictures';

/**
 * The window's own picture decoder, for the formats `pictures.ts` does not read itself (JPEG, GIF, WebP and SVG). A GIF or WebP
 * gives its first frame. An SVG is drawn at its own size, or 512 across when it has none, and at most 1024 on a side.
 */

const MIME: Partial<Record<PictureFormat, string>> = { jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', png: 'image/png', svg: 'image/svg+xml' };

function pixels(source: CanvasImageSource, width: number, height: number): Raster {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no drawing surface');
  ctx.drawImage(source, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);
  return { width, height, rgba: new Uint8ClampedArray(data.data) };
}

/** An SVG drawn at exactly w x h (see fitSvgTo, which makes the svg say so). */
export async function browserRasterizeSvgAt(svg: string, w: number, h: number): Promise<Raster> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return pixels(img, w, h);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function browserRasterize(bytes: Uint8Array, format: PictureFormat): Promise<Raster> {
  const type = MIME[format];
  if (!type) throw new Error(`the window cannot decode ${format}`);
  const blob = new Blob([bytes as BlobPart], { type });
  if (format === 'svg') {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      let w = img.naturalWidth || 512;
      let h = img.naturalHeight || 512;
      const longest = Math.max(w, h);
      if (longest > 1024) {
        w = Math.max(1, Math.round((w * 1024) / longest));
        h = Math.max(1, Math.round((h * 1024) / longest));
      } else if (longest < 16) {
        w *= 16;
        h *= 16;
      }
      return pixels(img, w, h);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const bitmap = await createImageBitmap(blob);
  try {
    return pixels(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}
