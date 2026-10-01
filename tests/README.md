# MakeShift Testing

This directory holds MakeShift's verification tests and their documentation:
the test inventory, manual test reports, known defects, and root cause
analyses (RCAs).

## Where Test Documentation Lives

| Document | Location |
| :--- | :--- |
| Verification Test Inventory | [`verification_test_inventory.md`](verification_test_inventory.md) |
| Manual test template | [`manual/manual_test_template.md`](manual/manual_test_template.md) |
| Manual test reports | `manual/YYYY-MM-DD_<test-case-id>.md` |
| Defect report template | [`.github/ISSUE_TEMPLATE/defect_report.yml`](../.github/ISSUE_TEMPLATE/defect_report.yml) |
| Defect reports and RCAs | GitHub issues labeled `bug`. RCAs are posted as comments on the defect issue |
| Known defects and RCA log | This file |
| V&V plan, SDP, design | [`docs/`](../docs) |

**Why here.** `tests/` already holds the test code (GoogleTest suites, the
contrast audit, pytest), so the inventory and reports sit next to the tests
they describe. A PR that adds a test can update its inventory row in the same
directory. `docs/` stays for planning documents (SDP, V&V plan, design) that
change once per milestone, and `tests/` holds records that change every
sprint. The defect template has to live in `.github/ISSUE_TEMPLATE/` because
GitHub only reads templates from there. RCAs stay on the defect issue so the
analysis, fix PR, and discussion are in one place, and the log below indexes
them.

## Layout

```text
tests/
├── README.md
├── verification_test_inventory.md
├── audio/
│   ├── test_audio.cpp                # PortAudio lifecycle
│   └── test_audio_events.cpp         # rendering, polyphony, SPSC queue
├── automation/
│   └── rca.test.cjs                  # repository-process regression tests
├── frontend/
│   ├── browserAudio.test.ts      # production DSP offline rendering
│   ├── browserAudioLifecycle.test.ts # browser owner mocks
│   ├── browserAudio.browser.mjs  # production browser graph check
│   ├── homePage.test.ts              # home page modals and overlays (jsdom)
│   ├── noteEvents.test.ts            # shared event validation, sessions and clocks
│   ├── midiUtils.test.ts             # MIDI unit tests
│   └── check-contrast.mjs            # theme token contrast audit
├── python/
│   └── test_dummy.py                 # existing placeholder, no product coverage
└── manual/
    └── manual_test_template.md
```

Add future tests, helpers, and fixtures to the matching suite directory.
Frontend tests import application modules from `../../frontend/src/`.
`frontend/vitest.config.mts` selects `tests/frontend/` and resolves frontend
package dependencies. Bare imports used by tests, including any module passed
to `vi.mock`, need an alias there because `tests/` has no `node_modules`. Add a
`// @vitest-environment jsdom` comment to tests that render components. The frontend TypeScript and ESLint commands also include
that directory. Keep frontend dependencies and tool configuration in `frontend/`,
C++ build definitions in `backend/CMakeLists.txt`, and CI workflows in `.github/`.
Python's default recursive discovery finds `tests/python/` without extra config.
No test implementation requires an exception to this layout.

## Running the Tests

| Suite | Command | Needs |
| :--- | :--- | :--- |
| C++ (GoogleTest) | `cmake -B build -S backend && cmake --build build --config Release && ctest --test-dir build -C Release --output-on-failure` | CMake 3.15+, C++23 compiler, Python 3.12, `pip install -r requirements.txt` |
| Python | `python -m pytest --cov=backend --cov-report=term-missing` | `pip install -r requirements.txt` |
| Frontend unit (Vitest) | `cd frontend && npx vitest run` | `npm ci` in `frontend/` |
| Contrast audit | `cd frontend && npm run test:contrast` | Node 20. Writes `frontend/test-results/contrast-report.json` |
| MIDI production download | `cd frontend && npm run test:midi-browser` | Running production server; Playwright and Edge; optional MAKE_SHIFT_URL / MIDI_BROWSER_CHANNEL |
| RCA automation | `node --test tests/automation/rca.test.cjs` | Node 22; no package installation or GitHub credentials needed |

## Note-list recorder verification (issues #108 and #115)

Local execution on Windows, 2026-09-26, Node 22.17.0 and Vitest 4.1.11,
on `feature/115-note-list-recorder`, working tree based on `3506cb5`.

- `npx.cmd vitest run`: 111 tests passed across four files, including 20
  cases in `tests/frontend/midiUtils.test.ts` (replacing the seven old cases).
- Recorder cases cover metadata, BPM validation, millisecond note pairing,
  duplicate and unknown events, repeated pitches, overlapping notes, zero
  duration, stop/release-all, pause boundaries, excluded time, repeated pauses,
  ignored idle/stopped input, independent instances/takes and copied snapshots.
- Three export adapter cases mock MidiWriter and the DOM. They check tempo,
  tick rounding, note values, paused-time removal, input preservation, empty
  and repeated exports, filename and click. They do not parse an actual MIDI
  file or prove browser download behavior.
- TypeScript passed; lint passed with seven existing unused-variable warnings
  in `page.tsx`; all 18 contrast pairs passed. Production build passed after
  rerunning with network access for Google Fonts (sandboxed attempt failed
  fetching Geist fonts).
- Vitest is still not invoked by `frontend-ci.yml` (D3); no Actions evidence
  exists for this run. Inventory 4.1.1 is partial: seeded random streams and a
  real MIDI parser oracle are pending. UI count-in/Stop interactions, CV-held-key
  behavior, camera workflows and actual file export remain unverified.

### Recording controls integration verification (#108)

Local execution on Windows, 2026-09-26, Node 22.17.0, Vitest 4.1.11,
same working tree/branch as the note-list recorder record above.

- `npx.cmd vitest run`: **116 tests passed in five files**, including five new
  cases in [recordingControls.test.tsx](frontend/recordingControls.test.tsx).
- These mount the production Home page, CV coordinator, marker overlay,
  homography/collision/transition code and recorder. Marker detector observations,
  MediaPipe hand landmarks, camera readiness, audio initialization and canvas
  drawing are fixtures/mocks. Next dynamic imports are replaced with direct
  components; jsdom provides the DOM under the Node test environment. Test
  aliases in frontend Vitest/TypeScript configuration resolve package dependencies
  for specs located outside `frontend/`.
- Verified held keys (including keys pressed during Pause) become new recorded
  notes after the resume count-in; keys released before resumption are omitted;
  repeated pauses preserve prior notes and exclude elapsed pause/count-in time.
  Buttons show the expected recording/paused/stopped state. Stop cancels both
  initial and resume count-ins; resume cancellation retains the completed take.
- The delayed-audio-initialization case failed before the fix: after Stop, the
  stale Resume continuation started another count-in and the UI showed recording.
  `playRequestRef` now invalidates that continuation on Stop/unmount; the same
  regression passed afterward. This was found in the uncommitted #108 work.
- TypeScript, lint (seven existing unused-variable warnings), all 18 contrast
  pairs and production build passed. Build used network access for Google Fonts.
- No CI execution evidence: Vitest remains outside the frontend workflow (D3).
  No physical webcam, calibration procedure, actual browser download, audio
  listening, or MIDI parser result is claimed. A physical manual workflow/report
  remains pending. Inventory 4.1.1 remains partial for seeded/random-file coverage;
  4.1.2 and 3.2.2 now have partial simulated DOM coverage.

### Upstream integration verification (2026-09-27)

Prepared `feature/115-midi-recording-pause-resume` from upstream `019e2f0`,
applying only the #108/#115 work and excluding unrelated fork commits.
Upstream had removed the disabled-tracking reset in `MarkerTrackingOverlay`.
Two existing held-key integration tests failed; restoring that reset made both
pass without changing the chosen policy or audio behavior.

- Windows, Node 22.17.0, Vitest 4.1.11: all **150 tests passed in five files**,
  including the same 20 MIDI and five recording-control cases. Upstream added
  34 audio tests since the earlier run.
- TypeScript, lint (eight existing warnings), all 18 contrast pairs and production
  build passed. Physical webcam and real-file verification remain pending.
- This supersedes the earlier branch's results for PR delivery. Actions evidence
  remains pending; Vitest is still not in CI.

## Shared-event verification (issue #86)

Local Windows verification on 2026-09-22, branch
`feature/86-note-events`, stacked on #35 at `12d93f4`, with Node 22.20.0
and Vitest 4.1.11. This is local execution evidence, not an Actions result.

- All 98 Vitest tests passed: 43 shared event/clock/MessagePort cases,
  11 browser-owner/adapter lifecycle cases, 37 offline DSP and seven MIDI.
- Shared tests cover validation, immutable schema copies, ordered sequences,
  duplicates and gaps, same-pitch press identities, release matching,
  stop/reset/interruption/release-all, stale-session rejection, bounded
  recovery, audio-first deferred observers, and invalid/delayed clock inputs.
- The adapter tests use production BrowserAudio with mocked device objects.
  Suspension, overload, processor failure and close retire shared presses,
  deliver release-all to observers, and reject stale input after recovery.
- TypeScript, lint (zero errors; seven existing home-page warnings), all 18
  contrast pairs, and production build passed.
- Extra production Edge 153.0.4234.48 / Playwright 1.62.1 smoke check:
  the unchanged runner FAILED its final immediate navigation-cleanup
  assertion (context still running after the URL changed). A local diagnostic
  copy waiting for the unmount cleanup passed: asset HTTP 200, soft/loud RMS
  0.0140931503 / 0.0426029731, chord output, stop silence, suspension recovery
  and navigation closure. The diagnostic is not a passing result for the
  unchanged test. See D16 and [issue #105](https://github.com/Kakrl/MakeShift/issues/105)
  for the separate test-harness fix.
- Vitest and the browser smoke runner remain outside CI (D3). No physical
  latency, camera accuracy, hardware listening, full MIDI recording lifecycle,
  live detector wiring or deployed cross-browser result is claimed.

## Browser audio verification (issue #35)

Local Windows verification on 2026-09-22, branch
`feature/35-browser-audio`, based on `30706c4`, with Node 22.20.0 and
Vitest 4.1.11. This is local evidence, not a CI result.

- Offline DSP: 37 tests passed, covering eleven pitches at 44.1/48/96 kHz,
  linear velocity, attack/release, ten voices, deterministic stealing, slot
  reuse, phase continuity, validation and session resets.
- Browser ownership: six tests passed for user activation, concurrent
  initialization, module failure/retry, suspended startup, interruption,
  bounded backlog, processor failure and close during initialization.
- Existing MIDI suite: seven tests passed.
- Production Edge 153.0.4234.48, Playwright 1.62.1, headless:
  `npm run test:audio-browser` passed. Soft/loud A4 RMS was
  0.014200991 / 0.042602973 (3:1). The worklet asset returned HTTP 200;
  ten-note graph output, stop silence, suspension/restart and navigation
  cleanup passed. Graph samples do not establish hardware audibility.
- Lint: zero errors, seven existing home-page unused-variable warnings.
  TypeScript, 18 contrast pairs, and production build passed.
- User-reported speaker listening passed for soft/loud A4, ten-note chord
  and Stop sound; see [manual report](manual/2026-09-22_2.2.3.md).
  Output device and browser details were not supplied. Physical latency,
  full shared #86 event integration and deployed/cross-browser compatibility
  remain pending. No native files changed.

To repeat the production smoke test: install frontend dependencies, run
`npm run build` and `npm start -- --hostname 127.0.0.1`; in another terminal
run `npm run test:audio-browser`. It uses an installed Edge by default.
See [browser audio](../docs/browser_audio.md) for environment overrides.
The tests remain outside CI (D3); no Actions execution is claimed.

## Navigation cleanup verification (issue #105)

Local Windows verification on 2026-09-28, Node 22.20.0, Playwright 1.62.1,
headless Edge 154.0.4258.37, based on `614203f`.

- The production browser audio runner now waits up to 5 seconds for the
  AudioContext to close after client navigation, then retains its final
  closed-state assertion. URL completion alone does not prove React cleanup
  has run; missing cleanup still fails with a bounded timeout.
- `npm run test:audio-browser` passed against the production build at
  `http://127.0.0.1:3105`: worklet HTTP 200, soft/loud RMS
  0.009940531 / 0.029822081, chord output, stop silence, suspension recovery
  without replay, navigation closure and no page errors.
- All 150 Vitest tests, TypeScript, 18 contrast pairs and production build
  passed. Lint passed with eight existing unused-variable warnings.
- This verifies browser graph behavior only. Hardware audibility, physical
  latency and Actions execution remain unverified; the runner is outside CI.

## Test relocation verification (issue #83)

Local Windows verification on 2026-09-17, against baseline
`e34d73624c4d776cb2dd7c4e23a5f1d7d37ce33a`. Counts below are runner results,
not claims of CI execution. Node 22.20.0, Vitest 4.1.11, Python 3.12.10,
pytest 8.2.2, and the Release CMake build were used.

| Suite | Before relocation | After relocation | Source |
| :--- | :--- | :--- | :--- |
| MIDI | 7 passed | 7 passed | [MIDI unit tests](frontend/midiUtils.test.ts) |
| Audio and queue | 14 reported passed | 14 reported passed | [Lifecycle](audio/test_audio.cpp), [events and queue](audio/test_audio_events.cpp) |
| RCA | 18 passed | 18 passed | [RCA tests](automation/rca.test.cjs) |
| Python placeholder | 1 passed | 1 passed | [Placeholder](python/test_dummy.py) |
| Contrast audit | 18 pairs passed | 18 pairs passed | [Audit](frontend/check-contrast.mjs) |

Assertions and test cases are unchanged; only location-dependent imports changed.
The existing audio tests can report a pass without exercising stream operations
when no audio device is available (D5). The Python placeholder verifies no
product behavior (D14). Neither limitation is fixed by relocating files.
Frontend type checking and production build, Ruff, and mypy passed locally.
ESLint passed with the two existing application warnings. clang-format 17 was
not available locally; the C++ files were moved without content changes.
The frontend CI path filters now include `tests/frontend/**`; Vitest remains a
local suite pending the separate CI integration work tracked as D3 (since
fixed by #152).

## Vitest CI verification (issue #152)

Local macOS execution on 2026-09-30, Node 26.8.1 and Vitest 4.1.11, branch
`fix/152-vitest-in-frontend-ci` from upstream `main`.

- `.github/workflows/frontend-ci.yml` adds a `Unit tests` step
  (`npx vitest run`) after type checking, so a failing Vitest case fails the job.
- The workflow's own file is now in its path filters (and in the Frontend
  Bypass `paths-ignore`), so edits to `frontend-ci.yml` run the real job
  instead of the bypass.
- Frontend-configured `npx vitest run`: **174 tests passed across seven files**.
- CI on PR #158 (Node 20): the `Unit tests` step ran and **174 tests passed
  across seven files** ([job log](https://github.com/Kakrl/MakeShift/actions/runs/36744857972/job/109988354672)).

### After merging `main` at `47400c7` (2026-10-01)

PR #148 merged after the run above and changed key contact and calibration.
On `main`, 23 of 236 Vitest cases failed. Nothing caught it because Vitest was
not in CI yet.

- 18 needed test updates for #148, now in this PR. Both suites stub
  `getComputedStyle` and the canvas methods the new overlays call.
  `recordingControls.test.tsx` passes `HandObservation` objects and runs the
  real `LiveContactPipeline` in its overlap-only mode, since jsdom has no
  `Worker` and the fixture has no depth calibration. Contact now highlights
  keys before a session starts (intended in #148), so the highlight test
  expects that and still checks that an interrupted session records nothing.
- 5 cases in `calibrationWorkflow.test.tsx` (6.2.3) found a real defect, D21
  ([#162](https://github.com/Kakrl/MakeShift/issues/162)). They are marked
  `it.fails` and linked to the issue. The fix PR switches them back to `it()`.
- Local result: **231 passed and 5 expected failures across 11 files**. CI on
  PR #158 (Node 20) matched ([job log](https://github.com/Kakrl/MakeShift/actions/runs/36897106200/job/110486733691)).

## Documentation Expectations by Severity

Not every defect needs the same amount of documentation. Use this table to
decide what to record.

| Severity | Examples | Documentation Required |
| :--- | :--- | :--- |
| High | A core workflow is broken or a High priority requirement fails: no sound on a detected key press, latency over 50 ms, calibration can't be completed, a merged feature is missing from the app, wrong notes play | Defect issue from the template, a row in Known Defects, and a full RCA comment on the issue after the fix, logged in the RCA table. The fix PR must name its regression test |
| Medium | A requirement is degraded or verification has a gap, but a workaround exists: tests not running in CI, a test that passes without checking anything, a resource leak on repeated actions, debug logging in a hot loop | Defect issue from the template and a row in Known Defects. RCA only if the team or mentor asks. The fix PR links the issue |
| Low | Cosmetic issues, dead code, stale docs, lint warnings, or edge cases with no user impact | A row in Known Defects or a line in the fixing PR description. No issue required |

Aim for 2 to 3 postmortem RCAs per build checkpoint unless the team mentor
asks for more.

The defect selected for the assignment requires an RCA regardless of severity.
Select **Assignment example (required)** in its issue form. On older issues, or
when the team requests an additional RCA, apply the `rca-required` issue label
(create that label if it does not exist). High severity is read from the issue
form's **Severity** field. Defect targets must retain the `bug` label.

## High Severity Bug Workflow

Follow these steps from discovery through publication of the RCA. Automatic
checks and comments are available once the RCA workflow is merged into `main`
(see [initial rollout and recovery](#automated-checks-publication-and-recovery)).
The assignment example follows the same RCA steps even at a lower severity.

1. **Report the defect.** Create a GitHub issue with the
   [defect report template](../.github/ISSUE_TEMPLATE/defect_report.yml), select
   **High** severity, and keep the `bug` label. Include the affected requirement,
   reproduction steps, expected and actual results, environment, and evidence.
   Identify the test that exposed it, or explain if it was found another way.
2. **Track it here.** Add or update its row in [Known Defects](#known-defects),
   linking the issue and marking it Open. Reuse an existing row for the same bug.
3. **Fix and verify.** Create a `fix/<issue>-short-description` branch using the
   [repository workflow](../docs/dev_process.md). Reproduce the failure, make
   the fix, add or identify a regression test that catches it, and run the checks
   for the affected areas. Record actual results and evidence links.
4. **Open the fix PR and write the RCA.** Target upstream `main` and include
   `Closes #N`. Copy the [RCA PR template](#rca-pr-template) into the description,
   set its explicit issue number, and complete all seven sections. Use a separate
   block for each defect. Open as a draft if you still need its PR number to
   complete the documentation.
5. **Complete the records in the same PR.** Fill all eight cells of the
   [RCA log](#root-cause-analysis-log), including the defect issue URL, fix PR
   URL, and regression test. Update the
   [verification inventory](verification_test_inventory.md) for any new or
   changed tests. If manual testing validates a critical workflow or exposes
   the defect, copy the [manual template](manual/manual_test_template.md) to
   `manual/YYYY-MM-DD_<test-case-id>.md`, record the results, and link the report
   in the inventory. Prepare the Known Defects status change so it records the
   fix when the PR merges.
6. **Review before merging.** Obtain at least one reviewer approval and passing
   required checks. The `RCA requirements` check validates the RCA fields,
   evidence link, target issues, and log rows. The reviewer verifies that the
   analysis, test results, and regression coverage are accurate; the check does
   not establish those facts. Request another review of substantive RCA edits.
7. **Merge and confirm publication.** Automation posts the RCA to each explicit
   defect issue with the fix PR and merged commit links. You do not need to copy
   the comment manually. Confirm that `Publish RCA` succeeded and the comment
   is present. For a failure, follow the
   [recovery steps](#automated-checks-publication-and-recovery); rerunning the
   job reuses existing bot comments instead of creating duplicates.

## Known Defects

Found in the codebase audit for issue #79 (2026-09-16, upstream `main` at
`c4cc55b`). Status is updated when a fix merges. "Issue" is filled in once a
defect report is filed.

| ID | Severity | Area | Defect | Location | Issue | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| D1 | High | CV / UI | (Req 1.1, 3.2) The ArUco marker and virtual keyboard overlay from PR #63 never renders. `MarkerTrackingOverlay` is imported in `page.tsx` but no JSX uses it. The `<MarkerTrackingOverlay videoRef={videoRef} />` element was dropped while resolving conflicts in merge `1669079` ("Merge branch 'main' into feature/visual-keyboard"). ESLint flags it as an unused variable, but warnings don't fail CI | `frontend/src/app/page.tsx:10` | | Open |
| D2 | High | MIDI / UI | (Req 4.1, 4.2) Original audit found UI-only recording/export. Recording now calls the recorder through shared-event consumers (#139); production download is verified locally by 4.2.3 (#141, D18). Delete clears the completed take but lacks browser verification; Listen has no handler. Complete file-control coverage in 4.2.2 remains pending. | `frontend/src/app/page.tsx`, `frontend/src/events/pianoIntegration.ts` | [#28](https://github.com/Kakrl/MakeShift/issues/28), [#140](https://github.com/Kakrl/MakeShift/issues/140) | Recording/export fixes verified locally in [#139](https://github.com/Kakrl/MakeShift/pull/139) / [#141](https://github.com/Kakrl/MakeShift/pull/141); review/merge pending; Listen and full file-control verification open |
| D3 | Medium | CI | The Vitest suite (4.1.3-4.1.7, 4.2.3) is not run in CI. `frontend-ci.yml` runs lint, type check, contrast, and build, but not `vitest run`, so MIDI regressions merge undetected | `.github/workflows/frontend-ci.yml` | [#152](https://github.com/Kakrl/MakeShift/issues/152) | Fixed in [#158](https://github.com/Kakrl/MakeShift/pull/158) |
| D4 | Medium | CI | The C++ test path filter `'CMakeLists.txt'` only matches a root-level file. A PR that only changes `backend/CMakeLists.txt` skips the C++ build and tests. It should be `'**/CMakeLists.txt'` | `.github/workflows/testing.yml:29` | | Open |
| D5 | Medium | Tests | `AudioEngineTest.StreamStartsAndStops` and `MultipleStartStopCycles` `return` early when there is no audio device, so on CI they report PASS without testing anything. Use `GTEST_SKIP()` so the skip shows in results | `tests/audio/test_audio.cpp:24-27`, `:35-38` | | Open |
| D6 | Medium | Calibration | Versioned geometry/camera/layout and hover/rest inputs replace the boolean; live compatibility gates reuse. Manual calibration checklist passed (Carl Xu, user-reported 2026-09-28). | `frontend/src/cv/calibration.ts`, `frontend/src/app/calibration/page.tsx` | [#87](https://github.com/Kakrl/MakeShift/issues/87) | Manual verification passed (user-reported); review/merge pending |
| D7 | Medium | CV / performance | Debug `console.log` calls run in the marker detection `requestAnimationFrame` loop (about 60 per second) and on every detection update. That adds main-thread work that counts against requirement 2.3 (latency) once D1 is fixed | `frontend/src/app/MarkerTrackingOverlay.tsx:49,95,102,111,121`; `frontend/src/cv/markerDetector.ts:103,105,119` | | Open |
| D8 | Medium | Audio | Calling `AudioEngine::startStream()` twice overwrites `stream` without closing it, which leaks the first PortAudio stream. `Pa_GetDeviceInfo` is dereferenced without a null check | `backend/src/audio/AudioEngine.cpp:89-119` | | Open |
| D9 | Medium | Audio / Python | Importing `backend.src.audio` builds an `AudioEngine` and calls `Pa_Initialize()` as a side effect. Any import (including from pytest) touches audio hardware and fails if the extension is not built. The example in `docs/audio_events.md` creates a second engine | `backend/src/audio/__init__.py:3-5` | | Open |
| D10 | Low | CV | `HandTrackingOverlay` loads MediaPipe WASM from `@latest`, the version mismatch that #12 fixed in `useHandLandmarker`. The component isn't used right now | `frontend/src/app/cv/HandTrackingOverlay.tsx:7-8` | | Open |
| D11 | Low | MIDI | `stopRecording` leaves `track` set, so `noteOn` and `noteOff` calls after stopping are still recorded | `frontend/src/app/midi/midiUtils.ts:66-82` | | Open |
| D12 | Low | Backend | `backend/src/MIDI/noteMap.ts` is a TypeScript file inside the Python backend package and nothing imports it | `backend/src/MIDI/noteMap.ts` | | Open |
| D13 | Low | Tests | The contrast audit only checks `--color-*` token pairs. Hardcoded canvas colors drawn over live video (`#00ff88`, `#ffd60a`, `#ff3b30`) aren't checked | `frontend/src/app/MarkerTrackingOverlay.tsx:136-192`, `frontend/src/app/cv/handLandmarkDrawing.ts:33-34` | | Open |
| D14 | Low | Tests | The only Python test is `test_dummy.py`, so the pytest coverage report in CI measures nothing | `tests/python/test_dummy.py` | | Open |
| D15 | Low | Docs | The root README said Python 3.10+ for the C++ build, but `backend/CMakeLists.txt` requires Python 3.12 | `README.md` | | Fixed in #79 PR |
| D16 | Low | Tests | Browser audio smoke runner checks context closure immediately after URL navigation, before React's unmount effect may run. The unchanged runner failed; a bounded cleanup-wait diagnostic passed during #86 verification | `tests/frontend/browserAudio.browser.mjs` | [#105](https://github.com/Kakrl/MakeShift/issues/105) | Fix implemented for #105; bounded wait and final assertion verified locally ([evidence](#navigation-cleanup-verification-issue-105)); merge pending |
| D17 | Medium | UI | (Req 3.1, 3.4) The UI is not responsive. Home, calibration, and about use a fixed 267 px side column with no breakpoints, and `body` is `h-dvh overflow-hidden`, so at tablet or phone widths, short laptop screens, or 200% zoom the camera is squeezed and controls are clipped with no way to scroll to them | `frontend/src/app/layout.tsx:32`, `frontend/src/app/page.tsx:213-400`, `frontend/src/app/calibration/page.tsx:669-681`, `frontend/src/app/about/page.tsx:42-63` | [#109](https://github.com/Kakrl/MakeShift/issues/109) | Fixed in [#111](https://github.com/Kakrl/MakeShift/pull/111) |
| D18 | High | MIDI / UI | Runtime path alias points midi-writer-js at a declarations-only file, so final Export throws on undefined Track and produces no download (Req 4.2) | `frontend/tsconfig.json` | [#140](https://github.com/Kakrl/MakeShift/issues/140) | Fix verified locally in [#141](https://github.com/Kakrl/MakeShift/pull/141); review/merge pending |
| D19 | Medium | CI | The `Vercel preview` workflow fails on every fork PR: `actions/checkout` refuses fork code in `pull_request_target` unless the step sets `allow-unsafe-pr-checkout: true`, so labeling `preview-link` never deploys | `.github/workflows/preview.yml:33-39` | [#160](https://github.com/Kakrl/MakeShift/issues/160) | Open |
| D20 | High | UI | (Req 3.1, 3.2, 4.2, 6.2) Merge `30706c4` (PR #98) resolved `page.tsx` by keeping the branch's older JSX, dropping the welcome and Calibration intro modals, count-in overlay, Recording Complete banner, Delete confirmation, calibration prompt, `CameraStatusOverlay`, and the aria-live region. The home Calibration tab and Delete button did nothing. ESLint flagged the orphaned state only as warnings | `frontend/src/app/page.tsx` | [#112](https://github.com/Kakrl/MakeShift/issues/112) | Fixed in [#113](https://github.com/Kakrl/MakeShift/pull/113) |
| D21 | High | Calibration | (Req 6.2, 1.1, 2.1) After PR #148, step 5 renders the depth capture, so the step 5 capture that set the validated result can't be reached. `handleComplete` calls `router.push("/")` and writes the legacy `isCalibrated` flag before validating, so `makeshift.calibration.v1` is never saved and failed saves still navigate. 6.2.3 marks 5 cases `it.fails` until fixed | `frontend/src/app/calibration/page.tsx` | [#162](https://github.com/Kakrl/MakeShift/issues/162) | Open |

## Root Cause Analysis Log

Every completed RCA is listed here. Add its row in the fix PR so it receives
review with the fix. The full analysis is automatically posted as an issue
comment after merge. Link the issue before the comment exists.

| Defect | Issue | Severity | Root Cause (one line) | Fix PR | Regression Test | RCA Date | Author |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| MIDI note-off events missing required duration information | [#91](https://github.com/Kakrl/MakeShift/issues/91) | Medium | Custom MidiWriterJS TypeScript declarations hid the library's required note event fields, allowing invalid note-off event construction. | [#92](https://github.com/Kakrl/MakeShift/pull/92) | `tests/frontend/midiUtils.test.ts` — `creates a note event using the note start time and duration` (not currently run in CI) | 2026-09-20 | harrydeng104 |
| Home page modals and overlays dropped in merge 30706c4 | [#112](https://github.com/Kakrl/MakeShift/issues/112) | High | A conflict in `page.tsx` was resolved by keeping the older branch JSX, and ESLint reported the orphaned state only as warnings, so CI passed. | [#113](https://github.com/Kakrl/MakeShift/pull/113) | `tests/frontend/homePage.test.ts` (3.1.3, 3.2.3, 3.2.4, 6.2.4; not run in CI until D3) plus `no-unused-vars` as an ESLint error (runs in `frontend-ci.yml`) | 2026-09-23 | jaddenki |
| Production MIDI export fails | [#140](https://github.com/Kakrl/MakeShift/issues/140) | High | TypeScript path alias to a .d.ts file erased the runtime MIDI module in Turbopack; mocked tests bypassed it. | [#141](https://github.com/Kakrl/MakeShift/pull/141) | 4.2.3; `tests/frontend/midiExport.browser.mjs`, production download bytes and dialog closure; local only | 2026-09-29 | Carl Xu (Codex-assisted) |

### RCA PR Template

Copy this block into the fix PR description, replacing `123` with the target
defect issue number. Repeat the block for each defect and add `Closes #123`
outside the block for each target. Only same-repository bug issues that GitHub
recognizes as closed by the PR are eligible. Ordinary PRs need no RCA block.
Keep the exact headings and replace every placeholder with actual analysis.

```markdown
<!-- rca:start issue=123 -->
### Root cause
<The mechanism that caused the defect, not just its symptom.>

### Discovery
<How the defect was discovered.>

### Exposing test
<Test ID or report. If no test caught it, explain why.>

### Fix verification
<Actual test results and an HTTPS link to the CI run, report, or other evidence.>

### Regression test
<Test ID, file, and whether it runs in CI.>

### Remaining risk
<Where else the issue could occur, what was checked, and what remains.>

### Process improvement
<What changes to catch this earlier, or explain why no change is needed.>
<!-- rca:end -->
```

Complete all eight cells of the log row above; do not leave `TBD` or placeholder
values. Use Markdown links with full URLs in the Issue and Fix PR cells:
`[#123](https://github.com/Kakrl/MakeShift/issues/123)` and
`[#124](https://github.com/Kakrl/MakeShift/pull/124)`. Open a draft PR to get
its number, then commit the log row before requesting review. Avoid table pipes
inside cells. The regression test must be identified, not invented.

### Automated checks, publication, and recovery

The read-only `RCA requirements` job runs on PR opening, description edits,
new commits, reopening, and readiness for review. It requires an RCA for every
closing High severity or explicitly RCA-required issue. Changing issue fields
does not itself trigger a PR run; rerun the check or edit the PR description
after changing severity or assignment selection. Reviewers must ensure all
fixed defects are linked and verify the evidence before merge.

After merge, `Publish RCA` validates again using the merged README and posts
one comment per explicit RCA target. It includes the fix PR and merged commit.
A stable PR/issue marker identifies its own bot comment, so reruns update that
comment instead of duplicating it. All targets validate before posting begins;
an API failure may still leave some comments posted and others pending.

If publication fails:

1. Open **Actions → RCA**, select the run for the merged PR, and inspect the
   `Publish RCA` failure. API/permission failures appear as failed jobs.
2. Restore the required repository permissions or resolve the transient API
   problem, then choose **Re-run failed jobs** (or **Re-run all jobs**).
   Previously posted comments are reused, including after partial failure.
3. A rerun uses the original merge event's PR description and original merged
   README. Editing a merged PR does not repair that snapshot. If the RCA text
   or log was incomplete, submit a reviewed follow-up PR with corrected RCA
   blocks, closing references, and log rows pointing to the follow-up PR.
   That PR publishes its own attributable correction; do not fabricate evidence
   to make the old run pass.

The workflow executes scripts only from the trusted base commit. PR descriptions
and README files are fetched as data, never executed. Only the publication job
has `issues: write`; regression tests run separately with a read-only token.
There is no AI-generated analysis or automatic assertion that tests passed.

**Initial rollout:** the trusted workflow becomes active after this change
lands on `main`; its own regression suite runs in the introducing PR. Once the
`RCA requirements` check appears, a maintainer should make it required in the
branch protection/ruleset alongside existing checks. The workflow alone does
not change repository merge settings. A missing required check on the first
rollout is not evidence that an RCA was validated.

## Browser envelope verification (issue #27)

Local Windows verification on 2026-09-24, branch
`feature/27-browser-envelopes`, Node 22.20.0 and Vitest 4.1.11:

- All 132 Vitest tests passed (71 DSP, including 34 new ADSR cases; 43 shared
  events, 11 browser lifecycle, seven MIDI). Default sustain RMS expectation
  changed from full level to 0.7; pitch/velocity/session coverage still passes.
- ADSR cases cover sample timing at six rates (8–384 kHz), every active-stage
  note-off, duplicate release, independent repeated-pitch presses, hard stealing
  during attack/decay/sustain/release, zero/sub-sample durations, parameter
  validation, slot reuse, block continuity, and boundary discontinuity bounds.
- Lint passed with zero errors and eight existing warnings in the home page
  and marker overlay. TypeScript and all 18 contrast pairs passed.
- Production build passed (Next.js 16.2.3).
- The unchanged production browser runner passed locally in Edge 153.0.4234.48:
  worklet HTTP 200, soft/loud RMS 0.0099406937 / 0.0298220811, chord output,
  stop silence, suspension recovery and navigation closure. This run passed
  despite the previously recorded D16 timing race; D16 is not fixed here.
- [Listening report 2.2.18](manual/2026-09-24_2.2.18.md): user-reported PASS
  on 2026-09-24: intended behavior, no sudden stopping and no audible pops.
  Browser/device and exact tested commit were not supplied. No measured physical
  latency, universally seamless stealing, or realistic piano timbre is claimed.
- Vitest remains outside CI (D3); no GitHub Actions execution is claimed.

## Calibration verification (issue #87)

Windows, 2026-09-27, Node 22.20.0, Vitest 4.1.11, working tree based on
614203f on fix/87-calibration-result. `npm ci` restored locked dependencies.

- All 169 tests passed across seven files: 12 calibration contract/geometry
  cases, six simulated calibration workflow cases, and six recording controls
  cases including invalidation while holding a key. Other existing suites passed.
- TypeScript passed. ESLint passed with five pre-existing unused-variable
  warnings in the home page. All 18 contrast pairs and production build passed.
- Calibration cases cover copied validated data, legacy flags, versions,
  coordinate convention, missing/duplicate markers, degenerate geometry,
  finite complete hand samples, MIDI bounds, perspective/key round trips,
  corrupt/denied storage, and camera/sheet/layout/movement compatibility.
- Workflow cases cover missing markers with retry, hover/rest capture failures,
  validated save, denied writes without navigation, and rechecking before save.
- Vitest is still absent from frontend CI (D3). These are local results;
  Actions execution and reviewer approval remain separate from local results.
- Carl Xu reported successful completion of the seven-step manual calibration
  checklist on 2026-09-28: marker/hand rejection and retry, saved result, reload
  reuse, sheet-loss interruption, corrupt-data recovery and camera-permission
  recovery. See the [passing manual report](manual/2026-09-27_6.2.2.md).
  Browser/device details and exact tested commit were not supplied. This is
  user-reported evidence, not independently observed or measured contact/latency
  verification.


## Session readiness verification (issue #24)

Local Windows execution on 2026-09-28, Node 22.20.0, Vitest 4.1.11,
`feature/24-session-gating`, stacked on #87 commit `71d44b2`:

- 196 tests passed across eight files. New `liveSession.test.ts` has 22 cases:
  invalid/mismatched calibration, missing tracking, transition sequence, startup
  cancellation, fresh identities, stale events, release on interruption,
  watchdog expiry/delayed execution, independent detector freshness, audio
  rejection, malformed events, retry, changed calibration and teardown.
- `recordingControls.test.tsx` now has ten simulated page/coordinator/marker
  cases. Existing pause/resume and calibration tests still pass through the
  gate; new cases cover audio interruption/restart, initial pending-start Stop,
  pagehide and repeated Play during initialization.
- `browserAudioLifecycle.test.ts` now has twelve cases, adding the real
  BrowserAudio owner with mocked context/worklet: startup reset, suspension,
  reset command, explicit reactivation and obsolete-session rejection.
- TypeScript passed. ESLint passed with five pre-existing unused-variable
  warnings in the home page. All 18 contrast pairs and production build passed.
- Vitest is not invoked by CI (D3); Actions evidence remains pending. These
  mocks establish neither device audibility nor physical latency/accuracy.
- Carl Xu reported all manual session-readiness checks passing on 2026-09-28,
  including calibration loss/recovery, audio suspension/reactivation, background
  and navigation, camera loss, startup recovery, Stop/restart and Pause/resume.
  See the [passing manual report](manual/2026-09-28_2.1.6.md). Results are
  user-reported; browser/device details, exact tested commit and per-step
  artifacts were not supplied. No quantitative latency/accuracy claim follows.
  Required independent review remains pending.

## One-octave integration verification (issue #28)

Windows, 2026-09-29, branch feature/28-browser-piano-integration, based on
#24 at 5d5f0b8 plus #137 at 7c2f77c (combined base b37db8d).

- All 213 Vitest tests passed across nine files. The 15 new deterministic
  pianoIntegration cases exercise eight pitches through production DSP, accepted
  note feedback and recording, velocity conversion, observer timing, chords,
  repeated presses, immediate Stop, same-pitch identities, tracking interruption,
  stale producers, audio rejection, invalid keys and invalid velocity.
- recordingControls now has 12 cases: the original ten still pass; added canvas
  highlight gating and immediate-Stop recording assertions use the real page,
  coordinator and geometry with simulated camera/hand/audio inputs.
- TypeScript passed. Lint passed with five existing home-page unused-variable
  warnings. All 18 contrast pairs and the Next.js 16.2.3 production build passed. Vitest remains outside CI (D3); no Actions
  execution is claimed.
- MIDI uses event observation times, independent press identities and normalized
  velocity × 100 for the writer. Existing recorder default-time/pause/export
  tests passed unchanged. Accepted history drains before lifecycle snapshots.
- Carl Xu reported the [manual checklist](manual/2026-09-29_2.1.2.md) passed
  on 2026-09-29, including successful export retest after the separate #141 fix
  for #140. That export fix is not included in PR #139 alone. Browser/device
  details, exact tested commit and per-step artifacts were not supplied.
- This user-reported pass does not establish intentional contact, measured
  finger-speed velocity, deployed cross-browser behavior, under-50-ms latency
  or under-3% errors. Independent review remains pending. This update changes
  documentation only; prior automated results are retained without a rerun.

Merge compatibility at implementation commit fc8f4f6: normal merge against the
resolved dependency base b37db8d produced the identical implementation tree
3142af798b00f2cc5287dd7bcd1d8076c230e90e. A simulated squash of all dependency
contents onto main 614203f conflicts if merged naively (ancestry is lost).
Transplanting only #28, using b37db8d as the merge base, passed with the same
identical tree. The historical transplant check below has been superseded by PR #139
merge reconciliation; do not replay the dependency commits. These checks use the
current heads, not unknown future edits. No existing PR or main was modified.

## MIDI export runtime verification (issue #140)

Local Windows execution on 2026-09-29; fix implementation 45304f6, based on
#139 head 025588e. Edge 154.0.4258.37, Playwright 1.62.1, Next.js 16.2.3.

- Baseline production page: seed a C3 completed take, open export and click the
  final Export button. Browser raised "Cannot read properties of undefined
  (reading 'Track')" in client chunk 15z31avwcs4s~.js; no download occurred.
  The user independently reported the same visible failure; browser unspecified.
- Root cause is the midi-writer-js paths entry targeting build/types/main.d.ts.
  Turbopack compiled the runtime import to undefined. Removing it and adding
  a type-only bridge to the shipped declarations preserves actual runtime code.
- Fixed production build: npm run test:midi-browser passed. Two downloads named
  recording.mid had exact valid MIDI bytes: one track, 128 ticks/quarter,
  120 BPM, C3/MIDI 48, velocity 102 and note-off after 128 ticks (500 ms).
  Both final Export clicks closed the dialog; no browser page errors.
- All 213 Vitest tests, TypeScript, production build and all 18 contrast pairs
  passed. Lint passed with five existing unused-variable home-page warnings.
- Browser regression uses guarded private React state injection for a completed
  take and actual production UI/library/downloads. It intentionally excludes CV,
  physical recording, audible playback, other browsers and timing requirements.
  UI hook changes require updating the fixture; failures are never skipped.
- Source: [browser regression](frontend/midiExport.browser.mjs). CI does not run
  this browser test or Vitest (D3); Actions execution remains pending. No new
  requirement or scope change. Listen remains unfinished; on the reconciled
  branch Delete clears the completed take but lacks browser verification.

User baseline failure and automated fix are recorded separately in the
[manual report](manual/2026-09-29_4.2.3.md); Carl Xu reported the export fix retest passed on 2026-09-29.
## PR #136 review verification

Local Windows execution on 2026-09-29, Node 22.20.0, Vitest 4.1.11,
branch `fix/87-calibration-result`, following review of issue #87 / PR #136.

- Frontend-configured `npx vitest run`: **174 tests passed across seven files**,
  including eleven recording-control integration cases. Five added cases cover
  immediate/ten-second marker cadence, free play across MIDI recording states,
  calibration loss, immediate frame-loss recovery, and stale audio initialization.
  Existing held-key resume and cancellation cases also pass. Audio dispatch is
  mocked; no hardware sound, FPS improvement or physical latency is measured.
- TypeScript, ESLint (five existing unused-variable warnings), all 18 contrast
  pairs and production build passed. Run commands from `frontend/`.
- An initial accidental repository-root Vitest invocation used an unconfigured
  runner and failed dependency/mock resolution; the configured frontend run above
  is the verification result. Its temporary root cache was removed.
- The ten-second cadence permits up to ten seconds before detecting sheet loss;
  frame loss still interrupts on the next animation frame. The earlier user
  manual report predates these edits; new physical/manual verification is pending.
- Vitest remains outside frontend CI (D3); Actions execution is pending.


## PR #138 review verification

Local Windows execution on 2026-09-30, Node 22.20.0, Vitest 4.1.11,
following merge of main at 4dc41ab (PR #136) into feature/24-session-gating.

- All 204 tests passed across eight files, including 25 readiness cases and
  15 page/coordinator/marker integration cases. Named note methods cover press
  pairing, obsolete identities, malformed values and readiness loss. Separate
  deadlines preserve ten-second marker checks and 500 ms hand-tracking expiry;
  continuing hand observations cannot conceal an expired marker observation.
- Combined page coverage preserves free play before recording, through count-in
  and Pause, and after Stop; held notes enter MIDI at capture boundaries without
  retriggering sound. Resume keeps the live session without reinitializing audio.
  Calibration/frame loss, startup cancellation and audio interruption still gate
  playback. Audio and camera hardware are mocked.
- TypeScript, ESLint (five existing unused-variable warnings), all 18 contrast
  pairs, production build and git diff --check passed.
- An accidental root-level Vitest run used an unconfigured runner and failed;
  only the frontend-configured run above is verification evidence. Its temporary
  cache was removed. The new deadline fixture initially advanced its fake clocks
  in the wrong order; corrected before the passing run.
- Inventory ID 2.1.7 preserves PR #136's playback regression coverage, which
  independently used the same 2.1.5 ID as this branch's readiness unit tests.
- The earlier manual pass predates these changes. Physical/manual verification
  of this merged behavior and Actions execution remain pending. Vitest remains
  outside frontend CI (D3); no FPS, detection accuracy or physical latency claim.

## PR #138 follow-up review verification

Local Windows execution on 2026-09-30, `feature/24-session-gating`, working
changes based on `0fecdb5` (Node 22, Vitest 4.1.11):

- All 205 Vitest tests passed across eight files, including 26 live-session
  cases and 15 simulated page/coordinator/marker integration cases.
- The new case preserves a playing session across an 11-second marker gap
  with fresh hand tracking, then verifies invalid calibration releases notes.
  Existing cases verify marker expiry, stale hands and token-paired releases.
- TypeScript and production build passed. Lint passed with five existing
  unused-variable warnings. All 18 contrast pairs passed.
- Readiness now comes from the session; marker geometry uses its returned
  compatibility decision. Both audio adapters share one press-token sink.
- Low-severity review cleanup: repaired UTF-8 mojibake in the inventory and
  removed unused pitch-based audio wrappers, which had no production callers.
- Two-second marker jitter slack is provisional. Hardware timing, physical
  camera/audio behavior and GitHub Actions execution remain unverified.

## PR 139 frontend CI merge repair

On 2026-09-30, restored the coordinator's accepted-event `activePitches`
prop and the missing `Delivery` type import on the PR branch based on
`e0a4a95`. Merge conflict resolution had retained obsolete note callback props
and removed an import still used by the MIDI observer subscription.

Local Windows verification: lint passed with four existing unused-variable
warnings in page.tsx; TypeScript passed; all 228 Vitest tests in nine files
passed; all 18 contrast pairs passed; production build passed.
No test cases changed. GitHub Actions execution for this repair is pending.

## Earlier PR 139 and PR 141 reconciliation evidence

- All 222 tests passed across nine files: 25 readiness cases, 17 page integration
  cases and 16 piano integration cases. Retained both branches' coverage and
  updated feedback expectations for independent recording Stop.
- Added a recording-boundary regression: deferred pre-capture history is drained,
  released notes are excluded, held same-pitch identities and velocities survive
  start/resume, and capture does not retrigger audio. Existing immediate Stop,
  pause/resume, tracking interruption and stale producer cases also pass.
- TypeScript, ESLint (five existing unused-variable warnings), all 18 contrast
  pairs and the Next.js 16.2.3 production build passed. `git diff --check` passed.
  An initial repository-root `npx tsc` invocation did not run the project compiler;
  the passing TypeScript check used the frontend working directory.
- Tests use simulated camera/audio inputs and production offline DSP. No new
  hardware/manual verification, physical latency or detection accuracy claim.
  Earlier manual passes predate this merge. Vitest remains outside CI (D3);
  Actions results are separate.
- Reconciliation keeps #138's named note methods, independent playback and
  marker cadence, #139's timestamped shared consumers, and #137's cleanup.
  The previous squash-transplant instruction is obsolete; #138 remains a
  dependency until merged.

## PR #141 merge reconciliation

Local Windows execution on 2026-09-30, Node 22.20.0, Vitest 4.1.11,
merging PR #139 head `b136e6a` into PR #141 head `b5245ea`.

- Preserved both branches' verification records and the MIDI runtime/type split.
- All 222 tests passed across nine files. TypeScript, all 18 contrast pairs,
  production build and whitespace checks passed. ESLint passed with five
  existing unused-variable warnings in Home.
- The production export regression initially rejected the changed Home hook
  layout. Updated its guarded fixture for the consumer ref added by #139;
  no production change was needed. Lint passed again after the fixture edit.
- `npm run test:midi-browser` passed in Edge 154.0.4258.37 against the new
  production build: two downloads, exact MIDI bytes, dialog closure and no
  page errors. Inventory 4.2.3 retains the seeded-take limitation; no new
  physical recording, camera, audio or latency verification is claimed.
- Vitest and the browser runner remain outside CI; Actions evidence is pending.
  PR #139 remains a dependency until merged. This reconciliation supersedes
  the old instruction to transplant only commits after `025588e`.

## PR 141 reconciliation with final PR 139 head

On 2026-09-30, merged PR #139 head `277491a` into the MIDI export fix.
Preserved both verification histories while resolving the README conflict;
retained the export runtime/type split and #139's corrected coordinator types.
Current `origin/main` (`46ed0c7`) is already an ancestor. Merge #139 first;
this branch includes its current contents and is compatible with that order.

Local Windows verification on merge commit `386b3e7`: all 228 Vitest tests
across nine files passed; TypeScript, 18 contrast pairs and production build
passed. Lint passed with four existing Home warnings. The production browser
regression passed in Edge 154.0.4258.37: two downloads with exact MIDI bytes,
dialog closure and no page errors. It uses a seeded take, not physical capture.
No tests changed. GitHub Actions execution for this reconciliation is pending.
