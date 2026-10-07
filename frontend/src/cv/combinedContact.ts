import type { ShadowContactState } from "./shadowHeuristics";

export type FingerContactState =
  | "unavailable"
  | "hover"
  | "ready"
  | "predicted"
  | "pressed"
  | "releasing";

export const CONTACT_RELEASE_GRACE_MS = 60;
export const CONTACT_SHADOW_MAX_AGE_MS = 150;
export const CONTACT_PREDICTION_CONFIRMATION_MS = 150;

export interface FingerContactEvaluation {
  state: FingerContactState;
  active: boolean;
  shadow: ShadowContactState;
  shadowFrameAtMs: number | null;
  releaseStartedAtMs: number | null;
  predictionStartedAtMs?: number | null;
}

export interface FingerContactGate {
  available: boolean;
  keyIndexes: readonly number[];
  knuckleEligible: boolean;
  sourceIdentity: string;
  revision: number;
  // Latest landmark frame, used when debugging without shadow confirmation.
  frameAtMs?: number;
}
