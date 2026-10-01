import { JSDOM } from "jsdom";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Recording } from "../../frontend/src/app/midi/midiUtils";
import type { HandObservation, NormalizedLandmark } from "../../frontend/src/cv/collision";

const fixtures = vi.hoisted(() => ({
  invalidate: null as null | (() => void),
  landmarks: null as null | ((hands: HandObservation[]) => void),
  initializeAudio: vi.fn(async () => {}),
  takes: [] as Recording[],
  download: vi.fn(),
  highlight: vi.fn(),
  detect: vi.fn(),
  camera: { stream: { getVideoTracks: () => [{ readyState: "live", getSettings: () => ({ deviceId: "camera-1" }) }] }, cameraReady: true },
}));
vi.mock("../../frontend/src/cv/keyboardGeometry", async (original) => ({
  ...await original<typeof import("../../frontend/src/cv/keyboardGeometry")>(),
  pressWhiteKey: fixtures.highlight,
}));
// jsdom has no Worker or depth calibration, so run the real contact pipeline
// in its overlap-only mode; these tests cover recording, not contact sensing.
vi.mock("../../frontend/src/cv/liveContactPipeline", async (original) => {
  const actual = await original<typeof import("../../frontend/src/cv/liveContactPipeline")>();
  const overlapOnly = { knuckles: false, shadows: false };
  return {
    ...actual,
    CONTACT_TECHNIQUES: overlapOnly,
    LiveContactPipeline: class extends actual.LiveContactPipeline {
      constructor(callbacks: ConstructorParameters<typeof actual.LiveContactPipeline>[0]) {
        super(callbacks, overlapOnly);
      }
    },
  };
});
vi.mock("../../frontend/src/app/CameraContext", () => ({
  useCamera: () => fixtures.camera,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../frontend/src/app/audio/audioEngine", () => ({
  browserAudio: {
    initialize: fixtures.initializeAudio,
    status: "ready",
    subscribeInvalidation: (listener: () => void) => {
      fixtures.invalidate = listener;
      return () => { fixtures.invalidate = null; };
    },
    noteOn: vi.fn(() => ({ session: 1, press: 1 })),
    noteOff: vi.fn(() => true),
    releaseAll: vi.fn(),
  },
}));
vi.mock("../../frontend/src/app/midi/midiUtils", async (original) => {
  const actual = await original<typeof import("../../frontend/src/app/midi/midiUtils")>();
  return {
    ...actual,
    downloadMidi: fixtures.download,
    createRecorder: () => {
      const recorder = actual.createRecorder();
      const stop = recorder.stopRecording;
      recorder.stopRecording = () => {
        const take = stop();
        if (take) fixtures.takes.push(take);
        return take;
      };
      return recorder;
    },
  };
});
vi.mock("../../frontend/src/cv/markerDetector", () => ({
  MarkerDetector: {
    create: async () => ({
      dispose: vi.fn(),
      detect: () => {
        fixtures.detect();
        return ({
        missingIds: [],
        observations: [[100, 100], [900, 100], [900, 900], [100, 900]]
          .map(([x, y], id) => ({
            id, center: { x, y },
            corners: [{ x, y }, { x: x + 1, y }, { x: x + 1, y: y + 1 }, { x, y: y + 1 }],
          })),
      });
      },
    }),
  },
}));
vi.mock("next/dynamic", async () => {
  return {
    default: (loader: () => unknown) => {
      const source = loader.toString();
      if (source.includes("CVOverlayCoordinator")) {
        return function CoordinatorFixture(props: ComponentProps<typeof Coordinator>) {
          return createElement(Coordinator, props);
        };
      }
      if (source.includes("MarkerTrackingOverlay")) {
        return function MarkerFixture(props: ComponentProps<typeof Marker>) {
          return createElement(Marker, props);
        };
      }
      return function HandFixture({ onLandmarks }: {
        onLandmarks: (hands: HandObservation[]) => void;
      }) {
        fixtures.landmarks = onLandmarks;
        return null;
      };
    },
  };
});

import { browserAudio } from "../../frontend/src/app/audio/audioEngine";
import Home from "../../frontend/src/app/page";
import Coordinator from "../../frontend/src/app/CVOverlayCoordinator";
import Marker from "../../frontend/src/app/MarkerTrackingOverlay";

let root: Root;
let host: HTMLDivElement;
let now: number;
let animationFrame: FrameRequestCallback | undefined;
let dom: JSDOM;
let currentHands: NormalizedLandmark[][] = [];

beforeEach(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true });
  for (const name of ["window", "self", "document", "localStorage", "HTMLCanvasElement", "HTMLVideoElement", "getComputedStyle"]) {
    vi.stubGlobal(name, Reflect.get(dom.window, name));
  }
  vi.useFakeTimers();
  vi.clearAllMocks();
  now = 1000;
  currentHands = [];
  fixtures.takes.length = 0;
  fixtures.camera.cameraReady = true;
  fixtures.initializeAudio.mockImplementation(async () => {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    animationFrame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const contextMethods = ["clearRect", "drawImage", "beginPath", "moveTo",
    "lineTo", "closePath", "fill", "stroke", "fillText", "fillRect",
    "strokeRect", "putImageData", "save", "restore", "scale", "setLineDash"];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      return Object.assign(
        Object.fromEntries(contextMethods.map((name) => [name, vi.fn()])),
        { canvas: this },
      ) as unknown as CanvasRenderingContext2D;
    },
  );
  for (const [name, value] of Object.entries({ readyState: 4, videoWidth: 1000, videoHeight: 1000 })) {
    vi.spyOn(HTMLVideoElement.prototype, name as "readyState", "get").mockReturnValue(value);
  }
  vi.spyOn(console, "log").mockImplementation(() => {});
  localStorage.setItem("makeshift.calibration.v1", JSON.stringify({
    version: 1, coordinates: "unmirrored-frame-pixels/marker-unit-square", sheet: "aruco-0-3-white-keys-v1",
    camera: { deviceId: "camera-1", width: 1000, height: 1000, facingMode: "" },
    layout: { octaves: 1, startingMidi: 48, whiteKeys: 8 },
    corners: [{ x: 100, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 900 }, { x: 100, y: 900 }],
    contact: { model: "landmark-reference-v1", hover: [Array(21).fill({ x: 0.5, y: 0.4, z: 0 })], rest: [Array(21).fill({ x: 0.5, y: 0.5, z: 0 })] },
  }));
  localStorage.setItem("hasVisited", "true");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Home />));
  await advance(0);
  // Disable count-in audio; audio hardware is outside this fixture.
  const metronome = host.querySelector<HTMLButtonElement>('button[aria-label="Toggle metronome"]');
  if (!metronome) throw new Error("Metronome control missing");
  await click(metronome);
  await keys();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  dom.window.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const result = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

async function click(target: HTMLButtonElement) {
  await act(async () => target.click());
}

async function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    const step = Math.min(100, ms - elapsed);
    now += step;
    await act(async () => fixtures.landmarks?.(
    currentHands.map((landmarks) => ({ landmarks, handedness: "Right" as const })),
  ));
    await frame();
    await act(async () => { await vi.advanceTimersByTimeAsync(step); });
  }
  if (ms === 0) await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

async function countIn() {
  for (let i = 0; i < 4; i++) await advance(500);
}

async function frame() {
  await act(async () => animationFrame?.(now));
}

async function keys(...xs: number[]) {
  const hand = Array.from({ length: 21 }, () => ({ x: -10, y: -10 }));
  for (let i = 0; i < xs.length; i++) hand[[4, 8, 12, 16, 20][i]] = { x: xs[i] / 1000, y: 0.5 };
  currentHands = xs.length ? [hand] : [];
  await act(async () => fixtures.landmarks?.(
    currentHands.map((landmarks) => ({ landmarks, handedness: "Right" as const })),
  ));
  await frame();
}

async function start() {
  await click(button("Start recording"));
  await countIn();
  expect(button("Pause recording").disabled).toBe(false);
}

it("uses the real page/coordinator/marker transitions to capture held keys after resume", async () => {
  await start();
  await keys(115); // First key, via real geometry and transitions.
  await advance(500);
  await click(button("Pause recording"));
  expect(button("Resume recording").disabled).toBe(false);
  await keys(115, 225); // Second key first pressed during pause.
  await advance(1000);
  await click(button("Resume recording"));
  expect(button("Resume recording").disabled).toBe(true);
  await countIn();
  await advance(250);
  await keys();
  await click(button("Stop recording"));
  const notes = fixtures.takes.at(-1)!.notes;
  expect(notes).toHaveLength(3);
  expect(notes[0]).toMatchObject({ startMs: 0, durationMs: 500 });
  expect(notes[1]).toMatchObject({ pitch: notes[0].pitch, startMs: 500, durationMs: 250 });
  expect(notes[2]).toMatchObject({ startMs: 500, durationMs: 250 });
  expect(notes[2].pitch).not.toBe(notes[0].pitch);
  expect(host.textContent).toContain("Export .MIDI Recording");
  expect(button("Start recording").disabled).toBe(false);
});

it("omits keys released during pause and preserves timing across repeated resumes", async () => {
  await start();
  await keys(115);
  await advance(200);
  await click(button("Pause recording"));
  await keys(225);
  await advance(1000);
  await keys();
  await click(button("Resume recording"));
  await countIn();
  await advance(300);
  await keys(115);
  await advance(100);
  await click(button("Pause recording"));
  await click(button("Resume recording"));
  await countIn();
  await advance(100);
  await click(button("Stop recording"));
  expect(fixtures.takes.at(-1)!.notes.map(({ startMs, durationMs }) => ({ startMs, durationMs })))
    .toEqual([
      { startMs: 0, durationMs: 200 },
      { startMs: 500, durationMs: 100 },
      { startMs: 600, durationMs: 100 },
    ]);
});

it("Stop during resume count-in preserves the take and cancels the pending resume", async () => {
  await start();
  await keys(115);
  await advance(500);
  await click(button("Pause recording"));
  await click(button("Resume recording"));
  await advance(500);
  await click(button("Stop recording"));
  await countIn();
  expect(fixtures.takes).toHaveLength(1);
  expect(fixtures.takes[0].notes).toHaveLength(1);
  expect(fixtures.takes[0].notes[0].durationMs).toBe(500);
  expect(button("Start recording").disabled).toBe(false);
  expect(button("Stop recording").disabled).toBe(true);
});

it("cancels an initial count-in without making a take", async () => {
  await click(button("Start recording"));
  await advance(500);
  await click(button("Stop recording"));
  await countIn();
  expect(fixtures.takes).toEqual([]);
  expect(host.textContent).not.toContain("Export .MIDI Recording");
  expect(button("Start recording").disabled).toBe(false);
});

it("resume keeps the live audio session without reinitializing it", async () => {
  await start();
  await keys(115);
  await advance(500);
  await click(button("Pause recording"));
  fixtures.initializeAudio.mockClear();
  await click(button("Resume recording"));
  await click(button("Stop recording"));
  await countIn();
  expect(fixtures.initializeAudio).not.toHaveBeenCalled();
  expect(button("Start recording").disabled).toBe(false);
  expect(button("Stop recording").disabled).toBe(true);
});


it("rejects a legacy boolean and interrupts recording when persisted calibration changes", async () => {
  await start();
  await keys(150);
  localStorage.removeItem("makeshift.calibration.v1");
  localStorage.setItem("isCalibrated", "true");
  await advance(10_000);
  await frame();
  expect(button("Start recording").disabled).toBe(true);
  expect(fixtures.takes).toHaveLength(1);
  await keys(250);
  expect(fixtures.takes).toHaveLength(1);
});


it("audio interruption closes the take and recovery needs another Play", async () => {
  await start();
  await keys(115);
  await advance(100);
  await act(async () => fixtures.invalidate?.());
  expect(fixtures.takes).toHaveLength(1);
  expect(host.textContent).toContain("Audio interrupted");
  await keys(225);
  expect(fixtures.takes[0].notes).toHaveLength(1);
  await start();
  await click(button("Stop recording"));
});

it("Stop cancels initial audio startup and offers a clean retry", async () => {
  let resolve!: () => void;
  fixtures.initializeAudio.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
  await click(button("Start recording"));
  expect(button("Stop recording").disabled).toBe(false);
  await click(button("Stop recording"));
  await act(async () => resolve());
  await countIn();
  expect(fixtures.takes).toHaveLength(0);
  await start();
});

it("backgrounding releases the session and closes the recording", async () => {
  await start();
  await keys(115);
  await act(async () => window.dispatchEvent(new window.Event("pagehide")));
  expect(fixtures.takes).toHaveLength(1);
  expect(button("Start recording").disabled).toBe(true);
  expect(host.textContent).toContain("background");
});


it("ignores repeated Play while audio is starting", async () => {
  let resolve!: () => void;
  fixtures.initializeAudio.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
  await click(button("Start recording"));
  expect(button("Start recording").disabled).toBe(true);
  await click(button("Start recording"));
  await act(async () => resolve());
  await countIn();
  expect(button("Pause recording").disabled).toBe(false);
  expect(fixtures.initializeAudio).toHaveBeenCalledTimes(1);
});

it("highlights accepted notes through recording Stop and clears them on interruption", async () => {
  await keys(115);
  // Since #148, contact highlights keys before any session starts.
  expect(fixtures.highlight).toHaveBeenCalled();
  fixtures.highlight.mockClear();
  await start();
  await advance(0);
  expect(fixtures.highlight).toHaveBeenCalled();
  await click(button("Stop recording"));
  fixtures.highlight.mockClear();
  await keys(115, 225);
  await advance(100);
  expect(fixtures.highlight).toHaveBeenCalled();
  await act(async () => fixtures.invalidate?.());
  fixtures.highlight.mockClear();
  await keys(115, 225);
  await advance(100);
  // Contact feedback still highlights; the interrupted session records nothing.
  expect(fixtures.takes.at(-1)!.notes).toHaveLength(1);
});

it("records a same-turn press before Stop drains deferred consumers", async () => {
  await start();
  await keys(115);
  await click(button("Stop recording"));
  expect(fixtures.takes.at(-1)!.notes).toMatchObject([{ pitch: "C3", velocity: 80, durationMs: 0 }]);
});

it("checks markers immediately and then only every ten seconds", async () => {
  expect(fixtures.detect).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 99; i++) {
    await advance(100);
    await frame();
  }
  expect(fixtures.detect).toHaveBeenCalledTimes(1);
  await advance(100);
  await frame();
  expect(fixtures.detect).toHaveBeenCalledTimes(2);
});

it("plays before recording, during count-in and pause, and after Stop", async () => {
  const enable = [...host.querySelectorAll("button")].find(b => b.textContent === "Enable audio")!;
  await click(enable);
  expect(fixtures.initializeAudio).toHaveBeenCalled();
  vi.mocked(browserAudio.noteOn).mockClear();
  vi.mocked(browserAudio.releaseAll).mockClear();
  await keys(115);
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(1);
  expect(fixtures.takes).toEqual([]);
  await click(button("Start recording"));
  await keys(115, 225);
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(2);
  await countIn();
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(2); // No audio retrigger at recording boundary.
  await advance(100);
  await click(button("Pause recording"));
  await keys(115);
  expect(browserAudio.noteOff).toHaveBeenCalled();
  await keys(115, 225);
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(3);
  await click(button("Stop recording"));
  expect(browserAudio.releaseAll).not.toHaveBeenCalled();
  expect(fixtures.takes.at(-1)!.notes).toHaveLength(2);
  expect(fixtures.takes.at(-1)!.notes.every(n => n.startMs === 0 && n.durationMs === 100)).toBe(true);
  await keys();
  await keys(115);
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(4);
});

it("releases free-play notes when calibration becomes invalid", async () => {
  await click([...host.querySelectorAll("button")].find(b => b.textContent === "Enable audio")!);
  await keys(115);
  vi.mocked(browserAudio.releaseAll).mockClear();
  localStorage.removeItem("makeshift.calibration.v1");
  await advance(10_000);
  await frame();
  expect(browserAudio.releaseAll).toHaveBeenCalled();
  vi.mocked(browserAudio.noteOn).mockClear();
  await keys(225);
  expect(browserAudio.noteOn).not.toHaveBeenCalled();
});


it("invalidates free play on frame loss without waiting for the marker interval", async () => {
  await click([...host.querySelectorAll("button")].find(b => b.textContent === "Enable audio")!);
  await keys(115);
  vi.mocked(browserAudio.releaseAll).mockClear();
  vi.spyOn(HTMLVideoElement.prototype, "readyState", "get").mockReturnValue(0);
  await advance(100);
  await frame();
  expect(browserAudio.releaseAll).toHaveBeenCalled();
  expect(button("Start recording").disabled).toBe(true);
  vi.spyOn(HTMLVideoElement.prototype, "readyState", "get").mockReturnValue(4);
  await frame();
  expect(fixtures.detect).toHaveBeenCalledTimes(2);
  expect(button("Start recording").disabled).toBe(false);
});

it("ignores pending free-play audio initialization after calibration loss", async () => {
  let resolveAudio!: () => void;
  fixtures.initializeAudio.mockImplementation(() => new Promise<void>(resolve => { resolveAudio = resolve; }));
  await click([...host.querySelectorAll("button")].find(b => b.textContent === "Enable audio")!);
  localStorage.removeItem("makeshift.calibration.v1");
  await advance(10_000);
  await frame();
  await act(async () => resolveAudio());
  vi.mocked(browserAudio.noteOn).mockClear();
  await keys(115);
  expect(browserAudio.noteOn).not.toHaveBeenCalled();
  expect(button("Start recording").disabled).toBe(true);
});
