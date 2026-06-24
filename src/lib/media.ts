export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const VOICE_MAX_BYTES = 5 * 1024 * 1024;
export const FILE_MAX_BYTES = 10 * 1024 * 1024;
export const STATUS_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const COMPRESS_ABOVE_BYTES = 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;

export function megabytes(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function validateUploadSize(file: Pick<File, 'size'>, maxBytes: number, label: string) {
  if (file.size > maxBytes) {
    throw new Error(`${label} must be ${megabytes(maxBytes)} or smaller.`);
  }
}

/**
 * Browser-native image resizing for free-tier bandwidth control. Animated GIFs
 * are left unchanged and all other large images are converted to WebP when the
 * compressed result is smaller than the original.
 */
export async function compressImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size <= COMPRESS_ABOVE_BYTES) {
    return file;
  }
  if (typeof createImageBitmap === 'undefined') return file;

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
    if (!blob || blob.size >= file.size) return file;
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${baseName}.webp`, { type: 'image/webp', lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}
