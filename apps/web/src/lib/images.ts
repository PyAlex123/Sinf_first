/**
 * Pictures for slides are made small in the teacher's browser before they travel (CLAUDE.md §3.1:
 * WebP, at most 1600 px wide and 150 KB; stage 4, W2): a photo from a phone is 4 MB, and thirty
 * weak computers load every slide.
 */

export const MAX_SLIDE_WIDTH = 1600;
export const MAX_SLIDE_BYTES = 150 * 1024;

export interface SlidePicture {
  blob: Blob;
  width: number;
  height: number;
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
}

/** Draws a picture (an image file or a drawn page) into WebP within the budget. */
export async function slidePicture(
  source: CanvasImageSource & { width: number; height: number },
): Promise<SlidePicture> {
  let width = source.width;
  let height = source.height;
  if (width > MAX_SLIDE_WIDTH) {
    height = Math.round((height * MAX_SLIDE_WIDTH) / width);
    width = MAX_SLIDE_WIDTH;
  }
  // Smaller, then lower quality, until it fits; a slide is looked at from across the room.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const g = canvas.getContext('2d');
    if (!g) throw new Error('canvas');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(source, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.55]) {
      const blob = await toBlob(canvas, quality);
      if (!blob) throw new Error('webp');
      if (blob.size <= MAX_SLIDE_BYTES) return { blob, width: canvas.width, height: canvas.height };
    }
    width = Math.round(width * 0.8);
    height = Math.round(height * 0.8);
  }
  throw new Error('too_large');
}

/** An image file the teacher picked, as a slide picture. */
export async function pictureFromFile(file: File): Promise<SlidePicture> {
  const bitmap = await createImageBitmap(file);
  try {
    return await slidePicture(bitmap);
  } finally {
    bitmap.close();
  }
}
