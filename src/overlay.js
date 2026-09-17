import { LM, SKELETON } from './landmarks.js';

const MIN_VISIBILITY = 0.5;

/** Default placement parameters per garment type. */
export const DEFAULTS = {
  top: { width: 1.9, height: 1.0, offsetY: -0.12 },
  dress: { width: 1.9, height: 1.0, offsetY: -0.12 },
  bottom: { width: 1.35, height: 1.0, offsetY: -0.1 },
};

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Converts a normalized landmark to canvas pixels, honoring mirroring. */
function toPixels(lm, index, width, height, mirrored) {
  const p = lm[index];
  return {
    x: (mirrored ? 1 - p.x : p.x) * width,
    y: p.y * height,
    v: p.visibility ?? 1,
  };
}

/** Angle of the line joining two points, ordered left-to-right on screen. */
function lineAngle(a, b) {
  const [l, r] = a.x <= b.x ? [a, b] : [b, a];
  return Math.atan2(r.y - l.y, r.x - l.x);
}

/**
 * Computes where to draw the garment for the current pose.
 *
 * @param lm normalized landmarks from the pose detector
 * @param type 'top' | 'dress' | 'bottom'
 * @param params { width, height, offsetY } multipliers
 * @param aspect garment image height / width
 * @returns {{x:number,y:number,w:number,h:number,angle:number}|null}
 *   Top-center anchor in pixels, size, and rotation. Null when body not visible.
 */
export function computePlacement(lm, type, params, aspect, width, height, mirrored) {
  const ls = toPixels(lm, LM.L_SHOULDER, width, height, mirrored);
  const rs = toPixels(lm, LM.R_SHOULDER, width, height, mirrored);
  const lh = toPixels(lm, LM.L_HIP, width, height, mirrored);
  const rh = toPixels(lm, LM.R_HIP, width, height, mirrored);

  let anchor;
  let baseWidth;
  let angle;

  if (type === 'bottom') {
    if (Math.min(lh.v, rh.v) < MIN_VISIBILITY) return null;
    anchor = mid(lh, rh);
    // Hips are narrower than the garment waistband; boost slightly.
    baseWidth = dist(lh, rh) * 1.15;
    angle = lineAngle(lh, rh);
  } else {
    if (Math.min(ls.v, rs.v) < MIN_VISIBILITY) return null;
    anchor = mid(ls, rs);
    baseWidth = dist(ls, rs);
    angle = lineAngle(ls, rs);
  }

  const w = baseWidth * params.width;
  const h = w * aspect * params.height;

  // Offset along the body axis (perpendicular to the shoulder/hip line).
  const off = params.offsetY * h;
  const x = anchor.x - Math.sin(angle) * off;
  const y = anchor.y + Math.cos(angle) * off;

  return { x, y, w, h, angle };
}

/** Draws the garment image at the computed placement. */
export function drawOutfit(ctx, image, placement, opacity = 1) {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(placement.x, placement.y);
  ctx.rotate(placement.angle);
  ctx.drawImage(image, -placement.w / 2, 0, placement.w, placement.h);
  ctx.restore();
}

/** Debug overlay: draws torso/limb connections and joints. */
export function drawSkeleton(ctx, lm, width, height, mirrored) {
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0, 255, 170, 0.8)';
  ctx.fillStyle = 'rgba(255, 80, 80, 0.9)';

  for (const [a, b] of SKELETON) {
    const pa = toPixels(lm, a, width, height, mirrored);
    const pb = toPixels(lm, b, width, height, mirrored);
    if (pa.v < MIN_VISIBILITY || pb.v < MIN_VISIBILITY) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  const joints = new Set(SKELETON.flat());
  for (const i of joints) {
    const p = toPixels(lm, i, width, height, mirrored);
    if (p.v < MIN_VISIBILITY) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
