"use client";

import { registerCameraVideo } from "../../diagnostics/cameraVideo";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import SideNav from "../SideNav";
import { useRouter } from "next/navigation";
import { useCamera } from "../CameraContext";
import CameraStatusOverlay from "../CameraStatusOverlay";
import { useHandLandmarker } from "../useHandLandmarker";
import DepthCalibrationCapture from "./DepthCalibrationCapture";
import {
  DEPTH_CALIBRATION_POSITIONS,
  DEPTH_CALIBRATION_STORAGE_KEY,
  DepthCalibrationCollector,
  makeDepthObservation,
  toPersistedDepthCalibration,
} from "../../cv/depthCalibration";
import type { DepthCalibrationModel } from "../../cv/depthCalibration";
import { MarkerDetector } from "../../cv/markerDetector";
import { getWhiteKeyPolygons, PIANO_CORNERS } from "../../cv/keyboardGeometry";
import { computeHomography, projectPoint } from "../../cv/homography";
import type { Homography } from "../../cv/homography";
import type { MarkerDetectionResult, Point } from "../../cv/types";
import {
  LIGHTING_MESSAGES,
  MAX_BRIGHTNESS,
  MIN_BRIGHTNESS,
  readFrameBrightness,
  type LightingReading,
} from "../lighting";

import { cameraSignature, markerCorners, compatibleCalibration, validateCalibration, saveCalibration, MARKER_ACQUIRE_INTERVAL_MS, MARKER_CHECK_INTERVAL_MS,
  validSamples, CURRENT_LAYOUT, SHEET_ID, type CalibrationResult, type LandmarkSample } from "../../cv/calibration";
const TOTAL_STEPS = 5;

const PAGE_CORNERS: [Point, Point, Point, Point] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];


const OCTAVE_OPTIONS = ["1"];
const NOTE_OPTIONS = ["C3"];

function ChevronDown() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertTriangle() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 4L22 20H2L12 4Z" stroke="white" strokeWidth="2" strokeLinejoin="round" />
      <line x1="12" y1="11" x2="12" y2="16" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="18.5" r="1" fill="white" />
    </svg>
  );
}

function SuccessBadge({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-success-soft border border-success">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="var(--color-success)" />
        <path d="M4.5 8L6.8 10.5L11.5 5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-[13px] font-sans text-success-strong whitespace-nowrap">{label}</span>
    </div>
  );
}

function ProgressBar({ total, current, className = "" }: { total: number; current: number; className?: string }) {
  return (
    <div className={`flex flex-1 items-center ${className}`} role="progressbar" aria-valuenow={current} aria-valuemin={1} aria-valuemax={total}>
      {Array.from({ length: total }, (_, i) => {
        const stepNum = i + 1;
        const circleFilled = stepNum <= current;
        const barFilled = stepNum < current;
        return (
          <div key={i} className="flex flex-1 items-center last:flex-none">
            <div className={`shrink-0 size-[20px] rounded-full border-2 transition-colors duration-200 ${circleFilled ? "bg-accent border-accent" : "bg-control-inactive border-control-inactive"}`} />
            {i < total - 1 && (
              <div className={`flex-1 h-[10px] transition-colors duration-200 ${barFilled ? "bg-accent" : "bg-control-inactive"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Calibration() {
  const [step, setStep] = useState(1);

  // Step 1
  const [octaves, setOctaves] = useState("1");
  const [startingNote, setStartingNote] = useState("C3");

  // Steps 4 & 5 — shared countdown
  const [countdown, setCountdown] = useState<number | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [fingersShown, setFingersShown] = useState(false);
  const [showingImage, setShowingImage] = useState(false);
  const [step5Success, setStep5Success] = useState(false);
  const [depthPositionIndex, setDepthPositionIndex] = useState(0);
  const [depthCaptureMessage, setDepthCaptureMessage] = useState<string | null>(null);
  const [depthCaptureBusy, setDepthCaptureBusy] = useState(false);
  const [sheetDetected, setSheetDetected] = useState(false);
  const [markerDetection, setMarkerDetection] =
    useState<MarkerDetectionResult | null>(null);
  const [sheetGeometry, setSheetGeometry] = useState<{
    pianoCorners: Point[];
    whiteKeys: Point[][];
    homography: Homography;
  } | null>(null);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [paperError, setPaperError] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [sheetDetectorStatus, setSheetDetectorStatus] =
    useState<"loading" | "ready" | "error">("loading");

  // #13 — the video element reports 0x0 until it has decoded a frame
  const [frameReady, setFrameReady] = useState(false);

  // #16 — sampled from the live frame during step 2
  const [lighting, setLighting] = useState<LightingReading | null>(null);

  const [corners, setCorners] = useState<Point[] | null>(null);
  const hoverRef = useRef<LandmarkSample[][] | null>(null);
  const resultRef = useRef<CalibrationResult | null>(null);
  const detectorRef = useRef<MarkerDetector | null>(null);
  const generationRef = useRef(0);
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => registerCameraVideo(videoRef.current), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sheetDetectionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sheetOverlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const { stream, cameraReady } = useCamera();
  const brightnessCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const depthCollectorRef = useRef(new DepthCalibrationCollector());
  const depthModelRef = useRef<DepthCalibrationModel | null>(null);
  const { status: landmarkerStatus, detect, reload: reloadLandmarker } =
    useHandLandmarker();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const update = () =>
      setFrameReady(
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.videoWidth > 0 &&
          video.videoHeight > 0,
      );

    // A remounted or retried stream may already be decoding, in which case no
    // further events fire; poll once on the next frame to catch that case.
    const raf = requestAnimationFrame(update);
    for (const evt of ["loadedmetadata", "loadeddata", "playing", "emptied"]) {
      video.addEventListener(evt, update);
    }
    return () => {
      cancelAnimationFrame(raf);
      for (const evt of ["loadedmetadata", "loadeddata", "playing", "emptied"]) {
        video.removeEventListener(evt, update);
      }
    };
  }, [stream]);

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // #16 — poll the live frame only while the lighting step is visible
  useEffect(() => {
    if (step !== 2 || !cameraReady || !frameReady) return;

    if (!brightnessCanvasRef.current) {
      brightnessCanvasRef.current = document.createElement("canvas");
    }
    const scratch = brightnessCanvasRef.current;

    const sample = () => {
      const video = videoRef.current;
      if (!video) return;
      const reading = readFrameBrightness(video, scratch);
      if (reading) setLighting(reading);
    };

    const raf = requestAnimationFrame(sample);
    const interval = setInterval(sample, 400);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(interval);
    };
  }, [step, cameraReady, frameReady]);

  function resetInteractiveStepState() {
    setCountdown(null);
    setHasStarted(false);
    setFingersShown(false);
    setShowingImage(false);
    setStep5Success(false);
    setDepthPositionIndex(0);
    setDepthCaptureMessage(null);
    setDepthCaptureBusy(false);
    depthCollectorRef.current = new DepthCalibrationCollector();
    depthModelRef.current = null;
    setShowHelpModal(false);
    setPaperError(false);
    setCaptureError(null);
    // Drop the previous reading so re-entering step 2 cannot advance on a
    // stale measurement before the first fresh sample lands.
    setLighting(null);
  }

  function goToAdjacentStep(delta: -1 | 1) {
    generationRef.current++;
    if (delta === -1) { resultRef.current = null; hoverRef.current = null; }
    resetInteractiveStepState();
    setStep((s) => s + delta);
  }

  useEffect(() => {
    if (!showHelpModal) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setShowHelpModal(false); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showHelpModal]);

  useEffect(() => {
    let cancelled = false;
    MarkerDetector.create().then(detector => {
      if (cancelled) { detector.dispose(); return; }
      detectorRef.current = detector;
      setSheetDetectorStatus("ready");
    }).catch(() => {
      if (cancelled) return;
      setSheetDetectorStatus("error");
      setCaptureError("Sheet detector unavailable. Reload to retry.");
    });
    return () => { cancelled = true; detectorRef.current?.dispose(); detectorRef.current = null; };
  }, []);

  useEffect(() => {
    generationRef.current++;
    hoverRef.current = null;
    resultRef.current = null;
  }, [stream]);

  function readSheet() {
    const video = videoRef.current;
    const camera = cameraSignature(stream, video);
    const detector = detectorRef.current;
    if (!video || !camera || !detector) throw new Error("Wait for the camera and sheet detector, then retry.");
    const canvas = document.createElement("canvas");
    canvas.width = camera.width; canvas.height = camera.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to read the camera frame.");
    context.drawImage(video, 0, 0);
    const observed = markerCorners(detector.detect(canvas), camera);
    if (!observed) throw new Error("Show all four sheet markers in a clear, flat rectangle, then retry.");
    return { camera, corners: observed };
  }

  function checkPaper() {
    try {
      const observed = readSheet();
      setCorners(observed.corners);
      setPaperError(false); setCaptureError(null);
    } catch (error) {
      setCorners(null); setPaperError(true);
      setCaptureError(error instanceof Error ? error.message : "Unable to detect the sheet.");
    }
  }

  function canvasToImage(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = canvas.toDataURL("image/png");
    });
  }

  const capture = useCallback(async function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // #13 — a 0x0 canvas throws on toDataURL and silently breaks detection
    if (!video.videoWidth || !video.videoHeight) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvasToImage(canvas);
  }, []);

  const captureDepthPosition = useCallback(async () => {
    if (depthCaptureBusy) return;

    const position = DEPTH_CALIBRATION_POSITIONS[depthPositionIndex];
    if (!position) return;

    setHasStarted(true);
    setDepthCaptureBusy(true);
    setDepthCaptureMessage(null);
    try {
      const image = await capture();
      if (!image) {
        setDepthCaptureMessage("The camera was not ready. Try again.");
        return;
      }

      const result = detect(image);
      if (!result) {
        setDepthCaptureMessage("Hand detection is unavailable. Try again.");
        return;
      }

      const rightHandIndex = (result.handednesses ?? []).findIndex((hand) =>
        hand[0]?.categoryName?.toLowerCase() === "right",
      );
      const rightHand =
        rightHandIndex >= 0 ? result.landmarks?.[rightHandIndex] : undefined;
      if (!rightHand) {
        setDepthCaptureMessage("Right hand not detected. Try again.");
        return;
      }

      const fingertipSheetYs = [4, 8, 12, 16, 20]
        .map((index) => rightHand[index]?.y)
        .filter((value): value is number => value !== undefined);
      const sheetY =
        fingertipSheetYs.reduce((sum, value) => sum + value, 0) /
        fingertipSheetYs.length;
      const observation = makeDepthObservation(
        rightHand,
        "Right",
        sheetY,
        fingertipSheetYs,
      );
      if (!observation) {
        setDepthCaptureMessage("The hand landmarks were incomplete. Try again.");
        return;
      }

      const captureResult = depthCollectorRef.current.capture(
        position,
        observation,
      );
      if (!captureResult.accepted) {
        setDepthCaptureMessage("Only a detected right hand can be captured.");
        return;
      }

      const nextPositionIndex = depthPositionIndex + 1;
      setDepthPositionIndex(nextPositionIndex);
      if (depthCollectorRef.current.isComplete()) {
        const model = depthCollectorRef.current.buildModel();
        if (!model) {
          setDepthCaptureMessage(
            "The depth values did not change enough between positions. Try again.",
          );
          setDepthPositionIndex(0);
          depthCollectorRef.current = new DepthCalibrationCollector();
          return;
        }
        depthModelRef.current = model;
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            DEPTH_CALIBRATION_STORAGE_KEY,
            JSON.stringify(toPersistedDepthCalibration(model)),
          );
        }
        setStep5Success(true);
        setDepthCaptureMessage("Depth calibration captured successfully.");
      } else {
        setDepthCaptureMessage(`${position} position captured.`);
      }
    } finally {
      setDepthCaptureBusy(false);
    }
  }, [capture, depthCaptureBusy, depthPositionIndex, detect]);

  useEffect(() => {
    if (step !== 3 || !cameraReady || !frameReady) return;

    setSheetDetected(false);
    setMarkerDetection(null);
    setSheetGeometry(null);
    setCorners(null);
    let cancelled = false;
    let detector: MarkerDetector | null = null;
    let timeout: number | undefined;
    const canvas =
      sheetDetectionCanvasRef.current ?? document.createElement("canvas");
    sheetDetectionCanvasRef.current = canvas;

    const checkSheet = () => {
      if (cancelled || !detector) return;
      let nextCheckInterval = MARKER_ACQUIRE_INTERVAL_MS;
      const video = videoRef.current;
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (context) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const detection = detector.detect(canvas);
          setMarkerDetection(detection);
          if (detection.missingIds.length === 0) {
            nextCheckInterval = MARKER_CHECK_INTERVAL_MS;
            const markerCenters = new Map(
              detection.observations.map((observation) => [
                observation.id,
                observation.center,
              ]),
            );
            const targetCorners = [0, 1, 2, 3].map((id) =>
              markerCenters.get(id),
            );
            const homography = targetCorners.every(
              (corner): corner is Point => corner !== undefined,
            )
              ? computeHomography(PAGE_CORNERS, targetCorners)
              : null;
            if (homography) {
              const pianoCorners = PIANO_CORNERS.map((corner) =>
                projectPoint(homography, corner),
              );
              const whiteKeys = getWhiteKeyPolygons().map((key) =>
                key.map((corner) => projectPoint(homography, corner)),
              );
              if (
                pianoCorners.every((corner): corner is Point => corner !== null) &&
                whiteKeys.every((key) =>
                  key.every((corner): corner is Point => corner !== null),
                )
              ) {
                const camera = cameraSignature(stream, video);
                const observedCorners = camera
                  ? markerCorners(detection, camera)
                  : null;
                if (observedCorners) {
                  setCorners(observedCorners);
                  setSheetDetected(true);
                  setSheetGeometry({
                    pianoCorners,
                    whiteKeys,
                    homography,
                  });
                }
              }
            }
          }
        }
      }
      timeout = window.setTimeout(checkSheet, nextCheckInterval);
    };

    MarkerDetector.create()
      .then((createdDetector) => {
        if (cancelled) {
          createdDetector.dispose();
          return;
        }
        detector = createdDetector;
        checkSheet();
      })
      .catch(() => {
        if (!cancelled) setSheetDetected(false);
      });

    return () => {
      cancelled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
      detector?.dispose();
    };
  }, [cameraReady, frameReady, step, stream]);

  useEffect(() => {
    const canvas = sheetOverlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) {
      return;
    }

    if (!sheetGeometry && !markerDetection) {
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;

    const accent =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--color-accent")
        .trim() || "#7440a8";
    const white =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--color-white")
        .trim() || "#ffffff";

    context.clearRect(0, 0, canvas.width, canvas.height);
    if (sheetGeometry) {
      context.lineWidth = 3;
      context.strokeStyle = accent;
      context.beginPath();
      sheetGeometry.pianoCorners.forEach((corner, index) => {
        if (index === 0) context.moveTo(corner.x, corner.y);
        else context.lineTo(corner.x, corner.y);
      });
      context.closePath();
      context.stroke();

      context.lineWidth = 1.5;
      context.strokeStyle = accent;
      context.fillStyle = white;
      sheetGeometry.whiteKeys.forEach((key) => {
        context.beginPath();
        key.forEach((corner, index) => {
          if (index === 0) context.moveTo(corner.x, corner.y);
          else context.lineTo(corner.x, corner.y);
        });
        context.closePath();
        context.globalAlpha = 0.32;
        context.fill();
        context.globalAlpha = 1;
        context.stroke();
      });
    }

    if (step === 3 && markerDetection) {
      context.lineWidth = 3;
      context.strokeStyle = accent;
      context.fillStyle = accent;
      context.font = "bold 24px sans-serif";
      for (const marker of markerDetection.observations) {
        context.beginPath();
        marker.corners.forEach((corner, index) => {
          if (index === 0) context.moveTo(corner.x, corner.y);
          else context.lineTo(corner.x, corner.y);
        });
        context.closePath();
        context.stroke();
        context.fillText(`ID ${marker.id}`, marker.center.x + 8, marker.center.y);
      }
    }
  }, [frameReady, markerDetection, sheetGeometry, step]);

  // Single countdown tick — behaviour at 0 differs per step
  // The timer schedules a real capture; it never establishes success itself.
  useEffect(() => {
    if (countdown === null || countdown < 0) return;
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(c => c === null ? null : c - 1), 1000);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    const generation = generationRef.current;
    const observed = (() => { try { return readSheet(); } catch { return null; } })();
    capture().then(image => {
      if (cancelled || generation !== generationRef.current) return;
      if (!image || !observed || !corners) throw new Error("Camera or sheet unavailable. Return to Align your paper.");
      const landmarks = detect(image)?.landmarks;
      if (!validSamples(landmarks)) throw new Error("Show one or two complete hands, then retry.");
      if (corners.some((p, i) => Math.hypot(p.x - observed.corners[i].x, p.y - observed.corners[i].y) >
        Math.hypot(observed.camera.width, observed.camera.height) * 0.01)) {
        throw new Error("The sheet moved. Return to Align your paper.");
      }
      if (step === 4) {
        hoverRef.current = structuredClone(landmarks);
        setFingersShown(true);
      } else if (step === 5) {
        const result = validateCalibration({ version: 1, coordinates: "unmirrored-frame-pixels/marker-unit-square",
          sheet: SHEET_ID, camera: observed.camera, layout: CURRENT_LAYOUT, corners,
          contact: { model: "landmark-reference-v1", hover: hoverRef.current, rest: landmarks } });
        if (!result) throw new Error("Capture the hover step again before placing your hands.");
        resultRef.current = result;
        setStep5Success(true);
      }
      setShowingImage(true);
    }).catch(error => {
      if (!cancelled && generation === generationRef.current) {
        setCaptureError(error instanceof Error ? error.message : "Capture failed. Retry.");
        setShowingImage(false);
      }
    });
    return () => { cancelled = true; };
  // Capture is bound to the countdown/step; late promises are explicitly rejected.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, step, stream]);

  const handleStartCountdown = () => {
    setHasStarted(true);
    setCountdown(3);
    setShowingImage(false);
    setFingersShown(false);
    setStep5Success(false);
    setCaptureError(null);
  };

  const handleComplete = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("isCalibrated", "true");
      const depthModel = depthModelRef.current;
      if (depthModel) {
        localStorage.setItem(
          DEPTH_CALIBRATION_STORAGE_KEY,
          JSON.stringify(toPersistedDepthCalibration(depthModel)),
        );
      }
    }
    router.push("/");
    try {
      const observed = readSheet();
      const result = resultRef.current;
      if (!result || !compatibleCalibration(result, observed.camera, observed.corners)) {
        throw new Error("Calibration changed. Return to calibration and capture again.");
      }
      if (!saveCalibration(result)) throw new Error("Could not save calibration. Enable browser storage and retry.");
      router.push("/");
    } catch (error) { setCaptureError(error instanceof Error ? error.message : "Please retry calibration."); }
  };

  const lightingOk = lighting?.verdict === "ok";

  const canAdvance = () => {
    if (step === 2) return lightingOk; // #16
    if (step === 3) return sheetDetected;
    if (step === 4) return fingersShown;
    if (step === 5) return step5Success;
    return true;
  };

  const isComplete = step > TOTAL_STEPS;

  // Start is only meaningful once there is a frame to capture and a detector
  // to run on it (#12, #13).
  const canCapture = cameraReady && frameReady && landmarkerStatus === "ready";

  // Counting down right now?
  const isCounting = countdown !== null && countdown > 0;
  const isInteractiveStep = step === 2 || step === 3 || step === 4 || step === 5;
  const showPreviousStep = !isComplete && step > 1 && !isCounting;
  const showExitCalibration = step === 1;
  // Step 1 is settings only; every later step asks the user to judge the camera feed.
  const showNextStep =
    !isComplete && (!isInteractiveStep || canAdvance()) && (step === 1 || cameraReady);

  // ── Camera overlays per step ──────────────────────────────────────────────
  const renderCameraOverlay = () => {
    if (isComplete) return null;

    if (step === 1) return null;

    // ── Step 2: lighting ──
    if (step === 2) {
      if (!lighting) {
        return (
          <div className="absolute top-5 left-1/2 -translate-x-1/2 bg-surface-dark px-4 py-2 rounded-full pointer-events-none">
            <span className="text-white text-[16px] font-sans">Measuring lighting…</span>
          </div>
        );
      }
      return lighting.verdict === "ok" ? (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-success-strong px-4 py-2 rounded-full pointer-events-none">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="8" fill="var(--color-success)"/><path d="M5 9L7.5 12L13 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span className="text-white text-[16px] font-sans">{LIGHTING_MESSAGES.ok}</span>
        </div>
      ) : (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-surface-dark px-4 py-2 rounded-full pointer-events-none">
          <AlertTriangle />
          <p className="text-white text-[18px] font-sans">{LIGHTING_MESSAGES[lighting.verdict]}</p>
        </div>
      );
    }

    // ── Step 3: align paper ──
    if (step === 3) {
      return (
        <div className="absolute inset-0">
          {/* Paper error banner */}
          {paperError && (
            <div className="absolute top-5 left-1/2 -translate-x-1/2 z-20 bg-white rounded-[10px] shadow-xl px-5 py-4 flex items-start gap-3 w-[480px] max-w-[90%]">
              {/* Red triangle icon */}
              <svg className="shrink-0 mt-0.5" width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M12 3L22 20H2L12 3Z" fill="var(--color-danger)" />
                <line x1="12" y1="9" x2="12" y2="14" stroke="white" strokeWidth="2" strokeLinecap="round" />
                <circle cx="12" cy="17" r="1" fill="white" />
              </svg>
              <div className="flex flex-col gap-0.5">
                <p className="text-[15px] font-bold text-danger font-sans">ERROR: Paper position is not accepted</p>
                <p className="text-[14px] text-ink-subtle font-sans">Impossible placement. Click the &lsquo;?&rsquo; button for help</p>
              </div>
              <button
                onClick={() => setPaperError(false)}
                aria-label="Dismiss error"
                className="ml-auto shrink-0 text-ink-subtle hover:text-black text-[20px] leading-none transition-colors"
              >×</button>
            </div>
          )}

          {/* Marker-detection status */}
          {!paperError && sheetDetected && (
            <div className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-success-strong px-4 py-2 rounded-full pointer-events-none">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="8" fill="var(--color-success)"/><path d="M5 9L7.5 12L13 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span className="text-white text-[16px] font-sans">Piano sheet detected</span>
            </div>
          )}

          {!paperError && !sheetDetected && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-surface-dark px-5 py-2 rounded-full pointer-events-none text-center">
              <p className="text-white text-[15px] font-sans">
                Detected: {markerDetection?.observations.map(({ id }) => id).join(", ") || "none"}
                {" · "}
                Missing: {markerDetection?.missingIds.join(", ") || "0, 1, 2, 3"}
              </p>
            </div>
          )}
          {/* Help button */}
          {!isCounting && !fingersShown && (
            <button onClick={() => setShowHelpModal(true)} aria-label="Show help" className="absolute bottom-4 right-4 w-10 h-10 bg-white rounded-[6px] flex items-center justify-center text-black text-[18px] font-bold shadow hover:bg-gray-100 transition-colors">?</button>
          )}
        </div>
      );
    }

    // ── Step 4: hover hands ──
    if (step === 4) {
      const handNotDetected = showingImage && !fingersShown;
      return (
        <>
          {/* Instruction pill — only before countdown starts */}
          {!hasStarted && (
            <div className="absolute top-[35%] left-1/2 -translate-x-1/2 flex items-center gap-2 bg-surface-dark px-5 py-2 rounded-full pointer-events-none">
              <span className="text-white text-[16px] font-sans">Hover hands above the paper, then press Start</span>
            </div>
          )}

          {/* Success overlay */}
          {fingersShown && (
            <div className="absolute inset-0 flex flex-col items-center justify-start pt-[14%] gap-3 pointer-events-none">
              <div className="flex items-center gap-3 bg-surface-dark px-6 py-3 rounded-full">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><circle cx="14" cy="14" r="13" fill="var(--color-success)"/><path d="M8 14L11.5 18L20 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span className="text-white text-[26px] font-sans font-medium">Hands detected!</span>
              </div>
              <p className="rounded-full bg-surface-dark px-4 py-1 text-white text-[15px] font-sans">Click Next Step to continue</p>
            </div>
          )}

          {/* Status banner: capture failure, detector failure, or no hands */}
          {(captureError || landmarkerStatus === "error" || handNotDetected) && (
            <div className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-surface-dark px-4 py-2 rounded-full">
              <AlertTriangle />
              <p className="text-white text-[18px] font-sans pointer-events-none">
                {captureError ??
                  (landmarkerStatus === "error"
                    ? "Hand detection failed to load."
                    : "No hands detected. Try again")}
              </p>
              {landmarkerStatus === "error" && (
                <button
                  onClick={reloadLandmarker}
                  className="rounded-[6px] border border-white px-3 py-1 text-[15px] font-sans text-white transition-[background-color,transform] hover:bg-white/15 active:scale-[0.97]"
                >
                  Reload
                </button>
              )}
            </div>
          )}

          {/* Waiting on the detector or the first decoded frame */}
          {!hasStarted && landmarkerStatus === "loading" && (
            <div className="absolute top-5 left-1/2 -translate-x-1/2 bg-surface-dark px-4 py-2 rounded-full pointer-events-none">
              <p className="text-white text-[16px] font-sans">Loading hand detection…</p>
            </div>
          )}
          {!hasStarted && landmarkerStatus === "ready" && cameraReady && !frameReady && (
            <div className="absolute top-5 left-1/2 -translate-x-1/2 bg-surface-dark px-4 py-2 rounded-full pointer-events-none">
              <p className="text-white text-[16px] font-sans">Waiting for the camera…</p>
            </div>
          )}

          {/* Help button */}
          {!isCounting && !step5Success && (
            <button onClick={() => setShowHelpModal(true)} aria-label="Show help" className="absolute bottom-4 right-4 w-10 h-10 bg-white rounded-[6px] flex items-center justify-center text-black text-[18px] font-bold shadow hover:bg-gray-100 transition-colors">?</button>
          )}
        </>
      );
    }

    // ── Step 5: hands on paper ──
    if (step === 5) {
      return (
        <>
          {/* Instruction pill — before the first capture */}
          {!hasStarted && !step5Success && (
            <div className="absolute top-[35%] left-1/2 -translate-x-1/2 flex items-center gap-2 bg-surface-dark px-5 py-2 rounded-full pointer-events-none">
                  <span className="text-white text-[16px] font-sans">Capture your right hand at the four corners and center</span>
            </div>
          )}

          {/* Success overlay */}
          {step5Success && (
            <div className="absolute inset-0 flex flex-col items-center justify-start pt-[14%] gap-3 pointer-events-none">
              <div className="flex items-center gap-3 bg-surface-dark px-6 py-3 rounded-full">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><circle cx="14" cy="14" r="13" fill="var(--color-success)"/><path d="M8 14L11.5 18L20 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span className="text-white text-[26px] font-sans font-medium">Success!</span>
              </div>
              <p className="rounded-full bg-surface-dark px-4 py-1 text-white text-[15px] font-sans">Click Next Step to finish calibration</p>
            </div>
          )}

          {/* Help button */}
          <button onClick={() => setShowHelpModal(true)} aria-label="Show help" className="absolute bottom-4 right-4 w-10 h-10 bg-white rounded-[6px] flex items-center justify-center text-black text-[18px] font-bold shadow hover:bg-gray-100 transition-colors">?</button>
        </>
      );
    }

    return null;
  };

  // ── Single fullscreen countdown (steps 4 & 5) ────────────────────────────
  const renderCountdown = () => {
    if (!isCounting || isComplete) return null;
    if (step !== 4 && step !== 5) return null;
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-40 pointer-events-none">
        <span className="text-white font-bold drop-shadow-lg" style={{ fontSize: "clamp(80px,20vw,150px)" }}>
          {countdown}
        </span>
      </div>
    );
  };

  // ── Help modal ────────────────────────────────────────────────────────────
  const renderHelpModal = () => {
    if (!showHelpModal) return null;
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="relative w-[88%] max-w-[640px] overflow-hidden rounded-[8px] shadow-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hand-reference.png" alt="Hand positioning reference" className="w-full block" style={{ aspectRatio: "16/9", objectFit: "cover" }} />
          <div className="absolute bottom-0 left-0 right-0 bg-black/75 px-5 py-3 flex items-center justify-between">
            <p className="text-white text-[17px] font-sans">Position your hands on the paper like this</p>
            <div aria-hidden="true" className="w-8 h-8 bg-white rounded-[4px] flex items-center justify-center text-black text-[14px] font-bold">?</div>
          </div>
          <button onClick={() => setShowHelpModal(false)} aria-label="Close" className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center text-white text-[24px] font-bold hover:opacity-70 transition-opacity leading-none">×</button>
        </div>
      </div>
    );
  };

  // ── Bottom bar step content ───────────────────────────────────────────────
  const renderStepContent = () => {
    if (isComplete) {
      return (
        <div className="flex flex-wrap items-center gap-4">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><circle cx="14" cy="14" r="13" fill="var(--color-success)"/><path d="M8 14L11.5 18L20 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <p className="text-[18px] sm:text-[24px] text-black font-sans">Calibration captured. Keep the camera and sheet in place.</p>
        </div>
      );
    }

    if (step === 1) {
      return (
        <div className="flex items-center gap-5 flex-wrap">
          <p className="text-[18px] sm:text-[24px] text-black font-sans">Step 1: Current sheet — one octave, C3–C4</p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="octave-count" className="text-[13px] text-black font-sans"># of Octaves</label>
              <div className="relative">
                <select id="octave-count" value={octaves} onChange={(e) => setOctaves(e.target.value)} className="border border-control-border rounded-[8px] pl-3 pr-8 py-2 text-[15px] text-ink bg-white appearance-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black">
                  {OCTAVE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                </select>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"><ChevronDown /></div>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="starting-note" className="text-[13px] text-black font-sans">Starting Octave</label>
              <div className="relative">
                <select id="starting-note" value={startingNote} onChange={(e) => setStartingNote(e.target.value)} className="border border-control-border rounded-[8px] pl-3 pr-8 py-2 text-[15px] text-ink bg-white appearance-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black">
                  {NOTE_OPTIONS.map((n) => <option key={n}>{n}</option>)}
                </select>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"><ChevronDown /></div>
              </div>
            </div>
            <SuccessBadge label="Settings ready" />
          </div>
        </div>
      );
    }

    if (step === 2) {
      const pct = lighting ? Math.round(lighting.brightness * 100) : null;
      return (
        <div className="flex items-center gap-5 flex-wrap">
          <p className="text-[18px] sm:text-[24px] text-black font-sans">Step 2: Check your lighting</p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-[14px] text-ink-muted font-sans" aria-live="polite">
              Current: {pct === null ? "measuring…" : `${pct}% brightness`}
            </span>
            <span className="text-[14px] text-ink-muted font-sans">
              Target: {Math.round(MIN_BRIGHTNESS * 100)}–{Math.round(MAX_BRIGHTNESS * 100)}%
            </span>
            {lightingOk ? (
              <SuccessBadge label="Lighting OK" />
            ) : lighting ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-50 border border-red-300">
                <span className="text-[13px] text-red-600">{LIGHTING_MESSAGES[lighting.verdict]}</span>
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    if (step === 3) {
      return <div><p>Step 3: Show all four paper markers</p><button onClick={checkPaper} className="border rounded px-4 py-2">Check paper</button>{corners && <SuccessBadge label="Sheet geometry validated" />}</div>;
    }

    if (step === 4) {
      return (
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-[18px] sm:text-[24px] text-black font-sans">Step 4: Hover hands above paper for 3 s</p>
          {!fingersShown && (
            <button onClick={handleStartCountdown} disabled={isCounting || !canCapture} className="shrink-0 border-[1.5px] border-black bg-surface px-5 py-2 rounded-[8px] text-[20px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform] disabled:opacity-40 disabled:cursor-not-allowed">
              {hasStarted && !isCounting ? "Retry" : "Start"}
            </button>
          )}
          {!fingersShown && !canCapture && (
            <span className="text-[14px] text-ink-muted font-sans" aria-live="polite">
              {landmarkerStatus === "loading"
                ? "Loading hand detection…"
                : landmarkerStatus === "error"
                  ? "Hand detection unavailable"
                  : "Waiting for the camera…"}
            </span>
          )}
          {fingersShown && <SuccessBadge label="Hands detected" />}
        </div>
      );
    }

    if (step === 5) {
      return (
        <div className="flex flex-wrap items-center gap-4">
          <div className="w-full max-w-[720px]">
            <p className="mb-3 text-[18px] sm:text-[24px] text-black font-sans">
              Step 5: Calibrate depth at the four corners and center
            </p>
            {!step5Success && depthPositionIndex < DEPTH_CALIBRATION_POSITIONS.length && (
              <DepthCalibrationCapture
                position={DEPTH_CALIBRATION_POSITIONS[depthPositionIndex]}
                sampleCount={depthCollectorRef.current.getSampleCount(
                  DEPTH_CALIBRATION_POSITIONS[depthPositionIndex],
                )}
                disabled={depthCaptureBusy || !canCapture}
                onCapture={captureDepthPosition}
              />
            )}
            {depthCaptureMessage && (
              <p className="mt-2 text-[14px] text-ink-muted font-sans" aria-live="polite">
                {depthCaptureMessage}
              </p>
            )}
            {step5Success && <SuccessBadge label="Depth calibrated!" />}
          </div>
        </div>
      );
    }

    return null;
  };

  // The data attributes let the deployment smoke test wait for detectors.
  return (
    <div className="flex-1 bg-surface flex flex-col" data-hand-detection={landmarkerStatus} data-sheet-detector={sheetDetectorStatus}>
      {/* Main area */}
      <div className="flex flex-col lg:flex-row pl-[clamp(20px,4.2vw,61px)] pr-[clamp(12px,3.2vw,47px)]">
        {/* Camera */}
        <div className="w-full lg:w-auto lg:flex-1 aspect-video bg-surface-dark relative overflow-hidden">
          <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" style={{ display: showingImage ? "none" : "block" }} />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" style={{ display: showingImage ? "block" : "none" }} />
          <canvas
            ref={sheetOverlayCanvasRef}
            className="absolute inset-0 z-10 h-full w-full object-cover pointer-events-none"
            style={{
              display:
                step >= 3 && step <= TOTAL_STEPS && !showingImage
                  ? "block"
                  : "none",
            }}
          />
          {renderCountdown()}
          {cameraReady && renderCameraOverlay()}
          <CameraStatusOverlay />
          {renderHelpModal()}
        </div>

        <SideNav active="calibration" />
      </div>

      {isComplete && <button className="underline text-ink" onClick={() => {
        generationRef.current++; resultRef.current = null; hoverRef.current = null;
        setCorners(null); resetInteractiveStepState(); setStep(1);
      }}>Restart calibration</button>}
      {captureError && <p role="alert" className="px-6 text-danger">{captureError}</p>}
      {/* Step content row */}
      <div className="flex flex-wrap items-center gap-4 shrink-0 pl-[clamp(20px,4.2vw,61px)] pr-[clamp(12px,3.2vw,47px)] pt-[clamp(8px,2dvh,28px)] pb-[clamp(6px,1.5dvh,16px)]">
        {renderStepContent()}
      </div>

      {/* Bottom nav */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:flex items-center shrink-0 pl-[clamp(20px,3.8vw,56px)] pr-[clamp(12px,3.2vw,47px)] pb-[clamp(10px,2.5dvh,30px)]">
        {showExitCalibration ? (
          <Link href="/" className="justify-self-start shrink-0 border-[1.5px] border-black bg-surface px-4 sm:px-6 py-2 sm:py-3 rounded-[8px] text-[18px] sm:text-[22px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]">Exit Calibration</Link>
        ) : showPreviousStep ? (
          <button onClick={() => goToAdjacentStep(-1)} className="justify-self-start shrink-0 border-[1.5px] border-black bg-surface px-4 sm:px-6 py-2 sm:py-3 rounded-[8px] text-[18px] sm:text-[22px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]">Previous Step</button>
        ) : <div aria-hidden="true" />}

        <ProgressBar total={TOTAL_STEPS} current={isComplete ? TOTAL_STEPS : step} className="col-span-2 row-start-1 sm:col-auto sm:row-auto" />

        {isComplete ? (
          <button onClick={handleComplete} className="justify-self-end shrink-0 border-[1.5px] border-black bg-surface px-4 sm:px-6 py-2 sm:py-3 rounded-[8px] text-[18px] sm:text-[22px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]">Start Playing</button>
        ) : showNextStep ? (
          <button onClick={() => goToAdjacentStep(1)} className="justify-self-end shrink-0 border-[1.5px] border-black bg-surface px-4 sm:px-6 py-2 sm:py-3 rounded-[8px] text-[18px] sm:text-[22px] text-black font-sans transition-[background-color,transform] hover:bg-black/5 active:scale-[0.97]">
            Next Step
          </button>
        ) : <div aria-hidden="true" />}
      </div>
    </div>
  );
}
