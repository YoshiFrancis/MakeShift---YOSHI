import { pipelineMetrics } from "../diagnostics/performanceMetrics";
import { NoteEvent, parseNoteEvent, toMainTime } from "./noteEvents";

export type Delivery = Readonly<{ event: NoteEvent; receivedAtMs: number }>;
export type NoteSink = (delivery: Delivery) => boolean;
export type DispatchResult =
  | "accepted"
  | "stale"
  | "duplicate"
  | "invalid"
  | "interrupted";

/** One ordered producer per session. Audio is synchronous; other consumers run in a later task. */
export class NoteSession {
  private id: string | null = null;
  private sequence = 0;
  private timestamp = 0;
  private lastPress = 0;
  private active = new Map<number, number>();
  private pending: Delivery[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(delivery: Delivery) => void>();

  constructor(
    private audio: NoteSink,
    private now = () => performance.now(),
  ) {}
  get sessionId() {
    return this.id;
  }
  get activePressCount() {
    return this.active.size;
  }

  start(): string {
    this.stop();
    this.id = crypto.randomUUID();
    this.sequence = this.lastPress = 0;
    this.timestamp = this.now();
    return this.id;
  }
  reset(): string {
    return this.start();
  }
  interrupt() {
    this.stop();
  }

  subscribe(listener: (delivery: Delivery) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Pass a worker's established origin and the main origin when receiving worker data. */
  receive(
    value: unknown,
    clock?: { sourceOriginMs: number; mainOriginMs: number },
  ): DispatchResult {
    let event = parseNoteEvent(value);
    if (!event) {
      // A malformed release cannot safely be discarded while notes are held.
      this.stop();
      return "invalid";
    }
    if (event.sessionId !== this.id) return "stale";
    if (event.sequence <= this.sequence) return "duplicate";
    const receivedAtMs = this.now();
    try {
      if (clock)
        event = Object.freeze({
          ...event,
          timestampMs: toMainTime(
            event.timestampMs,
            clock.sourceOriginMs,
            clock.mainOriginMs,
          ),
        });
    } catch {
      this.stop();
      return "invalid";
    }
    if (
      event.sequence !== this.sequence + 1 ||
      event.timestampMs < this.timestamp ||
      event.timestampMs > receivedAtMs ||
      event.sequence === Number.MAX_SAFE_INTEGER
    ) {
      this.stop();
      return "interrupted";
    }
    if (
      event.type === "note-on" &&
      (event.pressId <= this.lastPress || this.active.size >= 128)
    ) {
      this.stop();
      return "interrupted";
    }
    if (
      event.type === "note-off" &&
      this.active.get(event.pressId) !== event.pitch
    ) {
      this.stop();
      return "interrupted";
    }
    this.sequence = event.sequence;
    this.timestamp = event.timestampMs;
    if (event.type === "release-all") {
      this.finish(Object.freeze({ event, receivedAtMs }));
      return "accepted";
    }
    if (event.type === "note-on") {
      this.lastPress = event.pressId;
      this.active.set(event.pressId, event.pitch);
    } else this.active.delete(event.pressId);
    const delivery = Object.freeze({ event, receivedAtMs });
    let delivered = false;
    try {
      delivered = this.audio(delivery);
    } catch {
      /* Fail closed below. */
    }
    if (!delivered || this.id !== event.sessionId) {
      this.stop();
      return "interrupted";
    }
    if (this.pending.length >= 256) {
      this.stop();
      return "interrupted";
    }
    pipelineMetrics.record("eventDelivery", receivedAtMs - event.timestampMs);
    this.enqueue(delivery);
    return "accepted";
  }

  stop() {
    if (!this.id) return;
    const receivedAtMs = this.now();
    const event: NoteEvent = Object.freeze({
      version: 1,
      type: "release-all",
      sessionId: this.id,
      sequence: this.sequence + 1,
      timestampMs: Math.max(receivedAtMs, this.timestamp),
    });
    this.finish(Object.freeze({ event, receivedAtMs }));
  }

  private finish(delivery: Delivery) {
    // Retire before calling audio: its reset callback may reenter interrupt().
    this.id = null;
    this.active.clear();
    try {
      this.audio(delivery);
    } catch {
      /* Still clear the remaining consumers. */
    }
    // Preserve accepted musical history for recording, then deliver the terminal
    // event. Only overload discards history; its release-all still clears every
    // consumer. These are observer notifications, never inputs replayed to audio.
    if (this.pending.length >= 256) this.pending = [];
    this.enqueue(delivery);
  }

  private enqueue(delivery: Delivery) {
    this.pending.push(delivery);
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.flushObservers();
    }, 0);
  }

  /** Drain accepted history before a recording pause/stop/snapshot boundary.
   * Audio has already received these events; this never dispatches it again. */
  flushObservers() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.pending;
    this.pending = [];
    for (const item of batch) {
      for (const listener of this.listeners) {
        try {
          listener(item);
        } catch {
          /* One observer cannot block another or audio. */
        }
      }
    }
  }
}
