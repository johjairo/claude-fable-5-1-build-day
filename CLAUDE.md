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
- Render: `<canvas>` 2D con video en espejo + prenda transformada (`src/overlay.js`).
- Servir con `python3 -m http.server 8000` (la cámara exige `localhost` o `https`).

## Arquitectura

- `src/app.js`: estado (`settings`, persistido en `localStorage`), eventos de UI, loop `requestAnimationFrame`.
- `src/camera.js`: `getUserMedia` y dimensiones del video.
- `src/pose.js`: crea el landmarker (GPU con fallback a CPU) y suaviza landmarks con EMA.
- `src/landmarks.js`: constantes `LM` (índices) y `SKELETON` (conexiones). Sin dependencias de CDN para poder probar `overlay.js` en Node.
- `src/outfit.js`: carga de imagen por archivo o URL (fallback a proxy `images.weserv.nl`), keying de fondo blanco.
- `src/overlay.js`: `computePlacement(landmarks, type, params, aspect, w, h, mirrored)` → `{x, y, w, h, angle}`; `drawOutfit`, `drawSkeleton`.
- Tipos de prenda: `top` y `dress` se anclan al punto medio de hombros; `bottom` al punto medio de caderas. Ancho sale de la distancia entre hombros/caderas; alto respeta la relación de aspecto de la imagen.

## Reglas al modificar

- Textos visibles en la UI en español; identificadores en inglés.
- No introducir bundlers ni frameworks; mantener `index.html` abrible con cualquier servidor estático.
- Si se agrega una dependencia externa, cargarla por CDN con versión fijada.
- La lógica de `overlay.js` es pura; probarla en Node con `node --input-type=module` importando `computePlacement`.
- Probar siempre con cámara real: abrir `http://localhost:8000`, cargar `assets/sample-top.png` y verificar que la prenda sigue hombros al moverse.
