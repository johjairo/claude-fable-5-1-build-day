import { startCamera } from './camera.js';
import { createPoseDetector, getImagePoseDetector, torsoJoints } from './pose.js';
import {
  loadOutfitFromFile,
  loadOutfitFromUrl,
  imageHasTransparency,
  removeWhiteBackground,
} from './outfit.js';
import { DEFAULTS, landmarksToPixels, drawGarment2D, drawSkeleton } from './overlay.js';
import { extractGarments, GARMENT_ORDER, GARMENT_NAMES } from './segment.js';
import { frameFromJoints, syntheticGarmentFrame, scaleFrame } from './torso.js';
import { createGarmentRenderer } from './render3d.js';
import { generateTryOn, canvasToBlob } from './tryon.js';

const STORAGE_KEY = 'vto-settings-v2';
const SAMPLE_OUTFIT = 'assets/sample-top.png';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('canvas');
const glCanvas = $('gl');
const frameEl = $('frame');
const ctx = canvas.getContext('2d');
const stage = document.querySelector('.stage');
const statusEl = $('status');
const toastEl = $('toast');

const ui = {
  fileInput: $('file-input'),
  sampleBtn: $('sample-btn'),
  urlForm: $('url-form'),
  urlInput: $('url-input'),
  progress: $('progress'),
  progressBar: document.querySelector('#progress .progress-bar'),
  progressText: document.querySelector('#progress .progress-text'),
  garments: $('garments'),
  garmentsEmpty: $('garments-empty'),
  enhanceBtn: $('enhance-btn'),
  type: $('type'),
  width: $('width'),
  height: $('height'),
  offset: $('offset'),
  opacity: $('opacity'),
  keyBg: $('key-bg'),
  threshold: $('threshold'),
  thresholdField: $('threshold-field'),
  mode3d: $('mode3d'),
  depth: $('depth'),
  depthField: $('depth-field'),
  skeleton: $('skeleton'),
  mirror: $('mirror'),
  snapshotBtn: $('snapshot-btn'),
  resetBtn: $('reset-btn'),
  generateBtn: $('generate-btn'),
  garmentDes: $('garment-des'),
  steps: $('steps'),
  hfToken: $('hf-token'),
  result: $('result'),
  resultStatus: $('result-status'),
  resultBefore: $('result-before'),
  resultAfter: $('result-after'),
  resultDownload: $('result-download'),
  resultCancel: $('result-cancel'),
  resultClose: $('result-close'),
};

// ---------- Settings (persisted) ----------
function defaultSettings() {
  return {
    type: 'top',
    params: {
      top: { ...DEFAULTS.top },
      dress: { ...DEFAULTS.dress },
      bottom: { ...DEFAULTS.bottom },
    },
    opacity: 1,
    keyBg: true,
    threshold: 235,
    mode3d: true,
    depth: 1,
    skeleton: false,
    mirror: true,
    steps: 30,
    garmentDes: '',
    hfToken: '',
  };
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings();
    const saved = JSON.parse(raw);
    const base = defaultSettings();
    return {
      ...base,
      ...saved,
      params: {
        top: { ...base.params.top, ...(saved.params?.top || {}) },
        dress: { ...base.params.dress, ...(saved.params?.dress || {}) },
        bottom: { ...base.params.bottom, ...(saved.params?.bottom || {}) },
      },
    };
  } catch {
    return defaultSettings();
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

let settings = loadSettings();

// ---------- Outfit state (not persisted) ----------
/**
 * mode: 'none' | 'single' (transparent PNG or white-keyed fallback) | 'segmented'
 * garments[type] = { drawable, frame, aspect, enabled, sublabel, keyed, enhanced, thumb }
 *   frame: torso frame in drawable pixel coordinates (see torso.js)
 */
const outfit = {
  mode: 'none',
  source: null,
  garments: {},
};

let detector = null;
let renderer3d = null;
let frameSize = { width: 0, height: 0 };
let lastUserFrame = null;
let toastTimer = null;
let loadToken = 0;
let enhancing = false;
let generating = null; // { controller, before, after }

// ---------- UI helpers ----------
function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`.trim();
}

function cameraReady() {
  setStatus(detector ? 'Cámara lista' : 'Cargando modelo de pose…', detector ? 'ok' : '');
}

function toast(text, kind = '') {
  toastEl.textContent = text;
  toastEl.className = `toast ${kind}`.trim();
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 4500);
}

function showProgress(text, pct = null) {
  ui.progress.hidden = false;
  ui.progressText.textContent = text;
  ui.progressBar.style.width = pct == null ? '100%' : `${Math.max(2, Math.min(100, pct))}%`;
  ui.progressBar.style.opacity = pct == null ? '0.35' : '1';
}

function hideProgress() {
  ui.progress.hidden = true;
}

function fmt(n, digits = 2) {
  return Number(n).toFixed(digits);
}

function syncControls() {
  const p = settings.params[settings.type];
  ui.type.value = settings.type;
  ui.width.value = p.width;
  ui.height.value = p.height;
  ui.offset.value = p.offsetY;
  ui.opacity.value = settings.opacity;
  ui.keyBg.checked = settings.keyBg;
  ui.threshold.value = settings.threshold;
  ui.mode3d.checked = settings.mode3d;
  ui.depth.value = settings.depth;
  ui.skeleton.checked = settings.skeleton;
  ui.mirror.checked = settings.mirror;

  $('width-out').value = fmt(p.width);
  $('height-out').value = fmt(p.height);
  $('offset-out').value = fmt(p.offsetY);
  $('opacity-out').value = fmt(settings.opacity);
  $('threshold-out').value = settings.threshold;
  $('depth-out').value = fmt(settings.depth);
  ui.thresholdField.style.display = settings.keyBg ? '' : 'none';
  ui.depthField.style.display = settings.mode3d && renderer3d ? '' : 'none';
  ui.mode3d.disabled = !renderer3d;

  const list = Object.values(outfit.garments);
  ui.enhanceBtn.disabled = enhancing || !list.length || list.every((g) => g.enhanced);

  ui.steps.value = settings.steps;
  $('steps-out').value = settings.steps;
  ui.garmentDes.value = settings.garmentDes;
  ui.hfToken.value = settings.hfToken;
  ui.generateBtn.disabled = !!generating || !outfit.source || !frameSize.width;

  renderGarmentList();
}

function thumbnailFrom(drawable) {
  const size = 96;
  const w = drawable.naturalWidth || drawable.width;
  const h = drawable.naturalHeight || drawable.height;
  const scale = Math.min(size / w, size / h, 1);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c.getContext('2d').drawImage(drawable, 0, 0, c.width, c.height);
  return c.toDataURL();
}

function renderGarmentList() {
  ui.garments.querySelectorAll('.garment').forEach((el) => el.remove());
  const types = GARMENT_ORDER.filter((t) => outfit.garments[t]);
  ui.garmentsEmpty.hidden = types.length > 0;

  for (const type of [...types].reverse()) {
    const g = outfit.garments[type];
    const row = document.createElement('div');
    row.className = `garment${type === settings.type ? ' active' : ''}`;

    const img = document.createElement('img');
    img.src = g.thumb || (g.thumb = thumbnailFrom(g.drawable));
    img.alt = GARMENT_NAMES[type];

    const name = document.createElement('span');
    name.className = 'garment-name';
    name.textContent = GARMENT_NAMES[type];
    const subParts = [];
    if (g.sublabel) subParts.push(g.sublabel);
    if (g.poseAligned === false) subParts.push('sin pose, ajuste aproximado');
    if (g.enhanced) subParts.push('x2');
    if (subParts.length) {
      const sub = document.createElement('span');
      sub.className = 'garment-sub';
      sub.textContent = subParts.join(' · ');
      name.appendChild(sub);
    }
    name.addEventListener('click', () => {
      settings.type = type;
      saveSettings();
      syncControls();
    });

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = g.enabled;
    toggle.title = 'Mostrar / ocultar';
    toggle.addEventListener('change', () => {
      g.enabled = toggle.checked;
    });

    row.append(img, name, toggle);
    ui.garments.appendChild(row);
  }
}

// ---------- Outfit handling ----------
function syncRenderer3d() {
  if (!renderer3d) return;
  renderer3d.clear();
  GARMENT_ORDER.forEach((type, order) => {
    const g = outfit.garments[type];
    if (g) renderer3d.setGarment(type, g, order);
  });
}

function clearOutfit() {
  outfit.mode = 'none';
  outfit.source = null;
  outfit.garments = {};
  syncRenderer3d();
  renderGarmentList();
}

function drawableSize(d) {
  return { w: d.naturalWidth || d.width, h: d.naturalHeight || d.height };
}

/** Single-garment path: transparent PNG, or opaque image with white keying. */
function setSingleGarment(img, sublabel) {
  const hasAlpha = safeHasTransparency(img);
  const drawable = !hasAlpha && settings.keyBg ? removeWhiteBackground(img, settings.threshold) : img;
  const { w, h } = drawableSize(drawable);

  outfit.mode = 'single';
  outfit.source = img;
  outfit.garments = {
    [settings.type]: {
      drawable,
      frame: syntheticGarmentFrame(w, h, settings.type),
      aspect: h / w,
      enabled: true,
      sublabel,
      keyed: !hasAlpha,
      poseAligned: false,
      enhanced: false,
    },
  };
  syncRenderer3d();
  syncControls();
}

/** Re-applies white keying when its settings change (single mode only). */
function rebuildSingleGarment() {
  if (outfit.mode !== 'single' || !outfit.source) return;
  const type = Object.keys(outfit.garments)[0];
  const g = outfit.garments[type];
  if (!g?.keyed) return;
  g.drawable = settings.keyBg
    ? removeWhiteBackground(outfit.source, settings.threshold)
    : outfit.source;
  const { w, h } = drawableSize(g.drawable);
  g.frame = syntheticGarmentFrame(w, h, type);
  g.enhanced = false;
  g.thumb = null;
  syncRenderer3d();
  syncControls();
}

function safeHasTransparency(img) {
  try {
    return imageHasTransparency(img);
  } catch {
    return false;
  }
}

function progressHandler(token, label) {
  return (evt) => {
    if (token !== loadToken) return;
    if (evt.status === 'progress' && typeof evt.progress === 'number') {
      const file = (evt.file || '').split('/').pop();
      showProgress(`Descargando ${label}… ${Math.round(evt.progress)}% (${file})`, evt.progress);
    } else if (evt.status === 'initiate') {
      showProgress(`Descargando ${label} (solo la primera vez)…`, 0);
    } else if (evt.status === 'ready') {
      showProgress('Procesando…');
    }
  };
}

/**
 * Decides how to process a freshly loaded image:
 *  - transparent → single garment in the selected slot
 *  - opaque (JPG/JPEG/WebP…) → segmentation + pose; if nothing detected, white-keying fallback
 */
async function processImage(img, label) {
  const token = ++loadToken;

  if (safeHasTransparency(img)) {
    setSingleGarment(img, label);
    toast(`Outfit cargado: ${label}`);
    return;
  }

  setStatus('Procesando outfit…');
  showProgress('Preparando modelo de prendas…');

  let garments;
  try {
    const poseDetector = await getImagePoseDetector().catch((err) => {
      console.warn('Image pose detector unavailable', err);
      return null;
    });
    garments = await extractGarments(img, {
      onProgress: progressHandler(token, 'modelo de prendas'),
      poseDetector,
    });
  } catch (err) {
    console.error(err);
    if (token !== loadToken) return;
    hideProgress();
    cameraReady();
    setSingleGarment(img, label);
    toast('No se pudo cargar el modelo de prendas; se aplicó solo quitar fondo blanco.', 'error');
    return;
  }

  if (token !== loadToken) return;
  hideProgress();
  cameraReady();

  const found = Object.keys(garments);
  if (!found.length) {
    setSingleGarment(img, label);
    toast('No se detectaron prendas en la foto; se aplicó quitar fondo blanco.', 'error');
    return;
  }

  outfit.mode = 'segmented';
  outfit.source = img;
  outfit.garments = {};
  for (const type of found) {
    const g = garments[type];
    outfit.garments[type] = {
      drawable: g.canvas,
      frame: g.frame,
      aspect: g.aspect,
      enabled: true,
      sublabel: g.labels.join(' + '),
      poseAligned: g.poseAligned,
      enhanced: false,
    };
  }

  // Point the sliders at a detected garment.
  if (!outfit.garments[settings.type]) {
    settings.type = GARMENT_ORDER.slice().reverse().find((t) => outfit.garments[t]);
    saveSettings();
  }
  syncRenderer3d();
  syncControls();

  const names = found.map((t) => GARMENT_NAMES[t].toLowerCase()).join(', ');
  const aligned = garments[found[0]].poseAligned;
  toast(
    aligned
      ? `Prendas detectadas y alineadas con la pose: ${names}`
      : `Prendas detectadas: ${names}. No se encontró pose en la foto; ajuste aproximado.`
  );
}

async function handleFile(file) {
  try {
    setStatus('Cargando outfit…');
    const img = await loadOutfitFromFile(file);
    await processImage(img, file.name);
  } catch (err) {
    hideProgress();
    toast(err.message, 'error');
  } finally {
    if (statusEl.textContent.startsWith('Cargando outfit')) cameraReady();
  }
}

async function handleUrl(url) {
  try {
    setStatus('Descargando outfit…');
    const img = await loadOutfitFromUrl(url);
    await processImage(img, new URL(url).hostname);
  } catch (err) {
    hideProgress();
    toast(err.message, 'error');
  } finally {
    if (statusEl.textContent.startsWith('Descargando outfit')) cameraReady();
  }
}

// ---------- Quality enhancement ----------
async function enhanceAll() {
  if (enhancing) return;
  const entries = Object.entries(outfit.garments).filter(([, g]) => !g.enhanced);
  if (!entries.length) return;

  enhancing = true;
  syncControls();
  const token = loadToken;
  const { upscaleGarment } = await import('./enhance.js');

  try {
    let i = 0;
    for (const [type, g] of entries) {
      i++;
      showProgress(`Mejorando ${GARMENT_NAMES[type].toLowerCase()} (${i}/${entries.length})…`);
      const { canvas: up, scale } = await upscaleGarment(g.drawable, progressHandler(token, 'modelo de calidad'));
      if (token !== loadToken || outfit.garments[type] !== g) return; // outfit changed meanwhile
      g.drawable = up;
      g.frame = scaleFrame(g.frame, scale);
      g.enhanced = true;
      g.thumb = null;
      if (renderer3d) renderer3d.setGarment(type, g, GARMENT_ORDER.indexOf(type));
      renderGarmentList();
    }
    toast('Calidad mejorada (x2)');
  } catch (err) {
    console.error(err);
    toast('No se pudo mejorar la calidad. Revisa la conexión o intenta de nuevo.', 'error');
  } finally {
    enhancing = false;
    hideProgress();
    cameraReady();
    syncControls();
  }
}

// ---------- Generative try-on ----------
function garmentCategory() {
  const types = Object.keys(outfit.garments);
  if (types.includes('dress')) return 'dress';
  if (types.includes('top')) return 'top';
  if (types.includes('bottom')) return 'bottom';
  return settings.type;
}

function sourceToCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

/**
 * Image handed to the try-on model as "garment". IDM-VTON was trained on flat
 * product shots, so a segmented cut-out composited on white (with margin) works
 * better than the original photo of a person wearing it. Falls back to the source.
 */
function garmentCanvasFor(category) {
  const g = outfit.garments[category];
  if (!g?.drawable) return sourceToCanvas(outfit.source);
  const gw = g.drawable.naturalWidth || g.drawable.width;
  const gh = g.drawable.naturalHeight || g.drawable.height;
  const side = Math.round(Math.max(gw, gh) * 1.2);
  const c = document.createElement('canvas');
  c.width = Math.round(side * 0.75);
  c.height = side;
  const cctx = c.getContext('2d');
  cctx.fillStyle = '#ffffff';
  cctx.fillRect(0, 0, c.width, c.height);
  const scale = Math.min((c.width * 0.9) / gw, (c.height * 0.9) / gh);
  const dw = gw * scale;
  const dh = gh * scale;
  cctx.drawImage(g.drawable, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
  return c;
}

/** Camera frame without overlays, mirrored as the user sees it. */
function capturePerson() {
  const { width, height } = frameSize;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const cctx = c.getContext('2d');
  if (settings.mirror) {
    cctx.translate(width, 0);
    cctx.scale(-1, 1);
  }
  cctx.drawImage(video, 0, 0, width, height);
  return c;
}

function setResultStatus(text) {
  ui.resultStatus.textContent = text;
}

function openResult(beforeUrl) {
  ui.result.hidden = false;
  ui.resultBefore.src = beforeUrl;
  ui.resultAfter.removeAttribute('src');
  ui.resultAfter.parentElement.classList.add('loading');
  ui.resultDownload.disabled = true;
  ui.resultCancel.hidden = false;
}

function closeResult() {
  ui.result.hidden = true;
  if (generating?.running && !generating.controller.signal.aborted) generating.controller.abort();
  if (generating?.before) URL.revokeObjectURL(generating.before);
  if (generating?.after?.startsWith('blob:')) URL.revokeObjectURL(generating.after);
  generating = null;
  ui.resultBefore.removeAttribute('src');
  ui.resultAfter.removeAttribute('src');
  setResultStatus('');
  syncControls();
}

async function generate() {
  if (generating || !outfit.source || !frameSize.width) return;

  const controller = new AbortController();
  const personCanvas = capturePerson();
  const beforeUrl = URL.createObjectURL(await canvasToBlob(personCanvas, 1024, 'image/jpeg', 0.9));
  generating = { controller, before: beforeUrl, after: null, running: true };
  syncControls();
  openResult(beforeUrl);
  setResultStatus('Preparando imágenes…');

  try {
    const category = garmentCategory();
    const [personBlob, garmentBlob] = await Promise.all([
      canvasToBlob(personCanvas, 1024, 'image/jpeg', 0.92),
      canvasToBlob(garmentCanvasFor(category), 1024, 'image/jpeg', 0.92),
    ]);

    const { blob, url } = await generateTryOn({
      personBlob,
      garmentBlob,
      category,
      description: settings.garmentDes.trim(),
      steps: settings.steps,
      hfToken: settings.hfToken.trim() || undefined,
      signal: controller.signal,
      onStatus: (st) => {
        if (st.stage === 'connecting') setResultStatus('Conectando con el modelo…');
        else if (st.stage === 'pending' && st.position != null && st.position > 0) {
          setResultStatus(`En cola: posición ${st.position}${st.eta ? `, ~${Math.round(st.eta)} s` : ''}`);
        } else if (st.stage === 'pending') setResultStatus('Generando… (20–60 s)');
        else if (st.stage === 'downloading') setResultStatus('Descargando resultado…');
        else if (st.stage === 'generating') setResultStatus('Generando…');
      },
    });

    if (controller.signal.aborted) return;
    const afterUrl = blob ? URL.createObjectURL(blob) : url;
    generating.after = afterUrl;
    generating.running = false;
    ui.resultAfter.src = afterUrl;
    ui.resultAfter.parentElement.classList.remove('loading');
    ui.resultDownload.disabled = false;
    ui.resultCancel.hidden = true;
    setResultStatus('Listo');
    toast('Prueba generada con IA');
  } catch (err) {
    if (err?.name === 'AbortError') {
      setResultStatus('Cancelado');
    } else {
      console.error(err);
      setResultStatus(`Error: ${err.message}`);
      toast(`No se pudo generar: ${err.message}`, 'error');
    }
    if (generating) generating.running = false;
    ui.resultCancel.hidden = true;
    ui.resultAfter.parentElement.classList.remove('loading');
  } finally {
    syncControls();
  }
}

function downloadResult() {
  if (!generating?.after) return;
  const a = document.createElement('a');
  a.href = generating.after;
  a.download = `tryon-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  a.click();
}

// ---------- Layout ----------
/** Sizes the frame wrapper to the video aspect ratio inside the stage. */
function fitFrame() {
  const { width, height } = frameSize;
  if (!width) return;
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const scale = Math.min(sw / width, sh / height);
  frameEl.style.width = `${Math.floor(width * scale)}px`;
  frameEl.style.height = `${Math.floor(height * scale)}px`;
}

// ---------- Render loop ----------
function paramsByType() {
  return settings.params;
}

function enabledByType() {
  const out = {};
  for (const type of GARMENT_ORDER) out[type] = !!outfit.garments[type]?.enabled;
  return out;
}

function render() {
  const { width, height } = frameSize;
  if (!width) {
    requestAnimationFrame(render);
    return;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  if (settings.mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, width, height);
  ctx.restore();

  const landmarks = detector ? detector.detect(video) : null;
  let userFrame = null;
  let pixels = null;

  if (landmarks) {
    pixels = landmarksToPixels(landmarks, width, height, settings.mirror);
    userFrame = frameFromJoints(torsoJoints(pixels));
  }
  lastUserFrame = userFrame;

  const use3d = settings.mode3d && renderer3d;
  if (use3d) {
    renderer3d.render(userFrame, paramsByType(), enabledByType(), settings.opacity, settings.depth);
  } else {
    if (renderer3d) renderer3d.render(null, paramsByType(), enabledByType(), 0, 0);
    if (userFrame) {
      for (const type of GARMENT_ORDER) {
        const g = outfit.garments[type];
        if (!g || !g.enabled) continue;
        drawGarment2D(ctx, g.drawable, g.frame, userFrame, settings.params[type], settings.opacity);
      }
    }
  }

  if (pixels && settings.skeleton) drawSkeleton(ctx, pixels);

  requestAnimationFrame(render);
}

// ---------- Snapshot ----------
function takeSnapshot() {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const octx = out.getContext('2d');
  octx.drawImage(canvas, 0, 0);
  if (settings.mode3d && renderer3d) {
    // Re-render so the WebGL buffer is populated at copy time.
    renderer3d.render(lastUserFrame, paramsByType(), enabledByType(), settings.opacity, settings.depth);
    octx.drawImage(glCanvas, 0, 0, out.width, out.height);
  }
  out.toBlob((blob) => {
    if (!blob) return toast('No se pudo generar la foto.', 'error');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `outfit-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Foto guardada');
  }, 'image/png');
}

// ---------- Reset ----------
function resetAll() {
  loadToken++;
  enhancing = false;
  closeResult();
  hideProgress();
  settings = defaultSettings();
  localStorage.removeItem(STORAGE_KEY);
  clearOutfit();
  ui.urlInput.value = '';
  ui.fileInput.value = '';
  syncControls();
  cameraReady();
  toast('Todo restablecido');
}

// ---------- Events ----------
function bindEvents() {
  ui.fileInput.addEventListener('change', () => {
    const file = ui.fileInput.files?.[0];
    if (file) handleFile(file);
    ui.fileInput.value = '';
  });

  ui.sampleBtn.addEventListener('click', () =>
    handleUrl(new URL(SAMPLE_OUTFIT, location.href).href)
  );

  ui.urlForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = ui.urlInput.value.trim();
    if (url) handleUrl(url);
  });

  ui.enhanceBtn.addEventListener('click', enhanceAll);

  ui.type.addEventListener('change', () => {
    const newType = ui.type.value;
    // In single mode the select decides where the garment goes: move it.
    if (outfit.mode === 'single') {
      const g = outfit.garments[settings.type];
      if (g) {
        const { w, h } = drawableSize(g.drawable);
        g.frame = syntheticGarmentFrame(w, h, newType);
        outfit.garments = { [newType]: g };
      }
    }
    settings.type = newType;
    saveSettings();
    syncRenderer3d();
    syncControls();
  });

  const bindParam = (input, key) => {
    input.addEventListener('input', () => {
      settings.params[settings.type][key] = parseFloat(input.value);
      saveSettings();
      syncControls();
    });
  };
  bindParam(ui.width, 'width');
  bindParam(ui.height, 'height');
  bindParam(ui.offset, 'offsetY');

  ui.opacity.addEventListener('input', () => {
    settings.opacity = parseFloat(ui.opacity.value);
    saveSettings();
    syncControls();
  });

  ui.keyBg.addEventListener('change', () => {
    settings.keyBg = ui.keyBg.checked;
    saveSettings();
    syncControls();
    rebuildSingleGarment();
  });

  ui.threshold.addEventListener('input', () => {
    settings.threshold = parseInt(ui.threshold.value, 10);
    saveSettings();
    syncControls();
    rebuildSingleGarment();
  });

  ui.mode3d.addEventListener('change', () => {
    settings.mode3d = ui.mode3d.checked;
    saveSettings();
    syncControls();
  });

  ui.depth.addEventListener('input', () => {
    settings.depth = parseFloat(ui.depth.value);
    saveSettings();
    syncControls();
  });

  ui.skeleton.addEventListener('change', () => {
    settings.skeleton = ui.skeleton.checked;
    saveSettings();
  });

  ui.mirror.addEventListener('change', () => {
    settings.mirror = ui.mirror.checked;
    saveSettings();
  });

  ui.snapshotBtn.addEventListener('click', takeSnapshot);
  ui.resetBtn.addEventListener('click', resetAll);

  ui.generateBtn.addEventListener('click', generate);
  ui.resultClose.addEventListener('click', closeResult);
  ui.resultCancel.addEventListener('click', () => {
    if (!generating?.running) return closeResult();
    generating.controller.abort();
    setResultStatus('Cancelando…');
  });
  ui.resultDownload.addEventListener('click', downloadResult);
  ui.result.addEventListener('click', (e) => {
    if (e.target === ui.result && !generating?.running) closeResult();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ui.result.hidden && !generating?.running) closeResult();
  });

  ui.steps.addEventListener('input', () => {
    settings.steps = parseInt(ui.steps.value, 10);
    saveSettings();
    $('steps-out').value = settings.steps;
  });
  ui.garmentDes.addEventListener('input', () => {
    settings.garmentDes = ui.garmentDes.value;
    saveSettings();
  });
  ui.hfToken.addEventListener('input', () => {
    settings.hfToken = ui.hfToken.value;
    saveSettings();
  });

  window.addEventListener('resize', fitFrame);

  // Drag & drop onto the stage.
  ['dragenter', 'dragover'].forEach((evt) =>
    stage.addEventListener(evt, (e) => {
      e.preventDefault();
      stage.classList.add('dragging');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    stage.addEventListener(evt, (e) => {
      e.preventDefault();
      stage.classList.remove('dragging');
    })
  );
  stage.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) return handleFile(file);
    const url = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
    if (url) handleUrl(url.trim());
  });

  // Paste an image or a URL anywhere on the page.
  window.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) return handleFile(item.getAsFile());
    const text = e.clipboardData?.getData('text');
    if (text && /^https?:\/\//i.test(text.trim())) {
      ui.urlInput.value = text.trim();
      handleUrl(text.trim());
    }
  });
}

// ---------- Boot ----------
async function main() {
  renderer3d = createGarmentRenderer(glCanvas);
  if (!renderer3d) toast('WebGL no disponible: se usa el modo 2D.', 'error');

  syncControls();
  bindEvents();

  try {
    setStatus('Solicitando cámara…');
    frameSize = await startCamera(video);
    canvas.width = frameSize.width;
    canvas.height = frameSize.height;
    if (renderer3d) renderer3d.resize(frameSize.width, frameSize.height);
    fitFrame();
    syncControls();
  } catch (err) {
    console.error(err);
    setStatus('Sin acceso a la cámara', 'error');
    toast(
      'No se pudo acceder a la cámara. Revisa los permisos del navegador y que la página se sirva desde localhost o https.',
      'error'
    );
    return;
  }

  requestAnimationFrame(render);

  try {
    setStatus('Cargando modelo de pose…');
    detector = await createPoseDetector({ smoothing: 0.5 });
    setStatus('Cámara lista', 'ok');
  } catch (err) {
    console.error(err);
    setStatus('Error cargando el modelo', 'error');
    toast('No se pudo cargar el modelo de pose. Revisa tu conexión a internet.', 'error');
  }
}

main();
