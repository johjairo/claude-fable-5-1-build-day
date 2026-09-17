/**
 * Binary mask utilities (Uint8Array, 1 = on). Pure functions, testable in Node.
 */

/**
 * Labels 4-connected components. Returns { labels: Int32Array, sizes: number[] }
 * where labels[i] is 0 for background or the component id (1-based).
 */
export function connectedComponents(mask, width, height) {
  const labels = new Int32Array(width * height);
  const sizes = [0];
  const stack = new Int32Array(width * height);
  let next = 1;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = next++;
    let size = 0;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    while (sp > 0) {
      const i = stack[--sp];
      size++;
      const x = i % width;
      const y = (i - x) / width;
      if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = id; stack[sp++] = i - 1; }
      if (x < width - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - width] && !labels[i - width]) { labels[i - width] = id; stack[sp++] = i - width; }
      if (y < height - 1 && mask[i + width] && !labels[i + width]) { labels[i + width] = id; stack[sp++] = i + width; }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/**
 * Keeps the largest component plus any component at least `keepRatio` of its size
 * (sleeves split from the body by an arm, etc.). Drops speckles.
 */
export function keepMainComponents(mask, width, height, keepRatio = 0.15) {
  const { labels, sizes } = connectedComponents(mask, width, height);
  if (sizes.length <= 1) return { mask, area: 0 };
  const largest = Math.max(...sizes);
  const keep = sizes.map((s) => s >= largest * keepRatio);
  const out = new Uint8Array(mask.length);
  let area = 0;
  for (let i = 0; i < mask.length; i++) {
    if (labels[i] && keep[labels[i]]) {
      out[i] = 1;
      area++;
    }
  }
  return { mask: out, area };
}

/** Morphological erosion with a (2r+1)^2 square kernel. Removes boundary halo pixels. */
export function erode(mask, width, height, radius = 1) {
  if (radius <= 0) return mask;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      let on = 1;
      for (let dy = -radius; dy <= radius && on; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) { on = 0; break; }
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || !mask[yy * width + xx]) { on = 0; break; }
        }
      }
      out[i] = on;
    }
  }
  return out;
}

/** Axis-aligned bounding box of on-pixels, padded and clamped. Null if empty. */
export function boundingBox(mask, width, height, pad = 0) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!mask[row + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Nearest-neighbour resample of a single-channel image ({data,width,height}) to width x height. */
export function resampleMask(mask, width, height) {
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

/** Union of several single-channel masks (>127 = on) into a Uint8Array. */
export function unionMasks(parts, width, height) {
  const union = new Uint8Array(width * height);
  let area = 0;
  for (const part of parts) {
    const data = resampleMask(part, width, height);
    for (let i = 0; i < union.length; i++) {
      if (data[i] > 127 && !union[i]) {
        union[i] = 1;
        area++;
      }
    }
  }
  return { union, area };
}
