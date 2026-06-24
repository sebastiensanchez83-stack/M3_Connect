// Shared client-side image helpers used by the upload controls.

/**
 * Downscale an image to fit within maxWidth × maxHeight and return a Blob.
 * Only downscales (never upscales). PNGs keep their format (so transparency
 * survives); everything else is re-encoded as JPEG. SVGs and non-images are
 * returned unchanged. This is what lets a 20 MB phone photo upload fine.
 */
export async function resizeImage(
  file: File,
  maxWidth = 1600,
  maxHeight = 900,
  quality = 0.85,
): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas not supported')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => { if (blob) resolve(blob); else reject(new Error('Failed to create blob')); },
        file.type === 'image/png' ? 'image/png' : 'image/jpeg',
        quality,
      );
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

/** "1200×400 px · 245 KB" for upload feedback; just the weight for non-images. */
export async function fileMeta(file: File): Promise<string> {
  const weight = file.size < 1024 * 1024
    ? `${Math.round(file.size / 1024)} KB`
    : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
  if (!file.type.startsWith('image/')) return weight;
  return await new Promise<string>((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(`${img.naturalWidth}×${img.naturalHeight} px · ${weight}`); URL.revokeObjectURL(url); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(weight); };
    img.src = url;
  });
}
