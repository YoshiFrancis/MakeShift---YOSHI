"use client";

import { useEffect, useState } from "react";
import {
  benchmarkInstrumentation,
  pipelineMetrics,
  snapshotResources,
} from "../diagnostics/performanceMetrics";
import { getCameraVideo } from "../diagnostics/cameraVideo";
import { useCamera } from "./CameraContext";

/** Explicit diagnostics live outside React's per-frame render path. */
export default function PipelineDiagnostics() {
  const { stream } = useCamera();
  const [running, setRunning] = useState(false);
  const [hasReport, setHasReport] = useState(false);
  const [workload, setWorkload] = useState("");
  const [hardware, setHardware] = useState("");
  const [configuration, setConfiguration] = useState("");
  const [commit, setCommit] = useState(
    process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "",
  );

  useEffect(() => {
    if (!running) return;
    let video: HTMLVideoElement | null = null;
    let callback: number | null = null;
    const observe = (now: number, metadata: VideoFrameCallbackMetadata) => {
      pipelineMetrics.record("frameAge", now - metadata.presentationTime);
      pipelineMetrics.presentedFrame(now, metadata.presentedFrames);
      callback = video!.requestVideoFrameCallback(observe);
    };
    const sample = () => {
      snapshotResources("periodic");
      const current = getCameraVideo();
      if (current !== video) {
        if (video && callback !== null)
          video.cancelVideoFrameCallback(callback);
        video = current;
        callback = null;
        pipelineMetrics.endPresentationStream();
        if (video?.requestVideoFrameCallback)
          callback = video.requestVideoFrameCallback(observe);
      }
    };
    sample();
    const timer = setInterval(sample, 1000);
    return () => {
      clearInterval(timer);
      pipelineMetrics.endPresentationStream();
      if (video && callback !== null) video.cancelVideoFrameCallback(callback);
    };
  }, [running]);
  useEffect(() => () => pipelineMetrics.stop(), []);

  return (
    <details className="m-3 rounded border border-ink p-3 text-ink bg-surface">
      <summary>Pipeline diagnostics (optional)</summary>
      <p>
        Record software timings and resource counts. Stop playing before export.
        This does not measure physical press-to-sound latency.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const settings = stream?.getVideoTracks()[0]?.getSettings();
          pipelineMetrics.start({
            workload,
            hardware,
            commit,
            browser: navigator.userAgent,
            configuration: JSON.stringify({
              notes: configuration,
              camera: settings
                ? {
                    width: settings.width,
                    height: settings.height,
                    frameRate: settings.frameRate,
                  }
                : null,
              logicalCores: navigator.hardwareConcurrency ?? null,
            }),
          });
          snapshotResources("start");
          setRunning(true);
          setHasReport(true);
        }}
        className="flex flex-wrap gap-3 py-2"
      >
        {(
          [
            ["Workload / repeatable steps", workload, setWorkload],
            ["Hardware / camera / audio device", hardware, setHardware],
            [
              "Configuration / model / delegate",
              configuration,
              setConfiguration,
            ],
            ["Build commit", commit, setCommit],
          ] as const
        ).map(([label, value, setter]) => (
          <label key={label}>
            {label}
            <input
              required
              maxLength={200}
              disabled={running}
              value={value}
              onChange={(e) => setter(e.target.value)}
              className="block border border-ink bg-surface p-1"
            />
          </label>
        ))}
        <button
          disabled={running}
          type="submit"
          className="underline disabled:opacity-50"
        >
          Start diagnostics
        </button>
        <button
          disabled={!running}
          type="button"
          className="underline disabled:opacity-50"
          onClick={() => {
            snapshotResources("stop");
            pipelineMetrics.stop();
            setRunning(false);
          }}
        >
          Stop diagnostics
        </button>
        <button
          disabled={running || !hasReport}
          type="button"
          className="underline disabled:opacity-50"
          onClick={() => {
            const settings = stream?.getVideoTracks()[0]?.getSettings();
            const report = {
              ...pipelineMetrics.report(),
              cameraAtExport: settings
                ? {
                    width: settings.width,
                    height: settings.height,
                    frameRate: settings.frameRate,
                  }
                : null,
              instrumentationOverhead: benchmarkInstrumentation(),
            };
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(report, null, 2)], {
                type: "application/json",
              }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = "makeshift-performance.json";
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Export diagnostics
        </button>
      </form>
      <p role="status">
        {running
          ? "Diagnostics recording; up to 32 resource snapshots retained."
          : hasReport ? "Diagnostics stopped." : "Diagnostics idle."}
      </p>
    </details>
  );
}
