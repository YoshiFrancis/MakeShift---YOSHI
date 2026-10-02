"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { acquireResource } from "../diagnostics/performanceMetrics";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

/**
 * Pinned to the installed @mediapipe/tasks-vision version. Using `@latest`
 * lets jsDelivr serve a WASM runtime that does not match the JS wrapper,
 * which fails at load time with no useful message.
 */
const TASKS_VISION_VERSION = "0.10.34";
export const WASM_PATH = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;

export type LandmarkerStatus = "loading" | "ready" | "error";

async function createLandmarker(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: "/models/hand_landmarker.task" },
    runningMode: "IMAGE",
    numHands: 2,
  });
}

/**
 * Loads one HandLandmarker and keeps it for the lifetime of the page, so
 * repeated calibration attempts reuse a single detector instead of building
 * (and leaking) a new one per capture. The detector is closed on unmount.
 */
export function useHandLandmarker() {
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const [status, setStatus] = useState<LandmarkerStatus>("loading");
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => {
    setStatus("loading");
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let created: HandLandmarker | null = null;
    let releaseModel: (() => void) | undefined;

    createLandmarker()
      .then((landmarker) => {
        created = landmarker;
        if (cancelled) {
          landmarker.close();
          return;
        }
        releaseModel = acquireResource("handModels");
        landmarkerRef.current = landmarker;
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        landmarkerRef.current = null;
        setStatus("error");
      });

    return () => {
      cancelled = true;
      created?.close();
      releaseModel?.();
      landmarkerRef.current = null;
    };
  }, [attempt]);

  /** Null until the detector has loaded. */
  const detect = useCallback((image: HTMLImageElement) => {
    return landmarkerRef.current?.detect(image) ?? null;
  }, []);

  return { status, detect, reload };
}
