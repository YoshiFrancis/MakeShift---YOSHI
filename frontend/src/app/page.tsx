"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

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

export default function Home() {
  const [metronome, setMetronome] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;

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
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
        setCameraReady(true);
      })
      .catch(() => {});

    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="flex-1 bg-[#fffdf7] flex flex-col">
      <div className="flex flex-1 pt-[115px] pl-[61px] pr-[47px] pb-[226px]">
        {/* Camera feed */}
        <div className="flex-1 bg-[#090909] relative">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />
          {!cameraReady && (
            <p className="absolute inset-0 flex items-center justify-center text-white text-[37px] font-sans">
              Live Camera Feed
            </p>
          )}
        </div>

        {/* Right sidebar */}
        <div className="w-[267px] relative flex flex-col">
          {/* Piano key bars overlapping the nav */}
          <div className="absolute left-0 top-[50px] flex flex-col gap-[24px] z-10 pointer-events-none">
            <div className="bg-black h-[46px] w-[140px] rounded-tr-[4px] rounded-br-[4px] shadow-[2px_1px_1px_0px_rgba(0,0,0,0.1)]" />
            <div className="bg-black h-[46px] w-[140px] rounded-tr-[4px] rounded-br-[4px] shadow-[2px_1px_1px_0px_rgba(0,0,0,0.1)]" />
          </div>

          {/* Nav tabs */}
          <div className="flex flex-col">
            <Link
              href="/calibration"
              className="border border-black h-[72px] flex items-center justify-end pr-[19px] pl-[100px] rounded-tr-[8px] bg-[#fffdf7] relative shadow-[inset_0px_4px_0px_0px_rgba(255,255,255,0.25),inset_0px_-15px_17.6px_0px_rgba(53,21,21,0.07)]"
            >
              <span className="text-[20px] text-black font-sans whitespace-nowrap">
                Calibration
              </span>
            </Link>
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
                className="hover:opacity-70 transition-opacity"
              >
                <PlayIcon />
              </button>
              <button
                aria-label="Stop"
                className="hover:opacity-70 transition-opacity"
              >
                <StopIcon />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
