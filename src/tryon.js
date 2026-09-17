/**
 * Generative virtual try-on.
 *
 * Sends a photo of the user (camera frame) and the garment photo to a diffusion
 * try-on model and returns a rendered image of the user wearing the garment.
 * Not real-time (20-90 s); the live overlay remains the preview.
 *
 * Provider: IDM-VTON (open source, https://github.com/yisol/IDM-VTON) running on
 * the public Hugging Face Space `yisol/IDM-VTON` (ZeroGPU). Called from the
 * browser with @gradio/client, so no backend and no API key are required. An
 * optional Hugging Face token raises the free GPU quota.
 */
import { Client } from 'https://cdn.jsdelivr.net/npm/@gradio/client@2.6.0/+esm';

export const PROVIDERS = {
  'idm-vton': {
    name: 'IDM-VTON (Hugging Face Space)',
    space: 'yisol/IDM-VTON',
  },
};

/** Garment slot -> IDM-VTON category hint used in the text description. */
const CATEGORY_TEXT = {
  top: 'upper body garment',
  bottom: 'lower body garment, pants',
  dress: 'full body dress',
};

const clients = new Map();

async function getClient(space, hfToken) {
  const key = `${space}|${hfToken || ''}`;
  if (!clients.has(key)) {
    const opts = {};
    if (hfToken) opts.hf_token = hfToken;
    const p = Client.connect(space, opts);
    p.catch(() => clients.delete(key));
    clients.set(key, p);
  }
  return clients.get(key);
}

/** Longest side capped: the model works at 768x1024 internally; bigger uploads only cost time. */
export async function canvasToBlob(canvas, maxSide = 1024, type = 'image/jpeg', quality = 0.92) {
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  let src = canvas;
  if (scale < 1) {
    src = document.createElement('canvas');
    src.width = Math.round(canvas.width * scale);
    src.height = Math.round(canvas.height * scale);
    src.getContext('2d').drawImage(canvas, 0, 0, src.width, src.height);
  }
  return new Promise((resolve, reject) =>
    src.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality)
  );
}

/**
 * Runs the try-on.
 *
 * @param {object} args
 * @param {Blob} args.personBlob      camera frame (JPEG/PNG)
 * @param {Blob} args.garmentBlob     garment photo (product shot or person wearing it)
 * @param {'top'|'bottom'|'dress'} [args.category='top']
 * @param {string} [args.description] short text describing the garment (helps the model)
 * @param {number} [args.steps=30]    denoising steps (20 fast, 30 default, 40 best)
 * @param {number} [args.seed=42]
 * @param {string} [args.hfToken]     optional Hugging Face token (more ZeroGPU quota)
 * @param {(info: {stage: string, position?: number, eta?: number, message?: string}) => void} [args.onStatus]
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<{blob: Blob, url: string, maskUrl?: string}>}
 */
export async function generateTryOn({
  personBlob,
  garmentBlob,
  category = 'top',
  description = '',
  steps = 30,
  seed = 42,
  hfToken,
  onStatus = () => {},
  signal,
  provider = 'idm-vton',
}) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`Proveedor desconocido: ${provider}`);

  onStatus({ stage: 'connecting' });
  const app = await getClient(cfg.space, hfToken);

  const garmentDes = [description, CATEGORY_TEXT[category]].filter(Boolean).join(', ');
  const job = app.submit('/tryon', [
    { background: personBlob, layers: [], composite: null },
    garmentBlob,
    garmentDes,
    true, // auto-mask the body region
    true, // auto-crop & resize the person to 3:4
    steps,
    seed,
  ]);

  const abort = () => job.cancel?.();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    for await (const msg of job) {
      if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      if (msg.type === 'status') {
        if (msg.stage === 'error') {
          throw new Error(msg.message || 'El Space devolvió un error (¿cuota de GPU agotada?).');
        }
        onStatus({
          stage: msg.stage,
          position: msg.position,
          eta: msg.eta,
          message: msg.message,
        });
      } else if (msg.type === 'data') {
        const out = msg.data?.[0];
        const url = out?.url || out?.path;
        if (!url) throw new Error('El modelo no devolvió imagen.');
        onStatus({ stage: 'downloading' });
        let blob = null;
        try {
          const res = await fetch(url, { signal });
          if (res.ok) blob = await res.blob();
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
          console.warn('Result fetch blocked (CORS?); using URL directly', err);
        }
        return { blob, url, maskUrl: msg.data?.[1]?.url };
      }
    }
    throw new Error('La generación terminó sin resultado.');
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
