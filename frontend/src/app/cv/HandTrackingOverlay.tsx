"use client";

import { useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type {
  HandObservation,
  NormalizedLandmark,
} from "../../cv/collision";
import {
  pipelineMetrics,
  acquireResource,
  recordCameraFrame,
  recordHandInference,
} from "../../diagnostics/performanceMetrics";
import { drawHandLandmarks } from "./handLandmarkDrawing";
import { WASM_PATH as VISION_WASM_PATH } from "../useHandLandmarker";


export default function HandTrackingOverlay({
  videoRef,
  onTrackingFailure,
  onLandmarks,
  showVisualDebug = false,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onTrackingFailure?: () => void;
  onLandmarks?: (hands: readonly HandObservation[]) => void;
  showVisualDebug?: boolean;
}) {
  const [status, setStatus] = useState("Loading MediaPipe…");
  const [handCount, setHandCount] = useState(0);
  const [fps, setFps] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const showVisualDebugRef = useRef(showVisualDebug);

  useEffect(() => {
    showVisualDebugRef.current = showVisualDebug;
    if (!showVisualDebug) {
      const canvas = canvasRef.current;
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [showVisualDebug]);

  useEffect(() => {
    let cancelled = false;
    let animationFrame = 0;
    let handLandmarker: HandLandmarker | null = null;
    let releaseModel: (() => void) | undefined;
    let lastHandCount = -1;
    let lastVideoTime = -1;
    let fpsStartTimestamp = 0;
    let fpsFrameCount = 0;

    const processFrame = (timestamp: number) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (fpsStartTimestamp === 0) fpsStartTimestamp = timestamp;
      fpsFrameCount += 1;
      if (showVisualDebugRef.current && timestamp - fpsStartTimestamp >= 1000) {
        setFps(
          Math.round(
            (fpsFrameCount * 1000) / (timestamp - fpsStartTimestamp),
          ),
        );
        fpsStartTimestamp = timestamp;
        fpsFrameCount = 0;
      }

      if (!cancelled && video && canvas && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        if (pipelineMetrics.enabled) recordCameraFrame(performance.now());
        if (
          canvas.width !== video.videoWidth ||
          canvas.height !== video.videoHeight
        ) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        const context = showVisualDebugRef.current ? canvas.getContext("2d") : null;
        const inferenceStartedAt = pipelineMetrics.enabled ? performance.now() : null;
        let result;
        try {
          result = handLandmarker?.detectForVideo(video, timestamp);
        } catch {
          onTrackingFailure?.();
          setStatus("Tracking failed. Reload to retry.");
          return;
        }
        if (result && inferenceStartedAt !== null) {
          recordHandInference(performance.now() - inferenceStartedAt);
        }
        if (context) {
          context.clearRect(0, 0, canvas.width, canvas.height);
        }

        if (result && context) {
          drawHandLandmarks(
            context,
            result.landmarks,
            canvas.width,
            canvas.height,
          );
        }

        const hands: HandObservation[] = (result?.landmarks ?? []).map(
          (landmarks, index) => {
            const categoryName =
              result?.handednesses[index]?.[0]?.categoryName;
            return {
              landmarks: landmarks as readonly NormalizedLandmark[],
              handedness:
                categoryName === "Right" || categoryName === "Left"
                  ? categoryName
                  : "Unknown",
            };
          },
        );
        onLandmarks?.(hands);

        if (showVisualDebugRef.current && result && result.landmarks.length !== lastHandCount) {
          lastHandCount = result.landmarks.length;
          setHandCount(lastHandCount);
        }
      }

      if (!cancelled) {
        animationFrame = requestAnimationFrame(processFrame);
      }
    };

    const initialize = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(VISION_WASM_PATH);
        let createdHandLandmarker: HandLandmarker;
        let delegate = "GPU";

        try {
          createdHandLandmarker = await HandLandmarker.createFromOptions(
            vision,
            {
              baseOptions: {
                modelAssetPath: "/models/hand_landmarker.task",
                delegate: "GPU",
              },
              runningMode: "VIDEO",
              numHands: 2,
            },
          );
        } catch (gpuError) {
          console.warn(
            "GPU hand tracking is unavailable; falling back to CPU",
            gpuError,
          );
          delegate = "CPU";
          createdHandLandmarker = await HandLandmarker.createFromOptions(
            vision,
            {
              baseOptions: { modelAssetPath: "/models/hand_landmarker.task" },
              runningMode: "VIDEO",
              numHands: 2,
            },
          );
        }

        if (cancelled) {
          createdHandLandmarker.close();
          return;
        }

        handLandmarker = createdHandLandmarker;
        releaseModel = acquireResource("handModels");
        setStatus(`MediaPipe ready (${delegate})`);
        animationFrame = requestAnimationFrame(processFrame);
      } catch (error) {
        console.error("Unable to initialize MediaPipe hand tracking", error);
        setStatus("MediaPipe unavailable. Reload to retry.");
        onTrackingFailure?.();
      }
    };

    void initialize();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      handLandmarker?.close();
      releaseModel?.();
      pipelineMetrics.endFrameStream();
    };
  }, [onLandmarks, onTrackingFailure, videoRef]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 z-10 h-full w-full object-cover"
      />
      {showVisualDebug && (
        <div className="absolute left-4 top-4 z-20 rounded bg-black/70 px-3 py-2 text-sm text-white">
          {status} · Hands: {handCount}
          <br />
          FPS: {fps}
        </div>
      )}
    </>
  );
}
