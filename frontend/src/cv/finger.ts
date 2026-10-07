import {
  CONTACT_RELEASE_GRACE_MS,
  CONTACT_PREDICTION_CONFIRMATION_MS,
  CONTACT_SHADOW_MAX_AGE_MS,
  type FingerContactEvaluation,
  type FingerContactGate,
  type FingerContactState,
} from "./combinedContact";
import type { ShadowContactState } from "./shadowHeuristics";

interface FingerCheckOptions {
  shadowsEnabled?: boolean;
  zMotionPredicted?: boolean;
}

interface ShadowObservation {
  state: ShadowContactState;
  frameAtMs: number;
}

/** Owns contact state and transition decisions for one tracked fingertip. */
export class Finger {
  contact: FingerContactEvaluation | null = null;
  gate: FingerContactGate | null = null;
  private nowMs = 0;
  private observation?: ShadowObservation;
  private shadowsEnabled = true;
  private zMotionPredicted = false;
  private freshObservation = false;

  constructor(readonly id: string) {}

  /** Refresh this finger's inputs, then dispatch to its current state handler. */
  checkState(
    gate: FingerContactGate,
    nowMs: number,
    observation?: ShadowObservation,
    options: FingerCheckOptions = {},
  ): FingerContactEvaluation {
    this.gate = gate;
    this.nowMs = nowMs;
    this.observation = observation;
    this.shadowsEnabled = options.shadowsEnabled !== false;
    this.zMotionPredicted = options.zMotionPredicted === true;
    this.freshObservation = Boolean(
      observation &&
        Number.isFinite(observation.frameAtMs) &&
        observation.frameAtMs <= nowMs &&
        nowMs - observation.frameAtMs <= CONTACT_SHADOW_MAX_AGE_MS &&
        (this.contact?.shadowFrameAtMs == null ||
          observation.frameAtMs > this.contact.shadowFrameAtMs),
    );

    switch (this.contact?.state) {
      case "pressed":
        return this.handlePressed();
      case "predicted":
        return this.handlePredicted();
      case "releasing":
        return this.handleReleasing();
      case "ready":
        return this.handleReady();
      case "hover":
        return this.handleHover();
      case "unavailable":
      case undefined:
        return this.handleUnavailable();
    }
  }

  handlePressed(): FingerContactEvaluation {
    if (!this.gateAvailable()) return this.enterUnavailable();
    if (!this.canContact()) return this.enterHover();
    if (!this.shadowsEnabled) return this.keepPressedIfLandmarksFresh();

    const frameAtMs = this.currentShadowFrameAtMs();
    if (frameAtMs === null) return this.staySame("pressed");
    if (this.shadowIsStale(frameAtMs))
      return this.startOrContinueRelease(frameAtMs, "unknown");
    if (this.shadowState() === "press candidate")
      return this.staySame("pressed", frameAtMs);

    return this.startOrContinueRelease(frameAtMs);
  }

  handlePredicted(): FingerContactEvaluation {
    if (!this.gateAvailable()) return this.enterUnavailable();
    if (!this.canContact()) return this.enterHover();
    if (!this.shadowsEnabled) return this.keepPressedIfLandmarksFresh();

    const frameAtMs = this.currentShadowFrameAtMs();
    if (
      frameAtMs !== null &&
      !this.shadowIsStale(frameAtMs) &&
      this.shadowState() === "press candidate"
    ) {
      return this.enterPressed(frameAtMs);
    }

    const predictionStartedAtMs = this.contact?.predictionStartedAtMs;
    if (
      predictionStartedAtMs !== null &&
      predictionStartedAtMs !== undefined &&
      this.nowMs - predictionStartedAtMs >=
        CONTACT_PREDICTION_CONFIRMATION_MS
    ) {
      // The predicted note was not confirmed. Becoming inactive sends its
      // note-off through the normal key-transition path.
      return this.enterReady();
    }

    return this.staySame("predicted", frameAtMs);
  }

  handleReleasing(): FingerContactEvaluation {
    if (!this.gateAvailable()) return this.enterUnavailable();
    if (!this.canContact()) return this.enterHover();
    if (!this.shadowsEnabled) return this.keepPressedIfLandmarksFresh();

    const frameAtMs = this.currentShadowFrameAtMs();
    if (frameAtMs === null) return this.staySame("releasing");

    // Restore pressed state and clear the release timer without retriggering.
    if (
      !this.shadowIsStale(frameAtMs) &&
      this.shadowState() === "press candidate"
    ) {
      return this.enterPressed(frameAtMs);
    }
    return this.startOrContinueRelease(
      frameAtMs,
      this.shadowIsStale(frameAtMs) ? "unknown" : this.shadowState(),
    );
  }

  handleReady(): FingerContactEvaluation {
    if (!this.gateAvailable()) return this.enterUnavailable();
    if (!this.canContact()) return this.enterHover();
    if (!this.shadowsEnabled) return this.keepPressedIfLandmarksFresh();
    if (this.zMotionPredicted) return this.enterPredicted();

    const frameAtMs = this.currentShadowFrameAtMs();
    if (frameAtMs === null) return this.staySame("ready");
    if (this.shadowIsStale(frameAtMs)) return this.staySame("ready");
    if (this.shadowState() === "press candidate")
      return this.enterPressed(frameAtMs);
    // Hover and unknown shadow results are not press evidence.
    return this.staySame("ready", frameAtMs);
  }

  handleHover(): FingerContactEvaluation {
    if (!this.gateAvailable()) return this.enterUnavailable();
    if (!this.canContact()) return this.staySame("hover", null);
    // Crossing into the playing zone starts in ready; shadow can confirm below.
    this.enterReady();
    return this.handleReady();
  }

  handleUnavailable(): FingerContactEvaluation {
    if (!this.gateAvailable()) return this.staySame("unavailable");
    if (!this.canContact()) return this.enterHover();
    // Recovery only restores eligibility. Ready evaluates evidence on the
    // next state check, including fresh landmarks in shadow-free debug modes.
    const frameAtMs = this.shadowsEnabled
      ? this.currentShadowFrameAtMs()
      : null;
    return this.enterReady(frameAtMs);
  }

  reset() {
    this.contact = null;
    this.gate = null;
    this.observation = undefined;
    this.freshObservation = false;
    this.zMotionPredicted = false;
  }

  private gateAvailable(): boolean {
    return this.gate?.available === true;
  }

  private canContact(): boolean {
    return Boolean(
      this.gate &&
        this.gate.keyIndexes.length > 0 &&
        this.gate.knuckleEligible,
    );
  }

  private keepPressedIfLandmarksFresh(): FingerContactEvaluation {
    const frameAtMs = this.gate?.frameAtMs;
    if (
      frameAtMs === undefined ||
      !Number.isFinite(frameAtMs) ||
      frameAtMs > this.nowMs ||
      this.nowMs - frameAtMs > CONTACT_SHADOW_MAX_AGE_MS
    )
      return this.enterUnavailable();
    return this.enterPressed(null);
  }

  private startOrContinueRelease(
    frameAtMs: number,
    shadowState = this.shadowState(),
  ): FingerContactEvaluation {
    const previous = this.contact;
    const releaseStartedAtMs = previous?.releaseStartedAtMs ?? this.nowMs;
    if (
      previous?.active &&
      this.nowMs - releaseStartedAtMs < CONTACT_RELEASE_GRACE_MS
    ) {
      this.contact = {
        state: "releasing",
        active: true,
        shadow: shadowState,
        shadowFrameAtMs: frameAtMs,
        releaseStartedAtMs,
      };
      return this.contact;
    }
    this.contact = {
      state: "ready",
      active: false,
      shadow: shadowState,
      shadowFrameAtMs: frameAtMs,
      releaseStartedAtMs: null,
    };
    return this.contact;
  }

  private enterPressed(
    frameAtMs: number | null,
  ): FingerContactEvaluation {
    this.contact = {
      state: "pressed",
      active: true,
      shadow: this.shadowState(),
      shadowFrameAtMs: frameAtMs,
      releaseStartedAtMs: null,
      predictionStartedAtMs: null,
    };
    return this.contact;
  }

  private enterPredicted(): FingerContactEvaluation {
    this.contact = {
      state: "predicted",
      active: true,
      shadow: this.shadowState(),
      shadowFrameAtMs: this.currentShadowFrameAtMs(),
      releaseStartedAtMs: null,
      predictionStartedAtMs: this.nowMs,
    };
    return this.contact;
  }

  private enterReady(
    frameAtMs: number | null = null,
  ): FingerContactEvaluation {
    this.contact = {
      state: "ready",
      active: false,
      shadow: frameAtMs === null ? "unknown" : this.shadowState(),
      shadowFrameAtMs: frameAtMs,
      releaseStartedAtMs: null,
      predictionStartedAtMs: null,
    };
    return this.contact;
  }

  /** Preserve the current state while refreshing the latest shadow evidence. */
  private staySame(
    initialState: FingerContactState = this.contact?.state ?? "ready",
    frameAtMs: number | null = this.contact?.shadowFrameAtMs ?? null,
  ): FingerContactEvaluation {
    if (!this.contact) {
      this.contact = {
        state: initialState,
        active: false,
        shadow: frameAtMs === null ? "unknown" : this.shadowState(),
        shadowFrameAtMs: frameAtMs,
        releaseStartedAtMs: null,
      };
      return this.contact;
    }
    this.contact = {
      ...this.contact,
      shadow: frameAtMs === null ? this.contact.shadow : this.shadowState(),
      shadowFrameAtMs: frameAtMs,
    };
    return this.contact;
  }

  private enterHover(): FingerContactEvaluation {
    this.contact = {
      state: "hover",
      active: false,
      shadow: "unknown",
      shadowFrameAtMs: null,
      releaseStartedAtMs: null,
    };
    return this.contact;
  }

  private enterUnavailable(
    frameAtMs: number | null = null,
  ): FingerContactEvaluation {
    this.contact = {
      state: "unavailable",
      active: false,
      shadow: "unknown",
      shadowFrameAtMs: frameAtMs,
      releaseStartedAtMs: null,
    };
    return this.contact;
  }

  private shadowIsStale(frameAtMs: number): boolean {
    return this.nowMs - frameAtMs > CONTACT_SHADOW_MAX_AGE_MS;
  }

  private currentShadowFrameAtMs(): number | null {
    return this.freshObservation
      ? this.observation!.frameAtMs
      : (this.contact?.shadowFrameAtMs ?? null);
  }

  private shadowState(): ShadowContactState {
    return this.freshObservation
      ? this.observation!.state
      : (this.contact?.shadow ?? "unknown");
  }
}
