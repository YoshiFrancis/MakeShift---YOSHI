"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { useCamera } from "../CameraContext";

// ─── Progress bar configuration ───────────────────────────────────────────────
const TOTAL_STEPS = 5;
const CURRENT_STEP = 1;
const STEP_INSTRUCTION = "Click \"Start\" and hover your hands above the paper";
// ──────────────────────────────────────────────────────────────────────────────

function ChevronDown() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4 6L8 10L12 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="20" cy="20" r="18.5" stroke="#1e1e1e" strokeWidth="1.5" />
      <path d="M16 14L28 20L16 26V14Z" fill="#1e1e1e" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="20" cy="20" r="18.5" stroke="#1e1e1e" strokeWidth="1.5" />
      <rect x="13" y="13" width="14" height="14" fill="#1e1e1e" />
    </svg>
  );
}

function AlertTriangle() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M24 8L44 40H4L24 8Z"
        stroke="white"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <line
        x1="24"
        y1="22"
        x2="24"
        y2="32"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="24" cy="37" r="1.5" fill="white" />
    </svg>
  );
}

function ProgressBar({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex flex-1 items-center">
      {Array.from({ length: total }, (_, i) => {
        const stepNum = i + 1;
        const circleFilled = stepNum <= current;
        const barFilled = stepNum < current;
        return (
          <div key={i} className="flex flex-1 items-center last:flex-none">
            {/* Circle */}
            <div
              className={`shrink-0 size-[20px] rounded-full border-2 ${
                circleFilled
                  ? "bg-[#ffb645] border-[#ffb645]"
                  : "bg-[#ded4cb] border-[#ded4cb]"
              }`}
            />
            {/* Bar to next circle */}
            {i < total - 1 && (
              <div
                className={`flex-1 h-[10px] ${barFilled ? "bg-[#ffb645]" : "bg-[#ded4cb]"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Calibration() {
  const [metronome, setMetronome] = useState(true);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [fingersShown, setFingersShown] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [showingImage, setShowingImage] = useState(false);
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { stream } = useCamera();

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    // Check localStorage asynchronously to appease the strict linter rule
    const timer = setTimeout(() => {
      setIsCalibrated(localStorage.getItem("isCalibrated") === "true");
    }, 0);

    // Wipes the storage when the user hard-refreshes or closes the tab
    const handleBeforeUnload = () => {
      localStorage.removeItem("isCalibrated");
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  function canvasToImage(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => resolve(img);
      img.onerror = reject;

      img.src = canvas.toDataURL('image/png');
  });
}

  const capture = useCallback(async function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw current frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = await canvasToImage(canvas);
    return image;
  }, []);

  async function get_finger_skeleton(image : HTMLImageElement) {

    console.error("initializing model");
    const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

      const handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "/models/hand_landmarker.task"
      },
      runningMode: "IMAGE",
      numHands: 2
    });
    const res = handLandmarker.detect(image);

    const canvas = canvasRef.current;
    const video = videoRef.current;

    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const points = [4, 8, 12, 16, 20];
    if (res.landmarks) {
      let fingertips = 0;

      for (const hand of res.landmarks) {
        for (const idx of points) {
          const point = hand[idx];
          const x = point.x * canvas.width;
          const y = point.y * canvas.height;

          ctx.beginPath();
          ctx.arc(x, y, 20, 0, 2 * Math.PI);
          ctx.fillStyle = "red";
          ctx.fill();

          fingertips++;
        }
      }

      if (fingertips > 0) {
            setFingersShown(true);
      }
    }

    setShowingImage(true);
  }

  useEffect(() => {
    if (countdown === null || countdown < 0) return;
    else if (countdown === 0) {
      // get mediapipe overlay

      capture().then((image) => {
        if (image) {
          get_finger_skeleton(image).then(() => {
            console.log("W code");
          }); // run media pipe
        }
      }); // hand image
    }

    const timer = setTimeout(() => {
      setCountdown(countdown - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, capture]);

  const handleStartTimer = () => {
    setHasStarted(true);
    setCountdown(3);
    setShowingImage(false);
    setFingersShown(false);
  };

  const handleCompleteCalibration = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("isCalibrated", "true");
    }
    router.push("/");
  }

  return (
    <div className="flex-1 bg-[#fffdf7] flex flex-col">
      {/* Main area: camera + sidebar */}
      <div className="flex flex-1 pt-[115px] pl-[61px] pr-[47px]">
        {/* Camera feed with calibration overlays */}
        <div className="flex-1 bg-[#090909] relative">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
            style={{ display: showingImage ? 'none' : 'block' }}
          />
          <canvas
            ref={canvasRef}
            style={{ display: showingImage ? 'block' : 'none' }}
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Visual Countdown Overlay */}
          {countdown !== null && countdown > 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-50">
              <span className="text-white text-[150px] font-sans font-bold drop-shadow-lg">
                {countdown}
              </span>
            </div>
          )}

          {/* Warning banner */}
          <div className={`absolute top-[74px] left-[227px] flex items-center gap-[10px] bg-black/40 pr-3 pl-3 rounded-full ${
            (fingersShown || !showingImage) ? "hidden" : ""
          }`}>
            <AlertTriangle />
            <p className="text-white text-[37px] font-sans">
              Error: No fingers are visible
            </p>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="w-[267px] relative flex flex-col">
          {/* Piano key bars */}
          <div className="absolute left-0 top-[50px] flex flex-col gap-[24px] z-10 pointer-events-none">
            <div className="bg-black h-[46px] w-[140px] rounded-tr-[4px] rounded-br-[4px] shadow-[2px_1px_1px_0px_rgba(0,0,0,0.1)]" />
            <div className="bg-black h-[46px] w-[140px] rounded-tr-[4px] rounded-br-[4px] shadow-[2px_1px_1px_0px_rgba(0,0,0,0.1)]" />
          </div>

          {/* Nav tabs — Calibration is active */}
          <div className="flex flex-col">
            <div className="border border-black h-[72px] flex items-center justify-end pr-[19px] pl-[100px] rounded-tr-[8px] bg-[#ffe9c7] relative shadow-[inset_0px_4px_0px_0px_rgba(255,255,255,0.25),inset_0px_-15px_17.6px_0px_rgba(53,21,21,0.07)]">
              <span className="text-[20px] text-black font-sans whitespace-nowrap">
                Calibration
              </span>
            </div>
            <Link
              href="/tutorial"
              className="-mt-px border border-black h-[72px] flex items-center justify-end pr-[19px] pl-[100px] bg-[#fffdf7] relative shadow-[inset_0px_4px_0px_0px_rgba(255,255,255,0.25),inset_0px_-15px_17.6px_0px_rgba(53,21,21,0.07)]"
            >
              <span className="text-[20px] text-black font-sans whitespace-nowrap">
                Tutorial
              </span>
            </Link>
            <Link
              href="/documentation"
              className="-mt-px border border-black h-[72px] flex items-center justify-end pr-[19px] pl-[100px] rounded-br-[8px] bg-[#fffdf7] relative shadow-[inset_0px_4px_0px_0px_rgba(255,255,255,0.25),inset_0px_-15px_17.6px_0px_rgba(53,21,21,0.07)]"
            >
              <span className="text-[20px] text-black font-sans w-[66px]">
                Docs
              </span>
            </Link>
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-[42px] mt-[42px] pl-[43px]">
            <div className="flex flex-col gap-[23px]">
              {/* Set Tempo */}
              <div className="flex flex-col gap-2">
                <label className="text-[16px] text-[#1e1e1e] font-sans leading-[1.4]">
                  Set Tempo
                </label>
                <input
                  type="text"
                  defaultValue="120 BPM"
                  className="border border-[#d9d9d9] rounded-[8px] px-4 py-3 text-[16px] text-[#1e1e1e] bg-white w-[120px] leading-none outline-none"
                />
              </div>

              {/* Time Signature */}
              <div className="flex flex-col gap-2">
                <label className="text-[16px] text-[#1e1e1e] font-sans leading-[1.4]">
                  Time Signature
                </label>
                <div className="relative w-[120px]">
                  <select
                    defaultValue="4/4"
                    className="border border-[#d9d9d9] rounded-[8px] pl-4 pr-8 py-[10px] text-[16px] text-[#1e1e1e] bg-white w-full appearance-none leading-none outline-none cursor-pointer"
                  >
                    <option>4/4</option>
                    <option>3/4</option>
                    <option>6/8</option>
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[#1e1e1e]">
                    <ChevronDown />
                  </div>
                </div>
              </div>

              {/* Metronome toggle */}
              <div className="flex items-center gap-3">
                <span className="text-[16px] text-[#1e1e1e] font-sans leading-[1.4] whitespace-nowrap">
                  Metronome
                </span>
                <button
                  onClick={() => setMetronome(!metronome)}
                  className={`relative w-[40px] h-[24px] rounded-full transition-colors ${metronome ? "bg-[#1e1e1e]" : "bg-[#d9d9d9]"}`}
                  aria-label="Toggle metronome"
                >
                  <span
                    className={`absolute top-[2px] w-[20px] h-[20px] rounded-full bg-white shadow transition-transform ${metronome ? "translate-x-[18px]" : "translate-x-[2px]"}`}
                  />
                </button>
              </div>
            </div>

            {/* Play / Stop */}
            <div className="flex items-center gap-[27px]">
              <button
                aria-label="Play"
                disabled={!isCalibrated}
                className={`transition-opacity ${
                  !isCalibrated ? "opacity-30 cursor-not-allowed" : "hover:opacity-70"
                }`}
              >
                <PlayIcon />
              </button>
              <button
                aria-label="Stop"
                disabled={!isCalibrated}
                className={`transition-opacity ${
                  !isCalibrated ? "opacity-30 cursor-not-allowed" : "hover:opacity-70"
                }`}
              >
                <StopIcon />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Step instruction and Timer button */}
      <div className="flex items-center gap-6 pl-[61px] pr-[47px] pt-[35px] pb-[20px]">
        <p className="text-[30px] text-black font-sans">{STEP_INSTRUCTION}</p>
        <button
          onClick={handleStartTimer}
          className="shrink-0 border-[1.5px] border-black bg-[#fffdf7] px-6 py-3 rounded-[8px] text-[30px] text-black font-sans whitespace-nowrap hover:bg-black/5 transition-colors"
        >
          {hasStarted ? "Restart" : "Start"}
        </button>
      </div>

      {/* Bottom nav: Previous Step | progress bar | Next Step */}
      <div className="flex items-center gap-6 pl-[56px] pr-[47px] pb-[30px]">
        <Link
          href="/"
          className="shrink-0 border-[1.5px] border-black bg-[#fffdf7] px-6 py-3 rounded-[8px] text-[30px] text-black font-sans whitespace-nowrap hover:bg-black/5 transition-colors"
        >
          Exit Calibration
        </Link>

        <ProgressBar total={TOTAL_STEPS} current={CURRENT_STEP} />

        <button
          onClick={handleCompleteCalibration}
          disabled={!fingersShown}
          className={`shrink-0 border-[1.5px] border-black bg-[#fffdf7] px-6 py-3 rounded-[8px] text-[30px] text-black font-sans whitespace-nowrap hover:bg-black/5 transition-colors ${
            !fingersShown ? "opacity-30 cursor-not-allowed" : "hover:opacity-70"
          }`}
        >
          Complete Calibration
        </button>
      </div>
    </div>
  );
}
