import { startCamera } from './camera.js';
import { createPoseDetector } from './pose.js';
import {
  loadOutfitFromFile,
  loadOutfitFromUrl,
  imageHasTransparency,
  removeWhiteBackground,
} from './outfit.js';
import { DEFAULTS, computePlacement, drawOutfit, drawSkeleton } from './overlay.js';

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
const thumb = $('thumb');
const thumbEmpty = $('thumb-empty');

const ui = {
  fileInput: $('file-input'),
  sampleBtn: $('sample-btn'),
  urlForm: $('url-form'),
  urlInput: $('url-input'),
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

// ---------- State ----------
function defaultSettings() {
  return {
    type: 'top',
    params: {
      top: { ...DEFAULTS.top },
      dress: { ...DEFAULTS.dress },
      bottom: { ...DEFAULTS.bottom },
    },
    opacity: 1,
    keyBg: false,
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

/** Original loaded image (HTMLImageElement) and processed drawable (image or canvas). */
const outfit = {
  source: null,
  drawable: null,
  aspect: 1,
  hasAlpha: false,
};

let detector = null;
let frameSize = { width: 0, height: 0 };
let toastTimer = null;

// ---------- UI helpers ----------
function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`.trim();
}

function toast(text, kind = '') {
  toastEl.textContent = text;
  toastEl.className = `toast ${kind}`.trim();
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 4000);
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
}

// ---------- Outfit handling ----------
function rebuildDrawable() {
  if (!outfit.source) return;
  const useKey = settings.keyBg && !outfit.hasAlpha;
  outfit.drawable = useKey
    ? removeWhiteBackground(outfit.source, settings.threshold)
    : outfit.source;

  if (outfit.drawable instanceof HTMLCanvasElement) {
    thumb.src = outfit.drawable.toDataURL();
  } else {
    thumb.src = outfit.source.src;
  }
}

function setOutfit(img, label) {
  outfit.source = img;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  outfit.aspect = h / w;

  try {
    outfit.hasAlpha = imageHasTransparency(img);
  } catch {
    outfit.hasAlpha = false;
  }

  // Product photos on white backgrounds benefit from keying; enable automatically
  // the first time an opaque image is loaded.
  if (!outfit.hasAlpha && !settings.keyBg) {
    settings.keyBg = true;
    saveSettings();
    syncControls();
  }

  rebuildDrawable();
  thumb.hidden = false;
  thumbEmpty.hidden = true;
  toast(`Outfit cargado: ${label}`);
}

async function handleFile(file) {
  try {
    setStatus('Cargando outfit…');
    const img = await loadOutfitFromFile(file);
    setOutfit(img, file.name);
    setStatus('Cámara lista', 'ok');
  } catch (err) {
    setStatus('Cámara lista', 'ok');
    toast(err.message, 'error');
  }
}

async function handleUrl(url) {
  try {
    setStatus('Descargando outfit…');
    const img = await loadOutfitFromUrl(url);
    setOutfit(img, new URL(url).hostname);
    setStatus('Cámara lista', 'ok');
  } catch (err) {
    setStatus('Cámara lista', 'ok');
    toast(err.message, 'error');
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
    if (outfit.drawable) {
      const placement = computePlacement(
        landmarks,
        settings.type,
        settings.params[settings.type],
        outfit.aspect,
        width,
        height,
        settings.mirror
      );
      if (placement) drawOutfit(ctx, outfit.drawable, placement, settings.opacity);
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

// ---------- Events ----------
function bindEvents() {
  ui.fileInput.addEventListener('change', () => {
    const file = ui.fileInput.files?.[0];
    if (file) handleFile(file);
    ui.fileInput.value = '';
  });

  ui.sampleBtn.addEventListener('click', () => handleUrl(new URL(SAMPLE_OUTFIT, location.href).href));

  ui.urlForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = ui.urlInput.value.trim();
    if (url) handleUrl(url);
  });

  ui.type.addEventListener('change', () => {
    settings.type = ui.type.value;
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
    rebuildDrawable();
  });

  ui.threshold.addEventListener('input', () => {
    settings.threshold = parseInt(ui.threshold.value, 10);
    saveSettings();
    syncControls();
    rebuildDrawable();
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

  ui.resetBtn.addEventListener('click', () => {
    const keep = { type: settings.type, skeleton: settings.skeleton, mirror: settings.mirror };
    settings = { ...defaultSettings(), ...keep };
    saveSettings();
    syncControls();
    rebuildDrawable();
    toast('Ajustes restablecidos');
  });

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
