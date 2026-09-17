# claude-fable-5-1-build-day · Probador virtual

Prototipo construido durante el workshop **Build Day** con Claude Fable 5.1.

Página web que abre tu cámara, detecta tu cuerpo en tiempo real y dibuja encima la imagen de un outfit (camisa, vestido o pantalón) para que veas cómo te queda antes de comprarlo.

## Equipo

- John Sanchez ([@johjairo](https://github.com/johjairo))
- Sergio

## Cómo funciona

1. La cámara se muestra en modo espejo dentro de un `<canvas>`.
2. [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) corre en el navegador y devuelve hombros, caderas, rodillas y tobillos ~30 veces por segundo.
3. Al cargar una **foto (JPG/JPEG/WebP, sin transparencia)**, un modelo de segmentación de ropa ([SegFormer B2 clothes](https://huggingface.co/Xenova/segformer_b2_clothes) vía [transformers.js](https://huggingface.co/docs/transformers.js)) recorta cada prenda por separado: parte superior, parte inferior (pantalón/falda) y vestido. La máscara se limpia (componentes conexas, erosión anti-halo, bordes suavizados).
4. Sobre la misma foto se corre Pose para ubicar hombros y caderas de la persona que lleva el outfit. Con eso cada prenda queda expresada en un **marco de torso** (hombros = eje X, hombros→caderas = eje Y).
5. En vivo, ese marco se re-expresa en tu propio torso: los hombros de la prenda caen en tus hombros y las caderas en tus caderas. En **modo 3D** la prenda es una malla de [three.js](https://threejs.org) cuyos vértices se colocan en 3D usando la profundidad (z) de MediaPipe, con cámara en perspectiva: la prenda gira e inclina contigo. En modo 2D es un mapeo afín equivalente sobre el canvas.
6. **Mejorar calidad (x2)**: súper-resolución de la prenda recortada con [Swin2SR lightweight](https://huggingface.co/Xenova/swin2SR-lightweight-x2-64) (open source, en el navegador). La transparencia se preserva.
7. Si la imagen es un **PNG con transparencia**, se usa tal cual en la ranura elegida en "Prenda a ajustar", con un marco de torso sintético.
8. **Generar prueba realista (IA generativa)**: toma tu frame de cámara y la prenda, y los envía a [IDM-VTON](https://github.com/yisol/IDM-VTON) (modelo de difusión open source) corriendo en el Space público `yisol/IDM-VTON` de Hugging Face (ZeroGPU, gratis). Devuelve una imagen tuya con la prenda realmente puesta: pliegues, ajuste al cuerpo, oclusión de brazos. Tarda 20–90 s; es una foto, no video en vivo. Se llama desde el navegador con `@gradio/client`, sin backend ni API key. Un token de Hugging Face (opcional) aumenta la cuota de GPU.
9. Lo demás ocurre en el cliente: sin backend, sin API keys. Los modelos locales se descargan la primera vez (~29 MB ropa, ~7 MB súper-resolución) y quedan en caché del navegador.

## Cómo correr

Requiere servir los archivos por HTTP (la cámara solo funciona en `localhost` o `https`).

```bash
git clone https://github.com/johjairo/claude-fable-5-1-build-day.git
cd claude-fable-5-1-build-day
python3 -m http.server 8000
```

Abre <http://localhost:8000> y acepta el permiso de cámara.

Alternativa con Node: `npx serve .`

## Cómo usar

- **Subir foto**: elige una imagen del outfit desde tu computadora. También puedes arrastrarla al video o pegarla con `Ctrl/Cmd+V`.
- **URL**: pega un enlace **directo** a una imagen (`.png`, `.jpg`, `.webp`). Si la tienda bloquea el acceso, se reintenta a través de un proxy de imágenes.
- **Usar ejemplo**: carga una camiseta de prueba incluida en `assets/`.
- **Prendas detectadas**: lista con miniatura por prenda. El checkbox la muestra/oculta; clic en el nombre la selecciona para ajustar. Si la foto no tenía pose detectable, se indica "ajuste aproximado".
- **Mejorar calidad (x2)**: súper-resolución de todas las prendas cargadas. Tarda unos segundos por prenda; la primera vez descarga el modelo.
- **Prenda a ajustar**: a qué prenda aplican los sliders. Para PNG transparentes también define dónde se coloca (hombros o caderas).
- **Ajustes**: ancho, alto y posición vertical son multiplicadores sobre el marco de torso (1 / 1 / 0 = exactamente como la llevaba la persona de la foto). Opacidad global. Se guardan en el navegador por tipo de prenda.
- **Modo 3D (perspectiva)** y **Profundidad 3D**: activa la malla three.js y cuánto pesa la coordenada z de MediaPipe (0 = plano).
- **Generar prueba realista**: abre un panel Antes / Después. Se puede cancelar y descargar. "Pasos" (15–40) cambia calidad vs. tiempo; "Descripción de la prenda" ayuda al modelo (p. ej. "camiseta negra de algodón"). En Avanzado se puede pegar un token de Hugging Face si la cuota gratuita se agota (error "GPU quota").
- **Quitar fondo blanco**: respaldo cuando la foto no tiene personas y el modelo no detecta prendas (p. ej. foto de producto sobre blanco). Ajusta el umbral si quedan restos.
- **Mostrar esqueleto**: depuración, muestra los puntos detectados.
- **Tomar foto**: descarga un PNG con el outfit puesto.
- **Restablecer**: borra el outfit cargado y devuelve todos los ajustes a su valor inicial.

Consejos: párate de frente a 1–2 m de la cámara, con buena luz. Funciona mejor con fotos de una sola persona de frente, cuerpo completo o desde la cintura.

## Estructura

```
index.html        UI (español)
presentation.html Diapositivas interactivas para la demo (pitch deck)
PRESENTACION.md   Guion, tiempos, playbook de demo en vivo y Q&A
styles.css        estilos
src/app.js        arranque, estado, eventos, loop de render
src/camera.js     getUserMedia
src/pose.js       MediaPipe Pose Landmarker + suavizado EMA
src/landmarks.js  índices de landmarks y conexiones del esqueleto
src/outfit.js     carga desde archivo/URL, quitar fondo blanco
src/segment.js    segmentación de ropa (transformers.js + SegFormer) + pose de la foto → una prenda por canvas con su marco
src/mask.js       utilidades de máscara binaria (componentes conexas, erosión, bbox)
src/torso.js      marco de torso: conversión prenda ↔ usuario (2D afín y 3D)
src/render3d.js   capa three.js: malla por prenda, cámara en perspectiva alineada al video
src/enhance.js    súper-resolución x2 (Swin2SR) preservando alpha
src/tryon.js      try-on generativo: cliente del Space IDM-VTON (@gradio/client)
src/overlay.js    dibujo 2D (fallback) y esqueleto de depuración
assets/           prenda de ejemplo
prompts/          prompts para explorar variantes en sesiones nuevas de Claude Code
tests/unit.mjs    tests de torso.js y mask.js (`node tests/unit.mjs`)
tests/render3d.html  prueba de humo de la capa 3D (abrir servido por HTTP)
tests/tryon.html     prueba de humo: carga @gradio/client y consulta la API del Space
```

## Limitaciones conocidas

- El try-on generativo depende de un Space público: puede tener cola o agotar la cuota gratuita de ZeroGPU en horas pico. Un token de HF (gratis) da más cuota. Alternativa con API de pago: Replicate / fal.ai ofrecen IDM-VTON y CatVTON, pero necesitan un pequeño proxy para no exponer la key en el navegador.
- IDM-VTON funciona mejor con foto de prenda tipo producto (plana, fondo blanco). Por eso se le envía el recorte segmentado sobre blanco, no la foto original.
- Vista previa en vivo (overlay / 3D):
- La prenda es una textura sobre una malla que sigue el torso; no simula tela ni respeta oclusiones (brazos por delante).
- La prenda recortada conserva la pose de la persona de la foto; si estaba de lado o con brazos cruzados, se verá así. Fotos de frente dan el mejor resultado.
- La coordenada z de MediaPipe es aproximada; con "Profundidad 3D" alta puede exagerar la perspectiva.
- La URL debe ser una imagen directa, no la página del producto.
- La segmentación tarda unos segundos por foto (la primera vez además descarga el modelo). Sin WebGPU corre en WASM, más lento.

## Ideas siguientes

- Proveedor alternativo de try-on vía proxy (Replicate `cuuupid/idm-vton`, fal `fal-ai/cat-vton`) para no depender del Space público.
- Try-on generativo por video (frame a frame es demasiado lento hoy; ver ViViD / modelos de video try-on).
- Deformar la malla también con codos/muñecas para que las mangas sigan los brazos.
- Oclusión: ocultar la prenda donde los brazos pasan por delante usando segmentación del usuario.
- Varias prendas a la vez (superior + inferior).

## Convenciones

- Documentación (`README.md`, `CLAUDE.md`) en **español**.
- Código, nombres de features, recursos, identificadores y mensajes de commit en **inglés**.
- Rama principal: `main`.
