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
8. Todo ocurre en el cliente: sin backend, sin API keys. Los modelos se descargan la primera vez (~29 MB ropa, ~7 MB súper-resolución) y quedan en caché del navegador.

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
- **Quitar fondo blanco**: respaldo cuando la foto no tiene personas y el modelo no detecta prendas (p. ej. foto de producto sobre blanco). Ajusta el umbral si quedan restos.
- **Mostrar esqueleto**: depuración, muestra los puntos detectados.
- **Tomar foto**: descarga un PNG con el outfit puesto.
- **Restablecer**: borra el outfit cargado y devuelve todos los ajustes a su valor inicial.

Consejos: párate de frente a 1–2 m de la cámara, con buena luz. Funciona mejor con fotos de una sola persona de frente, cuerpo completo o desde la cintura.

## Estructura

```
index.html        UI (español)
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
src/overlay.js    dibujo 2D (fallback) y esqueleto de depuración
assets/           prenda de ejemplo
prompts/          prompts para explorar variantes en sesiones nuevas de Claude Code
tests/unit.mjs    tests de torso.js y mask.js (`node tests/unit.mjs`)
tests/render3d.html  prueba de humo de la capa 3D (abrir servido por HTTP)
```

## Limitaciones conocidas

- La prenda es una textura sobre una malla que sigue el torso; no simula tela ni respeta oclusiones (brazos por delante).
- La prenda recortada conserva la pose de la persona de la foto; si estaba de lado o con brazos cruzados, se verá así. Fotos de frente dan el mejor resultado.
- La coordenada z de MediaPipe es aproximada; con "Profundidad 3D" alta puede exagerar la perspectiva.
- La URL debe ser una imagen directa, no la página del producto.
- La segmentación tarda unos segundos por foto (la primera vez además descarga el modelo). Sin WebGPU corre en WASM, más lento.

## Ideas siguientes

- Botón "Generar foto realista" con un modelo de try-on generativo (IDM-VTON, CatVTON, Leffa; open source pero necesitan GPU en servidor) a partir de una captura.
- Deformar la malla también con codos/muñecas para que las mangas sigan los brazos.
- Oclusión: ocultar la prenda donde los brazos pasan por delante usando segmentación del usuario.
- Varias prendas a la vez (superior + inferior).

## Convenciones

- Documentación (`README.md`, `CLAUDE.md`) en **español**.
- Código, nombres de features, recursos, identificadores y mensajes de commit en **inglés**.
- Rama principal: `main`.
