/**
 * Loading and preprocessing of outfit images.
 */

/** Public image proxy that adds CORS headers. Used as fallback for hotlink-protected images. */
function proxyUrl(url) {
  const stripped = url.replace(/^https?:\/\//i, '');
  return `https://images.weserv.nl/?url=${encodeURIComponent(stripped)}`;
}

function loadImage(src, { cors = true } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar la imagen: ${src}`));
    img.src = src;
  });
}

/** Loads an outfit from a local File (from <input type="file"> or drag & drop). */
export async function loadOutfitFromFile(file) {
  if (!file.type.startsWith('image/')) {
    throw new Error('El archivo no es una imagen.');
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    return await loadImage(objectUrl, { cors: false });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Loads an outfit from a direct image URL.
 * Tries a CORS-enabled load first; falls back to an image proxy if the host
 * blocks cross-origin access (otherwise the canvas would be tainted).
 */
export async function loadOutfitFromUrl(url) {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('La URL debe empezar con http:// o https://');
  }
  try {
    return await loadImage(trimmed);
  } catch {
    try {
      return await loadImage(proxyUrl(trimmed));
    } catch {
      throw new Error(
        'No se pudo cargar la imagen desde esa URL. Verifica que sea un enlace directo a una imagen (jpg, png, webp).'
      );
    }
  }
}

function toCanvas(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx };
}

/** Returns true if the image already contains transparent pixels (sampled). */
export function imageHasTransparency(img) {
  const { canvas, ctx } = toCanvas(img);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const stride = 4 * 16;
  for (let i = 3; i < data.length; i += stride) {
    if (data[i] < 250) return true;
  }
  return false;
}

/**
 * Makes near-white, low-saturation pixels transparent.
 * Works well for typical product photos shot on a white background.
 *
 * @param {HTMLImageElement} img
 * @param {number} threshold 0..255; pixels whose darkest channel exceeds this become transparent.
 * @param {number} feather soft edge width in intensity units.
 * @returns {HTMLCanvasElement}
 */
export function removeWhiteBackground(img, threshold = 235, feather = 20) {
  const { canvas, ctx } = toCanvas(img);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  const maxSaturation = 28;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min > maxSaturation) continue;

    if (min >= threshold) {
      d[i + 3] = 0;
    } else if (min >= threshold - feather) {
      const t = (threshold - min) / feather;
      d[i + 3] = Math.round(d[i + 3] * t);
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
