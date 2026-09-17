/**
 * 3D garment layer (three.js). Each garment is a subdivided plane whose vertices
 * are placed, every frame, at the 3D position of their torso-frame coordinates
 * in the live user's frame. A perspective camera aligned with the video pixel
 * grid gives real foreshortening when the user turns or leans.
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';
import { toFrameCoords, fromFrameCoords, adjustFrameCoords } from './torso.js';

const SEGMENTS = 24;
const FOV_DEG = 40;

/**
 * @param {HTMLCanvasElement} canvas transparent WebGL canvas stacked over the video canvas
 * @returns renderer API or null when WebGL is unavailable
 */
export function createGarmentRenderer(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch (err) {
    console.warn('WebGL unavailable, 3D layer disabled', err);
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 1, 10);
  const meshes = new Map();

  let W = 0;
  let H = 0;
  let D = 1; // camera distance to the z=0 plane, in pixels

  function resize(width, height) {
    W = width;
    H = height;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    D = H / 2 / Math.tan(THREE.MathUtils.degToRad(FOV_DEG) / 2);
    camera.near = D * 0.05;
    camera.far = D * 6;
    camera.position.set(W / 2, H / 2, D);
    camera.up.set(0, 1, 0);
    camera.lookAt(W / 2, H / 2, 0);
    camera.updateProjectionMatrix();
  }

  function makeTexture(drawable) {
    const tex = new THREE.CanvasTexture(drawable);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  function removeGarment(type) {
    const e = meshes.get(type);
    if (!e) return;
    scene.remove(e.mesh);
    e.geo.dispose();
    e.mat.map?.dispose();
    e.mat.dispose();
    meshes.delete(type);
  }

  /**
   * Registers (or replaces) a garment. Precomputes each vertex's torso-frame
   * coordinates from the garment's own frame.
   * @param {string} type
   * @param {{drawable, frame}} garment frame in drawable pixel coordinates
   * @param {number} order render order (higher draws on top)
   */
  function setGarment(type, garment, order) {
    removeGarment(type);
    const gw = garment.drawable.naturalWidth || garment.drawable.width;
    const gh = garment.drawable.naturalHeight || garment.drawable.height;

    const geo = new THREE.PlaneGeometry(1, 1, SEGMENTS, SEGMENTS);
    const uv = geo.attributes.uv;
    const ab = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) {
      const px = uv.getX(i) * gw;
      const py = (1 - uv.getY(i)) * gh;
      const { a, b } = toFrameCoords(garment.frame, { x: px, y: py });
      ab[i * 2] = a;
      ab[i * 2 + 1] = b;
    }

    const mat = new THREE.MeshBasicMaterial({
      map: makeTexture(garment.drawable),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    mesh.visible = false;
    scene.add(mesh);
    meshes.set(type, { mesh, geo, mat, ab });
  }

  function clear() {
    for (const type of [...meshes.keys()]) removeGarment(type);
    renderer.clear();
  }

  /**
   * Draws all garments for the current user frame.
   * @param userFrame torso frame in video pixels (x, y, z in px); null hides everything
   * @param paramsByType { top: {width,height,offsetY}, ... }
   * @param enabledByType { top: true, ... }
   * @param opacity 0..1
   * @param depthScale multiplier for landmark z (0 = flat)
   */
  function render(userFrame, paramsByType, enabledByType, opacity, depthScale = 1) {
    if (!W) return;
    const cx = W / 2;
    const cy = H / 2;

    for (const [type, e] of meshes) {
      const visible = !!userFrame && !!enabledByType[type];
      e.mesh.visible = visible;
      if (!visible) continue;

      const params = paramsByType[type];
      const pos = e.geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const { a, b } = adjustFrameCoords(e.ab[i * 2], e.ab[i * 2 + 1], params);
        const p = fromFrameCoords(userFrame, a, b);
        // Landmarks are already projected 2D points at depth z; unproject them so that
        // re-projection through the perspective camera lands back on the same pixel.
        const zpx = p.z * depthScale;
        const depth = Math.max(D * 0.2, D + zpx);
        const s = depth / D;
        const wx = cx + (p.x - cx) * s;
        const wy = cy + (p.y - cy) * s;
        pos.setXYZ(i, wx, H - wy, D - depth);
      }
      pos.needsUpdate = true;
      e.mat.opacity = opacity;
    }
    renderer.render(scene, camera);
  }

  return { resize, setGarment, removeGarment, clear, render, canvas };
}
