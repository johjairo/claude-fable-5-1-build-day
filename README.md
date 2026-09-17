# claude-fable-5-1-build-day · Probador virtual

Prototipo construido durante el workshop **Build Day** con Claude Fable 5.1.

Página web que abre tu cámara, detecta tu cuerpo en tiempo real y dibuja encima la imagen de un outfit (camisa, vestido o pantalón) para que veas cómo te queda antes de comprarlo.

## Equipo

- John Sanchez ([@johjairo](https://github.com/johjairo))
- Sergio

## Cómo funciona

1. La cámara se muestra en modo espejo dentro de un `<canvas>`.
2. [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) corre en el navegador y devuelve hombros, caderas, rodillas y tobillos ~30 veces por segundo.
3. Al cargar una **foto (JPG/JPEG/WebP, sin transparencia)**, un modelo de segmentación de ropa ([SegFormer B2 clothes](https://huggingface.co/Xenova/segformer_b2_clothes) vía [transformers.js](https://huggingface.co/docs/transformers.js)) recorta cada prenda por separado: parte superior, parte inferior (pantalón/falda) y vestido. El fondo y la persona de la foto se descartan.
4. Cada prenda detectada se ancla a su parte del cuerpo (hombros o caderas), se escala y rota con la pose y se dibuja sobre el video.
5. Si la imagen es un **PNG con transparencia**, se usa tal cual en la ranura elegida en "Prenda a ajustar".
6. Todo ocurre en el cliente: sin backend, sin API keys. Los modelos se descargan la primera vez (~29 MB el de ropa) y quedan en caché del navegador.

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
- **Prendas detectadas**: lista con miniatura por prenda. El checkbox la muestra/oculta; clic en el nombre la selecciona para ajustar.
- **Prenda a ajustar**: a qué prenda aplican los sliders. Para PNG transparentes también define dónde se coloca (hombros o caderas).
- **Ajustes**: ancho, alto, posición vertical y opacidad. Se guardan en el navegador por tipo de prenda.
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
src/segment.js    segmentación de ropa (transformers.js + SegFormer) → una prenda por canvas
src/overlay.js    landmarks → posición/tamaño/rotación de la prenda
assets/           prenda de ejemplo
prompts/          prompts para explorar variantes en sesiones nuevas de Claude Code
```

## Limitaciones conocidas

- Es una superposición 2D: la prenda no se deforma con el cuerpo ni respeta oclusiones (brazos por delante).
- La prenda recortada conserva la pose de la persona de la foto; si estaba de lado o con brazos cruzados, se verá así.
- La URL debe ser una imagen directa, no la página del producto.
- La segmentación tarda unos segundos por foto (la primera vez además descarga el modelo). Sin WebGPU corre en WASM, más lento.

## Ideas siguientes

- Botón "Generar foto realista" con un modelo de try-on (IDM-VTON) a partir de una captura.
- Normalizar la pose de la prenda recortada (enderezar brazos) antes de superponerla.
- Varias prendas a la vez (superior + inferior).

## Convenciones

- Documentación (`README.md`, `CLAUDE.md`) en **español**.
- Código, nombres de features, recursos, identificadores y mensajes de commit en **inglés**.
- Rama principal: `main`.
