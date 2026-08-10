"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Mode = "intro" | "loading" | "calibrate" | "paint" | "error";
type InputMode = "camera" | "pointer";
type Point = { x: number; y: number };
type Landmark = { x: number; y: number; z: number; visibility?: number };
type GestureResult = {
  landmarks: Landmark[][];
  gestures: { categoryName: string; score: number }[][];
};
type WorkerResult = GestureResult & {
  type: "result";
  capturedAt: number;
  inferenceMs: number;
};
type CalibrationBounds = { minX: number; maxX: number; minY: number; maxY: number };
type AudioRig = {
  context: AudioContext;
  source: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
};
type Drip = {
  x: number;
  y: number;
  length: number;
  drawn: number;
  speed: number;
  width: number;
  color: string;
  alpha: number;
};
type MistParticle = Point & {
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
};

const PALETTE = [
  { name: "Voltage", hex: "#dfff00" },
  { name: "Hotline", hex: "#ff3f8e" },
  { name: "Signal", hex: "#ff5c35" },
  { name: "Pool", hex: "#29e7cd" },
  { name: "Ultraviolet", hex: "#9f6cff" },
  { name: "Ice", hex: "#e9f2ee" },
];

const CAPS = [
  { id: "skinny", label: "01", name: "Skinny", size: 20, flow: 15, kind: "aerosol" },
  { id: "classic", label: "02", name: "Classic", size: 44, flow: 27, kind: "aerosol" },
  { id: "fat", label: "03", name: "Fat cap", size: 82, flow: 42, kind: "aerosol" },
  { id: "splatter", label: "04", name: "Splatter", size: 66, flow: 19, kind: "splatter" },
  { id: "marker", label: "05", name: "Marker", size: 18, flow: 9, kind: "marker" },
];

const CALIBRATION_TARGETS = [
  { label: "TOP LEFT", x: 0.12, y: 0.18 },
  { label: "TOP RIGHT", x: 0.88, y: 0.18 },
  { label: "BOTTOM RIGHT", x: 0.88, y: 0.78 },
  { label: "BOTTOM LEFT", x: 0.12, y: 0.78 },
];

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

const distance = (a: Landmark, b: Landmark) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const rgb = (hex: string) => {
  const clean = hex.replace("#", "");
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
};

export default function Home() {
  const [mode, setMode] = useState<Mode>("intro");
  const [inputMode, setInputMode] = useState<InputMode>("pointer");
  const [color, setColor] = useState(PALETTE[0]);
  const [cap, setCap] = useState(CAPS[1]);
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false });
  const [isSpraying, setIsSpraying] = useState(false);
  const [trackingLabel, setTrackingLabel] = useState("LOOKING FOR HAND");
  const [debug, setDebug] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [toast, setToast] = useState("");
  const [calibrationStage, setCalibrationStage] = useState(0);
  const [telemetry, setTelemetry] = useState({
    trackingFps: 0,
    renderFps: 0,
    latencyMs: 0,
    inferenceMs: 0,
    confidence: 0,
    delegate: "—",
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const effectsCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef<Mode>("intro");
  const workerRef = useRef<Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackingRafRef = useRef<number | null>(null);
  const paintRafRef = useRef<number | null>(null);
  const frameInFlightRef = useRef(false);
  const pointerRef = useRef<Point>({ x: 0, y: 0 });
  const smoothedPointRef = useRef<Point | null>(null);
  const velocityRef = useRef<Point>({ x: 0, y: 0 });
  const lastPaintPointRef = useRef<Point | null>(null);
  const pointerVisibleRef = useRef(false);
  const trackingPinchRef = useRef(false);
  const sprayingRef = useRef(false);
  const wasSprayingRef = useRef(false);
  const pressureRef = useRef(0.85);
  const palmScaleRef = useRef(0.5);
  const lastPaintTimeRef = useRef(0);
  const lastInferenceRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const lastUiUpdateRef = useRef(0);
  const lastTrackTimeRef = useRef(0);
  const lastResultTimeRef = useRef(0);
  const trackingFpsRef = useRef(0);
  const renderFpsRef = useRef(0);
  const renderFrameCountRef = useRef(0);
  const renderSampleStartRef = useRef(0);
  const calibrationSamplesRef = useRef<Point[]>([]);
  const calibrationBoundsRef = useRef<CalibrationBounds>({ minX: 0.08, maxX: 0.92, minY: 0.07, maxY: 0.91 });
  const calibrationPinchRef = useRef(false);
  const openPalmSinceRef = useRef(0);
  const thumbsUpSinceRef = useRef(0);
  const gestureCooldownRef = useRef(0);
  const wetnessRef = useRef(0);
  const dripsRef = useRef<Drip[]>([]);
  const mistRef = useRef<MistParticle[]>([]);
  const historyRef = useRef<string[]>([]);
  const colorRef = useRef(color);
  const capRef = useRef(cap);
  const debugRef = useRef(debug);
  const audioRef = useRef<AudioRig | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setAppMode = useCallback((next: Mode) => {
    modeRef.current = next;
    setMode(next);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 1800);
  }, []);

  const ensureAudio = useCallback(() => {
    if (audioRef.current) {
      void audioRef.current.context.resume();
      return audioRef.current;
    }
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return null;
    const context = new AudioContextClass();
    const frameCount = context.sampleRate * 2;
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < frameCount; i += 1) {
      channel[i] = Math.random() * 2 - 1;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    filter.type = "bandpass";
    filter.frequency.value = 5100;
    filter.Q.value = 0.58;
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
    audioRef.current = { context, source, gain, filter };
    void context.resume();
    return audioRef.current;
  }, []);

  const setSprayAudio = useCallback(
    (active: boolean, pressure = 0.8) => {
      const rig = active ? ensureAudio() : audioRef.current;
      if (!rig) return;
      const now = rig.context.currentTime;
      rig.gain.gain.cancelScheduledValues(now);
      rig.gain.gain.setTargetAtTime(active ? 0.065 + pressure * 0.055 : 0, now, 0.025);
      rig.filter.frequency.setTargetAtTime(3900 + pressure * 2600, now, 0.04);
    },
    [ensureAudio],
  );

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const old = document.createElement("canvas");
    old.width = canvas.width;
    old.height = canvas.height;
    old.getContext("2d")?.drawImage(canvas, 0, 0);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (old.width > 0 && old.height > 0) {
      context.drawImage(old, 0, 0, old.width, old.height, 0, 0, width, height);
    }
    const effectsCanvas = effectsCanvasRef.current;
    if (effectsCanvas) {
      effectsCanvas.width = Math.floor(width * dpr);
      effectsCanvas.height = Math.floor(height * dpr);
      effectsCanvas.style.width = `${width}px`;
      effectsCanvas.style.height = `${height}px`;
      effectsCanvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }, []);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [resizeCanvas]);

  useEffect(() => {
    colorRef.current = color;
  }, [color]);

  useEffect(() => {
    capRef.current = cap;
  }, [cap]);

  useEffect(() => {
    debugRef.current = debug;
  }, [debug]);

  const checkpoint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      historyRef.current.push(canvas.toDataURL("image/webp", 0.82));
      if (historyRef.current.length > 7) historyRef.current.shift();
      setCanUndo(historyRef.current.length > 0);
    } catch {
      // Painting remains usable if a browser declines canvas serialization.
    }
  }, []);

  const undo = useCallback(() => {
    const canvas = canvasRef.current;
    const snapshot = historyRef.current.pop();
    if (!canvas || !snapshot) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const image = new Image();
    image.onload = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.restore();
      context.drawImage(image, 0, 0, canvas.width / dpr, canvas.height / dpr);
    };
    image.src = snapshot;
    setCanUndo(historyRef.current.length > 0);
    showToast("LAST MARK LIFTED");
  }, [showToast]);

  const clearWall = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => setConfirmClear(false), 2600);
      return;
    }
    checkpoint();
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.restore();
    }
    setConfirmClear(false);
    showToast("FRESH WALL");
  }, [checkpoint, confirmClear, showToast]);

  const saveArtwork = useCallback(() => {
    const source = canvasRef.current;
    if (!source) return;
    const output = document.createElement("canvas");
    output.width = source.width;
    output.height = source.height;
    const context = output.getContext("2d");
    if (!context) return;
    const gradient = context.createRadialGradient(
      output.width * 0.42,
      output.height * 0.35,
      0,
      output.width * 0.5,
      output.height * 0.5,
      output.width * 0.78,
    );
    gradient.addColorStop(0, "#282825");
    gradient.addColorStop(0.58, "#171715");
    gradient.addColorStop(1, "#090a09");
    context.fillStyle = gradient;
    context.fillRect(0, 0, output.width, output.height);
    context.fillStyle = "rgba(255,255,255,.025)";
    for (let i = 0; i < 7000; i += 1) {
      const size = Math.random() * 2.2;
      context.fillRect(Math.random() * output.width, Math.random() * output.height, size, size);
    }
    context.drawImage(source, 0, 0);
    context.fillStyle = "rgba(255,255,255,.5)";
    context.font = `600 ${Math.max(16, output.width * 0.011)}px Arial`;
    context.letterSpacing = "3px";
    context.fillText("AIRCAN / DIGITAL WALL", output.width * 0.025, output.height * 0.955);
    const link = document.createElement("a");
    link.download = `aircan-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = output.toDataURL("image/png");
    link.click();
    showToast("ARTWORK SAVED");
  }, [showToast]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen();
    } else {
      void document.exitFullscreen();
    }
  }, []);

  const deposit = useCallback(
    (
      context: CanvasRenderingContext2D,
      x: number,
      y: number,
      radius: number,
      pressure: number,
      amountScale: number,
    ) => {
      const paint = rgb(colorRef.current.hex);
      const selectedCap = capRef.current;
      if (selectedCap.kind === "marker") {
        const angle = Math.atan2(velocityRef.current.y, velocityRef.current.x || 0.001) + Math.PI * 0.5;
        context.save();
        context.translate(x, y);
        context.rotate(angle);
        context.beginPath();
        context.fillStyle = `rgba(${paint.r},${paint.g},${paint.b},${0.58 + pressure * 0.34})`;
        context.ellipse(0, 0, radius * 0.7, radius * 0.25, 0, 0, Math.PI * 2);
        context.fill();
        context.restore();
        return;
      }

      const splatter = selectedCap.kind === "splatter";
      const count = Math.max(5, Math.floor(selectedCap.flow * pressure * amountScale));
      for (let i = 0; i < count; i += 1) {
        const theta = Math.random() * Math.PI * 2;
        const spread = splatter
          ? 0.18 + Math.pow(Math.random(), 0.52) * 1.55
          : Math.min(1.35, Math.sqrt(-2 * Math.log(Math.max(0.001, Math.random()))) * 0.39);
        const d = spread * radius;
        const dotX = x + Math.cos(theta) * d;
        const dotY = y + Math.sin(theta) * d;
        const centerWeight = 1 - clamp(d / (radius * 1.38));
        const dotRadius = splatter
          ? 0.7 + Math.pow(Math.random(), 3) * 7.5
          : 0.35 + Math.random() * (1.1 + pressure * 1.65) + centerWeight * 0.9;
        const alpha = splatter
          ? (0.18 + Math.random() * 0.48) * pressure
          : (0.045 + centerWeight * 0.18) * pressure;
        context.beginPath();
        context.fillStyle = `rgba(${paint.r},${paint.g},${paint.b},${alpha})`;
        context.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
        context.fill();
      }
      if (!splatter) {
        context.beginPath();
        context.fillStyle = `rgba(${paint.r},${paint.g},${paint.b},${0.025 + pressure * 0.035})`;
        context.arc(x, y, radius * 0.32, 0, Math.PI * 2);
        context.fill();
      }

      if (mistRef.current.length < 240 && Math.random() < 0.72) {
        const mistCount = splatter ? 1 : 2;
        for (let i = 0; i < mistCount; i += 1) {
          mistRef.current.push({
            x: x + (Math.random() - 0.5) * radius,
            y: y + (Math.random() - 0.5) * radius,
            vx: (Math.random() - 0.5) * 22,
            vy: -8 - Math.random() * 20,
            life: 0.45 + Math.random() * 0.45,
            size: 1 + Math.random() * 2.4,
            color: colorRef.current.hex,
          });
        }
      }
    },
    [],
  );

  const sprayBurst = useCallback(
    (context: CanvasRenderingContext2D, point: Point) => {
      const paint = rgb(colorRef.current.hex);
      const radius = capRef.current.size * (0.85 + palmScaleRef.current * 0.5);
      for (let i = 0; i < 22; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const d = radius * (0.15 + Math.random() * 1.25);
        const size = 0.7 + Math.random() * 3.8;
        context.beginPath();
        context.fillStyle = `rgba(${paint.r},${paint.g},${paint.b},${0.12 + Math.random() * 0.38})`;
        context.arc(point.x + Math.cos(angle) * d, point.y + Math.sin(angle) * d, size, 0, Math.PI * 2);
        context.fill();
      }
    },
    [],
  );

  useEffect(() => {
    const frame = (time: number) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      const dt = clamp((time - lastPaintTimeRef.current) / 1000, 0.002, 0.05);
      lastPaintTimeRef.current = time;
      renderFrameCountRef.current += 1;
      if (!renderSampleStartRef.current) renderSampleStartRef.current = time;
      if (time - renderSampleStartRef.current >= 500) {
        renderFpsRef.current = Math.round(
          renderFrameCountRef.current / ((time - renderSampleStartRef.current) / 1000),
        );
        renderFrameCountRef.current = 0;
        renderSampleStartRef.current = time;
      }

      if (canvas && context && sprayingRef.current && pointerVisibleRef.current && modeRef.current === "paint") {
        const current = pointerRef.current;
        if (!wasSprayingRef.current) {
          checkpoint();
          sprayBurst(context, current);
          lastPaintPointRef.current = current;
        }
        const last = lastPaintPointRef.current ?? current;
        const travel = Math.hypot(current.x - last.x, current.y - last.y);
        const speed = travel / dt;
        const radius = capRef.current.size * (0.82 + palmScaleRef.current * 0.65);
        const steps = Math.max(1, Math.min(12, Math.ceil(travel / Math.max(3, radius * 0.13))));
        const density = clamp(1.28 - speed / 1250, 0.34, 1.18);
        for (let step = 1; step <= steps; step += 1) {
          const ratio = step / steps;
          deposit(
            context,
            last.x + (current.x - last.x) * ratio,
            last.y + (current.y - last.y) * ratio,
            radius,
            pressureRef.current,
            Math.max(0.28, ((dt * 60) / steps) * density),
          );
        }
        lastPaintPointRef.current = { ...current };
        if (speed < 70 && capRef.current.kind === "aerosol") {
          wetnessRef.current += dt * pressureRef.current;
          if (wetnessRef.current > 0.78 && Math.random() < 0.055) {
            dripsRef.current.push({
              x: current.x + (Math.random() - 0.5) * radius * 0.4,
              y: current.y + radius * 0.12,
              length: 24 + Math.random() * 105,
              drawn: 0,
              speed: 38 + Math.random() * 56,
              width: 1.2 + Math.random() * 3,
              color: colorRef.current.hex,
              alpha: 0.16 + Math.random() * 0.22,
            });
            wetnessRef.current *= 0.32;
          }
        } else {
          wetnessRef.current = Math.max(0, wetnessRef.current - dt * 0.7);
        }
      } else {
        lastPaintPointRef.current = null;
        wetnessRef.current = Math.max(0, wetnessRef.current - dt * 0.5);
      }

      if (context && dripsRef.current.length) {
        dripsRef.current = dripsRef.current.filter((drip) => {
          const previous = drip.drawn;
          drip.drawn = Math.min(drip.length, drip.drawn + drip.speed * dt);
          const paint = rgb(drip.color);
          context.beginPath();
          context.moveTo(drip.x, drip.y + previous);
          context.lineTo(drip.x + Math.sin(drip.drawn * 0.045) * 0.7, drip.y + drip.drawn);
          context.strokeStyle = `rgba(${paint.r},${paint.g},${paint.b},${drip.alpha})`;
          context.lineWidth = drip.width * (1 - drip.drawn / drip.length * 0.45);
          context.lineCap = "round";
          context.stroke();
          if (drip.drawn >= drip.length) {
            context.beginPath();
            context.fillStyle = `rgba(${paint.r},${paint.g},${paint.b},${drip.alpha * 0.9})`;
            context.arc(drip.x, drip.y + drip.length, drip.width * 1.25, 0, Math.PI * 2);
            context.fill();
            return false;
          }
          return true;
        });
      }

      const effectsCanvas = effectsCanvasRef.current;
      const effects = effectsCanvas?.getContext("2d");
      if (effectsCanvas && effects) {
        effects.clearRect(0, 0, window.innerWidth, window.innerHeight);
        mistRef.current = mistRef.current.filter((particle) => {
          particle.life -= dt;
          if (particle.life <= 0) return false;
          particle.x += particle.vx * dt;
          particle.y += particle.vy * dt;
          particle.vx *= 0.97;
          particle.vy *= 0.97;
          const paint = rgb(particle.color);
          effects.beginPath();
          effects.fillStyle = `rgba(${paint.r},${paint.g},${paint.b},${Math.min(0.24, particle.life * 0.28)})`;
          effects.arc(particle.x, particle.y, particle.size * particle.life, 0, Math.PI * 2);
          effects.fill();
          return true;
        });
      }

      wasSprayingRef.current = sprayingRef.current;
      paintRafRef.current = requestAnimationFrame(frame);
    };
    paintRafRef.current = requestAnimationFrame(frame);
    return () => {
      if (paintRafRef.current) cancelAnimationFrame(paintRafRef.current);
    };
  }, [checkpoint, deposit, sprayBurst]);

  const updateSpraying = useCallback(
    (active: boolean, pressure = pressureRef.current) => {
      if (sprayingRef.current === active) {
        if (active) setSprayAudio(true, pressure);
        return;
      }
      sprayingRef.current = active;
      pressureRef.current = pressure;
      setIsSpraying(active);
      setSprayAudio(active, pressure);
    },
    [setSprayAudio],
  );

  const drawDebugHand = useCallback((landmarks: Landmark[]) => {
    const canvas = debugCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = canvas.clientWidth || 240;
    const height = canvas.clientHeight || 180;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.clearRect(0, 0, width, height);
    context.fillStyle = colorRef.current.hex;
    landmarks.forEach((landmark, index) => {
      context.beginPath();
      context.arc((1 - landmark.x) * width, landmark.y * height, index === 8 || index === 4 ? 4 : 2, 0, Math.PI * 2);
      context.fill();
    });
  }, []);

  const processTrackingResult = useCallback(
    (result: WorkerResult) => {
      const now = performance.now();
      if (lastResultTimeRef.current) {
        const instantFps = 1000 / Math.max(1, now - lastResultTimeRef.current);
        trackingFpsRef.current = trackingFpsRef.current
          ? trackingFpsRef.current * 0.82 + instantFps * 0.18
          : instantFps;
      }
      lastResultTimeRef.current = now;
      const landmarks = result.landmarks[0];

      if (!landmarks) {
        pointerVisibleRef.current = false;
        trackingPinchRef.current = false;
        calibrationPinchRef.current = false;
        updateSpraying(false);
        if (now - lastUiUpdateRef.current > 160) {
          setCursor((previous) => ({ ...previous, visible: false }));
          setTrackingLabel("HAND OUT OF FRAME");
          setTelemetry((previous) => ({
            ...previous,
            trackingFps: Math.round(trackingFpsRef.current),
            renderFps: renderFpsRef.current,
            latencyMs: Math.round(now - result.capturedAt),
            inferenceMs: Math.round(result.inferenceMs),
            confidence: 0,
          }));
          lastUiUpdateRef.current = now;
        }
        return;
      }

      const tip = landmarks[8];
      const thumb = landmarks[4];
      const palm = Math.max(0.04, distance(landmarks[0], landmarks[9]));
      const pinchRatio = distance(tip, thumb) / palm;
      const nextPressure = clamp(1 - (pinchRatio - 0.1) / 0.36, 0.18, 1);
      const pinching = trackingPinchRef.current ? pinchRatio < 0.48 : pinchRatio < 0.34;
      trackingPinchRef.current = pinching;

      const raw = { x: 1 - tip.x, y: tip.y };
      const bounds = calibrationBoundsRef.current;
      const normalizedX = clamp((raw.x - bounds.minX) / Math.max(0.2, bounds.maxX - bounds.minX));
      const normalizedY = clamp((raw.y - bounds.minY) / Math.max(0.2, bounds.maxY - bounds.minY));
      const target = {
        x: normalizedX * window.innerWidth,
        y: normalizedY * window.innerHeight,
      };

      const dt = clamp((now - (lastTrackTimeRef.current || now - 33)) / 1000, 0.008, 0.1);
      lastTrackTimeRef.current = now;
      const previous = smoothedPointRef.current ?? target;
      const rawVelocity = {
        x: (target.x - previous.x) / dt,
        y: (target.y - previous.y) / dt,
      };
      velocityRef.current = {
        x: velocityRef.current.x * 0.72 + rawVelocity.x * 0.28,
        y: velocityRef.current.y * 0.72 + rawVelocity.y * 0.28,
      };
      const speed = Math.hypot(velocityRef.current.x, velocityRef.current.y);
      const smoothing = clamp(0.2 + speed / 2600, 0.2, 0.52);
      const smoothed = {
        x: previous.x + (target.x - previous.x) * smoothing,
        y: previous.y + (target.y - previous.y) * smoothing,
      };
      smoothedPointRef.current = smoothed;
      const predictionSeconds = clamp(speed / 45000, 0.012, 0.034);
      pointerRef.current = {
        x: clamp(smoothed.x + velocityRef.current.x * predictionSeconds, 0, window.innerWidth),
        y: clamp(smoothed.y + velocityRef.current.y * predictionSeconds, 0, window.innerHeight),
      };
      pointerVisibleRef.current = true;
      palmScaleRef.current = clamp((palm - 0.13) / 0.18);
      pressureRef.current = nextPressure;

      const gesture = result.gestures[0]?.[0]?.categoryName ?? "None";
      const gestureScore = result.gestures[0]?.[0]?.score ?? 0;

      if (modeRef.current === "calibrate") {
        const stage = calibrationSamplesRef.current.length;
        setTrackingLabel(`PINCH ${CALIBRATION_TARGETS[stage]?.label ?? "TO FINISH"}`);
        if (pinching && !calibrationPinchRef.current && stage < CALIBRATION_TARGETS.length) {
          calibrationSamplesRef.current.push(raw);
          const nextStage = calibrationSamplesRef.current.length;
          setCalibrationStage(nextStage);
          if (nextStage === CALIBRATION_TARGETS.length) {
            const [topLeft, topRight, bottomRight, bottomLeft] = calibrationSamplesRef.current;
            const left = (topLeft.x + bottomLeft.x) / 2;
            const right = (topRight.x + bottomRight.x) / 2;
            const top = (topLeft.y + topRight.y) / 2;
            const bottom = (bottomLeft.y + bottomRight.y) / 2;
            const xMin = Math.min(left, right);
            const xMax = Math.max(left, right);
            const yMin = Math.min(top, bottom);
            const yMax = Math.max(top, bottom);
            const xSpan = Math.max(0.22, xMax - xMin);
            const ySpan = Math.max(0.22, yMax - yMin);
            calibrationBoundsRef.current = {
              minX: clamp(xMin - xSpan * (0.12 / 0.76), 0, 0.7),
              maxX: clamp(xMax + xSpan * (0.12 / 0.76), 0.3, 1),
              minY: clamp(yMin - ySpan * (0.18 / 0.6), 0, 0.7),
              maxY: clamp(yMax + ySpan * (0.22 / 0.6), 0.3, 1),
            };
            smoothedPointRef.current = null;
            setAppMode("paint");
            showToast("CALIBRATED — THE WALL IS YOURS");
          } else {
            showToast(`${nextStage}/4 LOCKED`);
          }
        }
        calibrationPinchRef.current = pinching;
      } else if (modeRef.current === "paint") {
        updateSpraying(pinching, nextPressure);
        setTrackingLabel(pinching ? "SPRAYING" : gesture === "Open_Palm" ? "OPEN PALM" : "PINCH TO SPRAY");
      }

      if (gesture === "Open_Palm" && gestureScore > 0.72 && !pinching) {
        if (!openPalmSinceRef.current) openPalmSinceRef.current = now;
      } else {
        openPalmSinceRef.current = 0;
      }

      if (modeRef.current === "paint" && gesture === "Thumb_Up" && gestureScore > 0.78 && !pinching) {
        if (!thumbsUpSinceRef.current) thumbsUpSinceRef.current = now;
        if (now - thumbsUpSinceRef.current > 900 && now > gestureCooldownRef.current) {
          gestureCooldownRef.current = now + 3000;
          thumbsUpSinceRef.current = 0;
          saveArtwork();
        }
      } else {
        thumbsUpSinceRef.current = 0;
      }

      if (now - lastUiUpdateRef.current > 34) {
        setCursor({ ...pointerRef.current, visible: true });
        setTelemetry((previous) => ({
          ...previous,
          trackingFps: Math.round(trackingFpsRef.current),
          renderFps: renderFpsRef.current,
          latencyMs: Math.round(now - result.capturedAt),
          inferenceMs: Math.round(result.inferenceMs),
          confidence: Math.round(gestureScore * 100),
        }));
        if (debugRef.current) drawDebugHand(landmarks);
        lastUiUpdateRef.current = now;
      }
    },
    [drawDebugHand, saveArtwork, setAppMode, showToast, updateSpraying],
  );

  const stopCamera = useCallback(() => {
    if (trackingRafRef.current) cancelAnimationFrame(trackingRafRef.current);
    trackingRafRef.current = null;
    workerRef.current?.postMessage({ type: "close" });
    workerRef.current?.terminate();
    workerRef.current = null;
    frameInFlightRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    trackingPinchRef.current = false;
    smoothedPointRef.current = null;
    updateSpraying(false);
  }, [updateSpraying]);

  const startCamera = useCallback(async () => {
    ensureAudio();
    setInputMode("camera");
    setAppMode("loading");
    setTrackingLabel("WARMING UP VISION");
    setCalibrationStage(0);
    calibrationSamplesRef.current = [];
    calibrationBoundsRef.current = { minX: 0.08, maxX: 0.92, minY: 0.07, maxY: 0.91 };
    calibrationPinchRef.current = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 60 },
          facingMode: "user",
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Video surface unavailable");
      video.srcObject = stream;
      await video.play();

      const worker = new Worker("/gesture-worker.js", { type: "module" });
      workerRef.current = worker;
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Vision worker timed out")), 18000);
        worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
          const message = event.data;
          if (message.type === "ready") {
            window.clearTimeout(timeout);
            setTelemetry((previous) => ({ ...previous, delegate: String(message.delegate ?? "CPU") }));
            resolve();
            return;
          }
          if (message.type === "error") {
            window.clearTimeout(timeout);
            reject(new Error(String(message.message ?? "Vision worker failed")));
            return;
          }
          if (message.type === "result") {
            frameInFlightRef.current = false;
            processTrackingResult(message as unknown as WorkerResult);
            return;
          }
          if (message.type === "frame-error" || message.type === "frame-dropped") {
            frameInFlightRef.current = false;
          }
        };
        worker.onerror = () => {
          window.clearTimeout(timeout);
          reject(new Error("Vision worker crashed"));
        };
        worker.postMessage({ type: "init", origin: window.location.origin });
      });
      setAppMode("calibrate");
      setTrackingLabel("PINCH TOP LEFT");

      const loop = (time: number) => {
        const activeWorker = workerRef.current;
        const activeVideo = videoRef.current;
        if (!activeWorker || !activeVideo) return;
        if (
          activeVideo.readyState >= 2 &&
          activeVideo.currentTime !== lastVideoTimeRef.current &&
          time - lastInferenceRef.current >= 32 &&
          !frameInFlightRef.current
        ) {
          lastInferenceRef.current = time;
          lastVideoTimeRef.current = activeVideo.currentTime;
          frameInFlightRef.current = true;
          const capturedAt = performance.now();
          void createImageBitmap(activeVideo)
            .then((bitmap) => {
              if (!workerRef.current) {
                bitmap.close();
                frameInFlightRef.current = false;
                return;
              }
              workerRef.current.postMessage(
                { type: "frame", bitmap, timestamp: capturedAt, capturedAt },
                [bitmap],
              );
            })
            .catch(() => {
              frameInFlightRef.current = false;
              setTrackingLabel("TRACKING RECOVERY");
            });
        }
        trackingRafRef.current = requestAnimationFrame(loop);
      };
      trackingRafRef.current = requestAnimationFrame(loop);
    } catch {
      stopCamera();
      setAppMode("error");
      setTrackingLabel("CAMERA BLOCKED");
    }
  }, [ensureAudio, processTrackingResult, setAppMode, stopCamera]);

  const startPointerMode = useCallback(() => {
    stopCamera();
    ensureAudio();
    setInputMode("pointer");
    pointerVisibleRef.current = true;
    pointerRef.current = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    setCursor({ ...pointerRef.current, visible: true });
    setTrackingLabel("HOLD TO SPRAY");
    setAppMode("paint");
    showToast("POINTER CAN READY");
  }, [ensureAudio, setAppMode, showToast, stopCamera]);

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (inputMode !== "pointer" || mode !== "paint") return;
    pointerRef.current = { x: event.clientX, y: event.clientY };
    pointerVisibleRef.current = true;
    setCursor({ x: event.clientX, y: event.clientY, visible: true });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (inputMode !== "pointer" || mode !== "paint") return;
    if ((event.target as HTMLElement).closest("[data-ui]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = { x: event.clientX, y: event.clientY };
    pressureRef.current = event.pressure > 0 ? clamp(event.pressure * 1.6, 0.45, 1) : 0.86;
    updateSpraying(true, pressureRef.current);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (inputMode !== "pointer") return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    updateSpraying(false);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (modeRef.current !== "paint") return;
      if (event.code === "Space" && inputMode === "pointer" && !event.repeat) {
        event.preventDefault();
        updateSpraying(true, 0.85);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
      if (event.key.toLowerCase() === "s") saveArtwork();
      if (event.key.toLowerCase() === "f") toggleFullscreen();
      if (event.key.toLowerCase() === "d") setDebug((value) => !value);
      const number = Number(event.key);
      if (number >= 1 && number <= PALETTE.length) setColor(PALETTE[number - 1]);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space" && inputMode === "pointer") updateSpraying(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [inputMode, saveArtwork, toggleFullscreen, undo, updateSpraying]);

  useEffect(() => {
    return () => {
      stopCamera();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      const rig = audioRef.current;
      if (rig) {
        try {
          rig.source.stop();
          void rig.context.close();
        } catch {
          // Audio may already be closed during hot reload.
        }
      }
    };
  }, [stopCamera]);

  const chooseColor = (next: (typeof PALETTE)[number]) => {
    setColor(next);
    showToast(next.name.toUpperCase());
  };

  const activeCalibrationTarget =
    CALIBRATION_TARGETS[Math.min(calibrationStage, CALIBRATION_TARGETS.length - 1)];

  return (
    <main
      className={`aircan mode-${mode} ${isSpraying ? "is-spraying" : ""}`}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="wall" aria-hidden="true" />
      <canvas ref={canvasRef} className="paint-canvas" aria-label="Your digital graffiti wall" />
      <canvas ref={effectsCanvasRef} className="effects-canvas" aria-hidden="true" />
      <div className="wall-grain" aria-hidden="true" />

      <video
        ref={videoRef}
        className={`camera-feed ${debug ? "is-visible" : ""}`}
        muted
        playsInline
        aria-label="Mirrored hand tracking preview"
      />
      <canvas
        ref={debugCanvasRef}
        className={`debug-landmarks ${debug ? "is-visible" : ""}`}
        aria-hidden="true"
      />

      {(mode === "paint" || mode === "calibrate") && cursor.visible && (
        <div
          className={`nozzle ${isSpraying ? "active" : ""} ${mode === "calibrate" ? "calibration-cursor" : ""}`}
          style={{
            transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0)`,
            width: mode === "calibrate" ? 38 : cap.size * 1.15,
            height: mode === "calibrate" ? 38 : cap.size * 1.15,
            "--paint": color.hex,
          } as React.CSSProperties}
          aria-hidden="true"
        >
          <span />
        </div>
      )}

      <header className="topbar" data-ui>
        <div className="brand-lockup">
          <div className="brand">AIRCAN</div>
          <div className="edition">DIGITAL WALL / 002</div>
        </div>
        {mode === "paint" && (
          <div className="session-actions">
            <button type="button" onClick={undo} disabled={!canUndo} aria-label="Undo last stroke">
              <span>UNDO</span><kbd>⌘Z</kbd>
            </button>
            <button type="button" onClick={clearWall} className={confirmClear ? "danger" : ""}>
              <span>{confirmClear ? "SURE?" : "CLEAR"}</span>
            </button>
            <button type="button" onClick={saveArtwork}>
              <span>SAVE ART</span><kbd>S</kbd>
            </button>
            <button type="button" onClick={toggleFullscreen} aria-label="Toggle fullscreen">
              <span>FULLSCREEN</span><kbd>F</kbd>
            </button>
          </div>
        )}
      </header>

      {mode === "intro" && (
        <section className="intro" data-ui>
          <div className="intro-index">EXPERIMENT 002 / GESTURE + COLOR</div>
          <div className="hero-copy">
            <p className="eyebrow"><span /> THE WALL IS LIVE</p>
            <h1><span>YOUR HAND.</span><span>THE WALL.</span><span>NO RULES.</span></h1>
            <p className="lede">
              Turn movement into aerosol. Aim with your index finger, pinch to paint,
              and leave a mark without touching the screen.
            </p>
            <div className="intro-actions">
              <button type="button" className="primary-cta" onClick={startCamera}>
                <span>START WITH CAMERA</span><span className="cta-arrow">↗</span>
              </button>
              <button type="button" className="text-cta" onClick={startPointerMode}>
                TRY WITH POINTER <span>→</span>
              </button>
            </div>
          </div>
          <div className="intro-foot">
            <p><strong>PRIVATE BY DESIGN</strong><br />VIDEO STAYS ON THIS DEVICE</p>
            <p><strong>NO INSTALL</strong><br />CAMERA + ONE HAND</p>
            <p className="coordinates">64.1466° N<br />21.9426° W</p>
          </div>
          <div className="hero-orbit" aria-hidden="true">
            <span className="orbit-copy">MOVE / PINCH / SPRAY / REPEAT / </span>
            <span className="hero-dot" />
          </div>
        </section>
      )}

      {mode === "loading" && (
        <section className="system-overlay" data-ui aria-live="polite">
          <div className="scanner"><span /><span /><span /></div>
          <p className="system-kicker">INITIALIZING ON-DEVICE VISION</p>
          <h2>WAKING UP<br />THE CAN</h2>
          <div className="load-track"><span /></div>
          <p className="system-note">Camera frames are processed here. Nothing is uploaded.</p>
        </section>
      )}

      {mode === "calibrate" && (
        <section className="calibration-overlay" data-ui aria-live="polite">
          <div
            className="calibration-target"
            style={{
              left: `${activeCalibrationTarget.x * 100}%`,
              top: `${activeCalibrationTarget.y * 100}%`,
            }}
            aria-hidden="true"
          >
            <span className="target-ring ring-one" />
            <span className="target-ring ring-two" />
            <span className="target-cross" />
            <em>{activeCalibrationTarget.label}</em>
          </div>
          <div className="calibration-hud">
            <p className="system-kicker">CALIBRATION / {String(calibrationStage + 1).padStart(2, "0")} OF 04</p>
            <h2>AIM. PINCH.<br />RELEASE.</h2>
            <p className="system-note">Move the lime cursor onto the target, pinch once, then open your fingers for the next corner.</p>
            <div className="calibration-progress" aria-label={`${calibrationStage} of 4 calibration points captured`}>
              {CALIBRATION_TARGETS.map((target, index) => (
                <span key={target.label} className={index < calibrationStage ? "complete" : index === calibrationStage ? "active" : ""} />
              ))}
            </div>
            <button type="button" className="text-cta" onClick={startPointerMode}>USE POINTER INSTEAD →</button>
          </div>
        </section>
      )}

      {mode === "error" && (
        <section className="system-overlay error-panel" data-ui>
          <div className="error-code">CAM / 403</div>
          <p className="system-kicker">CAMERA ACCESS DIDN&apos;T OPEN</p>
          <h2>THE WALL<br />STILL WORKS.</h2>
          <p className="system-note">Allow camera access in your browser, or paint with your pointer right now.</p>
          <div className="intro-actions">
            <button type="button" className="primary-cta" onClick={startCamera}>TRY CAMERA AGAIN <span>↗</span></button>
            <button type="button" className="text-cta" onClick={startPointerMode}>USE POINTER →</button>
          </div>
        </section>
      )}

      {mode === "paint" && (
        <>
          <div className={`tracking-pill ${isSpraying ? "live" : ""}`} data-ui aria-live="polite">
            <span className="tracking-light" />
            {trackingLabel}
          </div>

          <aside className="gesture-guide" data-ui>
            <span className="guide-number">{inputMode === "camera" ? "01" : "MOUSE"}</span>
            <p>{inputMode === "camera" ? "MOVE TO AIM" : "MOVE TO AIM"}<br />{inputMode === "camera" ? "PINCH TO SPRAY" : "HOLD TO SPRAY"}</p>
            <button type="button" onClick={() => setDebug((value) => !value)}>
              {debug ? "HIDE TRACKING" : "SHOW TRACKING"} <kbd>D</kbd>
            </button>
          </aside>

          {debug && (
            <aside className="tracking-lab" data-ui aria-label="Live tracking diagnostics">
              <div className="lab-heading"><span>TRACKING LAB</span><strong>LIVE</strong></div>
              <dl>
                <div><dt>TRACK</dt><dd>{telemetry.trackingFps || "—"} FPS</dd></div>
                <div><dt>RENDER</dt><dd>{telemetry.renderFps || "—"} FPS</dd></div>
                <div><dt>LATENCY</dt><dd>{telemetry.latencyMs || "—"} MS</dd></div>
                <div><dt>INFERENCE</dt><dd>{telemetry.inferenceMs || "—"} MS</dd></div>
                <div><dt>GESTURE</dt><dd>{telemetry.confidence || "—"}%</dd></div>
                <div><dt>DELEGATE</dt><dd>{telemetry.delegate}</dd></div>
              </dl>
              <p>WORKER THREAD / PREDICTIVE FILTER / 4-POINT MAP</p>
            </aside>
          )}

          <section className="tool-dock" data-ui aria-label="Paint tools">
            <div className="color-tools">
              <span className="tool-label">COLOR</span>
              <div className="swatches">
                {PALETTE.map((paint, index) => (
                  <button
                    type="button"
                    key={paint.hex}
                    className={paint.hex === color.hex ? "selected" : ""}
                    style={{ "--swatch": paint.hex } as React.CSSProperties}
                    onClick={() => chooseColor(paint)}
                    aria-label={`${paint.name} paint, shortcut ${index + 1}`}
                    title={`${paint.name} · ${index + 1}`}
                  ><span>{index + 1}</span></button>
                ))}
              </div>
            </div>
            <div className="dock-divider" />
            <div className="cap-tools">
              <span className="tool-label">CAP</span>
              <div className="caps">
                {CAPS.map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    className={option.id === cap.id ? "selected" : ""}
                    onClick={() => {
                      setCap(option);
                      showToast(option.name.toUpperCase());
                    }}
                    aria-label={`${option.name} spray cap`}
                  >
                    <span className={`cap-dot cap-${option.id}`} />
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      {toast && <div className="toast" data-ui role="status">{toast}</div>}
      <div className="screen-frame" aria-hidden="true" />
    </main>
  );
}
