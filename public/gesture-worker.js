import { FilesetResolver, GestureRecognizer } from "/mediapipe/vision_bundle.mjs";

let recognizer = null;

const send = (message) => self.postMessage(message);

async function initialize(origin) {
  const fileset = await FilesetResolver.forVisionTasks(`${origin}/mediapipe-wasm`);
  const sharedOptions = {
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.5,
  };

  try {
    recognizer = await GestureRecognizer.createFromOptions(fileset, {
      ...sharedOptions,
      baseOptions: {
        modelAssetPath: `${origin}/models/gesture_recognizer.task`,
        delegate: "GPU",
      },
    });
    send({ type: "ready", delegate: "GPU" });
  } catch {
    recognizer = await GestureRecognizer.createFromOptions(fileset, {
      ...sharedOptions,
      baseOptions: {
        modelAssetPath: `${origin}/models/gesture_recognizer.task`,
        delegate: "CPU",
      },
    });
    send({ type: "ready", delegate: "CPU" });
  }
}

self.onmessage = async (event) => {
  const message = event.data;
  if (message.type === "init") {
    try {
      await initialize(message.origin);
    } catch (error) {
      send({
        type: "error",
        message: error instanceof Error ? error.message : "Vision worker failed to initialize",
      });
    }
    return;
  }

  if (message.type === "close") {
    recognizer?.close();
    recognizer = null;
    self.close();
    return;
  }

  if (message.type === "frame") {
    if (!recognizer) {
      message.bitmap.close();
      send({ type: "frame-dropped" });
      return;
    }

    const startedAt = performance.now();
    try {
      const result = recognizer.recognizeForVideo(message.bitmap, message.timestamp);
      send({
        type: "result",
        capturedAt: message.capturedAt,
        inferenceMs: performance.now() - startedAt,
        landmarks: result.landmarks,
        gestures: result.gestures.map((hand) =>
          hand.map(({ categoryName, score }) => ({ categoryName, score })),
        ),
      });
    } catch (error) {
      send({
        type: "frame-error",
        message: error instanceof Error ? error.message : "Frame inference failed",
      });
    } finally {
      message.bitmap.close();
    }
  }
};
