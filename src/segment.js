/**
 * Clothing segmentation in the browser.
 *
 * Uses a SegFormer model fine-tuned on clothing (ATR dataset) through
 * transformers.js. Given a photo of a person wearing an outfit, it returns one
 * transparent, cropped canvas per garment group (top / bottom / dress), each with
 * the torso frame of the person in the photo so it can be re-fitted to the user.
 */
import {
  pipeline,
  env,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1';
import { unionMasks, keepMainComponents, erode, boundingBox } from './mask.js';
import { frameFromJoints, translateFrame, syntheticGarmentFrame } from './torso.js';
import { torsoJoints } from './pose.js';

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

/** Builds a cropped, transparent canvas containing only the masked pixels. */
function cutGarment(source, mask, box, feather) {
  const { x, y, w, h } = box;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const mctx = maskCanvas.getContext('2d');
  const maskData = mctx.createImageData(w, h);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const on = mask[(y + row) * source.width + (x + col)];
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
  ctx.filter = `blur(${feather}px)`;
  ctx.drawImage(maskCanvas, 0, 0);
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  return out;
}

/** Runs pose on the photo and returns the torso frame in source pixels (or null). */
function detectPhotoFrame(poseDetector, source) {
  if (!poseDetector) return null;
  try {
    const lm = poseDetector.detect(source);
    if (!lm) return null;
    const { width, height } = source;
    const px = (p) => ({ x: p.x * width, y: p.y * height, z: p.z * width, visibility: p.visibility });
    const j = torsoJoints(lm);
    return frameFromJoints({ ls: px(j.ls), rs: px(j.rs), lh: px(j.lh), rh: px(j.rh) });
  } catch (err) {
    console.warn('Pose on outfit photo failed', err);
    return null;
  }
}

/**
 * Segments an outfit photo into garments.
 *
 * @param {HTMLImageElement} img CORS-clean image.
 * @param {object} [opts]
 * @param {(evt: object) => void} [opts.onProgress] transformers.js progress events.
 * @param {{detect(source): Array|null}} [opts.poseDetector] image-mode pose detector for the photo.
 * @returns {Promise<Record<string, {canvas, aspect, area, labels, frame, poseAligned}>>}
 *   Keyed by garment type; only detected garments are present. `frame` is in crop pixels.
 */
export async function extractGarments(img, { onProgress, poseDetector } = {}) {
  const segmenter = await loadSegmenter(onProgress);
  const source = downscale(img);
  const { width, height } = source;

  // The pipeline accepts HTMLCanvasElement directly (RawImage.fromCanvas).
  const results = await segmenter(source);
  const photoFrame = detectPhotoFrame(poseDetector, source);

  const longSide = Math.max(width, height);
  const erodeRadius = Math.max(1, Math.round(longSide / 600));
  const feather = Math.max(0.8, longSide / 800);
  const pad = Math.round(longSide * PADDING_RATIO);

  const garments = {};
  for (const [type, labels] of Object.entries(GARMENT_LABELS)) {
    const parts = results.filter((r) => labels.includes(r.label)).map((r) => r.mask);
    if (!parts.length) continue;

    const { union, area: rawArea } = unionMasks(parts, width, height);
    if (rawArea < width * height * MIN_AREA_RATIO) continue;

    let { mask, area } = keepMainComponents(union, width, height);
    if (area < width * height * MIN_AREA_RATIO) continue;
    mask = erode(mask, width, height, erodeRadius);

    const box = boundingBox(mask, width, height, pad);
    if (!box) continue;

    const canvas = cutGarment(source, mask, box, feather);
    const frame = photoFrame
      ? translateFrame(photoFrame, -box.x, -box.y)
      : syntheticGarmentFrame(box.w, box.h, type);

    garments[type] = {
      canvas,
      aspect: box.h / box.w,
      area,
      labels: results.filter((r) => labels.includes(r.label)).map((r) => r.label),
      frame,
      poseAligned: !!photoFrame,
    };
  }
  return garments;
}
