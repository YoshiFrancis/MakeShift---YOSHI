import { describe, expect, it, vi } from "vitest";
import {
  PipelineMetrics,
  acquireResource,
  benchmarkInstrumentation,
  closeTrackedAudioContext,
  compareReports,
  crossContextDuration,
  pipelineMetrics,
  snapshotResources,
  trackAudioContext,
  type RunMetadata,
} from "../../frontend/src/diagnostics/performanceMetrics";

const metadata: RunMetadata = {
  workload: "30fps fixture",
  hardware: "mock",
  configuration: "720p",
  commit: "abc",
  browser: "test",
};
const resources = {
  workers: null,
  mediaTracks: 1,
  audioContexts: 0,
  audioNodes: 0,
  handModels: 0,
  markerDetectors: 0,
};

describe("bounded pipeline diagnostics", () => {
  it("does no collection or logging unless explicitly enabled", () => {
    const log = vi.spyOn(console, "info");
    const now = vi.fn(() => 10);
    const metrics = new PipelineMetrics(now);
    for (let i = 0; i < 10000; i++) {
      metrics.record("inference", 3);
      metrics.frame(i);
    }
    expect(now).not.toHaveBeenCalled();
    expect(metrics.report().metrics.inference.mean).toBeNull();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it("keeps lifetime aggregates and bounded recent quantiles independently", () => {
    const metrics = new PipelineMetrics(() => 0);
    metrics.start(metadata);
    for (let i = 1; i <= 1000; i++) metrics.record("inference", i);
    const result = metrics.report().metrics.inference;
    expect(result).toMatchObject({
      count: 1000,
      mean: 500.5,
      max: 1000,
      recentSamples: 256,
      p50: 872,
      p95: 988,
    });
  });
  it("rejects negative and nonfinite samples without inventing zero measurements", () => {
    const metrics = new PipelineMetrics();
    metrics.start(metadata);
    for (const value of [-1, NaN, Infinity]) metrics.record("transfer", value);
    expect(metrics.report().metrics.transfer).toMatchObject({
      count: 0,
      mean: null,
      max: null,
      p95: null,
    });
    metrics.record("transfer", 0);
    expect(metrics.report().metrics.transfer.mean).toBe(0);
  });
  it("converts positive and negative origin offsets and rejects invalid intervals", () => {
    expect(crossContextDuration(10, 1050, 65, 1000)).toBe(5);
    expect(crossContextDuration(100, 950, 65, 1000)).toBe(15);
    expect(crossContextDuration(10, 1000, 9, 1000)).toBeNull();
    expect(crossContextDuration(NaN, 1000, 9, 1000)).toBeNull();
    expect(crossContextDuration(1, 0, 9, 1000)).toBeNull();
    expect(crossContextDuration(1, 1000, Infinity, 1000)).toBeNull();
  });
  it("counts fresh frames and known drop gaps separately", () => {
    let now = 0;
    const metrics = new PipelineMetrics(() => now);
    metrics.start(metadata);
    metrics.frame(0);
    metrics.frame(0);
    metrics.frame(50);
    metrics.frame(49);
    now = 100;
    expect(metrics.report()).toMatchObject({
      frames: 2,
      processedFps: 20,
      droppedFrames: null,
    });
    metrics.dropFrames(0);
    metrics.dropFrames(2);
    metrics.dropFrames(-3);
    expect(metrics.report().droppedFrames).toBe(2);
    expect(metrics.report().metrics.frameInterval.mean).toBe(50);
    metrics.endFrameStream();
    metrics.frame(10000);
    expect(metrics.report().metrics.frameInterval.mean).toBe(50);
  });
  it("measures delivered rate from presentation advances, not media-time polling", () => {
    const metrics = new PipelineMetrics();
    metrics.start(metadata);
    for (let i = 0; i < 20; i++) metrics.frame(i * 10);
    expect(metrics.report().deliveredFps).toBeNull();
    metrics.presentedFrame(0, 100);
    metrics.presentedFrame(50, 101);
    metrics.presentedFrame(150, 103);
    metrics.presentedFrame(151, 103);
    expect(metrics.report()).toMatchObject({
      deliveredFps: 20,
      processedFps: 100,
      droppedFrames: 1,
      presentationCallbacks: 3,
    });
    metrics.endPresentationStream();
    metrics.presentedFrame(10000, 1);
    expect(metrics.report().deliveredFps).toBe(20);
  });
  it("freezes elapsed time on stop and resets all run data on restart", () => {
    let now = 0;
    const metrics = new PipelineMetrics(() => now);
    metrics.start(metadata);
    metrics.record("inference", 2);
    now = 10;
    metrics.stop();
    now = 100;
    metrics.record("inference", 9);
    expect(metrics.report().elapsedMs).toBe(10);
    expect(metrics.report().metrics.inference.count).toBe(1);
    metrics.start(metadata);
    expect(metrics.report().metrics.inference.count).toBe(0);
  });
  it("caps resource history, preserves unavailable heap and returns defensive snapshots", () => {
    const metrics = new PipelineMetrics();
    metrics.start(metadata);
    for (let i = 0; i < 50; i++) metrics.snapshot(String(i), resources, null);
    const report = metrics.report();
    expect(report.resourceSnapshots).toHaveLength(32);
    expect(report.discardedSnapshots).toBe(18);
    expect(report.resourceSnapshots[0]).toMatchObject({
      label: "18",
      heapBytes: null,
      resources: { workers: null },
    });
    report.resourceSnapshots[0].resources.mediaTracks = 99;
    expect(metrics.report().resourceSnapshots[0].resources.mediaTracks).toBe(1);
  });
  it("bounds and copies user metadata", () => {
    const input = { ...metadata, hardware: "a".repeat(5000) };
    const metrics = new PipelineMetrics();
    metrics.start(input);
    input.commit = "changed";
    expect(metrics.report().metadata?.hardware).toHaveLength(512);
    expect(metrics.report().metadata?.commit).toBe("abc");
  });
  it("refuses comparisons across different workloads or configuration", () => {
    const a = new PipelineMetrics();
    const b = new PipelineMetrics();
    a.start(metadata);
    b.start({ ...metadata, configuration: "1080p" });
    expect(compareReports(a.report(), b.report())).toMatchObject({
      comparable: false,
      mismatches: ["configuration"],
      meanDeltaMs: null,
    });
    b.start(metadata);
    a.record("inference", 2);
    b.record("inference", 5);
    expect(compareReports(a.report(), b.report())).toMatchObject({
      comparable: true,
      meanDeltaMs: { inference: 3, transfer: null },
    });
  });
  it("balances repeated lifecycle accounting with idempotent releases", () => {
    pipelineMetrics.start(metadata);
    snapshotResources("baseline");
    const baseline = pipelineMetrics.report().resourceSnapshots[0].resources;
    for (let i = 0; i < 100; i++) {
      const releases = (
        [
          "mediaTracks",
          "audioContexts",
          "audioNodes",
          "handModels",
          "markerDetectors",
        ] as const
      ).map(acquireResource);
      releases.forEach((release) => {
        release();
        release();
      });
    }
    snapshotResources("after");
    expect(pipelineMetrics.report().resourceSnapshots[1].resources).toEqual(
      baseline,
    );
    pipelineMetrics.stop();
  });
  it("counts an audio context until async closure really completes", async () => {
    pipelineMetrics.start(metadata);
    snapshotResources("before");
    const baseline =
      pipelineMetrics.report().resourceSnapshots[0].resources.audioContexts!;
    let resolve!: () => void;
    const context = {
      close: () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    } as AudioContext;
    trackAudioContext(context);
    trackAudioContext(context);
    const closing = closeTrackedAudioContext(context);
    snapshotResources("closing");
    expect(
      pipelineMetrics.report().resourceSnapshots[1].resources.audioContexts,
    ).toBe(baseline + 1);
    resolve();
    await closing;
    snapshotResources("closed");
    expect(
      pipelineMetrics.report().resourceSnapshots[2].resources.audioContexts,
    ).toBe(baseline);
    pipelineMetrics.stop();
  });
  it("reports alternating paired overhead trials without changing live diagnostics", () => {
    const before = pipelineMetrics.enabled;
    const result = benchmarkInstrumentation(1000);
    expect(result.pairs).toHaveLength(6);
    expect(result.unit).toBe("ms/call");
    expect(Number.isFinite(result.meanAddedMs)).toBe(true);
    expect(pipelineMetrics.enabled).toBe(before);
  });
});
