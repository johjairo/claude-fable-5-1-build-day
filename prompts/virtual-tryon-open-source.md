# Prompt: probador virtual de ropa (HTML autocontenido + modelos open source)

Quiero una demo de probador virtual de ropa, estilo ALTA (la app que te muestra cómo te
queda una prenda a partir de una foto tuya y una foto de la prenda).

## QUÉ QUIERO

Un solo archivo HTML autocontenido. Se abre y funciona. Nada más.

- Usa la cámara de mi MacBook para capturar mi foto.
- Dentro del HTML ya va embebida UNA imagen de prenda (una camiseta), en base64.
  No hay que buscarla, scrapearla ni pegar links: es la prenda de la demo y punto.
- Genera la imagen de mí usando esa prenda.
- Muestra el antes y el después.

## RESTRICCIONES

1. UN SOLO ARCHIVO `.html`. Sin build, sin npm, sin backend, sin servidor local.
   Idealmente doble clic y funciona.
2. La generación de imagen debe usar MODELOS OPEN SOURCE (IDM-VTON, CatVTON,
   OOTDiffusion, Leffa, o lo que esté vigente y funcione mejor hoy).
   Nada de APIs propietarias cerradas.
3. Se presenta EN VIVO ante gente externa desde una MacBook con Chrome.
   Si falla en escena queda mal: prioriza robustez sobre features.

## LO QUE NECESITO QUE RESUELVAS TÚ, INVESTIGANDO ANTES DE ESCRIBIR CÓDIGO

No asumas nada. Busca y verifica en documentación real:

- ¿Qué modelo open source de virtual try-on da el mejor resultado hoy y dónde puede
  correr? Compara las vías: inferencia en el navegador (transformers.js / ONNX / WebGPU),
  Hugging Face Spaces vía su API, Replicate, fal, o local.
- Para cada vía, verifica si es compatible con un HTML suelto: ¿permite llamadas desde
  el navegador sin proxy? ¿Las cabeceras CORS lo aceptan? ¿Requiere token?
  ¿Funciona desde `file://` o exige servidor?
- ¿Cuánto tarda cada opción por imagen? Necesito saber si el usuario espera 5 s o 90 s.
- ¿Hay alguna vía 100 % local, sin red, aunque sea con calidad menor?

Cuando tengas los datos, dime cuál eliges y por qué, y qué sacrificas con esa elección.
Si alguna de mis restricciones es imposible de cumplir con modelos open source, dímelo
claramente en vez de inventar una solución que no funciona.

## DETALLES DE LA DEMO

- La vista de la cámara debe verse espejada (como un espejo) para poder encuadrarme,
  pero la imagen que se envía al modelo NO debe ir espejada.
- Estados visibles en pantalla: cámara lista, capturando, generando con contador de
  segundos. Nada de UI congelada sin explicación.
- Errores en pantalla, no en consola: sin permiso de cámara, modelo caído, timeout.
- Botón para repetir la captura y botón para descargar el resultado.
- Diseño oscuro, limpio, contraste alto, controles grandes: se va a ver en proyector.

## ENTREGA

El archivo HTML completo y funcional, más:

1. Cómo correrlo exactamente.
2. Qué verificaste contra documentación y qué quedó como supuesto.
3. Los puntos más probables de fallo en vivo y cómo mitigarlos rápido.
