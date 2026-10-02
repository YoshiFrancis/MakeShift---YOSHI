import { toMainTime } from "../events/noteEvents";

export const METRICS = {
  frameInterval:
    "ms between changed media-time polls in hand overlay; can repeat decoded frames",
  presentationInterval:
    "ms between diagnostic video presentation callbacks; gaps can span multiple frames",
  frameAge: "ms from browser presentationTime to callback; not exposure age",
  // Reserved for future worker send/receive instrumentation; currently unavailable.
  transfer:
    "ms from sender post start to receiver entry after origin conversion; includes queueing",
  inference: "ms around synchronous MediaPipe detectForVideo",
  markerDetection: "ms around MarkerDetector.detect; excludes canvas drawImage",
  detection:
    "ms around synchronous live contact processing and shadow submission; excludes asynchronous worker execution",
  eventDelivery:
    "ms from accepted event observation to NoteSession receipt; excludes audio rendering",
} as const;
export type Metric = keyof typeof METRICS;
type Aggregate = { count: number; sum: number; max: number; recent: number[] };
export type RunMetadata = {
  workload: string;
  hardware: string;
  configuration: string;
  commit: string;
  browser: string;
};
const WINDOW = 256;
const MAX_SNAPSHOTS = 32;
export type Resources = {
  workers: number | null;
  mediaTracks: number | null;
  audioContexts: number | null;
  audioNodes: number | null;
  handModels: number | null;
  markerDetectors: number | null;
};
const resources: Resources = {
  workers: null, // Shadow worker ownership is not instrumented.
  mediaTracks: 0,
  audioContexts: 0,
  audioNodes: 0,
  handModels: 0,
  markerDetectors: 0,
};

/** Constant-size lifecycle counters run before profiling starts. No resource references. */
export function acquireResource(kind: keyof Resources): () => void {
  resources[kind] = (resources[kind] ?? 0) + 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    resources[kind] = Math.max(0, (resources[kind] ?? 0) - 1);
  };
}

/** Future worker clock adapter; no production transfer producer exists yet. */
export function crossContextDuration(
  sentMs: number,
  sourceOriginMs: number,
  receivedMs: number,
  mainOriginMs: number,
): number | null {
  try {
    const elapsed =
      receivedMs - toMainTime(sentMs, sourceOriginMs, mainOriginMs);
    return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
  } catch {
    return null;
  }
}

/** Fixed names, aggregate totals and a 256-value rolling sample per stage. */
export class PipelineMetrics {
  enabled = false;
  private metadata: RunMetadata | null = null;
  private started = 0;
  private ended: number | null = null;
  private previousFrame: number | null = null;
  private frames = 0;
  private presentation: { now: number; frame: number } | null = null;
  private presentedAdvance = 0;
  private presentationCallbacks = 0;
  private dropped: number | null = null;
  private stages = new Map<Metric, Aggregate>();
  private snapshots: {
    label: string;
    atMs: number;
    heapBytes: number | null;
    resources: Resources;
  }[] = [];
  private snapshotCount = 0;
  constructor(private now = () => performance.now()) {}
  start(metadata: RunMetadata) {
    this.metadata = Object.fromEntries(
      Object.entries(metadata).map(([k, v]) => [k, v.slice(0, 512)]),
    ) as RunMetadata;
    this.started = this.now();
    this.ended = this.previousFrame = null;
    this.frames = 0;
    this.presentation = null;
    this.presentedAdvance = this.presentationCallbacks = 0;
    this.dropped = null;
    this.stages.clear();
    this.snapshots = [];
    this.snapshotCount = 0;
    this.enabled = true;
  }
  stop() {
    if (this.enabled) this.ended = this.now();
    this.enabled = false;
  }
  record(name: Metric, ms: number) {
    if (
      !this.enabled ||
      !Object.hasOwn(METRICS, name) ||
      !Number.isFinite(ms) ||
      ms < 0
    )
      return;
    let stage = this.stages.get(name);
    if (!stage) {
      stage = { count: 0, sum: 0, max: 0, recent: [] };
      this.stages.set(name, stage);
    }
    stage.recent[stage.count % WINDOW] = ms;
    stage.count++;
    stage.sum += ms;
    stage.max = Math.max(stage.max, ms);
  }
  frame(now: number) {
    if (!this.enabled || !Number.isFinite(now) || now < 0) return;
    if (this.previousFrame !== null && now <= this.previousFrame) return;
    if (this.previousFrame !== null)
      this.record("frameInterval", now - this.previousFrame);
    this.previousFrame = now;
    this.frames++;
  }
  presentedFrame(now: number, frame: number) {
    if (
      !this.enabled ||
      !Number.isFinite(now) ||
      now < 0 ||
      !Number.isSafeInteger(frame) ||
      frame < 0
    )
      return;
    const previous = this.presentation;
    if (previous && (now <= previous.now || frame === previous.frame)) return;
    if (previous && frame > previous.frame) {
      this.record("presentationInterval", now - previous.now);
      this.presentedAdvance += frame - previous.frame;
      this.dropFrames(frame - previous.frame - 1);
    }
    this.presentation = { now, frame };
    this.presentationCallbacks++;
  }
  endPresentationStream() {
    this.presentation = null;
  }
  endFrameStream() {
    this.previousFrame = null;
  }
  dropFrames(count: number) {
    if (this.enabled && Number.isSafeInteger(count) && count >= 0)
      this.dropped = (this.dropped ?? 0) + count;
  }
  snapshot(label: string, values: Resources, heapBytes: number | null) {
    if (!this.enabled) return;
    this.snapshotCount++;
    if (this.snapshots.length === MAX_SNAPSHOTS) this.snapshots.shift();
    this.snapshots.push({
      label: label.slice(0, 80),
      atMs: this.now() - this.started,
      resources: { ...values },
      heapBytes:
        heapBytes !== null && Number.isFinite(heapBytes) && heapBytes >= 0
          ? heapBytes
          : null,
    });
  }
  report() {
    const elapsed = (this.ended ?? this.now()) - this.started;
    const intervals = this.stages.get("frameInterval");
    const presentationIntervals = this.stages.get("presentationInterval");
    return {
      schemaVersion: 1,
      metadata: this.metadata && { ...this.metadata },
      clock:
        "performance.now milliseconds, main timeOrigin; worker conversion = source timestamp + source timeOrigin - main timeOrigin",
      timeOriginMs: performance.timeOrigin,
      elapsedMs: this.metadata ? elapsed : null,
      enabled: this.enabled,
      frames: this.frames,
      processedFps:
        intervals && intervals.sum > 0
          ? (intervals.count * 1000) / intervals.sum
          : null,
      processedFpsBoundary:
        "changed media-time polls in hand overlay; may repeat decoded frames; excludes unmounted gaps",
      presentationCallbacks: this.presentationCallbacks,
      deliveredFps:
        presentationIntervals && presentationIntervals.sum > 0
          ? (this.presentedAdvance * 1000) / presentationIntervals.sum
          : null,
      deliveredFpsBoundary:
        "browser presentedFrames advance / presentation callback interval; excludes video-element replacement gaps; not sensor FPS",
      droppedFrames: this.dropped,
      droppedFrameBoundary:
        "presentation callback gaps only; unavailable without requestVideoFrameCallback; not sensor or worker drops",
      metrics: Object.fromEntries(
        Object.entries(METRICS).map(([name, boundary]) => {
          const a = this.stages.get(name as Metric);
          const sorted = a?.recent.slice().sort((x, y) => x - y);
          return [
            name,
            {
              unit: "ms",
              boundary,
              count: a?.count ?? 0,
              mean: a ? a.sum / a.count : null,
              max: a?.max ?? null,
              recentSamples: sorted?.length ?? 0,
              p50: sorted?.[Math.ceil(sorted.length * 0.5) - 1] ?? null,
              p95: sorted?.[Math.ceil(sorted.length * 0.95) - 1] ?? null,
            },
          ];
        }),
      ),
      resourceSnapshots: this.snapshots.map((s) => ({
        ...s,
        resources: { ...s.resources },
      })),
      discardedSnapshots: Math.max(0, this.snapshotCount - MAX_SNAPSHOTS),
      limits: { samplesPerStage: WINDOW, resourceSnapshots: MAX_SNAPSHOTS },
      unavailable: [
        "sensor exposure age",
        "physical press-to-sound",
        "audio render latency",
        "shadow-worker transfer timing is not instrumented",
        "asynchronous shadow execution and physical contact accuracy",
      ],
    };
  }
}
export const pipelineMetrics = new PipelineMetrics();
export function recordCameraFrame(now: number) {
  pipelineMetrics.frame(now);
}
export function recordHandInference(ms: number) {
  pipelineMetrics.record("inference", ms);
}
export function recordMarkerDetection(ms: number) {
  pipelineMetrics.record("markerDetection", ms);
}
export function snapshotResources(label: string) {
  const memory = (
    performance as Performance & { memory?: { usedJSHeapSize: number } }
  ).memory;
  pipelineMetrics.snapshot(label, resources, memory?.usedJSHeapSize ?? null);
}

/** Run explicitly while stopped. Paired hook microbenchmark, not pipeline overhead. */
export function benchmarkInstrumentation(iterations = 20000) {
  const count = Math.min(
    100000,
    Math.max(1000, Math.floor(iterations) || 20000),
  );
  const probe = new PipelineMetrics();
  const metadata = {
    workload: "hook microbenchmark",
    hardware: "unspecified",
    configuration: "record inference constant 1ms",
    commit: "unspecified",
    browser: "unspecified",
  };
  const run = (enabled: boolean) => {
    probe.start(metadata);
    if (!enabled) probe.stop();
    const begin = performance.now();
    for (let i = 0; i < count; i++) probe.record("inference", 1);
    return (performance.now() - begin) / count;
  };
  run(false);
  run(true);
  const pairs = Array.from({ length: 6 }, (_, i) => {
    if (i % 2) {
      const enabled = run(true);
      return { disabled: run(false), enabled };
    }
    const disabled = run(false);
    return { disabled, enabled: run(true) };
  });
  return {
    unit: "ms/call",
    iterations: count,
    pairs,
    meanAddedMs:
      pairs.reduce((sum, p) => sum + p.enabled - p.disabled, 0) / pairs.length,
    limitation:
      "Hook only; excludes caller timestamps, video callbacks, resources and UI/export. Timer precision/JIT can dominate. Compare matched full workloads separately.",
  };
}

const audioReleases = new WeakMap<AudioContext, () => void>();
export function trackAudioContext(context: AudioContext): AudioContext {
  if (!audioReleases.has(context))
    audioReleases.set(context, acquireResource("audioContexts"));
  return context;
}
export async function closeTrackedAudioContext(context: AudioContext) {
  await context.close();
  audioReleases.get(context)?.();
  audioReleases.delete(context);
}
export type PipelineReport = ReturnType<PipelineMetrics["report"]>;
/** Offline report comparison helper; not called by the current diagnostics UI. */
export function compareReports(a: PipelineReport, b: PipelineReport) {
  const keys = [
    "workload",
    "hardware",
    "configuration",
    "commit",
    "browser",
  ] as const;
  const mismatches = keys.filter(
    (key) => !a.metadata?.[key] || a.metadata[key] !== b.metadata?.[key],
  );
  return {
    comparable: mismatches.length === 0,
    mismatches,
    meanDeltaMs: mismatches.length
      ? null
      : Object.fromEntries(
          Object.keys(METRICS).map((name) => {
            const left = a.metrics[name].mean,
              right = b.metrics[name].mean;
            return [
              name,
              left === null || right === null ? null : right - left,
            ];
          }),
        ),
    limitation:
      "Matching metadata is necessary, not proof of equivalent lighting, thermal state, duration or input. Review conditions before interpreting deltas.",
  };
}
