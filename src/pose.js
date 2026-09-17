import {
  PoseLandmarker,
  FilesetResolver,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export { LM, SKELETON } from './landmarks.js';
import { LM } from './landmarks.js';

let visionPromise = null;
function getVision() {
  if (!visionPromise) visionPromise = FilesetResolver.forVisionTasks(WASM_PATH);
  return visionPromise;
}

async function createLandmarker(runningMode) {
  const vision = await getVision();
  const make = (delegate) =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode,
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  try {
    return await make('GPU');
  } catch (err) {
    console.warn('GPU delegate failed, falling back to CPU', err);
    return make('CPU');
  }
}

/** Picks the four torso joints out of a full landmark list. */
export function torsoJoints(landmarks) {
  return {
    ls: landmarks[LM.L_SHOULDER],
    rs: landmarks[LM.R_SHOULDER],
    lh: landmarks[LM.L_HIP],
    rh: landmarks[LM.R_HIP],
  };
}

/**
 * Creates a pose detector wrapper around MediaPipe PoseLandmarker.
 * Applies exponential moving average smoothing to reduce landmark jitter.
 *
 * @param {object} [opts]
 * @param {number} [opts.smoothing=0.5] EMA factor in (0,1]; 1 = no smoothing.
 */
export async function createPoseDetector({ smoothing = 0.5 } = {}) {
  const landmarker = await createLandmarker('VIDEO');

  let lastVideoTime = -1;
  let smoothed = null;

  return {
    /**
     * Runs detection on the current video frame.
     * @returns {Array<{x:number,y:number,z:number,visibility:number}>|null}
     *   Normalized (0..1) landmarks or null when no person is detected.
     */
    detect(video) {
      if (video.currentTime === lastVideoTime) return smoothed;
      lastVideoTime = video.currentTime;

      const result = landmarker.detectForVideo(video, performance.now());
      const raw = result.landmarks?.[0];

      if (!raw) {
        smoothed = null;
        return null;
      }

      if (!smoothed || smoothed.length !== raw.length) {
        smoothed = raw.map((p) => ({ ...p }));
        return smoothed;
      }

      const a = smoothing;
      for (let i = 0; i < raw.length; i++) {
        const s = smoothed[i];
        const r = raw[i];
        s.x += a * (r.x - s.x);
        s.y += a * (r.y - s.y);
        s.z += a * (r.z - s.z);
        s.visibility = r.visibility;
      }
      return smoothed;
    },

    close() {
      landmarker.close();
    },
  };
}

/**
 * Pose detector for still images (outfit photos). Lazily created, shared.
 * @returns {Promise<{detect(source: HTMLCanvasElement|HTMLImageElement): Array|null}>}
 */
let imageDetectorPromise = null;
export function getImagePoseDetector() {
  if (!imageDetectorPromise) {
    imageDetectorPromise = createLandmarker('IMAGE').then((landmarker) => ({
      detect(source) {
        const result = landmarker.detect(source);
        return result.landmarks?.[0] ?? null;
      },
    }));
    imageDetectorPromise.catch(() => {
      imageDetectorPromise = null;
    });
  }
  return imageDetectorPromise;
}
