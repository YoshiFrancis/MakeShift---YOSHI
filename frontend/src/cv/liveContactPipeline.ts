import {
  FINGERTIP_LANDMARK_INDICES,
  type Fingertip,
  type HandObservation,
} from "./collision";
import {
  type FingerContactEvaluation,
  type FingerContactGate,
} from "./combinedContact";
import { Finger } from "./finger";
import {
  checkKeyOverlap,
  checkKnuckleEligibility,
  checkShadowContact,
} from "./contactPipeline";
import {
  DEPTH_FINGERS,
  getKnuckleDistance,
  type PersistedDepthCalibration,
} from "./depthCalibration";
import {
  evaluateZMotionPrediction,
  Z_MOTION_HISTORY_WINDOW_MS,
  type ZMotionSample,
} from "./zMotionPrediction";
import type {
  ShadowContactEvaluation,
  ShadowMeasurement,
  ShadowObservation,
  ShadowWorkerResponse,
} from "./shadowHeuristics";
import type { Point } from "./types";

export const SHADOW_CROP_RADIUS = 70;
const SHADOW_INTERVAL_MS = 10;

export interface ContactTechniques {
  knuckles: boolean;
  shadows: boolean;
}

// Change these independently to debug either technique. Key overlap is required.
// Both false isolates key overlap for debugging, without knuckles or shadows.
export const CONTACT_TECHNIQUES: Readonly<ContactTechniques> = {
  knuckles: false,
  shadows: false,
};

export interface ContactPipelineFrame {
  video: HTMLVideoElement | null;
  fingertips: readonly Fingertip[];
  hands: readonly HandObservation[];
  whiteKeys: Point[][] | null;
  calibration: PersistedDepthCalibration | null;
  previewFingerId: string | null;
}

interface PipelineCallbacks {
  onContactsChanged: (refreshDebug?: boolean) => void;
  onShadowCameraPreview: (crop: HTMLCanvasElement | null, center: Point) => void;
  onShadowPreview: (
    observation: ShadowObservation,
    contact: ShadowContactEvaluation,
  ) => void;
  onError: (message: string) => void;
}

/** Owns live eligibility, shadow work/history, and press/release timing. */
export class LiveContactPipeline {
  readonly fingers = new Map<string, Finger>();
  readonly gates = new Map<string, FingerContactGate>();
  readonly contacts = new Map<string, FingerContactEvaluation>();
  readonly observations = new Map<string, ShadowObservation>();
  readonly shadowContacts = new Map<string, ShadowContactEvaluation>();
  private readonly measurements = new Map<string, ShadowMeasurement>();
  private readonly zHistories = new Map<string, ZMotionSample[]>();
  private readonly zPredictionLatched = new Set<string>();
  private worker: Worker | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private inFlight = false;
  private cropCanvas: HTMLCanvasElement | null = null;
  private lastFrameAtMs = -Infinity;
  private revision = 0;
  private previewFingerId: string | null = null;

  readonly techniques: Readonly<ContactTechniques>;

  constructor(
    private readonly callbacks: PipelineCallbacks,
    techniques: ContactTechniques = CONTACT_TECHNIQUES,
  ) {
    this.techniques = { ...techniques };
  }

  start() {
    if (this.techniques.shadows)
      try {
        const worker = new Worker(
          new URL("./shadowWorker.ts", import.meta.url),
          {
            type: "module",
          },
        );
        this.worker = worker;
        worker.onmessage = ({ data }: MessageEvent<ShadowWorkerResponse>) =>
          this.receiveShadows(data);
        worker.onerror = (event) => {
          if (this.disposed) return;
          worker.terminate();
          this.worker = null;
          this.inFlight = false;
          this.measurements.clear();
          this.observations.clear();
          this.shadowContacts.clear();
          this.zHistories.clear();
          this.zPredictionLatched.clear();
          this.contacts.clear();
          this.callbacks.onContactsChanged();
          this.callbacks.onError(
            event.message || "Worker failed without an error message",
          );
        };
      } catch (error) {
        this.callbacks.onError(
          error instanceof Error ? error.message : "Unable to start worker",
        );
      }
    // Releases and stale-contact handling never wait for the worker or React.
    this.timer = setInterval(() => {
      if (this.disposed) return;
      const now = performance.now();
      let changed = false;
      for (const [id, previous] of this.contacts) {
        const gate = this.gates.get(id);
        if (!gate) continue;
        const finger = this.fingers.get(id);
        if (!finger) continue;
        finger.contact = previous;
        const next = finger.checkState(gate, now, undefined, {
          shadowsEnabled: this.techniques.shadows,
        });
        this.contacts.set(id, next);
        changed ||= next.state !== previous.state;
      }
      if (changed) this.callbacks.onContactsChanged(true);
    }, 20);
  }

  reset() {
    for (const finger of this.fingers.values()) finger.reset();
    this.fingers.clear();
    this.contacts.clear();
    this.gates.clear();
    this.measurements.clear();
    this.observations.clear();
    this.shadowContacts.clear();
    this.zHistories.clear();
    this.zPredictionLatched.clear();
    // Keep revisions monotonic so pending results cannot enter a new session.
    this.callbacks.onContactsChanged();
  }

  dispose() {
    this.disposed = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.worker?.terminate();
    this.worker = null;
    this.reset();
  }

  /** Main pipeline: overlap -> knuckles -> asynchronous shadow check. */
  processFrame(frame: ContactPipelineFrame): boolean {
    if (this.disposed) return false;
    const now = performance.now();
    this.previewFingerId = frame.previewFingerId;
    const activeIds = new Set<string>();
    const knuckleDistances = new Map<number, number | null>();

    for (const fingertip of frame.fingertips) {
      const hand = frame.hands[fingertip.handIndex];
      const fingerIndex = FINGERTIP_LANDMARK_INDICES.indexOf(
        fingertip.landmarkIndex as (typeof FINGERTIP_LANDMARK_INDICES)[number],
      );
      if (!hand || fingerIndex < 0) continue;
      activeIds.add(fingertip.id);
      const previousGate = this.gates.get(fingertip.id);
      const sourceIdentity = `${hand.handedness}:${frame.video?.videoWidth}:${frame.video?.videoHeight}`;
      const sameSource = previousGate?.sourceIdentity === sourceIdentity;
      let distance: number | null = null;
      if (this.techniques.knuckles) {
        if (!knuckleDistances.has(fingertip.handIndex))
          knuckleDistances.set(
            fingertip.handIndex,
            getKnuckleDistance(hand.landmarks),
          );
        distance = knuckleDistances.get(fingertip.handIndex) ?? null;
      }
      const screenY =
        frame.video && frame.video.videoHeight > 0
          ? fingertip.point.y / frame.video.videoHeight
          : null;
      const available = Boolean(
        frame.whiteKeys &&
        frame.video &&
        frame.video.readyState >= 2 &&
        hand.landmarks[fingertip.landmarkIndex] &&
        (!this.techniques.knuckles ||
          (frame.calibration && distance !== null && screenY !== null)) &&
        (!this.techniques.shadows || this.worker),
      );

      // 1. Which key is under the fingertip?
      const keyIndexes = checkKeyOverlap(fingertip, frame.whiteKeys);
      const keyOverlap = keyIndexes.length > 0;

      // 2. Do the knuckles place this finger in the playing zone?
      const knuckleEligible =
        available &&
        keyOverlap &&
        (!this.techniques.knuckles ||
          checkKnuckleEligibility({
            calibration: frame.calibration,
            finger: DEPTH_FINGERS[fingerIndex],
            knuckleDistance: distance,
            fingertipScreenY: screenY,
            previouslyEligible:
              sameSource && previousGate?.knuckleEligible === true,
          }));

      const keysChanged =
        !previousGate ||
        previousGate.keyIndexes.length !== keyIndexes.length ||
        previousGate.keyIndexes.some((key, index) => key !== keyIndexes[index]);

      const gateChanged =
        !sameSource ||
        keysChanged ||
        previousGate?.available !== available ||
        previousGate?.knuckleEligible !== knuckleEligible;

      let zMotionPredicted = false;
      const fingertipZ = hand.landmarks[fingertip.landmarkIndex]?.z;
      const canEvaluateZMotion = Boolean(
        this.techniques.knuckles &&
          this.techniques.shadows &&
          frame.calibration &&
          keyOverlap &&
          knuckleEligible &&
          screenY !== null &&
          fingertipZ !== undefined &&
          Number.isFinite(fingertipZ),
      );
      if (!canEvaluateZMotion || gateChanged) {
        this.zHistories.delete(fingertip.id);
        this.zPredictionLatched.delete(fingertip.id);
      }
      if (
        canEvaluateZMotion &&
        screenY !== null &&
        fingertipZ !== undefined &&
        frame.calibration
      ) {
        const finger = DEPTH_FINGERS[fingerIndex];
        const history = this.zHistories.get(fingertip.id) ?? [];
        const prediction = evaluateZMotionPrediction({
          history,
          zLine: frame.calibration.zLines[finger],
          current: { timestampMs: now, z: fingertipZ, sheetY: screenY },
          historyWindowMs: Z_MOTION_HISTORY_WINDOW_MS,
        });
        if (!prediction.boundaryCrossed)
          this.zPredictionLatched.delete(fingertip.id);
        zMotionPredicted = Boolean(
          this.techniques.shadows &&
            prediction.predicted &&
            !this.zPredictionLatched.has(fingertip.id),
        );
        if (zMotionPredicted) this.zPredictionLatched.add(fingertip.id);

        const cutoffMs = now - Z_MOTION_HISTORY_WINDOW_MS;
        history.push({ timestampMs: now, z: fingertipZ });
        this.zHistories.set(
          fingertip.id,
          history.filter((sample) => sample.timestampMs >= cutoffMs),
        );
      }

      const gate: FingerContactGate = {
        available,
        keyIndexes,
        knuckleEligible,
        sourceIdentity,
        revision: gateChanged ? ++this.revision : previousGate!.revision,
        frameAtMs: now,
      };

      if (
        !keyOverlap ||
        !knuckleEligible ||
        keysChanged ||
        !sameSource
      ) {
        this.shadowContacts.delete(fingertip.id);
        this.measurements.delete(fingertip.id);
        this.observations.delete(fingertip.id);
      }

      this.gates.set(fingertip.id, gate);
      const finger = this.fingers.get(fingertip.id) ?? new Finger(fingertip.id);
      this.fingers.set(fingertip.id, finger);
      if (gateChanged) finger.reset();
      const contact = finger.checkState(
        gate,
        now,
        undefined,
        {
          shadowsEnabled: this.techniques.shadows,
          zMotionPredicted,
        },
      );
      this.contacts.set(fingertip.id, contact);

    }

    for (const map of [
      this.gates,
      this.contacts,
      this.measurements,
      this.observations,
      this.shadowContacts,
      this.fingers,
      this.zHistories,
      this.zPredictionLatched,
    ]) {
      for (const id of map.keys()) if (!activeIds.has(id)) map.delete(id);
    }
    this.callbacks.onContactsChanged();

    // 3. Check shadows. Fresh results update contact asynchronously below.
    return this.techniques.shadows && this.checkShadows(frame, now);
  }

  private checkShadows(
    frame: ContactPipelineFrame,
    frameAtMs: number,
  ): boolean {
    const { video } = frame;
    const fingers = frame.fingertips.filter((finger) => {
      const gate = this.gates.get(finger.id);
      return Boolean(
        gate &&
          gate.keyIndexes.length > 0 &&
          gate.knuckleEligible &&
          frame.hands[finger.handIndex],
      );
    });
    const previewFinger = frame.fingertips.find(
      (finger) => finger.id === this.previewFingerId,
    );
    // The selected debug finger may be sampled off-key for preview only;
    // its gate still prevents this diagnostic result from activating contact.
    if (
      previewFinger &&
      frame.hands[previewFinger.handIndex] &&
      !fingers.some((finger) => finger.id === previewFinger.id)
    )
      fingers.push(previewFinger);
    if (
      !video ||
      !this.worker ||
      this.inFlight ||
      fingers.length === 0 ||
      video.readyState < 2 ||
      frameAtMs - this.lastFrameAtMs < SHADOW_INTERVAL_MS ||
      video.videoWidth <= 0 ||
      video.videoHeight <= 0
    )
      return false;
    const canvas = this.cropCanvas ?? document.createElement("canvas");
    this.cropCanvas = canvas;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    const crops = fingers.map((finger) => {
      const virtualLeft = Math.round(finger.point.x) - SHADOW_CROP_RADIUS;
      const virtualTop = Math.round(finger.point.y) - SHADOW_CROP_RADIUS;
      const left = Math.max(0, virtualLeft);
      const top = Math.max(0, virtualTop);
      const right = Math.min(
        video.videoWidth,
        virtualLeft + SHADOW_CROP_RADIUS * 2,
      );
      const bottom = Math.min(
        video.videoHeight,
        virtualTop + SHADOW_CROP_RADIUS * 2,
      );
      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);
      // Setting either dimension resets the canvas bitmap, even when unchanged.
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      if (width > 0 && height > 0)
        context.drawImage(video, left, top, width, height, 0, 0, width, height);
      const imageData =
        width > 0 && height > 0
          ? context.getImageData(0, 0, width, height)
          : new ImageData(1, 1);
      const center = {
        x: finger.point.x - left,
        y: finger.point.y - top,
      };
      if (finger.id === this.previewFingerId)
        this.callbacks.onShadowCameraPreview(
          width > 0 && height > 0 ? canvas : null,
          center,
        );
      return {
        id: finger.id,
        imageData,
        center,
        previous: this.measurements.get(finger.id) ?? null,
        keyOverlap: (this.gates.get(finger.id)?.keyIndexes.length ?? 0) > 0,
        contactRevision: this.gates.get(finger.id)?.revision ?? -1,
      };
    });
    this.lastFrameAtMs = frameAtMs;
    this.inFlight = true;
    this.worker.postMessage(
      {
        radius: SHADOW_CROP_RADIUS,
        frameAtMs,
        previewFingerId: this.previewFingerId,
        fingers: crops,
      },
      crops.map(({ imageData }) => imageData.data.buffer),
    );
    return true;
  }

  private receiveShadows(data: ShadowWorkerResponse) {
    if (this.disposed) return;
    this.inFlight = false;
    const now = performance.now();
    const accepted: typeof data.observations = [];
    for (const result of data.observations) {
      const { id, observation, keyOverlap, contactRevision } = result;
      const gate = this.gates.get(id);
      if (!gate || gate.revision !== contactRevision) continue;
      const contact = checkShadowContact({
        observation,
        frameAtMs: data.frameAtMs,
        previous: this.shadowContacts.get(id) ?? null,
        sampledKeyOverlap: keyOverlap,
        currentKeyOverlap: gate.keyIndexes.length > 0,
      });
      this.shadowContacts.set(id, contact);
      this.measurements.set(id, observation.measurement);
      this.observations.set(id, observation);
      const finger = this.fingers.get(id);
      if (!finger) continue;
      finger.contact = this.contacts.get(id) ?? null;
      this.contacts.set(
        id,
        finger.checkState(gate, now, {
          state: contact.state,
          frameAtMs: data.frameAtMs,
        }),
      );
      accepted.push(result);
    }
    // Audio/contact callbacks run before preview drawing or diagnostic updates.
    this.callbacks.onContactsChanged(true);
    for (const { id, observation } of accepted) {
      if (id === this.previewFingerId && observation.mask) {
        this.callbacks.onShadowPreview(
          observation,
          this.shadowContacts.get(id)!,
        );
      }
    }
  }
}
