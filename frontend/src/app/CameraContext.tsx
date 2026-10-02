"use client";

import { acquireResource } from "../diagnostics/performanceMetrics";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

/** Why the camera is unavailable. Drives the message the user sees. */
export type CameraErrorKind =
  | "permission-denied"
  | "no-device"
  | "device-in-use"
  | "disconnected"
  | "unsupported"
  | "unknown";

export type CameraStatus = "requesting" | "ready" | "error";

export interface CameraError {
  kind: CameraErrorKind;
  /** Short sentence naming the problem. */
  title: string;
  /** What the user can do about it. */
  detail: string;
}

interface CameraContextValue {
  stream: MediaStream | null;
  cameraReady: boolean;
  status: CameraStatus;
  error: CameraError | null;
  /** Request the camera again after a failure. */
  retry: () => void;
}

const CameraContext = createContext<CameraContextValue>({
  stream: null,
  cameraReady: false,
  status: "requesting",
  error: null,
  retry: () => {},
});

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { min: 1280, ideal: 1920 },
  height: { min: 720, ideal: 1080 },
  aspectRatio: { ideal: 16 / 9 },
  frameRate: { ideal: 30 },
};

function requestCameraStream(): Promise<MediaStream> {
  // Non-secure origins and older browsers expose no mediaDevices at all. Rejecting
  // here keeps every failure on one path instead of setting state from the effect body.
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(
      new DOMException("getUserMedia is unavailable", "NotSupportedError"),
    );
  }
  return navigator.mediaDevices.getUserMedia({
    video: VIDEO_CONSTRAINTS,
    audio: false,
  });
}

/**
 * getUserMedia rejects with a DOMException whose `name` identifies the cause.
 * Browsers disagree on the older aliases, so match both spellings.
 */
function describeError(err: unknown): CameraError {
  const name = err instanceof DOMException ? err.name : "";

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return {
        kind: "permission-denied",
        title: "Camera access blocked",
        detail:
          "MakeShift needs your camera to track your hands. Allow camera access in your browser's site settings, then try again.",
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return {
        kind: "no-device",
        title: "No camera found",
        detail:
          "Connect a camera and try again. If one is already plugged in, check that another app has not disabled it.",
      };
    case "NotReadableError":
    case "TrackStartError":
      return {
        kind: "device-in-use",
        title: "Camera is unavailable",
        detail:
          "Another application may be using the camera. Close it, then try again.",
      };
    case "NotSupportedError":
      return {
        kind: "unsupported",
        title: "Camera not supported",
        detail:
          "This browser cannot access cameras. Try a recent version of Chrome, Edge, Firefox, or Safari over HTTPS.",
      };
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return {
        kind: "no-device",
        title: "Camera does not meet requirements",
        detail:
          "MakeShift needs a camera that supports at least 1280x720. Try a different camera.",
      };
    default:
      return {
        kind: "unknown",
        title: "Could not start the camera",
        detail: "Something went wrong while starting the camera. Try again.",
      };
  }
}

/** Shown when a live track ends: unplugged device or permission revoked. */
const DISCONNECTED_ERROR: CameraError = {
  kind: "disconnected",
  title: "Camera disconnected",
  detail:
    "The camera stopped sending video. Reconnect it or re-allow access, then try again.",
};

export function CameraProvider({ children }: { children: React.ReactNode }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("requesting");
  const [error, setError] = useState<CameraError | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setStatus("requesting");
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    // A retry can land while an earlier request is still pending; ignore the loser
    // so a slow rejection cannot overwrite a newer successful stream.
    let cancelled = false;
    let acquired: MediaStream | null = null;
    const releases: (() => void)[] = [];

    requestCameraStream()
      .then((s) => {
        acquired = s;
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        s.getTracks().forEach(t => {
          const release = acquireResource("mediaTracks");
          t.addEventListener("ended", release, { once: true });
          releases.push(() => { t.removeEventListener("ended", release); release(); });
        });
        s.getVideoTracks().forEach((track) =>
          track.addEventListener("ended", () => {
            if (cancelled) return;
            setStream(null);
            setError(DISCONNECTED_ERROR);
            setStatus("error");
          }),
        );
        setStream(s);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setStream(null);
        setError(describeError(err));
        setStatus("error");
      });

    const stopTracks = () => {
      acquired?.getTracks().forEach((t) => t.stop());
      releases.forEach(release => release());
    };
    window.addEventListener("beforeunload", stopTracks);

    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", stopTracks);
      stopTracks();
    };
  }, [attempt]);

  return (
    <CameraContext.Provider
      value={{ stream, cameraReady: status === "ready", status, error, retry }}
    >
      {children}
    </CameraContext.Provider>
  );
}

export function useCamera() {
  return useContext(CameraContext);
}
