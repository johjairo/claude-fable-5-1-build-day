/**
 * Garment quality enhancement: 2x super-resolution with Swin2SR (open source,
 * runs in the browser through transformers.js). Alpha is upscaled separately so
 * the cut-out stays transparent.
 */
import {
  pipeline,
  env,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1';

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = 'Xenova/swin2SR-lightweight-x2-64';
/** Inputs larger than this (long side) are downscaled first to keep inference fast. */
const MAX_INPUT_SIDE = 512;

let upscalerPromise = null;

async function createUpscaler(onProgress) {
  const opts = { progress_callback: onProgress };
  if (navigator.gpu) {
    try {
      return await pipeline('image-to-image', MODEL_ID, { ...opts, device: 'webgpu' });
    } catch (err) {
      console.warn('WebGPU upscaler failed, falling back to WASM', err);
    }
  }
  return pipeline('image-to-image', MODEL_ID, { ...opts, device: 'wasm' });
}

export function loadUpscaler(onProgress) {
  if (!upscalerPromise) {
    upscalerPromise = createUpscaler(onProgress);
    upscalerPromise.catch(() => {
      upscalerPromise = null;
    });
  }
  return upscalerPromise;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Fills the transparent surroundings of the garment with blurred garment colour so
 * the super-resolution network does not smear black fringes into the edges.
 */
function padEdges(drawable, w, h) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.filter = 'blur(6px)';
  // Repeated source-over passes push the blurred alpha towards 1 around the edges.
  for (let i = 0; i < 4; i++) ctx.drawImage(drawable, 0, 0, w, h);
  ctx.filter = 'none';
  ctx.drawImage(drawable, 0, 0, w, h);
  return c;
}

function rawImageToCanvas(raw) {
  const { width, height, channels, data } = raw;
  const c = makeCanvas(width, height);
  const ctx = c.getContext('2d');
  const out = ctx.createImageData(width, height);
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const s = i * channels;
    const d = i * 4;
    if (channels === 1) {
      out.data[d] = out.data[d + 1] = out.data[d + 2] = data[s];
    } else {
      out.data[d] = data[s];
      out.data[d + 1] = data[s + 1];
      out.data[d + 2] = data[s + 2];
    }
    out.data[d + 3] = channels === 4 ? data[s + 3] : 255;
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

/**
 * Returns a new canvas with the garment at 2x resolution (relative to the
 * possibly-downscaled input), preserving transparency.
 *
 * @param {HTMLCanvasElement|HTMLImageElement} drawable garment with alpha
 * @param {(evt: object) => void} [onProgress]
 * @returns {Promise<{canvas: HTMLCanvasElement, scale: number}>} scale = output px / input px
 */
export async function upscaleGarment(drawable, onProgress) {
  const sr = await loadUpscaler(onProgress);

  const w0 = drawable.naturalWidth || drawable.width;
  const h0 = drawable.naturalHeight || drawable.height;
  const pre = Math.min(1, MAX_INPUT_SIDE / Math.max(w0, h0));
  const w = Math.max(8, Math.round(w0 * pre));
  const h = Math.max(8, Math.round(h0 * pre));

  const input = padEdges(drawable, w, h);
  const raw = await sr(input);

  const W = raw.width;
  const H = raw.height;
  const result = makeCanvas(W, H);
  const ctx = result.getContext('2d');
  ctx.drawImage(rawImageToCanvas(raw), 0, 0);

  // Alpha: smooth upscale of the original cut-out.
  const alpha = makeCanvas(W, H);
  const actx = alpha.getContext('2d');
  actx.imageSmoothingEnabled = true;
  actx.imageSmoothingQuality = 'high';
  actx.drawImage(drawable, 0, 0, W, H);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(alpha, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  return { canvas: result, scale: W / w0 };
}
