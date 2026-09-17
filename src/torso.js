/**
 * Torso frame: a local coordinate system attached to a body.
 *
 *   origin = shoulder midpoint
 *   axisX  = left shoulder -> right shoulder (shoulders sit at a = -0.5 and +0.5)
 *   axisY  = shoulder midpoint -> hip midpoint (hips sit at b = 1)
 *
 * A garment segmented from a photo gets the frame of the person in that photo.
 * At render time each garment pixel's (a, b) frame coordinates are re-expressed in
 * the live user's frame, so shoulders land on shoulders and hips on hips, in 2D or 3D.
 *
 * Pure math, no DOM: unit-testable in Node.
 */

/** Ratio torso length / shoulder-joint distance used when hips are not visible. */
export const TORSO_TO_SHOULDER_RATIO = 1.25;
/** Ratio hip-joint distance / shoulder-joint distance used when hips are not visible. */
export const HIP_TO_SHOULDER_RATIO = 0.8;
const MIN_VISIBILITY = 0.5;

const mid = (p, q) => ({
  x: (p.x + q.x) / 2,
  y: (p.y + q.y) / 2,
  z: ((p.z ?? 0) + (q.z ?? 0)) / 2,
});
const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y, z: (p.z ?? 0) - (q.z ?? 0) });
const len2 = (v) => Math.hypot(v.x, v.y);

/**
 * Estimates hip joints from shoulders alone (person cropped at the waist, etc.).
 * Hips are placed perpendicular to the shoulder line, on the side of `down`.
 */
export function estimateHips(ls, rs, down = { x: 0, y: 1 }) {
  const sm = mid(ls, rs);
  const shoulderW = len2(sub(rs, ls));
  // Perpendicular to the shoulder line, oriented towards `down`.
  let px = -(rs.y - ls.y);
  let py = rs.x - ls.x;
  const n = Math.hypot(px, py) || 1;
  px /= n;
  py /= n;
  if (px * down.x + py * down.y < 0) {
    px = -px;
    py = -py;
  }
  const torso = shoulderW * TORSO_TO_SHOULDER_RATIO;
  const hm = { x: sm.x + px * torso, y: sm.y + py * torso, z: sm.z };
  const half = (shoulderW * HIP_TO_SHOULDER_RATIO) / 2;
  const ux = (rs.x - ls.x) / (shoulderW || 1);
  const uy = (rs.y - ls.y) / (shoulderW || 1);
  return {
    lh: { x: hm.x - ux * half, y: hm.y - uy * half, z: ls.z ?? 0, visibility: 0 },
    rh: { x: hm.x + ux * half, y: hm.y + uy * half, z: rs.z ?? 0, visibility: 0 },
  };
}

/**
 * Builds a frame from the four torso joints. Hips may be missing or low-confidence,
 * in which case they are estimated. Returns null when shoulders are not usable.
 *
 * @param {{ls, rs, lh?, rh?}} joints points with x, y, optional z and visibility
 */
export function frameFromJoints({ ls, rs, lh, rh }) {
  if (!ls || !rs) return null;
  if ((ls.visibility ?? 1) < MIN_VISIBILITY || (rs.visibility ?? 1) < MIN_VISIBILITY) return null;
  if (len2(sub(rs, ls)) < 1e-6) return null;

  let hipsEstimated = false;
  const hipsOk =
    lh && rh && (lh.visibility ?? 1) >= MIN_VISIBILITY && (rh.visibility ?? 1) >= MIN_VISIBILITY;
  if (!hipsOk) {
    ({ lh, rh } = estimateHips(ls, rs));
    hipsEstimated = true;
  }

  const origin = mid(ls, rs);
  const axisX = sub(rs, ls);
  const axisY = sub(mid(lh, rh), origin);
  return { origin, axisX, axisY, hipsEstimated };
}

/**
 * Expresses a 2D point in frame coordinates (a along shoulders, b along torso).
 * Only x/y are used; solves origin + a*axisX + b*axisY = p.
 */
export function toFrameCoords(frame, p) {
  const { origin, axisX, axisY } = frame;
  const det = axisX.x * axisY.y - axisY.x * axisX.y;
  if (Math.abs(det) < 1e-9) return { a: 0, b: 0 };
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return {
    a: (dx * axisY.y - axisY.x * dy) / det,
    b: (axisX.x * dy - dx * axisX.y) / det,
  };
}

/** Maps frame coordinates back to a 3D point in the frame's space. */
export function fromFrameCoords(frame, a, b) {
  const { origin, axisX, axisY } = frame;
  return {
    x: origin.x + a * axisX.x + b * axisY.x,
    y: origin.y + a * axisX.y + b * axisY.y,
    z: origin.z + a * axisX.z + b * axisY.z,
  };
}

/**
 * Applies user adjustments in frame space.
 * width/height scale the garment around the frame origin; offsetY slides it along the torso.
 */
export function adjustFrameCoords(a, b, params) {
  return {
    a: a * params.width,
    b: b * params.height + params.offsetY,
  };
}

/**
 * Frame for a ready-made garment image (transparent PNG) with no person in it.
 * Assumes a front-facing garment whose full width spans ~1.9 shoulder distances
 * (sleeves included) and whose top edge sits slightly above the shoulder joints.
 * MediaPipe's LEFT shoulder appears on the image's RIGHT for a front-facing body.
 */
export function syntheticGarmentFrame(width, height, type = 'top') {
  if (type === 'bottom') {
    // Waistband across the top edge; hips at ~8% below it. Shoulders are placed
    // above the image so the frame still has a valid X axis.
    const hipW = width * 0.85;
    const hm = { x: width / 2, y: height * 0.08, z: 0 };
    const shoulderW = hipW / HIP_TO_SHOULDER_RATIO;
    const sm = { x: width / 2, y: hm.y - shoulderW * TORSO_TO_SHOULDER_RATIO, z: 0 };
    return frameFromJoints({
      ls: { x: sm.x + shoulderW / 2, y: sm.y, z: 0 },
      rs: { x: sm.x - shoulderW / 2, y: sm.y, z: 0 },
      lh: { x: hm.x + hipW / 2, y: hm.y, z: 0 },
      rh: { x: hm.x - hipW / 2, y: hm.y, z: 0 },
    });
  }
  const shoulderW = width / 1.9;
  const sm = { x: width / 2, y: height * 0.1, z: 0 };
  const ls = { x: sm.x + shoulderW / 2, y: sm.y, z: 0 };
  const rs = { x: sm.x - shoulderW / 2, y: sm.y, z: 0 };
  return frameFromJoints({ ls, rs });
}

/** Scales a frame uniformly (e.g. after 2x super-resolution of the garment). */
export function scaleFrame(frame, s) {
  const m = (v) => ({ x: v.x * s, y: v.y * s, z: v.z * s });
  return { ...frame, origin: m(frame.origin), axisX: m(frame.axisX), axisY: m(frame.axisY) };
}

/** Translates a frame (e.g. from photo coordinates to crop coordinates). */
export function translateFrame(frame, dx, dy) {
  return {
    ...frame,
    origin: { x: frame.origin.x + dx, y: frame.origin.y + dy, z: frame.origin.z },
  };
}

/**
 * Affine matrix (canvas setTransform order: a, b, c, d, e, f) mapping points in the
 * garment frame's pixel space to the user's frame pixel space (2D only).
 */
export function frameToFrameAffine(gFrame, uFrame, params) {
  // Garment px -> (a,b): p = gO + a*gX + b*gY. Then adjust, then user px = uO + a'*uX + b'*uY.
  // Compose as 2D affine matrices.
  const det = gFrame.axisX.x * gFrame.axisY.y - gFrame.axisY.x * gFrame.axisX.y;
  if (Math.abs(det) < 1e-9) return null;
  // Inverse of [gX gY] applied to (p - gO)
  const ia = gFrame.axisY.y / det;
  const ib = -gFrame.axisX.y / det;
  const ic = -gFrame.axisY.x / det;
  const id = gFrame.axisX.x / det;
  // (a, b) = M_inv * (p - gO)
  // a' = a*W, b' = b*H + off
  const W = params.width;
  const H = params.height;
  const off = params.offsetY;
  // user = uO + a'*uX + b'*uY
  const ux = uFrame.axisX;
  const uy = uFrame.axisY;
  // Build full matrix: user = A * p + t
  const m11 = ux.x * W * ia + uy.x * H * ib;
  const m12 = ux.x * W * ic + uy.x * H * id;
  const m21 = ux.y * W * ia + uy.y * H * ib;
  const m22 = ux.y * W * ic + uy.y * H * id;
  const gox = gFrame.origin.x;
  const goy = gFrame.origin.y;
  const tx = uFrame.origin.x + uy.x * off - (m11 * gox + m12 * goy);
  const ty = uFrame.origin.y + uy.y * off - (m21 * gox + m22 * goy);
  return { a: m11, b: m21, c: m12, d: m22, e: tx, f: ty };
}
