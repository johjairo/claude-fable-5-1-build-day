# CLAUDE.md

Guía para Claude Code al trabajar en este repositorio.

## Contexto

Repositorio del workshop **Build Day** (2026-09-16). Trabajan en pareja John Sanchez y Sergio. Objetivo: entregar un prototipo funcional al final del día.

## Idioma

- `README.md`, `CLAUDE.md` y cualquier documentación para humanos: **español**.
- Nombres de features, recursos, identificadores, código, comentarios en código y mensajes de commit: **inglés**.
- Los prompts llegan en inglés; no traducir nombres de features ni recursos al responder o al crear archivos.

## Principios de trabajo

- Es un prototipo con tiempo limitado: preferir soluciones simples y ejecutables sobre arquitectura elaborada.
- Mantener el `README.md` actualizado para que cualquiera de los dos pueda retomar el trabajo rápido.
- No agregar dependencias ni abstracciones que no se necesiten hoy.

## Git

- Rama principal: `main`.
- Remoto por HTTPS (el puerto 22 de SSH está bloqueado en la red del workshop). Si el push pide credenciales, ejecutar una vez `gh auth setup-git`.
- Commits pequeños y frecuentes, en inglés, formato Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).

## Stack

- HTML/CSS/JavaScript vanilla, módulos ES, sin build ni dependencias npm.
- Detección de pose: `@mediapipe/tasks-vision` (PoseLandmarker, modo VIDEO) cargado desde CDN en `src/pose.js`.
- Segmentación de ropa: `@huggingface/transformers` 3.7.1 (CDN) con `Xenova/segformer_b2_clothes` en `src/segment.js`. WebGPU si existe, fallback WASM. Modelo q8 ≈ 29 MB, cacheado por el navegador.
- Súper-resolución: mismo transformers.js con `Xenova/swin2SR-lightweight-x2-64` en `src/enhance.js` (≈ 7 MB).
- Try-on generativo: `@gradio/client` **2.6.0** (CDN `+esm`) contra el Space `yisol/IDM-VTON` en `src/tryon.js`. No bajar a 1.x: manda `credentials: include` y el preflight del Space falla por CORS. Endpoint `/tryon` con 7 entradas posicionales: `{background, layers:[], composite:null}` (persona), prenda, descripción, auto-mask, auto-crop, pasos, seed. Salida `data[0].url`. Sin backend; token HF opcional (`hf_token`).
- 3D: `three` 0.169 (CDN) en `src/render3d.js`. Cámara en perspectiva a distancia D = (H/2)/tan(fov/2) para que el plano z=0 coincida 1:1 con píxeles del video.
- Render: `<canvas>` 2D con video en espejo + prenda transformada (`src/overlay.js`).
- Servir con `python3 -m http.server 8000` (la cámara exige `localhost` o `https`).

## Arquitectura

- `src/app.js`: estado (`settings`, persistido en `localStorage`), eventos de UI, loop `requestAnimationFrame`.
- `src/camera.js`: `getUserMedia` y dimensiones del video.
- `src/pose.js`: crea el landmarker (GPU con fallback a CPU) y suaviza landmarks con EMA.
- `src/landmarks.js`: constantes `LM` (índices) y `SKELETON` (conexiones). Sin dependencias de CDN para poder probar `overlay.js` en Node.
- `src/outfit.js`: carga de imagen por archivo o URL (fallback a proxy `images.weserv.nl`), keying de fondo blanco.
- `src/segment.js`: `extractGarments(img, { poseDetector })` → `{ top?, bottom?, dress? }` con canvas recortado, transparente y `frame` (marco de torso en píxeles del recorte). Labels agrupados en `GARMENT_LABELS`. Limpieza con `mask.js`: componentes ≥ 15 % de la mayor, erosión 1–2 px, feather. Si Pose no encuentra persona en la foto → `syntheticGarmentFrame` y `poseAligned: false`.
- `src/torso.js`: marco `{ origin, axisX, axisY }` (hombros en a=±0.5, caderas en b=1). `toFrameCoords`/`fromFrameCoords`, `frameToFrameAffine` (2D), `estimateHips` cuando faltan caderas. Puro, sin DOM.
- `src/render3d.js`: por prenda, `PlaneGeometry` 24×24; en `setGarment` se precalculan (a,b) por vértice desde el marco de la prenda; en `render` cada vértice se coloca con `fromFrameCoords(userFrame)` y se des-proyecta con su z para que la re-proyección caiga en el mismo píxel. `depthTest` off, orden dress < bottom < top.
- `src/tryon.js`: `generateTryOn({ personBlob, garmentBlob, category, description, steps, seed, hfToken, onStatus, signal })` → `{ blob, url }`. `blob` puede ser null si el fetch del resultado falla por CORS; usar `url` directo en ese caso. `app.js` envía la persona como frame de cámara sin overlays (`capturePerson`) y la prenda como recorte sobre blanco 3:4 (`garmentCanvasFor`).
- `src/enhance.js`: `upscaleGarment(drawable)` rellena bordes con color difuminado antes del SR (evita franjas negras) y reaplica el alpha escalado. Devuelve `{ canvas, scale }`; el caller escala el frame con `scaleFrame`.
- `src/overlay.js`: `computePlacement(landmarks, type, params, aspect, w, h, mirrored)` → `{x, y, w, h, angle}`; `drawOutfit`, `drawSkeleton`.
- Tipos de prenda: `top` y `dress` se anclan al punto medio de hombros; `bottom` al punto medio de caderas. Ancho sale de la distancia entre hombros/caderas; alto respeta la relación de aspecto de la imagen.
- Flujo en `app.js` (`processImage`): imagen con transparencia → prenda única en la ranura seleccionada; imagen opaca → segmentación + pose de la foto; sin prendas detectadas o error del modelo → fallback a quitar fondo blanco. `outfit.mode` ∈ `none | single | segmented`. Orden de dibujo `GARMENT_ORDER`: dress, bottom, top. Loop: `landmarksToPixels` → `frameFromJoints` → `renderer3d.render` (o `drawGarment2D` si Modo 3D apagado / sin WebGL). Dos canvases apilados en `#frame`: `#canvas` (video + esqueleto) y `#gl` (three.js, transparente); `fitFrame()` los dimensiona.
- Sliders ancho/alto/posición son multiplicadores en espacio de marco (`adjustFrameCoords`); default 1/1/0. `STORAGE_KEY` = `vto-settings-v2`; subir la versión si cambia la semántica de los params.

## Reglas al modificar

- Textos visibles en la UI en español; identificadores en inglés.
- No introducir bundlers ni frameworks; mantener `index.html` abrible con cualquier servidor estático.
- Si se agrega una dependencia externa, cargarla por CDN con versión fijada.
- No hacer generaciones en tests automáticos: consumen cuota ZeroGPU compartida. `tests/tryon.html` solo consulta `view_api()`.
- `torso.js` y `mask.js` son puros: `node tests/unit.mjs` debe pasar antes de commitear. `tests/render3d.html` es una prueba de humo de WebGL (abrir servido por HTTP).
- Probar siempre con cámara real: abrir `http://localhost:8000`, cargar `assets/sample-top.png` y verificar que la prenda sigue hombros al moverse.
