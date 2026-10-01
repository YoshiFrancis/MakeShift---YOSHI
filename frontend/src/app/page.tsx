"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCamera } from "./CameraContext";
import CameraStatusOverlay from "./CameraStatusOverlay";
import SideNav from "./SideNav";
import {
  createRecorder,
  downloadMidi,
  type Recorder,
  type Recording,
} from "./midi/midiUtils";
import { browserAudio } from "./audio/audioEngine";
import { LiveSession } from "../events/liveSession";
import { loadCalibration } from "../cv/calibration";
import { connectPianoConsumers } from "../events/pianoConsumers";

const CVOverlayCoordinator = dynamic(
  () => import("./CVOverlayCoordinator"),
  { ssr: false },
);

function ChevronDown() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlayIcon({ color = "var(--color-ink)" }: { color?: string }) {
  return (
    <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18.5" stroke={color} strokeWidth="1.5" style={{ transition: "stroke 120ms ease" }} />
      <path d="M16 14L28 20L16 26V14Z" fill={color} style={{ transition: "fill 120ms ease" }} />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18.5" stroke="var(--color-info)" strokeWidth="1.5" />
      <rect x="13" y="13" width="5" height="14" rx="1.5" fill="var(--color-info)" />
      <rect x="22" y="13" width="5" height="14" rx="1.5" fill="var(--color-info)" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18.5" stroke="var(--color-ink)" strokeWidth="1.5" />
      <rect x="13" y="13" width="14" height="14" fill="var(--color-ink)" />
    </svg>
  );
}

export default function Home() {
  const router = useRouter();
  const [session] = useState(() => new LiveSession(browserAudio));
  const [liveStatus, setLiveStatus] = useState(session.status);
  const [activePitches, setActivePitches] = useState<ReadonlySet<number>>(new Set());
  const recorderRef = useRef<Recorder | null>(null);
  if (recorderRef.current === null) {
    recorderRef.current = createRecorder();
  }
  const recorder = recorderRef.current;
  const consumersRef = useRef<ReturnType<typeof connectPianoConsumers> | null>(null);
  const [completedRecording, setCompletedRecording] =
    useState<Recording | null>(null);

  // ── Tempo & time signature (controlled) ─────────────────────────────────
  const [tempo, setTempo] = useState(120);
  const [timeSignature, setTimeSignature] = useState("4/4");
  const beatsPerMeasure = parseInt(timeSignature.split("/")[0]);

  // ── Metronome ────────────────────────────────────────────────────────────
  const [metronome, setMetronome] = useState(true);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // ── Count-in beat (1 → beatsPerMeasure, then recording starts) ──────────
  const [countInBeat, setCountInBeat] = useState<number | null>(null);
  const countInActionRef = useRef<"start" | "resume" | null>(null);
  const playRequestRef = useRef(0);

  useEffect(() => () => {
    // Ignore audio initialization that finishes after leaving this page.
    playRequestRef.current += 1;
  }, []);

  // ── Welcome modal (first visit only) ────────────────────────────────────
  const [showWelcome, setShowWelcome] = useState(false);
  const [showCalibrationIntro, setShowCalibrationIntro] = useState(false);

  // ── Recording state machine ──────────────────────────────────────────────
  //   countInBeat      → 1 … beatsPerMeasure (one measure count-in), then recording
  //   isRecording      → actively recording (or paused)
  //   isPaused         → recording paused mid-session
  //   hasFinishedRecording → stop pressed; MIDI controls visible
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const hasFinishedRecording = completedRecording !== null;
  const [showRecordingComplete, setShowRecordingComplete] = useState(false);

  // ── Export / delete ──────────────────────────────────────────────────────
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportPath, setExportPath] = useState("~/Downloads");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const { stream, cameraReady } = useCamera();
  // Drives the calibration prompt; live readiness stays with the session.
  const [isCalibrated, setIsCalibrated] = useState(false);

  useEffect(() => {
    if (stream && videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsCalibrated(loadCalibration() !== null);
      // Show welcome modal only on the very first visit
      try {
        if (!localStorage.getItem("hasVisited")) {
          setShowWelcome(true);
          localStorage.setItem("hasVisited", "true");
        }
      } catch { /* Calibration displays storage recovery separately. */ }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // ── Audio click (used only for count-in) ────────────────────────────────
  const playClick = useCallback((accent: boolean) => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = accent ? 1050 : 820;
    gain.gain.setValueAtTime(accent ? 0.65 : 0.38, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.055);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.06);
  }, []);

  // ── Beat-based count-in (1 measure at current tempo) ────────────────────
  useEffect(() => {
    if (countInBeat === null) return;
    // Play click for this beat (accent on beat 1)
    if (metronome) playClick(countInBeat === 1);
    const intervalMs = (60 / tempo) * 1000;
    const timer = setTimeout(() => {
      if (countInActionRef.current === null) return;
      if (countInBeat >= beatsPerMeasure) {
        // Measure complete — start recording
        if (session.status.state !== "playing") {
          session.interrupt("Readiness changed during count-in. Wait for tracking, then select Enable audio.");
          return;
        }
        setCountInBeat(null);
        setIsRecording(true);
        setIsPaused(false);

        session.flushNotes();
        // Resume keeps the existing take and excludes the count-in time.
        if (countInActionRef.current === "resume") {
          recorder.resumeRecording();
        } else {
          recorder.startRecording(tempo);
        }
        consumersRef.current?.captureHeld();
        countInActionRef.current = null;
      } else {
        setCountInBeat((b) => (b !== null ? b + 1 : null));
      }
    }, intervalMs);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countInBeat]);

  // Playing and recording share readiness, but have independent lifetimes.
  const canPlay = liveStatus.canStart;

  // ── Recording controls ───────────────────────────────────────────────────
  useEffect(() => {
    const detach = session.attach();
    const disconnectNotes = connectPianoConsumers(session, recorder, setActivePitches);
    consumersRef.current = disconnectNotes;
    let previousState = session.status.state;
    const unsubscribe = session.subscribe(() => {
      const status = session.status;
      setLiveStatus(status);
      const changed = previousState !== status.state;
      previousState = status.state;
      if (changed && (status.state === "interrupted" || status.state === "error")) {
        playRequestRef.current++;
        countInActionRef.current = null;
        setCountInBeat(null);
        session.flushNotes();
        const take = recorder.stopRecording();
        if (take) setCompletedRecording(take);
        setIsRecording(false);
        setIsPaused(false);
      }
    });
    const visibility = () => session.setHidden(document.hidden);
    const leave = () => session.setHidden(true);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    visibility();
    return () => {
      unsubscribe();
      detach();
      session.flushNotes();
      disconnectNotes();
      consumersRef.current = null;
      recorder.stopRecording();
      void audioCtxRef.current?.close();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
    };
  }, [session, recorder]);
  const enableAudio = async () => {
    if (!canPlay) return false;
    if (session.status.state === "playing") return true;
    if (!await session.prepare()) return false;
    return session.play() !== null;
  };
  const handlePlay = async () => {
    if (countInBeat !== null || session.status.state === "starting") return;
    if (isRecording && !isPaused) {
      session.flushNotes();
      recorder.pauseRecording();
      setIsPaused(true);
      return;
    }
    if (!canPlay) return;
    const request = ++playRequestRef.current;
    if (!await enableAudio() || request !== playRequestRef.current) return;
    if (countInBeat !== null) return; // already counting in
    if (isRecording && isPaused) {
      // Keep the existing take paused until the count-in finishes.
      countInActionRef.current = "resume";
      setCountInBeat(1);
      return;
    }
    // Start fresh — clear previous session and begin count-in
    setIsRecording(false);
    setIsPaused(false);
    setCompletedRecording(null);
    setShowRecordingComplete(false);
    setShowExportDialog(false);
    setShowDeleteConfirm(false);
    countInActionRef.current = "start";
    setCountInBeat(1);
  };

  const handleStop = () => {
    if (session.status.state === "starting") session.stop();
    session.flushNotes();
    playRequestRef.current += 1;
    countInActionRef.current = null;
    setCountInBeat(null);
    // An initial count-in has no take; a resume count-in does.
    if (!isRecording) return;
    const recording = recorder.stopRecording();
    setCompletedRecording(recording);
    setIsRecording(false);
    setIsPaused(false);
    setShowRecordingComplete(recording !== null);
  };

  const confirmDelete = () => {
    setCompletedRecording(null);
    setShowRecordingComplete(false);
    setShowExportDialog(false);
    setShowDeleteConfirm(false);
  };

  // ── Tempo input helper ───────────────────────────────────────────────────
  const handleTempoChange = (raw: string) => {
    const parsed = parseInt(raw);
    if (!isNaN(parsed)) setTempo(Math.max(20, Math.min(300, parsed)));
  };

  return (
    <div className="flex-1 bg-surface flex flex-col">
      <p role={liveStatus.state === "error" ? "alert" : "status"} className="text-ink px-4">{liveStatus.message}</p>
      <div aria-live="polite" className="sr-only">
        {isRecording ? "Recording started" : showRecordingComplete ? "Recording complete" : ""}
      </div>

      {/* ── Welcome Modal (first visit) ─────────────────────────────────────── */}
      {showWelcome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface rounded-[20px] shadow-2xl w-[540px] max-w-[92vw] max-h-[90dvh] overflow-y-auto">

            {/* Body */}
            <div className="px-6 sm:px-10 pt-7 sm:pt-9 pb-6 sm:pb-8">
              {/* Piano icon */}
              <div className="flex items-center gap-3 mb-5">
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
                  <rect x="1" y="6" width="34" height="24" rx="3" fill="var(--color-ink)" />
                  {/* White keys */}
                  {[4, 9, 14, 19, 24, 29].map((x) => (
                    <rect key={x} x={x} y="6" width="4" height="18" rx="1" fill="white" />
                  ))}
                  {/* Black keys */}
                  {[6.5, 11.5, 21.5, 26.5].map((x) => (
                    <rect key={x} x={x} y="6" width="3" height="11" rx="1" fill="var(--color-ink)" />
                  ))}
                </svg>
                <h2 className="text-[22px] sm:text-[28px] font-bold text-black font-sans tracking-tight">
                  Welcome to MakeShift
                </h2>
              </div>

              <p className="text-[15px] text-ink-muted font-sans leading-relaxed mb-7">
                MakeShift turns a sheet of paper and your webcam into a playable piano, no hardware needed. Before you start, here&apos;s how to get going:
              </p>

              <div className="flex flex-col gap-4 mb-8">
                {[
                  {
                    num: "1",
                    color: "var(--color-accent)",
                    title: "Read the Tutorial",
                    body: "Get familiar with the setup steps and how finger tracking works.",
                  },
                  {
                    num: "2",
                    color: "var(--color-accent)",
                    title: "Run Calibration",
                    body: "Place a sheet of paper in view of your camera and walk through the 5-step calibration so MakeShift can map your keys.",
                  },
                  {
                    num: "3",
                    color: "var(--color-accent)",
                    title: "Press Play and perform",
                    body: "Set your tempo, toggle the metronome, hit Play, and start tapping the paper to make music.",
                  },
                ].map(({ num, color, title, body }) => (
                  <div key={num} className="flex gap-4 items-start">
                    <span
                      className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-[13px] font-bold mt-0.5"
                      style={{ background: color }}
                    >
                      {num}
                    </span>
                    <div>
                      <p className="text-[15px] font-semibold text-black font-sans">{title}</p>
                      <p className="text-[14px] text-ink-muted font-sans leading-relaxed">{body}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* CTA row */}
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowWelcome(false); router.push("/tutorial"); }}
                  className="flex-1 border border-black bg-surface py-3 rounded-[10px] text-[15px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]"
                >
                  Read Tutorial
                </button>
                <button
                  onClick={() => { setShowWelcome(false); setShowCalibrationIntro(true); }}
                  className="flex-1 border border-black bg-black py-3 rounded-[10px] text-[15px] text-white font-sans hover:bg-black/80 active:scale-[0.97] transition-[background-color,transform]"
                >
                  Start Calibration
                </button>
              </div>

              <button
                onClick={() => setShowWelcome(false)}
                className="w-full mt-3 py-2 text-[13px] text-ink-muted font-sans hover:text-black transition-colors"
              >
                Skip for now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Calibration Intro Modal ─────────────────────────────────────────── */}
      {showCalibrationIntro && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowCalibrationIntro(false)}
        >
          <div
            className="bg-white rounded-[16px] shadow-2xl w-[520px] max-w-[90vw] max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 sm:px-8 pt-8 pb-5">
              <h2 className="text-[22px] sm:text-[26px] font-bold text-black font-sans">Before You Begin: Calibration</h2>
            </div>
            <hr className="border-divider-subtle" />
            <div className="px-6 sm:px-8 py-6">
              <p className="text-[15px] text-ink-subtle font-sans mb-5 leading-relaxed">
                Calibration maps your paper keyboard to the screen. Make sure you have a sheet of paper, good lighting, and your webcam is unobstructed before starting.
              </p>
              <ol className="flex flex-col gap-3">
                {[
                  "Select the number of octaves and your starting note",
                  "Check your environment's lighting",
                  "Align the paper outline with your physical sheet",
                  "Hover both hands above the paper to detect fingertips",
                  "Place hands flat on the paper to set note boundaries",
                ].map((text, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-accent flex items-center justify-center text-white text-[13px] font-bold mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-[15px] text-black/80 font-sans leading-relaxed">{text}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="px-6 sm:px-8 pb-8 flex gap-3 justify-end">
              <button
                onClick={() => { setShowCalibrationIntro(false); router.push("/calibration"); }}
                className="border border-black bg-surface px-6 py-3 rounded-[10px] text-[16px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]"
              >
                Skip
              </button>
              <button
                onClick={() => { setShowCalibrationIntro(false); router.push("/calibration"); }}
                className="border border-black bg-black px-6 py-3 rounded-[10px] text-[16px] text-white font-sans hover:bg-black/80 active:scale-[0.97] transition-[background-color,transform]"
              >
                Begin Calibration
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col lg:flex-row lg:flex-1 pt-4 lg:pt-[clamp(16px,calc(100dvh_-_700px),115px)] pl-[clamp(20px,4.2vw,61px)] pr-[clamp(12px,3.2vw,47px)] lg:pb-[clamp(16px,calc(100dvh_-_660px),226px)]">
        {/* Camera feed */}
        <div className="w-full aspect-video lg:w-auto lg:aspect-auto lg:flex-1 lg:min-h-[240px] bg-surface-dark relative overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />
          <CVOverlayCoordinator
            session={session}
            videoRef={videoRef}
            enabled={canPlay && liveStatus.state === "playing"}
            activePitches={activePitches}
          />
          <CameraStatusOverlay />

          {/* "Click Calibration to Begin" overlay */}
          {!isCalibrated && cameraReady && (
            <div className="absolute inset-0 flex items-start justify-center pt-6 sm:pt-[60px] pointer-events-none">
              <p className="text-white text-[20px] sm:text-[32px] font-sans text-center px-8">Click &lsquo;Calibration&rsquo; to Begin</p>
            </div>
          )}

          {/* Count-in overlay — one measure of beats before recording */}
          {countInBeat !== null && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-40 pointer-events-none">
              <span className="text-white font-bold drop-shadow-lg leading-none tabular-nums" style={{ fontSize: "clamp(80px,20vw,160px)" }}>
                {countInBeat}
              </span>
              <div className="flex items-center gap-2 mt-6">
                {Array.from({ length: beatsPerMeasure }, (_, i) => (
                  <div
                    key={i}
                    className="rounded-full transition-all duration-75"
                    style={{
                      width:  i + 1 === countInBeat ? 14 : 8,
                      height: i + 1 === countInBeat ? 14 : 8,
                      background: i + 1 <= countInBeat ? "var(--color-white)" : "color-mix(in srgb, var(--color-white) 30%, transparent)",
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Recording Complete banner */}
          {showRecordingComplete && (
            <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/30">
              <div className="bg-white rounded-[14px] px-6 sm:px-12 py-6 sm:py-8 max-w-[90%] shadow-2xl flex flex-col items-center gap-3">
                <div className="flex items-center gap-3">
                  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="var(--color-success)"/><path d="M9 16L13.5 21L23 11" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <p className="text-[22px] sm:text-[28px] font-bold text-black font-sans">Recording Complete!</p>
                </div>
                <p className="text-[14px] text-ink-subtle font-sans">Use the sidebar to export or delete</p>
                <button
                  onClick={() => setShowRecordingComplete(false)}
                  className="mt-1 border border-black/20 px-6 py-2 rounded-[8px] text-[15px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Delete confirmation dialog */}
          {showDeleteConfirm && (
            <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/30">
              <div className="bg-white rounded-[14px] px-6 sm:px-10 py-6 sm:py-8 shadow-2xl flex flex-col items-center gap-5 w-[360px] max-w-[90%]">
                <p className="text-[20px] font-sans font-medium text-black text-center">Delete this MIDI recording?</p>
                <p className="text-[14px] text-ink-subtle font-sans text-center -mt-2">This cannot be undone.</p>
                <div className="flex gap-4 w-full">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 border border-black bg-surface py-3 rounded-[8px] text-[16px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDelete}
                    className="flex-1 border border-danger bg-danger py-3 rounded-[8px] text-[16px] text-white font-sans hover:bg-danger-hover active:scale-[0.97] transition-[background-color,transform]"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
          {!canPlay && <p role="status" className="absolute bottom-2 left-2 right-2 z-20 bg-surface px-4 text-ink">Show the calibrated sheet and camera, or <a href="/calibration" className="underline">calibrate again</a>. Saved data is checked before playing.</p>}
        </div>

        {/* Right sidebar (below the camera under lg) */}
        <SideNav onCalibrationClick={() => setShowCalibrationIntro(true)}>
          {/* Controls */}
          <div className="flex flex-row flex-wrap items-end lg:flex-col lg:items-stretch gap-[23px] mt-6 lg:mt-[42px] lg:pl-[43px]">
            {/* Tempo */}
            <div className="flex flex-col gap-2">
              <label htmlFor="set-tempo" className="text-[16px] text-ink font-sans leading-[1.4]">Set Tempo</label>
              <div className="flex items-center gap-2">
                <input
                  id="set-tempo"
                  type="number"
                  min={20}
                  max={300}
                  value={tempo}
                  onChange={(e) => handleTempoChange(e.target.value)}
                  className="border border-control-border rounded-[8px] px-4 py-3 text-[16px] text-ink bg-white w-[80px] leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                />
                <span className="text-[13px] text-ink-muted font-sans">BPM</span>
              </div>
            </div>

            {/* Time Signature */}
            <div className="flex flex-col gap-2">
              <label htmlFor="time-signature" className="text-[16px] text-ink font-sans leading-[1.4]">Time Signature</label>
              <div className="relative w-[120px]">
                <select
                  id="time-signature"
                  value={timeSignature}
                  onChange={(e) => setTimeSignature(e.target.value)}
                  className="border border-control-border rounded-[8px] pl-4 pr-8 py-[10px] text-[16px] text-ink bg-white w-full appearance-none leading-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                >
                  <option>4/4</option>
                  <option>3/4</option>
                  <option>6/8</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-ink"><ChevronDown /></div>
              </div>
            </div>

            {/* Metronome toggle */}
            <div className="flex items-center gap-3 h-[42px] lg:h-auto">
              <span className="text-[16px] text-ink font-sans leading-[1.4] whitespace-nowrap">Metronome</span>
              <button
                onClick={() => setMetronome(!metronome)}
                aria-label="Toggle metronome"
                aria-pressed={metronome}
                className={`relative w-[40px] h-[24px] rounded-full overflow-hidden transition-colors ${metronome ? "bg-ink" : "bg-control-inactive"}`}
              >
                <span className={`absolute top-[2px] left-0 w-[20px] h-[20px] rounded-full bg-white shadow transition-transform duration-150 ease-out ${metronome ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
              </button>
            </div>

            {/* MIDI controls — only visible after Stop is pressed */}
            {hasFinishedRecording && (
              <div className="w-full flex flex-col gap-[10px] pt-[6px] border-t border-divider">
                <button
                  onClick={() => setShowExportDialog(!showExportDialog)}
                  className="border border-black bg-surface px-4 py-[10px] rounded-[8px] text-[14px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform] text-left"
                >
                  Export .MIDI Recording
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="border border-danger bg-surface px-4 py-[10px] rounded-[8px] text-[14px] text-danger font-sans hover:bg-red-50 active:scale-[0.97] transition-[background-color,transform] text-left"
                >
                  Delete .MIDI Recording
                </button>
              </div>
            )}
          </div>
        </SideNav>
      </div>

      {/* ── Export Modal ────────────────────────────────────────────────────── */}
      {showExportDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowExportDialog(false)}
        >
          <div
            className="bg-white rounded-[16px] shadow-2xl w-[480px] max-w-[90vw] p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[22px] font-bold text-black font-sans mb-2">Export MIDI Recording</h2>
            <p className="text-[15px] text-ink-subtle font-sans mb-6">Choose where to save the MIDI file.</p>
            <label htmlFor="export-path" className="text-[14px] font-medium text-black font-sans block mb-2">Save location</label>
            <input
              id="export-path"
              type="text"
              value={exportPath}
              onChange={(e) => setExportPath(e.target.value)}
              className="w-full border border-control-border rounded-[8px] px-4 py-3 text-[16px] text-black bg-white mb-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowExportDialog(false)}
                className="border border-black bg-white px-6 py-3 rounded-[10px] text-[16px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (completedRecording === null) return;
                  downloadMidi(completedRecording);
                  setShowExportDialog(false);
                }}
                className="border border-black bg-black px-6 py-3 rounded-[10px] text-[16px] text-white font-sans hover:bg-black/80 active:scale-[0.97] transition-[background-color,transform]"
              >
                Export
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom: Listen (left) + Play/Stop (centre) */}
      <div className="flex items-center shrink-0 pl-[clamp(20px,4.2vw,61px)] pr-[clamp(12px,3.2vw,47px)] pb-[clamp(12px,3dvh,36px)] pt-[clamp(8px,2dvh,24px)]">
        <div className="flex-1 relative flex flex-wrap items-center justify-center gap-[27px]">
          {hasFinishedRecording && (
            <button className="lg:absolute lg:left-0 border-[1.5px] border-black bg-surface px-5 py-2 rounded-[8px] text-[17px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]">
              Listen to Recording
            </button>
          )}

          <button
            onClick={enableAudio}
            disabled={!canPlay || liveStatus.state === "starting" || liveStatus.state === "playing"}
            className="border border-black rounded-[8px] px-4 py-2 text-ink disabled:opacity-30"
          >
            Enable audio
          </button>
          {/* Record / Pause / Resume button */}
          <button
            onClick={handlePlay}
            aria-label={isRecording && !isPaused ? "Pause recording" : isPaused ? "Resume recording" : "Start recording"}
            disabled={!canPlay || countInBeat !== null || liveStatus.state === "starting"}
            className={`flex flex-col items-center gap-1 transition-[opacity,transform] active:scale-[0.97] ${!canPlay || countInBeat !== null || liveStatus.state === "starting" ? "opacity-30 cursor-not-allowed" : "hover:opacity-70"}`}
          >
            {isRecording && !isPaused
              ? <PauseIcon />
              : <PlayIcon color={isPaused ? "var(--color-info)" : "var(--color-ink)"} />}
            <span className={`text-[13px] font-sans select-none ${isPaused ? "text-info" : "text-ink"}`}>
              {isRecording && !isPaused ? "Pause" : isPaused ? "Resume" : "Record"}
            </span>
          </button>

          {/* Stop button */}
          <button
            onClick={handleStop}
            aria-label="Stop recording"
            disabled={!isRecording && countInBeat === null && liveStatus.state !== "starting"}
            className={`flex flex-col items-center gap-1 transition-[opacity,transform] active:scale-[0.97] ${!isRecording && countInBeat === null && liveStatus.state !== "starting" ? "opacity-30 cursor-not-allowed" : "hover:opacity-70"}`}
          >
            <StopIcon />
            <span className="text-[13px] text-ink font-sans select-none">Stop</span>
          </button>
        </div>
        <div className="hidden lg:block w-[267px] shrink-0" />
      </div>
    </div>
  );
}
