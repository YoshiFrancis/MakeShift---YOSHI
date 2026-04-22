"use client";

import { createContext, useContext, useEffect, useState } from "react";

interface CameraContextValue {
  stream: MediaStream | null;
  cameraReady: boolean;
}

const CameraContext = createContext<CameraContextValue>({
  stream: null,
  cameraReady: false,
});

export function CameraProvider({ children }: { children: React.ReactNode }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    let mediaStream: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          aspectRatio: 16 / 9,
        },
        audio: false,
      })
      .then((s) => {
        mediaStream = s;
        setStream(s);
        setCameraReady(true);
      })
      .catch(() => {});

    const handleBeforeUnload = () => {
      mediaStream?.getTracks().forEach((t) => t.stop());
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      mediaStream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <CameraContext.Provider value={{ stream, cameraReady }}>
      {children}
    </CameraContext.Provider>
  );
}

export function useCamera() {
  return useContext(CameraContext);
}
