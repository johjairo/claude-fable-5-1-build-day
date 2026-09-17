import { startCamera } from './camera.js';
import { createPoseDetector } from './pose.js';
import {
  loadOutfitFromFile,
  loadOutfitFromUrl,
  imageHasTransparency,
  removeWhiteBackground,
} from './outfit.js';
import { DEFAULTS, computePlacement, drawOutfit, drawSkeleton } from './overlay.js';
import { extractGarments, GARMENT_ORDER, GARMENT_NAMES } from './segment.js';

const STORAGE_KEY = 'vto-settings-v1';
const SAMPLE_OUTFIT = 'assets/sample-top.png';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('canvas');
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
  type: $('type'),
  width: $('width'),
  height: $('height'),
  offset: $('offset'),
  opacity: $('opacity'),
  keyBg: $('key-bg'),
  threshold: $('threshold'),
  thresholdField: $('threshold-field'),
  skeleton: $('skeleton'),
  mirror: $('mirror'),
  snapshotBtn: $('snapshot-btn'),
  resetBtn: $('reset-btn'),
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
    skeleton: false,
    mirror: true,
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
 * mode:
 *   'none'      nothing loaded
 *   'single'    one ready-made garment (transparent PNG or white-keyed fallback) in slot `settings.type`
 *   'segmented' garments cut out of a photo by the segmentation model
 * garments[type] = { drawable, aspect, enabled, sublabel }
 */
const outfit = {
  mode: 'none',
  source: null,
  garments: {},
};

let detector = null;
let frameSize = { width: 0, height: 0 };
let toastTimer = null;
let loadToken = 0;

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
  ui.skeleton.checked = settings.skeleton;
  ui.mirror.checked = settings.mirror;

  $('width-out').value = fmt(p.width);
  $('height-out').value = fmt(p.height);
  $('offset-out').value = fmt(p.offsetY);
  $('opacity-out').value = fmt(settings.opacity);
  $('threshold-out').value = settings.threshold;
  ui.thresholdField.style.display = settings.keyBg ? '' : 'none';

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
    if (g.sublabel) {
      const sub = document.createElement('span');
      sub.className = 'garment-sub';
      sub.textContent = g.sublabel;
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
function clearOutfit() {
  outfit.mode = 'none';
  outfit.source = null;
  outfit.garments = {};
  renderGarmentList();
}

/** Single-garment path: transparent PNG, or opaque image with white keying. */
function setSingleGarment(img, sublabel) {
  const hasAlpha = safeHasTransparency(img);
  const drawable = !hasAlpha && settings.keyBg ? removeWhiteBackground(img, settings.threshold) : img;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  outfit.mode = 'single';
  outfit.source = img;
  outfit.garments = {
    [settings.type]: {
      drawable,
      aspect: h / w,
      enabled: true,
      sublabel,
      keyed: !hasAlpha,
    },
  };
  renderGarmentList();
}

/** Re-applies white keying when its settings change (single mode only). */
function rebuildSingleGarment() {
  if (outfit.mode !== 'single' || !outfit.source) return;
  const g = Object.values(outfit.garments)[0];
  if (!g?.keyed) return;
  g.drawable = settings.keyBg
    ? removeWhiteBackground(outfit.source, settings.threshold)
    : outfit.source;
  g.thumb = null;
  renderGarmentList();
}

function safeHasTransparency(img) {
  try {
    return imageHasTransparency(img);
  } catch {
    return false;
  }
}

function progressHandler(token) {
  return (evt) => {
    if (token !== loadToken) return;
    if (evt.status === 'progress' && typeof evt.progress === 'number') {
      const file = (evt.file || '').split('/').pop();
      showProgress(`Descargando modelo de prendas… ${Math.round(evt.progress)}% (${file})`, evt.progress);
    } else if (evt.status === 'initiate') {
      showProgress('Descargando modelo de prendas (solo la primera vez)…', 0);
    } else if (evt.status === 'ready') {
      showProgress('Detectando prendas…');
    }
  };
}

/**
 * Decides how to process a freshly loaded image:
 *  - transparent → single garment in the selected slot
 *  - opaque (JPG/JPEG/WebP…) → segmentation; if nothing detected, white-keying fallback
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
    garments = await extractGarments(img, progressHandler(token));
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
      aspect: g.aspect,
      enabled: true,
      sublabel: g.labels.join(' + '),
    };
  }

  // Point the sliders at a detected garment.
  if (!outfit.garments[settings.type]) {
    settings.type = GARMENT_ORDER.slice().reverse().find((t) => outfit.garments[t]);
    saveSettings();
  }
  syncControls();
  toast(`Prendas detectadas: ${found.map((t) => GARMENT_NAMES[t].toLowerCase()).join(', ')}`);
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

// ---------- Render loop ----------
function render() {
  const { width, height } = frameSize;
  if (!width) {
    requestAnimationFrame(render);
    return;
  }

  ctx.save();
  if (settings.mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, width, height);
  ctx.restore();

  const landmarks = detector ? detector.detect(video) : null;

  if (landmarks) {
    for (const type of GARMENT_ORDER) {
      const g = outfit.garments[type];
      if (!g || !g.enabled) continue;
      const placement = computePlacement(
        landmarks,
        type,
        settings.params[type],
        g.aspect,
        width,
        height,
        settings.mirror
      );
      if (placement) drawOutfit(ctx, g.drawable, placement, settings.opacity);
    }
    if (settings.skeleton) drawSkeleton(ctx, landmarks, width, height, settings.mirror);
  }

  requestAnimationFrame(render);
}

// ---------- Snapshot ----------
function takeSnapshot() {
  canvas.toBlob((blob) => {
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

  ui.type.addEventListener('change', () => {
    const newType = ui.type.value;
    // In single mode the select decides where the garment goes: move it.
    if (outfit.mode === 'single') {
      const g = outfit.garments[settings.type];
      outfit.garments = g ? { [newType]: g } : {};
    }
    settings.type = newType;
    saveSettings();
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
  syncControls();
  bindEvents();

  try {
    setStatus('Solicitando cámara…');
    frameSize = await startCamera(video);
    canvas.width = frameSize.width;
    canvas.height = frameSize.height;
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
