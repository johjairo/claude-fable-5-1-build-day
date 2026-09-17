/**
 * Starts the user-facing camera and attaches the stream to a <video> element.
 * Resolves with the native video dimensions once metadata is available.
 */
export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador no soporta acceso a la cámara.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });

  video.srcObject = stream;

  await new Promise((resolve) => {
    if (video.readyState >= 1) return resolve();
    video.onloadedmetadata = () => resolve();
  });

  await video.play();

  return { width: video.videoWidth, height: video.videoHeight, stream };
}

export function stopCamera(video) {
  const stream = video.srcObject;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
}
