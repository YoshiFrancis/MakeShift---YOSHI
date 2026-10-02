"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCamera } from "./CameraContext";
import { cameraSignature, loadCalibration, markerCorners, MARKER_ACQUIRE_INTERVAL_MS, MARKER_CHECK_INTERVAL_MS } from "../cv/calibration";
import {
  getWhiteKeyPolygons,
  PIANO_CORNERS,
  pressWhiteKey,
  releaseWhiteKey,
} from "../cv/keyboardGeometry";
import { getKeyCollisions, updateKeyTransitions } from "../cv/collision";
import type { Fingertip } from "../cv/collision";
import type { HandObservation } from "../cv/collision";
import type { FingerContactState } from "../cv/combinedContact";
import {
  KNUCKLE_PLAYING_MARGIN_Y,
  KNUCKLE_ELIGIBILITY_HYSTERESIS_Y,
} from "../cv/contactPipeline";
import {
  CONTACT_TECHNIQUES,
  LiveContactPipeline,
  SHADOW_CROP_RADIUS,
} from "../cv/liveContactPipeline";
import {
  getKnuckleBoundaryY,
  getKnuckleDistance,
  DEPTH_FINGERS,
} from "../cv/depthCalibration";
import type { PersistedDepthCalibration } from "../cv/depthCalibration";
import {
  SHADOW_CUTOFF_OFFSET_Y,
  SHADOW_PRESS_ABSOLUTE_AREA_PIXELS,
  SHADOW_PRESS_AREA_RATIO,
} from "../cv/shadowHeuristics";
import type { ShadowContactState, ShadowState } from "../cv/shadowHeuristics";
import { MarkerDetector } from "../cv/markerDetector";
import {
  computeHomography,
  invertHomography,
  projectPoint,
  type Homography,
} from "../cv/homography";
import type { MarkerDetectionResult } from "../cv/types";
import type { Point } from "../cv/types";
import { keyIndexToMidi } from "../cv/noteMap";
import {
  recordMarkerDetection,
  pipelineMetrics,
} from "../diagnostics/performanceMetrics";

const PAGE_CORNERS: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const KNUCKLE_LANDMARK_INDICES = [5, 9, 13, 17] as const;
const SHADOW_PREVIEW_RADIUS = SHADOW_CROP_RADIUS;
const SHADOW_PREVIEW_SIZE = 280;

function drawShadowSamplingGuides(
  context: CanvasRenderingContext2D,
  center: Point,
  scale = 1,
) {
  const style = getComputedStyle(context.canvas);
  const x = Math.round(center.x);
  const y = Math.round(center.y);
  context.save();
  context.lineWidth = 2 / scale;
  context.strokeStyle = style.getPropertyValue("--color-accent-light").trim();
  context.strokeRect(
    x - SHADOW_PREVIEW_RADIUS,
    y - SHADOW_PREVIEW_RADIUS,
    SHADOW_PREVIEW_RADIUS * 2,
    SHADOW_PREVIEW_RADIUS * 2,
  );
  context.setLineDash([6 / scale, 4 / scale]);
  context.beginPath();
  context.moveTo(x - SHADOW_PREVIEW_RADIUS, y + SHADOW_CUTOFF_OFFSET_Y);
  context.lineTo(x + SHADOW_PREVIEW_RADIUS, y + SHADOW_CUTOFF_OFFSET_Y);
  context.stroke();
  context.setLineDash([]);
  context.strokeStyle = style.getPropertyValue("--color-white").trim();
  context.beginPath();
  context.moveTo(center.x - 4 / scale, center.y);
  context.lineTo(center.x + 4 / scale, center.y);
  context.moveTo(center.x, center.y - 4 / scale);
  context.lineTo(center.x, center.y + 4 / scale);
  context.stroke();
  context.restore();
}

interface FingerDebugState {
  id: string;
  handIndex: number;
  finger: string;
  state: FingerContactState;
  keyOverlap: boolean;
  knuckleEligible: boolean;
  fingertipVideo: Point;
  fingertipSheet: Point | null;
  fingertipZ: number | undefined;
  knuckleDistance: number | null;
  knuckles: Point[];
  shadow: ShadowState;
  shadowStrength: number | null;
  shadowLumaChange: number | null;
  shadowDarkArea: number | null;
  shadowContourArea: number | null;
  shadowContact: ShadowContactState;
  shadowPeakArea: number | null;
  shadowAreaRatio: number | null;
}

export default function MarkerTrackingOverlay({
  videoRef,
  fingertips,
  hands = [],
  depthCalibration = null,
  onKeyTransitions,
  trackingEnabled = false,
  onCalibrationObservation,
  activePitches,
  showVisualDebug = false,
  debugShowSheetWithoutCalibration = false,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  fingertips: readonly Fingertip[];
  hands?: readonly HandObservation[];
  depthCalibration?: PersistedDepthCalibration | null;
  activePitches: ReadonlySet<number>;
  onKeyTransitions?: (pressed: readonly number[], released: readonly number[]) => void;
  trackingEnabled?: boolean;
  showVisualDebug?: boolean;
  debugShowSheetWithoutCalibration?: boolean;
  onCalibrationObservation: (saved: unknown, camera: ReturnType<typeof cameraSignature>, corners: Point[] | null) => boolean;
}) {
  const { stream, cameraReady } = useCamera();
  const [markerDetection, setMarkerDetection] =
    useState<MarkerDetectionResult | null>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const shadowPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const shadowMaskCanvasRef = useRef<HTMLCanvasElement>(null);
  const shadowMaskSourceRef = useRef<HTMLCanvasElement>(null);
  const pipelineRef = useRef<LiveContactPipeline | null>(null);
  const [shadowWorkerError, setShadowWorkerError] = useState<string | null>(
    null,
  );
  const [shadowMaskCount, setShadowMaskCount] = useState(0);
  const [shadowPreviewMode, setShadowPreviewMode] = useState<"mask" | "camera">(
    "mask",
  );
  const homographyRef = useRef<Homography | null>(null);
  const projectedPianoCornersRef = useRef<Point[] | null>(null);
  const projectedWhiteKeysRef = useRef<Point[][] | null>(null);
  const displayPianoCornersRef = useRef<Point[] | null>(null);
  const displayWhiteKeysRef = useRef<Point[][] | null>(null);
  const markerDetectionRef = useRef<MarkerDetectionResult | null>(null);
  const previousKeysRef = useRef<Set<number>>(new Set());
  const previousHighlightedKeysRef = useRef<Set<number>>(new Set());
  const trackingEnabledRef = useRef(false);
  const onKeyTransitionsRef = useRef(onKeyTransitions);
  const showVisualDebugRef = useRef(showVisualDebug);
  const [highlightedKeyIndexes, setHighlightedKeyIndexes] = useState<number[]>(
    [],
  );
  const [fingerDebug, setFingerDebug] = useState<FingerDebugState[]>([]);
  const shadowPreviewFinger =
    !showVisualDebug || !CONTACT_TECHNIQUES.shadows
      ? undefined
      : (fingertips.find(
          (finger) =>
            finger.landmarkIndex === 8 &&
            hands[finger.handIndex]?.handedness === "Right",
        ) ?? fingertips.find((finger) => finger.landmarkIndex === 8));
  const shadowPreviewDebug = fingerDebug.find(
    (finger) => finger.id === shadowPreviewFinger?.id,
  );

  const syncContactKeys = useCallback(() => {
    const detectedKeys = new Set<number>();
    for (const [id, contact] of pipelineRef.current?.contacts ?? []) {
      if (!contact.active) continue;
      for (const key of pipelineRef.current?.gates.get(id)?.keyIndexes ?? [])
        detectedKeys.add(key);
    }
    const currentKeys = trackingEnabledRef.current
      ? detectedKeys
      : new Set<number>();
    const transitions = updateKeyTransitions(
      previousKeysRef.current,
      currentKeys,
    );
    previousKeysRef.current = currentKeys;
    if (transitions.pressed.length || transitions.released.length) {
      onKeyTransitionsRef.current?.(transitions.pressed, transitions.released);
    }
    // Camera feedback is useful even before recording starts or while paused.
    const highlights = updateKeyTransitions(
      previousHighlightedKeysRef.current,
      detectedKeys,
    );
    previousHighlightedKeysRef.current = detectedKeys;
    if (highlights.pressed.length || highlights.released.length) {
      queueMicrotask(() => setHighlightedKeyIndexes([...detectedKeys]));
    }
  }, []);

  useEffect(() => {
    if (!trackingEnabled && previousKeysRef.current.size > 0) {
      onKeyTransitions?.([], [...previousKeysRef.current]);
      // A new playback session treats held keys as fresh presses.
      previousKeysRef.current = new Set();
    }
  }, [onKeyTransitions, trackingEnabled]);

  useEffect(() => {
    showVisualDebugRef.current = showVisualDebug;
  }, [showVisualDebug]);

  useEffect(() => {
    onKeyTransitionsRef.current = onKeyTransitions;
  }, [onKeyTransitions]);

  useEffect(() => {
    trackingEnabledRef.current = trackingEnabled;
    pipelineRef.current?.reset();
  }, [depthCalibration, trackingEnabled]);

  useEffect(() => {
    const pipeline = new LiveContactPipeline({
      onContactsChanged: (refreshDebug) => {
        syncContactKeys();
        if (!refreshDebug || !showVisualDebugRef.current) return;
        setFingerDebug((current) =>
          current.map((finger) => {
            const observation = pipeline.observations.get(finger.id);
            const contact = pipeline.shadowContacts.get(finger.id);
            return {
              ...finger,
              state: pipeline.contacts.get(finger.id)?.state ?? "unavailable",
              ...(observation
                ? {
                    shadow: observation.state,
                    shadowStrength: observation.measurement.shadowStrength,
                    shadowLumaChange: observation.lumaChange,
                    shadowDarkArea: observation.measurement.darkArea,
                    shadowContourArea: observation.contour?.areaPixels ?? null,
                    shadowContact: contact?.state ?? "unknown",
                    shadowPeakArea: contact?.peakArea ?? null,
                    shadowAreaRatio: contact?.areaRatio ?? null,
                  }
                : {}),
            };
          }),
        );
      },
      onShadowCameraPreview: (crop, center) => {
        if (!showVisualDebugRef.current) return;
        const previewCanvas = shadowPreviewCanvasRef.current;
        const previewContext = previewCanvas?.getContext("2d");
        if (!previewCanvas || !previewContext) return;
        previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        if (!crop || crop.width === 0 || crop.height === 0) return;
        const cropLeft = Math.round(center.x) - SHADOW_CROP_RADIUS;
        const cropTop = Math.round(center.y) - SHADOW_CROP_RADIUS;
        const scale = previewCanvas.width / (SHADOW_CROP_RADIUS * 2);
        previewContext.imageSmoothingEnabled = false;
        previewContext.drawImage(
          crop,
          -cropLeft * scale,
          -cropTop * scale,
          crop.width * scale,
          crop.height * scale,
        );
        previewContext.save();
        previewContext.scale(scale, scale);
        drawShadowSamplingGuides(
          previewContext,
          {
            x: center.x - cropLeft,
            y: center.y - cropTop,
          },
          scale,
        );
        previewContext.restore();
      },
      onShadowPreview: (observation, contact) => {
        if (!showVisualDebugRef.current || !observation.mask) return;
        const maskCanvas = shadowMaskCanvasRef.current;
        const source = shadowMaskSourceRef.current;
        const maskContext = maskCanvas?.getContext("2d");
        if (!maskCanvas || !source || !maskContext) return;
        const mask = observation.mask;
        if (source.width !== mask.width) source.width = mask.width;
        if (source.height !== mask.height) source.height = mask.height;
        const sourceContext = source.getContext("2d");
        if (!sourceContext) return;
        sourceContext.putImageData(mask, 0, 0);
        maskContext.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        maskContext.imageSmoothingEnabled = false;
        maskContext.drawImage(
          source,
          0,
          0,
          maskCanvas.width,
          maskCanvas.height,
        );
        const style = getComputedStyle(maskCanvas);
        const scaleX = maskCanvas.width / mask.width;
        const scaleY = maskCanvas.height / mask.height;
        maskContext.save();
        maskContext.fillStyle = style
          .getPropertyValue(
            contact?.state === "press candidate"
              ? "--color-success"
              : "--color-info",
          )
          .trim();
        for (const index of observation.contour?.boundary ?? []) {
          maskContext.fillRect(
            (index % mask.width) * scaleX,
            Math.floor(index / mask.width) * scaleY,
            scaleX,
            scaleY,
          );
        }
        maskContext.strokeStyle = style
          .getPropertyValue("--color-accent-light")
          .trim();
        maskContext.lineWidth = 2;
        maskContext.setLineDash([6, 4]);
        const cutoffY = (mask.height / 2 + SHADOW_CUTOFF_OFFSET_Y) * scaleY;
        maskContext.beginPath();
        maskContext.moveTo(0, cutoffY);
        maskContext.lineTo(maskCanvas.width, cutoffY);
        maskContext.stroke();
        maskContext.restore();
        setShadowMaskCount((count) => count + 1);
      },
      onError: (message) => {
        setShadowWorkerError(message);
        if (showVisualDebugRef.current)
          setFingerDebug((current) =>
            current.map((finger) => ({
              ...finger,
              state: "unavailable",
              shadowContact: "unknown",
            })),
          );
      },
    });
    pipelineRef.current = pipeline;
    pipeline.start();
    return () => {
      pipeline.dispose();
      pipelineRef.current = null;
    };
  }, [syncContactKeys]);

  useEffect(() => {
    let cancelled = false;
    let animationFrame = 0;
    let detector: MarkerDetector | null = null;
    let lastDetectionTime = -Infinity;

    const detect = (time: number) => {
      const video = videoRef.current;
      const processingCanvas = processingCanvasRef.current;

      if (!cancelled) {
        if (video && processingCanvas && video.readyState >= 2) {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            if (
              processingCanvas.width !== video.videoWidth ||
              processingCanvas.height !== video.videoHeight
            ) {
              processingCanvas.width = video.videoWidth;
              processingCanvas.height = video.videoHeight;
            }

            const overlayCanvas = overlayCanvasRef.current;
            if (overlayCanvas) {
              if (
                overlayCanvas.width !== video.videoWidth ||
                overlayCanvas.height !== video.videoHeight
              ) {
                overlayCanvas.width = video.videoWidth;
                overlayCanvas.height = video.videoHeight;
              }
            }

            const markerInterval =
              markerDetectionRef.current?.missingIds.length === 0
                ? MARKER_CHECK_INTERVAL_MS
                : MARKER_ACQUIRE_INTERVAL_MS;
            if (time - lastDetectionTime >= markerInterval) {
              const context = processingCanvas.getContext("2d");
              if (context && detector) {
                context.drawImage(
                  video,
                  0,
                  0,
                  processingCanvas.width,
                  processingCanvas.height,
                );
                const detectionStartedAt = pipelineMetrics.enabled ? performance.now() : null;
                try {
                  const detection = detector.detect(processingCanvas);
                  if (detectionStartedAt !== null) recordMarkerDetection(
                    performance.now() - detectionStartedAt,
                  );
                  markerDetectionRef.current = detection;
                  setMarkerDetection(detection);
                } catch {
                  markerDetectionRef.current = null;
                  setMarkerDetection(null);
                }
                lastDetectionTime = time;
              }
            }
          }
        }
        if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
          markerDetectionRef.current = null;
          setMarkerDetection(null);
          lastDetectionTime = -Infinity;
        }
        animationFrame = requestAnimationFrame(detect);
      }
    };

    MarkerDetector.create()
      .then((createdDetector) => {
        if (cancelled) {
          createdDetector.dispose();
          return;
        }
        detector = createdDetector;
        animationFrame = requestAnimationFrame(detect);
      })
      .catch((error: unknown) => {
        console.error("Unable to initialize ArUco marker detector", error);
        setMarkerDetection(null);
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      detector?.dispose();
    };
  }, [videoRef, stream, cameraReady]);

  useEffect(() => {
    const camera = cameraReady ? cameraSignature(stream, videoRef.current) : null;
    const corners = camera && markerDetection ? markerCorners(markerDetection, camera) : null;
    const saved = loadCalibration();

    let homography: Homography | null = null;
    let projectedPianoCorners: Point[] | null = null;
    let projectedWhiteKeys: Point[][] | null = null;
    if (markerDetection?.missingIds.length === 0) {
      const markerCenters = new Map(
        markerDetection.observations.map((observation) => [
          observation.id,
          observation.center,
        ]),
      );
      const markerPoints = [0, 1, 2, 3].map((id) => markerCenters.get(id));
      if (markerPoints.every((point): point is Point => point !== undefined)) {
        homography = computeHomography(PAGE_CORNERS, markerPoints);
      }
      if (homography) {
        const piano = PIANO_CORNERS.map((corner) =>
          projectPoint(homography!, corner),
        );
        const keys = getWhiteKeyPolygons().map((key) =>
          key.map((corner) => projectPoint(homography!, corner)),
        );
        if (
          piano.every((corner): corner is Point => corner !== null) &&
          keys.every((key) => key.every((corner) => corner !== null))
        ) {
          projectedPianoCorners = piano;
          projectedWhiteKeys = keys as Point[][];
        } else {
          homography = null;
        }
      }
    }

    const valid = onCalibrationObservation(saved, camera, corners);
    if (
      (valid || debugShowSheetWithoutCalibration) &&
      projectedPianoCorners &&
      projectedWhiteKeys
    ) {
      displayPianoCornersRef.current = projectedPianoCorners;
      displayWhiteKeysRef.current = projectedWhiteKeys;
    }
    if (!valid) {
      if (previousKeysRef.current.size) onKeyTransitions?.([], [...previousKeysRef.current]);
      previousKeysRef.current = new Set();
      if (
        debugShowSheetWithoutCalibration &&
        homography &&
        projectedPianoCorners &&
        projectedWhiteKeys
      ) {
        // The debug switch enables marker-derived overlap visualization only;
        // session readiness still gates note dispatch in syncContactKeys.
        homographyRef.current = homography;
        projectedPianoCornersRef.current = projectedPianoCorners;
        projectedWhiteKeysRef.current = projectedWhiteKeys;
      } else {
        homographyRef.current = null;
        projectedPianoCornersRef.current = null;
        projectedWhiteKeysRef.current = null;
      }
      return;
    }
    if (!homography || !projectedPianoCorners || !projectedWhiteKeys) return;

    homographyRef.current = homography;
    projectedPianoCornersRef.current = projectedPianoCorners;
    projectedWhiteKeysRef.current = projectedWhiteKeys;
  }, [markerDetection, stream, cameraReady, videoRef, onCalibrationObservation, onKeyTransitions, debugShowSheetWithoutCalibration]);

  useEffect(() => {
    const inverseHomography = homographyRef.current
      ? invertHomography(homographyRef.current)
      : null;
    const pipeline = pipelineRef.current;
    if (!pipeline) return;
    const video = videoRef.current;
    // The complete live pipeline runs here: overlap -> knuckles -> shadows.
    const detectionStartedAt = pipelineMetrics.enabled ? performance.now() : null;
    const capturedShadowFrame = pipeline.processFrame({
      video,
      fingertips,
      hands,
      whiteKeys: projectedWhiteKeysRef.current,
      calibration: depthCalibration,
      previewFingerId: shadowPreviewFinger?.id ?? null,
    });
    if (detectionStartedAt !== null) {
      pipelineMetrics.record("detection", performance.now() - detectionStartedAt);
    }

    const nextDebug: FingerDebugState[] = [];
    if (showVisualDebug)
      for (const fingertip of fingertips) {
        const hand = hands[fingertip.handIndex];
        const fingerIndex = [4, 8, 12, 16, 20].indexOf(fingertip.landmarkIndex);
        const gate = pipeline.gates.get(fingertip.id);
        if (!hand || fingerIndex < 0 || !gate) continue;
        const shadowObservation = pipeline.observations.get(fingertip.id);
        const shadowContact = pipeline.shadowContacts.get(fingertip.id);
        nextDebug.push({
          id: fingertip.id,
          handIndex: fingertip.handIndex,
          finger: DEPTH_FINGERS[fingerIndex],
          state: pipeline.contacts.get(fingertip.id)?.state ?? "unavailable",
          keyOverlap: gate.keyIndexes.length > 0,
          knuckleEligible: gate.knuckleEligible,
          fingertipVideo: fingertip.point,
          fingertipSheet: inverseHomography
            ? projectPoint(inverseHomography, fingertip.point)
            : null,
          fingertipZ: hand.landmarks[fingertip.landmarkIndex]?.z,
          knuckleDistance: CONTACT_TECHNIQUES.knuckles
            ? getKnuckleDistance(hand.landmarks)
            : null,
          knuckles: KNUCKLE_LANDMARK_INDICES.map((index) => ({
            x: hand.landmarks[index]?.x ?? 0,
            y: hand.landmarks[index]?.y ?? 0,
          })),
          shadow: shadowObservation?.state ?? "unknown",
          shadowStrength: shadowObservation?.measurement.shadowStrength ?? null,
          shadowLumaChange: shadowObservation?.lumaChange ?? null,
          shadowDarkArea: shadowObservation?.measurement.darkArea ?? null,
          shadowContourArea: shadowObservation?.contour?.areaPixels ?? null,
          shadowContact: shadowContact?.state ?? "unknown",
          shadowPeakArea: shadowContact?.peakArea ?? null,
          shadowAreaRatio: shadowContact?.areaRatio ?? null,
        });
      }

    const preview = shadowPreviewCanvasRef.current;
    const previewContext = preview?.getContext("2d");
    if (preview && previewContext && !shadowPreviewFinger)
      previewContext.clearRect(0, 0, preview.width, preview.height);
    const maskCanvas = shadowMaskCanvasRef.current;
    const maskContext = maskCanvas?.getContext("2d");
    if (
      maskCanvas &&
      maskContext &&
      (capturedShadowFrame || !shadowPreviewFinger)
    ) {
      maskContext.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    }
    // This state is the intentionally derived data shown in the prototype debug panel.
    if (showVisualDebug) queueMicrotask(() => setFingerDebug(nextDebug));

    // Console logging is intentionally disabled while tuning the visual prototype.
  }, [
    depthCalibration,
    fingertips,
    hands,
    markerDetection,
    shadowPreviewFinger,
    showVisualDebug,
    syncContactKeys,
    trackingEnabled,
    videoRef,
  ]);

  useEffect(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const video = videoRef.current;
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      if (overlay.width !== video.videoWidth) overlay.width = video.videoWidth;
      if (overlay.height !== video.videoHeight)
        overlay.height = video.videoHeight;
    }

    const context = overlay.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, overlay.width, overlay.height);

    const colors = getComputedStyle(document.documentElement);
    const accent = colors.getPropertyValue("--color-accent").trim();
    const ink = colors.getPropertyValue("--color-ink").trim();
    const danger = colors.getPropertyValue("--color-danger").trim();
    const white = colors.getPropertyValue("--color-white").trim();

    context.lineWidth = 4;
    context.font = "bold 24px Arial";
    context.textBaseline = "bottom";

    if (showVisualDebug)
      markerDetection?.observations.forEach((observation) => {
        context.strokeStyle = "#00ff88";
        context.fillStyle = "#00ff88";
        context.beginPath();
        observation.corners.forEach((corner, index) => {
          if (index === 0) context.moveTo(corner.x, corner.y);
          else context.lineTo(corner.x, corner.y);
        });
        context.closePath();
        context.stroke();
        context.fillText(
          `ID ${observation.id}`,
          observation.center.x + 8,
          observation.center.y,
        );
      });

    const projectedPianoCorners = displayPianoCornersRef.current;
    const projectedWhiteKeys = displayWhiteKeysRef.current;

    if (projectedPianoCorners && projectedWhiteKeys) {
      context.beginPath();
      projectedPianoCorners.forEach((corner, index) => {
        if (index === 0) context.moveTo(corner.x, corner.y);
        else context.lineTo(corner.x, corner.y);
      });
      context.closePath();
      context.fillStyle = white;
      context.globalAlpha = 0.12;
      context.fill();
      context.globalAlpha = 1;
      context.strokeStyle = accent;
      context.lineWidth = 4;
      context.stroke();

      context.lineWidth = 3;
      const collidedKeys = new Set(highlightedKeyIndexes);

      projectedWhiteKeys.forEach((key, index) => {
        const pitch = keyIndexToMidi(index);
        const isPlaying = pitch !== null && activePitches.has(pitch);
        const isPressed = collidedKeys.has(index) || isPlaying;
        context.strokeStyle = isPressed ? danger : ink;
        if (isPressed) pressWhiteKey(context, key, danger);
        else releaseWhiteKey(context, key, white);
      });

      if (
        showVisualDebug &&
        CONTACT_TECHNIQUES.knuckles &&
        depthCalibration &&
        videoRef.current?.videoHeight
      ) {
        fingertips
          .filter(({ landmarkIndex }) =>
            [4, 8, 12, 16, 20].includes(landmarkIndex),
          )
          .forEach((fingertip) => {
            const keyOverlap =
              getKeyCollisions([fingertip], projectedWhiteKeys, 8).length > 0;
            if (!keyOverlap) return;
            const hand = hands[fingertip.handIndex];
            const landmark = hand?.landmarks[fingertip.landmarkIndex];
            const knuckleDistance = hand
              ? getKnuckleDistance(hand.landmarks)
              : null;
            if (!landmark || knuckleDistance === null) return;
            const fingerIndex = [4, 8, 12, 16, 20].indexOf(
              fingertip.landmarkIndex,
            );
            if (fingerIndex < 0) return;
            const finger = DEPTH_FINGERS[fingerIndex];
            const boundaryY = getKnuckleBoundaryY(
              depthCalibration,
              finger,
              knuckleDistance,
              true,
            );
            if (boundaryY === null) return;

            const eligibilityY =
              boundaryY -
              KNUCKLE_PLAYING_MARGIN_Y -
              (pipelineRef.current?.gates.get(fingertip.id)?.knuckleEligible
                ? KNUCKLE_ELIGIBILITY_HYSTERESIS_Y
                : 0);
            const screenY = eligibilityY * videoRef.current!.videoHeight;
            const calibrationDistances = Object.values(
              depthCalibration.knuckleDistances,
            );
            const outsideRange =
              knuckleDistance < Math.min(...calibrationDistances) ||
              knuckleDistance > Math.max(...calibrationDistances);
            context.save();
            const colors = [
              "#ff9f0a",
              "#ff375f",
              "#bf5af2",
              "#64d2ff",
              "#30d158",
            ];
            const color = colors[fingerIndex];
            context.strokeStyle = color;
            context.fillStyle = color;
            context.lineWidth = 3;
            context.setLineDash([16, 10]);
            context.beginPath();
            context.moveTo(0, screenY);
            context.lineTo(overlay.width, screenY);
            context.stroke();
            context.setLineDash([]);
            context.font = "bold 18px Arial";
            context.fillText(
              `${finger} knuckle eligibility${outsideRange ? " (outside range)" : ""}`,
              12,
              screenY - 8,
            );
            context.restore();
          });
      }
    }
    if (shadowPreviewFinger) {
      drawShadowSamplingGuides(context, shadowPreviewFinger.point);
    }
  }, [
    highlightedKeyIndexes,
    showVisualDebug,
    depthCalibration,
    fingerDebug,
    fingertips,
    hands,
    markerDetection,
    shadowPreviewFinger,
    videoRef,
    cameraReady,
    stream,
    trackingEnabled,
    activePitches
  ]);

  return (
    <>
      <canvas
        ref={overlayCanvasRef}
        width={1920}
        height={1080}
        className="absolute inset-0 z-10 h-full w-full object-cover pointer-events-none"
      />
      <canvas ref={processingCanvasRef} className="hidden" />
      {showVisualDebug && (
        <>
          <canvas ref={shadowMaskSourceRef} className="hidden" />
          <div className="absolute left-4 top-4 rounded bg-black/70 px-3 py-2 text-sm text-white">
            {markerDetection === null
              ? "Loading ArUco detector…"
              : markerDetection.missingIds.length === 0
                ? "All four ArUco boards detected"
                : `Missing IDs: ${markerDetection.missingIds.join(", ")}`}
          </div>
          <div className="absolute right-4 top-4 z-20 max-h-[70vh] max-w-[430px] overflow-auto rounded bg-black/80 px-3 py-2 font-mono text-xs text-white">
            <div className="mb-1 font-bold">Finger debug</div>
            <div className="mb-2">
              Techniques: knuckles {CONTACT_TECHNIQUES.knuckles ? "on" : "off"}{" "}
              · shadows {CONTACT_TECHNIQUES.shadows ? "on" : "off"}
            </div>
            {CONTACT_TECHNIQUES.shadows && (
              <div className="mb-3 border-b border-white/20 pb-2">
                <div className="mb-1 font-bold">
                  Index k-means preview
                  {shadowPreviewFinger
                    ? ` (H${shadowPreviewFinger.handIndex})`
                    : ""}
                </div>
                <div className="mb-2" role="status">
                  {shadowWorkerError
                    ? `Mask unavailable: ${shadowWorkerError}`
                    : !shadowPreviewFinger
                      ? "Show your index finger to start the mask."
                      : shadowMaskCount === 0
                        ? "Waiting for the first mask…"
                        : `Mask active · ${shadowMaskCount} frames received`}
                </div>
                <div className="mb-2 flex gap-2">
                  <button
                    type="button"
                    aria-pressed={shadowPreviewMode === "mask"}
                    onClick={() => setShadowPreviewMode("mask")}
                    className={`rounded px-2 py-1 ${shadowPreviewMode === "mask" ? "bg-white text-ink" : "bg-surface-dark text-white"}`}
                  >
                    Black / white
                  </button>
                  <button
                    type="button"
                    aria-pressed={shadowPreviewMode === "camera"}
                    onClick={() => setShadowPreviewMode("camera")}
                    className={`rounded px-2 py-1 ${shadowPreviewMode === "camera" ? "bg-white text-ink" : "bg-surface-dark text-white"}`}
                  >
                    Camera
                  </button>
                </div>
                <canvas
                  ref={shadowMaskCanvasRef}
                  width={SHADOW_PREVIEW_SIZE}
                  height={SHADOW_PREVIEW_SIZE}
                  aria-label="Black and white mask of the darkest color cluster in the index fingertip crop"
                  className={`${shadowPreviewMode === "mask" ? "block" : "hidden"} h-auto max-w-full bg-surface-dark`}
                />
                <canvas
                  ref={shadowPreviewCanvasRef}
                  width={SHADOW_PREVIEW_SIZE}
                  height={SHADOW_PREVIEW_SIZE}
                  aria-label="Magnified camera view of the index fingertip crop used for k-means"
                  className={`${shadowPreviewMode === "camera" ? "block" : "hidden"} h-auto max-w-full bg-surface-dark`}
                />
                <div className="mt-1">
                  Black: darkest color group. White: other groups.
                </div>
                <div>
                  Above purple dashed line: ignored. Outline: blue hover, green
                  candidate.
                </div>
                <div className="mt-1 font-bold">
                  Contour area: {shadowPreviewDebug?.shadowContourArea ?? "—"}{" "}
                  pixels
                </div>
                <div className="font-bold">
                  Shadow:{" "}
                  {shadowPreviewDebug && !shadowPreviewDebug.keyOverlap
                    ? "outside key"
                    : (shadowPreviewDebug?.shadowContact ?? "unknown")}
                </div>
                <div className="font-bold">
                  Contact:{" "}
                  {shadowPreviewDebug && !shadowPreviewDebug.keyOverlap
                    ? "outside key"
                    : (shadowPreviewDebug?.state ?? "unavailable")}
                </div>
                <div>
                  Peak: {shadowPreviewDebug?.shadowPeakArea ?? "—"} pixels ·
                  Ratio:{" "}
                  {shadowPreviewDebug?.shadowAreaRatio == null
                    ? "—"
                    : `${(shadowPreviewDebug.shadowAreaRatio * 100).toFixed(1)}%`}
                </div>
                <div>
                  Candidate: ratio ≤{SHADOW_PRESS_AREA_RATIO * 100}% or area
                  &lt;
                  {SHADOW_PRESS_ABSOLUTE_AREA_PIXELS} pixels.
                </div>
                <div>Ink and remaining skin may still appear black.</div>
                <div>
                  Camera view: purple box marks the crop; cross marks the
                  fingertip.
                </div>
              </div>
            )}
            <div className="mb-2 border-b border-white/20 pb-1">
              calibration={depthCalibration ? "ready" : "missing"} mapping=
              {markerDetection?.missingIds.length === 0 ? "ready" : "waiting"}
              <br />
              knuckle TL=
              {depthCalibration
                ? depthCalibration.knuckleDistances["top-left"].toFixed(5)
                : "n/a"}{" "}
              TR=
              {depthCalibration
                ? depthCalibration.knuckleDistances["top-right"].toFixed(5)
                : "n/a"}{" "}
              BL=
              {depthCalibration
                ? depthCalibration.knuckleDistances["bottom-left"].toFixed(5)
                : "n/a"}{" "}
              BR=
              {depthCalibration
                ? depthCalibration.knuckleDistances["bottom-right"].toFixed(5)
                : "n/a"}{" "}
              C=
              {depthCalibration
                ? depthCalibration.knuckleDistances.center.toFixed(5)
                : "n/a"}{" "}
              current={fingerDebug[0]?.knuckleDistance?.toFixed(5) ?? "n/a"}
            </div>
            {fingerDebug.length === 0 ? (
              <div>No hand data</div>
            ) : (
              fingerDebug.map((finger) => (
                <div key={finger.id} className="mb-1">
                  H{finger.handIndex} {finger.finger}:{" "}
                  {finger.keyOverlap ? finger.state : "outside key"}
                  <div>
                    overlap={finger.keyOverlap ? "yes" : "no"} · knuckles=
                    {CONTACT_TECHNIQUES.knuckles
                      ? finger.knuckleEligible
                        ? "yes"
                        : "no"
                      : "disabled"}{" "}
                    · shadow=
                    {CONTACT_TECHNIQUES.shadows
                      ? finger.shadowContact
                      : "disabled"}
                  </div>
                  {finger.shadowStrength === null
                    ? ""
                    : ` (area ${finger.shadowContourArea ?? "—"} px, dark ${((finger.shadowDarkArea ?? 0) * 100).toFixed(0)}%, Δ${
                        finger.shadowLumaChange?.toFixed(1) ?? "—"
                      })`}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </>
  );
}
