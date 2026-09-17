// Unit tests for the pure modules (no DOM). Run: node tests/unit.mjs
import {
  frameFromJoints, toFrameCoords, fromFrameCoords, adjustFrameCoords, frameToFrameAffine,
  syntheticGarmentFrame, scaleFrame, translateFrame, TORSO_TO_SHOULDER_RATIO,
} from '../src/torso.js';
import { connectedComponents, keepMainComponents, erode, boundingBox, unionMasks } from '../src/mask.js';

let fails = 0;
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const check = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name); if (!cond) fails++; };

// --- torso frames ---
const ls = { x: 700, y: 300, z: -10, visibility: 1 }, rs = { x: 500, y: 300, z: 10, visibility: 1 };
const lh = { x: 680, y: 560, z: 0, visibility: 1 }, rh = { x: 520, y: 560, z: 0, visibility: 1 };
const F = frameFromJoints({ ls, rs, lh, rh });
check('frame origin at shoulder mid', close(F.origin.x, 600) && close(F.origin.y, 300));
check('frame axisX = rs - ls', close(F.axisX.x, -200) && close(F.axisX.y, 0) && close(F.axisX.z, 20));
check('frame axisY = hipMid - shoulderMid', close(F.axisY.x, 0) && close(F.axisY.y, 260));
check('hips not estimated', F.hipsEstimated === false);

let c = toFrameCoords(F, ls); check('left shoulder -> a=-0.5,b=0', close(c.a, -0.5) && close(c.b, 0));
c = toFrameCoords(F, rs); check('right shoulder -> a=+0.5,b=0', close(c.a, 0.5) && close(c.b, 0));
c = toFrameCoords(F, { x: 600, y: 560 }); check('hip mid -> a=0,b=1', close(c.a, 0) && close(c.b, 1));
const rt = fromFrameCoords(F, 0.25, 0.5);
const back = toFrameCoords(F, rt); check('round trip', close(back.a, 0.25) && close(back.b, 0.5));
check('fromFrameCoords carries z', close(rt.z, 0.25 * 20));

const F2 = frameFromJoints({ ls, rs, lh: { ...lh, visibility: 0.1 }, rh: undefined });
check('hips estimated flag', F2.hipsEstimated === true);
check('estimated torso length = ratio * shoulderW', close(Math.hypot(F2.axisY.x, F2.axisY.y), 200 * TORSO_TO_SHOULDER_RATIO));
check('estimated hips point down (+y)', F2.axisY.y > 0 && close(F2.axisY.x, 0));
check('null when shoulder hidden', frameFromJoints({ ls: { ...ls, visibility: 0.2 }, rs }) === null);

// --- affine vs frame mapping consistency ---
const G = frameFromJoints({ ls: { x: 300, y: 80 }, rs: { x: 100, y: 90 }, lh: { x: 280, y: 330 }, rh: { x: 120, y: 340 } });
const U = frameFromJoints({ ls: { x: 900, y: 400 }, rs: { x: 650, y: 420 }, lh: { x: 880, y: 720 }, rh: { x: 680, y: 730 } });
const params = { width: 1.1, height: 0.9, offsetY: 0.05 };
const M = frameToFrameAffine(G, U, params);
const apply = (m, p) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
let maxErr = 0;
for (const p of [{ x: 0, y: 0 }, { x: 300, y: 80 }, { x: 150, y: 200 }, { x: 400, y: 400 }, { x: 33, y: 377 }]) {
  const { a, b } = toFrameCoords(G, p);
  const adj = adjustFrameCoords(a, b, params);
  const viaFrame = fromFrameCoords(U, adj.a, adj.b);
  const viaAffine = apply(M, p);
  maxErr = Math.max(maxErr, Math.abs(viaFrame.x - viaAffine.x), Math.abs(viaFrame.y - viaAffine.y));
}
check('affine == frame mapping', maxErr < 1e-6);
const M1 = frameToFrameAffine(G, U, { width: 1, height: 1, offsetY: 0 });
const s = apply(M1, { x: 300, y: 80 }); check('garment LS -> user LS', close(s.x, 900) && close(s.y, 400));
const hmid = apply(M1, { x: 200, y: 335 }); check('garment hip mid -> user hip mid', close(hmid.x, 780) && close(hmid.y, 725));

const S = syntheticGarmentFrame(380, 400, 'top');
check('synthetic top: shoulders span w/1.9', close(Math.hypot(S.axisX.x, S.axisX.y), 200));
check('synthetic top: LS on image right', S.axisX.x < 0);
check('synthetic top: origin at 10% height', close(S.origin.y, 40) && close(S.origin.x, 190));
const B = syntheticGarmentFrame(300, 500, 'bottom');
const hipB = fromFrameCoords(B, 0, 1); check('synthetic bottom: hips at 8% height', close(hipB.y, 40) && close(hipB.x, 150));
const Sc = scaleFrame(F, 2); check('scaleFrame doubles origin and axes', close(Sc.origin.x, 1200) && close(Sc.axisY.y, 520) && close(Sc.axisX.z, 40));
const Tr = translateFrame(F, -100, -50); check('translateFrame moves origin only', close(Tr.origin.x, 500) && close(Tr.origin.y, 250) && close(Tr.axisX.x, -200));

// --- masks ---
const W = 10, H = 6;
const m = new Uint8Array(W * H);
const on = (x, y) => (m[y * W + x] = 1);
for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) on(x, y);
on(8, 0); on(7, 5); on(8, 5);
const cc = connectedComponents(m, W, H);
check('3 components', cc.sizes.length - 1 === 3);
const kept = keepMainComponents(m, W, H, 0.15);
check('keepMain drops speckles (<15%)', kept.area === 16 && !kept.mask[8] && !kept.mask[5 * W + 7]);
const er = erode(kept.mask, W, H, 1);
let erArea = 0; for (const v of er) erArea += v;
check('erode 4x4 -> 2x2', erArea === 4 && er[2 * W + 2] === 1 && er[1 * W + 1] === 0);
const bb = boundingBox(kept.mask, W, H, 1);
check('bbox padded+clamped', bb.x === 0 && bb.y === 0 && bb.w === 6 && bb.h === 6);
check('bbox null for empty', boundingBox(new Uint8Array(W * H), W, H) === null);
const u = unionMasks([{ data: new Uint8ClampedArray([255, 0, 0, 0]), width: 2, height: 2 }, { data: new Uint8ClampedArray([0, 0, 0, 200]), width: 2, height: 2 }], 2, 2);
check('unionMasks merges & counts', u.area === 2 && u.union[0] === 1 && u.union[3] === 1);
const rs2 = unionMasks([{ data: new Uint8ClampedArray([255]), width: 1, height: 1 }], 3, 3);
check('unionMasks resamples smaller mask', rs2.area === 9);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
