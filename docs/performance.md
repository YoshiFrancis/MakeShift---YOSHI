# Pipeline performance diagnostics

Issue [#38](https://github.com/Kakrl/MakeShift/issues/38), requirement 2.3,
verification inventory 2.3.2. These diagnostics identify software bottlenecks;
they do not measure physical press-to-sound latency or prove the 50 ms target.

## Recording a profile

The panel is hidden by default. Set `NEXT_PUBLIC_PIPELINE_DIAGNOSTICS=1` before
building or starting development, then expand **Pipeline diagnostics (optional)** at the bottom of the app. Enter a
repeatable workload, hardware/camera/audio-device description, configuration
(including model, delegate, lighting, layout and resolution), and the exact build
commit. Production builders can set `NEXT_PUBLIC_BUILD_COMMIT` at build time.
Start diagnostics, perform the workload, stop playing, stop diagnostics and
export the JSON report. No report is uploaded. Camera device IDs are excluded.
The start configuration and camera settings at export are separate: a camera
still loading at Start has a null initial configuration. Do not treat such a run
as equivalent to a steady-state run. Record any camera/configuration changes.

Normal operation does not collect stage samples or schedule diagnostic video
callbacks, and has no diagnostic console logging. Constant-size lifecycle
counters remain active so a profile started after acquisition can see resources.
Reports are generated only on demand, outside audio rendering and the frame loop.
Starting a new profile replaces the previous one; export first to retain it.
The panel persists across client navigation; a full reload starts a new process.

## Metrics and clock assumptions

All stage durations are milliseconds. Main-thread `performance.now()` is
monotonic and relative to `performance.timeOrigin`. For worker delivery use
`sourceTimestamp + sourceTimeOrigin - mainTimeOrigin`; capture both origins
when establishing the connection. `crossContextDuration` returns null for
invalid/nonfinite timestamps, negative intervals, or times before the main
origin. Never subtract video `currentTime` (media seconds) from this clock.
AudioContext time is a different clock; these metrics do not convert it into
physical sound output time. See [note events](note_events.md) for audio mapping.

| Field | Boundary and limitation |
| :--- | :--- |
| processedFps / frameInterval | Changed `video.currentTime` polls in the hand overlay; these can repeat decoded frames. Unmount resets interval tracking. This is processing rate, not camera FPS. |
| deliveredFps / presentationInterval | Browser `presentedFrames` advance divided by elapsed video callback intervals. Includes missed callback presentations; resets across video-element replacement. Null without video callbacks. Not sensor FPS. |
| frameAge | Diagnostic `requestVideoFrameCallback` entry timestamp minus `presentationTime`; browser presentation-to-callback age, not exposure or physical press age. Unsupported callbacks leave the metric null. |
| droppedFrames | Sum of gaps in `presentedFrames` between diagnostic callbacks on the same video element. Starts unavailable until two callbacks establish a gap (including zero). Does not count sensor, decoder or worker scheduler drops. |
| inference | Around synchronous `detectForVideo`, including cold calls. Drawing and React work are excluded. |
| markerDetection | Around `MarkerDetector.detect`, including OpenCV readback, excluding preceding canvas `drawImage`. |
| detection | Synchronous live contact pipeline processing (overlap, knuckle eligibility and shadow-frame submission); excludes asynchronous shadow-worker execution and later contact callbacks, and excludes debug drawing. Does not measure physical press-to-sound latency. |
| eventDelivery | Accepted event observation timestamp to NoteSession receipt. Recording happens after synchronous audio dispatch, before deferred MIDI/UI observers. No AudioWorklet or device latency claim. |
| transfer | Contract for future worker send-to-receive elapsed time, including queueing and origin conversion. The shadow worker does not emit transfer timing, so production reports leave it null. |

Reports include boundaries and units. Missing values are **null**, distinct from
measured zero; sample count zero means no valid observation. Invalid/negative
stage durations are ignored. Means and maxima cover the whole run. p50/p95 use
nearest rank over only the **latest 256 samples per stage**, not the whole run.
Startup and warmed work must be profiled separately if that distinction matters.
There are eight fixed stage slots, at most 2,048 retained durations, and at most
32 resource snapshots. Extra snapshots discard the oldest and increment a
reported discard count. Text metadata is length-limited; there is no frame,
event, media-track or model-object history retained by the metrics collector.

## Resources and repeated sessions

Resource snapshots record application-owned media tracks, AudioContexts,
AudioWorklet nodes, hand models (live and calibration), and marker detectors.
Audio contexts remain counted until their asynchronous `close()` completes;
releases are idempotent. Worklet node counts end after disconnect/port close.
`audioNodes` counts piano AudioWorklet nodes, not every ephemeral count-in
oscillator or internal browser audio object. Stop playing releases notes but
intentionally retains the camera/models/audio context for fast restart.
Navigation off the owning page closes audio and CV owners; CameraProvider
retains its one shared stream until provider teardown/retry. Tests must compare
against these expected baselines, not require zero on every Play/Stop.

Workers are null/unavailable because the live shadow-worker owner is not yet
instrumented. Library-internal workers, GPU allocations, native OpenCV heaps,
and browser-internal objects are not enumerated. `performance.memory` supplies
optional JS heap bytes where supported; otherwise null. This nonstandard value
is approximate and GC-dependent, not proof of a leak or total process memory.
Ownership counters help detect missed cleanup but cannot prove native memory
has been reclaimed. Full unload discards in-process diagnostics; automated
provider lifecycle tests additionally check media track stop on teardown.

## Equivalent workloads and overhead

Keep commit, browser, hardware, camera settings, model/delegate, input clip,
lighting, calibration/layout, output device, duration, and warm-up equivalent.
Document any changes. `compareReports` rejects different/missing workload,
hardware, configuration, commit or browser metadata and propagates null for
unmeasured stages. Matching strings alone cannot prove equal experimental
conditions. Compare distributions and counts, not just an isolated mean.

Export includes six alternating paired enabled/disabled hook microbenchmark
trials after warm-up, in ms/call. It runs on an isolated collector and cannot
reset the recorded profile. It excludes caller timestamp reads, diagnostic
video callbacks, resource sampling and export itself. Do not present this as
whole-pipeline overhead; timer quantization and JIT can dominate the result.

Run `npm run test:performance-browser` from `frontend` against a production
server on port 3100 (override `MAKE_SHIFT_URL` and optionally
`PERFORMANCE_BROWSER_CHANNEL`). The runner uses headless Edge and a synthetic
camera, checks three enable/chord/stop/navigation cycles, downloads a real
report and checks resource baselines. It then holds the same warmed home scene
for four four-second off/on/on/off trials using an identical external rAF
probe. Both timing samples and limitations are saved under ignored
`frontend/test-results/performance/`. There is no arbitrary performance pass
threshold: short trials are evidence, not a claim that overhead is negligible.

The synthetic camera has no printed keyboard or calibrated contact, so live
collision/event timings can remain unavailable. Hardware latency, intentional
presses, worker transfer, long-session memory growth, physical camera unplug,
and other browsers require separate profiling. Use the physical harness in
#30 and labeled accuracy verification in #39 for those requirements.

## Verification and delivery

Tests: `performanceMetrics.test.ts` covers aggregation, missing versus zero,
clock offsets/invalid clocks, rolling quantiles, fresh frames, reset/stop,
metadata/history bounds, defensive copies, workload matching, balanced resource
counters, asynchronous audio closure and overhead isolation.
`performanceResources.test.tsx` mounts the real CameraProvider with mocked
media acquisition to verify repeated teardown and ended-track cleanup.
Existing audio/session suites continue to cover interruption and failure paths.
The synthetic run measured 20.028 delivered FPS against a reported 20 FPS
camera and distinguished 38.809 media-time processing polls/s. Stage and overhead
results, including cold-start and variability limits, are recorded in [the testing guide](../tests/README.md#pipeline-diagnostics-verification-issue-38).
Vitest now runs in frontend CI after main merged #152; the profiling browser runner
remains local-only. Actions execution for this review update is pending.

The branch now merges current main directly; earlier stacked rebase instructions
are obsolete. Preserve upstream changes when integrating later main updates.

Shared metrics and the explicit camera-video registry live in
`frontend/src/diagnostics/`, outside CV/audio/event ownership. Home and calibration
register their actual camera element; unrelated videos are never sampled. A hidden
calibration video may produce no presentation samples. Developer switches live in
`frontend/src/debugFlags.ts`; existing CV visualization defaults are preserved.
The registry tests cover stale-view cleanup and unrelated videos, and the panel
test covers idle state and callback cancellation. The worker clock adapter and
report comparison helper are reserved/offline APIs; transfer remains unavailable.
