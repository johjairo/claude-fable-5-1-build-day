/**
 * Clothing segmentation in the browser.
 *
 * Uses a SegFormer model fine-tuned on clothing (ATR dataset) through
 * transformers.js. Given a photo of a person wearing an outfit, it returns one
 * transparent, cropped canvas per garment group (top / bottom / dress).
 */
import {
  pipeline,
  env,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1';

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = 'Xenova/segformer_b2_clothes';
const MAX_SIDE = 1024;
/** Minimum share of image pixels for a garment to count as detected. */
const MIN_AREA_RATIO = 0.005;
const PADDING_RATIO = 0.02;

/** Model labels grouped into the garment slots used by the overlay. */
export const GARMENT_LABELS = {
  top: ['Upper-clothes'],
  bottom: ['Pants', 'Skirt', 'Belt'],
  dress: ['Dress'],
};

/** Draw order: dress first, then bottom, then top on top of everything. */
export const GARMENT_ORDER = ['dress', 'bottom', 'top'];

export const GARMENT_NAMES = {
  top: 'Parte superior',
  bottom: 'Parte inferior',
  dress: 'Vestido',
};

let segmenterPromise = null;

async function createSegmenter(onProgress) {
  const opts = { progress_callback: onProgress };
  if (navigator.gpu) {
    try {
      return await pipeline('image-segmentation', MODEL_ID, { ...opts, device: 'webgpu' });
    } catch (err) {
      console.warn('WebGPU segmenter failed, falling back to WASM', err);
    }
  }
  return pipeline('image-segmentation', MODEL_ID, { ...opts, device: 'wasm' });
}

/** Lazily loads (and caches) the segmentation pipeline. */
export function loadSegmenter(onProgress) {
  if (!segmenterPromise) {
    segmenterPromise = createSegmenter(onProgress);
    segmenterPromise.catch(() => {
      segmenterPromise = null;
    });
  }
  return segmenterPromise;
}

export function isSegmenterReady() {
  return segmenterPromise !== null;
}

function downscale(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Nearest-neighbour resample of a single-channel mask. */
function resampleMask(mask, width, height) {
  if (mask.width === width && mask.height === height) return mask.data;
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(mask.height - 1, Math.floor((y * mask.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(mask.width - 1, Math.floor((x * mask.width) / width));
      out[y * width + x] = mask.data[sy * mask.width + sx];
    }
  }
  return out;
}

function unionMasks(parts, width, height) {
  const union = new Uint8Array(width * height);
  let area = 0;
  for (const part of parts) {
    const data = resampleMask(part.mask, width, height);
    for (let i = 0; i < union.length; i++) {
      if (data[i] > 127 && !union[i]) {
        union[i] = 1;
        area++;
      }
    }
  }
  return { union, area };
}

function boundingBox(union, width, height) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!union[row + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const pad = Math.round(Math.max(width, height) * PADDING_RATIO);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Builds a cropped, transparent canvas containing only the masked pixels. */
function cutGarment(source, union, box) {
  const { x, y, w, h } = box;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const mctx = maskCanvas.getContext('2d');
  const maskData = mctx.createImageData(w, h);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const on = union[(y + row) * source.width + (x + col)];
      const o = (row * w + col) * 4;
      maskData.data[o] = 255;
      maskData.data[o + 1] = 255;
      maskData.data[o + 2] = 255;
      maskData.data[o + 3] = on ? 255 : 0;
    }
  }
  mctx.putImageData(maskData, 0, 0);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.drawImage(source, x, y, w, h, 0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.filter = 'blur(1.2px)';
  ctx.drawImage(maskCanvas, 0, 0);
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  return out;
}

/**
 * Segments an outfit photo into garments.
 *
 * @param {HTMLImageElement} img CORS-clean image.
 * @param {(evt: object) => void} [onProgress] transformers.js progress events.
 * @returns {Promise<Record<string, {canvas: HTMLCanvasElement, aspect: number, area: number, labels: string[]}>>}
 *   Keyed by garment type; only detected garments are present.
 */
export async function extractGarments(img, onProgress) {
  const segmenter = await loadSegmenter(onProgress);
  const source = downscale(img);
  const { width, height } = source;

  // The pipeline accepts HTMLCanvasElement directly (RawImage.fromCanvas).
  const results = await segmenter(source);

  const garments = {};
  for (const [type, labels] of Object.entries(GARMENT_LABELS)) {
    const parts = results.filter((r) => labels.includes(r.label));
    if (!parts.length) continue;

    const { union, area } = unionMasks(parts, width, height);
    if (area < width * height * MIN_AREA_RATIO) continue;

    const box = boundingBox(union, width, height);
    const canvas = cutGarment(source, union, box);
    garments[type] = {
      canvas,
      aspect: box.h / box.w,
      area,
      labels: parts.map((p) => p.label),
    };
  }
  return garments;
}
