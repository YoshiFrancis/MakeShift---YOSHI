import { acquireResource, trackAudioContext, closeTrackedAudioContext } from "../../diagnostics/performanceMetrics";
export type AudioStatus = "idle" | "loading" | "ready" | "suspended" | "error";
type AudioCommand =
  | { type: "reset" | "release-all"; session: number }
  | {
      type: "note-on";
      session: number;
      press: number;
      note: number;
      velocity: number;
    }
  | { type: "note-off"; session: number; press: number };

/** Owns one context. Call initialize only from a user gesture. */
export class BrowserAudio {
  private releaseNode: (() => void) | undefined;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private initializing: Promise<void> | null = null;
  private session = 0;
  private press = 0;
  private outstanding = 0;
  private recovering = false;
  private generation = 0;
  private invalidationListeners = new Set<() => void>();
  status: AudioStatus = "idle";
  error = "";

  /** Shared sessions retire their presses whenever this transport invalidates them. */
  subscribeInvalidation(listener: () => void): () => void {
    this.invalidationListeners.add(listener);
    return () => {
      this.invalidationListeners.delete(listener);
    };
  }

  private invalidate() {
    for (const listener of this.invalidationListeners) {
      try {
        listener();
      } catch {
        /* One owner cannot prevent transport recovery. */
      }
    }
  }

  private reset() {
    this.session++;
    this.press = 0;
    if (this.node) {
      this.node.port.postMessage({ type: "reset", session: this.session });
      this.outstanding++;
    }
    this.invalidate();
  }

  initialize(): Promise<void> {
    if (this.initializing) return this.initializing;
    if (this.status === "ready" && this.context?.state === "running")
      return Promise.resolve();
    const generation = ++this.generation;
    const task = this.start(generation);
    this.initializing = task;
    void task
      .finally(() => {
        if (this.initializing === task) this.initializing = null;
      })
      .catch(() => {});
    return task;
  }

  private async start(generation: number) {
    this.status = "loading";
    this.error = "";
    try {
      if (!this.context || this.context.state === "closed") {
        this.context = trackAudioContext(new AudioContext({ latencyHint: "interactive" }));
      }
      const context = this.context;
      // Invoke resume before any await to retain user activation.
      const resumed = context.resume();
      const loaded = this.node
        ? Promise.resolve()
        : context.audioWorklet.addModule("/audio/piano-worklet.js");
      await Promise.all([resumed, loaded]);
      if (generation !== this.generation) return;
      if (context.state !== "running")
        throw new Error("Audio is suspended. Select Enable audio to retry.");
      if (!this.node) {
        const node = new AudioWorkletNode(context, "makeshift-piano", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        this.node = node;
        this.releaseNode = acquireResource("audioNodes");
        this.outstanding = 0;
        this.recovering = false;
        node.port.onmessage = ({ data }) => {
          if (this.node !== node) return;
          if (!Number.isSafeInteger(data) || data < 1) return;
          this.outstanding = Math.max(0, this.outstanding - data);
          if (this.outstanding === 0) this.recovering = false;
        };
        node.onprocessorerror = () => {
          if (this.node !== node) return;
          this.status = "error";
          this.error = "Audio processing failed. Select Enable audio to retry.";
          node.disconnect();
          node.port.close();
          this.releaseNode?.();
          if (this.node === node) this.node = null;
          this.outstanding = 0;
          this.recovering = false;
          this.invalidate();
        };
        node.connect(context.destination);
        context.onstatechange = () => {
          if (context !== this.context || context.state === "running") return;
          this.status = "suspended";
          this.releaseAll();
        };
      }
      if (!this.recovering) this.reset();
      this.status = "ready";
    } catch (error) {
      if (generation !== this.generation) return;
      this.status = "error";
      this.error =
        error instanceof Error ? error.message : "Audio initialization failed.";
      this.node?.disconnect();
      this.node?.port.close();
      this.releaseNode?.();
      this.node = null;
      this.invalidate();
      const context = this.context;
      this.context = null;
      if (context) {
        context.onstatechange = null;
        await closeTrackedAudioContext(context).catch(() => {});
      }
      throw new Error(this.error);
    }
  }

  private send(event: AudioCommand): boolean {
    if (
      !this.node ||
      this.context?.state !== "running" ||
      this.status !== "ready" ||
      this.recovering
    )
      return false;
    if (this.outstanding >= 64) {
      this.recovering = true;
      this.reset(); // Reject input until the reset is consumed; never drop only a release.
      return false;
    }
    this.node.port.postMessage(event);
    this.outstanding++;
    return true;
  }

  noteOn(
    note: number,
    velocity = 0.8,
  ): { session: number; press: number } | null {
    if (
      !Number.isInteger(note) ||
      note < 0 ||
      note > 127 ||
      !Number.isFinite(velocity) ||
      velocity <= 0 ||
      velocity > 1
    )
      return null;
    const token = { session: this.session, press: ++this.press };
    return this.send({ type: "note-on", ...token, note, velocity })
      ? token
      : null;
  }

  noteOff(token: { session: number; press: number }) {
    return this.send({ type: "note-off", ...token });
  }

  releaseAll() {
    if (!this.recovering) {
      this.recovering = true;
      this.reset();
    }
  }

  async close() {
    const generation = ++this.generation;
    this.initializing = null;
    this.node?.disconnect();
    this.node?.port.close();
    this.releaseNode?.();
    this.node = null;
    this.invalidate();
    const context = this.context;
    this.context = null;
    if (context) {
      context.onstatechange = null;
      await closeTrackedAudioContext(context);
    }
    if (generation !== this.generation) return;
    this.status = "idle";
    this.outstanding = 0;
    this.recovering = false;
  }
}

export const browserAudio = new BrowserAudio();
