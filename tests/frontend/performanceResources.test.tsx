import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PipelineDiagnostics from "../../frontend/src/app/PipelineDiagnostics";
import { getCameraVideo, registerCameraVideo } from "../../frontend/src/diagnostics/cameraVideo";
import { CameraProvider } from "../../frontend/src/app/CameraContext";
import {
  pipelineMetrics,
  snapshotResources,
} from "../../frontend/src/diagnostics/performanceMetrics";
let root: Root;
let dom: JSDOM;
let tracks: {
  stop: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}[];
beforeEach(() => {
  dom = new JSDOM("<div id='root'></div>");
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  tracks = [];
  vi.stubGlobal("navigator", { userAgent: "jsdom",
    mediaDevices: {
      getUserMedia: vi.fn(async () => {
        const track = {
          stop: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        };
        tracks.push(track);
        return { getTracks: () => [track], getVideoTracks: () => [track] };
      }),
    },
  });
  pipelineMetrics.start({
    workload: "camera lifecycle",
    hardware: "mock",
    configuration: "mock",
    commit: "test",
    browser: "jsdom",
  });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  pipelineMetrics.stop();
  dom.window.close();
  vi.unstubAllGlobals();
});
function count() {
  snapshotResources("check");
  return pipelineMetrics.report().resourceSnapshots.at(-1)!.resources
    .mediaTracks!;
}
it("tracks repeated provider acquisition/unmount and stops every media track", async () => {
  const baseline = count();
  for (let i = 0; i < 3; i++) {
    root = createRoot(document.getElementById("root")!);
    await act(async () =>
      root.render(
        <CameraProvider>
          <span>camera</span>
        </CameraProvider>,
      ),
    );
    expect(count()).toBe(baseline + 1);
    await act(async () => root.unmount());
    expect(count()).toBe(baseline);
    expect(tracks[i].stop).toHaveBeenCalledOnce();
  }
});
it("does not double decrement after a track ends and the provider unmounts", async () => {
  const baseline = count();
  root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<CameraProvider>camera</CameraProvider>));
  tracks[0].addEventListener.mock.calls[0][1]();
  expect(count()).toBe(baseline);
  await act(async () => root.unmount());
  expect(count()).toBe(baseline);
});

it("keeps the registered camera when an older view cleans up and ignores unrelated video", () => {
  const unrelated = document.createElement("video");
  document.body.prepend(unrelated);
  const oldCamera = document.createElement("video");
  const nextCamera = document.createElement("video");
  const releaseOld = registerCameraVideo(oldCamera);
  expect(getCameraVideo()).toBe(oldCamera);
  const releaseNext = registerCameraVideo(nextCamera);
  releaseOld();
  expect(getCameraVideo()).toBe(nextCamera);
  releaseNext();
  expect(getCameraVideo()).toBeNull();
});
it("shows idle before a diagnostics run and samples only the registered camera", async () => {
  const unrelated = document.createElement("video");
  document.body.prepend(unrelated);
  const camera = document.createElement("video");
  camera.requestVideoFrameCallback = vi.fn(() => 1);
  camera.cancelVideoFrameCallback = vi.fn();
  const release = registerCameraVideo(camera);
  root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<PipelineDiagnostics />));
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Diagnostics idle.");
  await act(async () => document.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  expect(camera.requestVideoFrameCallback).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  expect(camera.cancelVideoFrameCallback).toHaveBeenCalledWith(1);
  release();
});
