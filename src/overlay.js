import { SKELETON } from './landmarks.js';
import { frameToFrameAffine } from './torso.js';

const MIN_VISIBILITY = 0.5;

/**
 * Default adjustment parameters per garment type. With pose-aligned garments,
 * 1 / 1 / 0 means "exactly where the person in the photo wore it".
 */
export const DEFAULTS = {
  top: { width: 1.0, height: 1.0, offsetY: 0 },
  dress: { width: 1.0, height: 1.0, offsetY: 0 },
  bottom: { width: 1.0, height: 1.0, offsetY: 0 },
};

/** Converts normalized landmarks to video pixels (z scaled like x), honoring mirroring. */
export function landmarksToPixels(landmarks, width, height, mirrored) {
  return landmarks.map((p) => ({
    x: (mirrored ? 1 - p.x : p.x) * width,
    y: p.y * height,
    z: (p.z ?? 0) * width,
    visibility: p.visibility ?? 1,
  }));
}

/** 2D fallback: affine-maps the garment's torso frame onto the user's frame. */
export function drawGarment2D(ctx, drawable, garmentFrame, userFrame, params, opacity = 1) {
  const m = frameToFrameAffine(garmentFrame, userFrame, params);
  if (!m) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.drawImage(drawable, 0, 0);
  ctx.restore();
}

/** Debug overlay: draws torso/limb connections and joints from pixel landmarks. */
export function drawSkeleton(ctx, pixels) {
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0, 255, 170, 0.8)';
  ctx.fillStyle = 'rgba(255, 80, 80, 0.9)';

  for (const [a, b] of SKELETON) {
    const pa = pixels[a];
    const pb = pixels[b];
    if (pa.visibility < MIN_VISIBILITY || pb.visibility < MIN_VISIBILITY) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  for (const i of new Set(SKELETON.flat())) {
    const p = pixels[i];
    if (p.visibility < MIN_VISIBILITY) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
