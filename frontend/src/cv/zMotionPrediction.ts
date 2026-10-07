import {
  DEPTH_BOUNDARY_SIDE,
  type DepthLineCoefficients,
} from "./depthCalibration";

/** Extra normalized sheet Y below the calibrated zLine required for crossing. */
export const Z_LINE_TOLERANCE = 0;
export const Z_MOTION_HISTORY_WINDOW_MS = 150;
const Z_MOTION_MIN_PRIOR_SAMPLES = 2;

export interface ZMotionSample {
  timestampMs: number;
  z: number;
}

export interface ZFingerPosition extends ZMotionSample {
  sheetY: number;
}

export interface ZMotionPredictionInput {
  /** Prior samples for this fingertip, ordered from oldest to newest. */
  history: readonly ZMotionSample[];
  /** Calibrated per-finger mapping from MediaPipe z to expected sheet Y. */
  zLine: DepthLineCoefficients;
  /** Current fingertip z, sheet Y, and observation timestamp. */
  current: ZFingerPosition;
  /** Only prior samples within this many milliseconds may establish movement. */
  historyWindowMs: number;
}

export interface ZMotionPrediction {
  predicted: boolean;
  boundaryCrossed: boolean;
  downwardDelta: number | null;
  downwardTrend: boolean;
}

/**
 * Evaluate early press evidence for one fingertip without changing contact
 * state or dispatching note events. A decrease in MediaPipe z is treated as
 * downward. The zLine tolerance is applied only to its sheet-position test.
 */
export function evaluateZMotionPrediction({
  history,
  zLine,
  current,
  historyWindowMs,
}: ZMotionPredictionInput): ZMotionPrediction {
  const expectedSheetY = zLine.slope * current.z + zLine.intercept;
  const boundaryCrossed =
    Number.isFinite(current.z) &&
    Number.isFinite(current.sheetY) &&
    Number.isFinite(expectedSheetY) &&
    (DEPTH_BOUNDARY_SIDE === "greater"
      ? current.sheetY >= expectedSheetY + Z_LINE_TOLERANCE
      : current.sheetY <= expectedSheetY - Z_LINE_TOLERANCE);

  if (
    !Number.isFinite(current.timestampMs) ||
    !Number.isFinite(current.z) ||
    !Number.isFinite(historyWindowMs) ||
    historyWindowMs <= 0
  ) {
    return {
      predicted: false,
      boundaryCrossed,
      downwardDelta: null,
      downwardTrend: false,
    };
  }

  let baseline: ZMotionSample | null = null;
  let sampleCount = 0;
  for (const sample of history) {
    if (
      !Number.isFinite(sample.timestampMs) ||
      !Number.isFinite(sample.z) ||
      sample.timestampMs >= current.timestampMs ||
      current.timestampMs - sample.timestampMs > historyWindowMs
    ) {
      continue;
    }
    sampleCount += 1;
    if (!baseline || sample.timestampMs < baseline.timestampMs) {
      baseline = sample;
    }
  }

  if (!baseline || sampleCount < Z_MOTION_MIN_PRIOR_SAMPLES) {
    return {
      predicted: false,
      boundaryCrossed,
      downwardDelta: null,
      downwardTrend: false,
    };
  }

  const downwardDelta = baseline.z - current.z;
  const downwardTrend = downwardDelta > 0;

  return {
    predicted: boundaryCrossed && downwardTrend,
    boundaryCrossed,
    downwardDelta,
    downwardTrend,
  };
}
