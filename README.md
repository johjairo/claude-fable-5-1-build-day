# claude-fable-5-1-build-day · Probador virtual

Prototipo construido durante el workshop **Build Day** con Claude Fable 5.1.

Página web que abre tu cámara, detecta tu cuerpo en tiempo real y dibuja encima la imagen de un outfit (camisa, vestido o pantalón) para que veas cómo te queda antes de comprarlo.

## Equipo

- John Sanchez ([@johjairo](https://github.com/johjairo))
- Sergio

## Cómo funciona

1. La cámara se muestra en modo espejo dentro de un `<canvas>`.
2. [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) corre en el navegador y devuelve hombros, caderas, rodillas y tobillos ~30 veces por segundo.
3. Con esos puntos se calcula tamaño, posición y rotación de la prenda y se dibuja sobre el video.
4. Todo ocurre en el cliente: sin backend, sin API keys. Solo se descarga el modelo la primera vez.

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
- **Tipo de prenda**: parte superior, vestido o parte inferior. Cambia el punto de anclaje (hombros o caderas).
- **Ajustes**: ancho, alto, posición vertical y opacidad. Se guardan en el navegador por tipo de prenda.
- **Quitar fondo blanco**: para fotos de producto sobre fondo blanco. Se activa solo al cargar una imagen sin transparencia. Ajusta el umbral si quedan restos.
- **Mostrar esqueleto**: depuración, muestra los puntos detectados.
- **Tomar foto**: descarga un PNG con el outfit puesto.

Consejos: párate de frente a 1–2 m de la cámara, con buena luz. Las mejores prendas son PNG con fondo transparente.

## Estructura

```
index.html        UI (español)
styles.css        estilos
src/app.js        arranque, estado, eventos, loop de render
src/camera.js     getUserMedia
src/pose.js       MediaPipe Pose Landmarker + suavizado EMA
src/landmarks.js  índices de landmarks y conexiones del esqueleto
src/outfit.js     carga desde archivo/URL, quitar fondo blanco
src/overlay.js    landmarks → posición/tamaño/rotación de la prenda
assets/           prenda de ejemplo
```

## Limitaciones conocidas

- Es una superposición 2D: la prenda no se deforma con el cuerpo ni respeta oclusiones (brazos por delante).
- La URL debe ser una imagen directa, no la página del producto.
- Quitar fondo solo funciona con fondos blancos o casi blancos.

## Ideas siguientes

- Eliminación de fondo con modelo ML en el navegador (`@imgly/background-removal`).
- Botón "Generar foto realista" con un modelo de try-on (IDM-VTON) a partir de una captura.
- Varias prendas a la vez (superior + inferior).

## Convenciones

- Documentación (`README.md`, `CLAUDE.md`) en **español**.
- Código, nombres de features, recursos, identificadores y mensajes de commit en **inglés**.
- Rama principal: `main`.
