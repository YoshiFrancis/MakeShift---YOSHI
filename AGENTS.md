# Repository Instructions

These instructions apply to every contributor and coding agent (Codex, Claude,
or anything else). `CLAUDE.md` points here, so keep this file as the single
source of truth.

## Project Scope and Architecture

MakeShift is a browser-based virtual piano played on a printed keyboard using
a webcam. Prioritize accurate intentional press/release detection and low-latency
sound, with calibration, visual feedback, velocity and MIDI recording/export.
Read [the architecture](docs/architecture.md) before changing subsystem boundaries;
it separates existing behavior from planned work and links implementation issues.

- Target pipeline: camera → CV worker → calibrated detection → musical events →
  browser audio, MIDI and feedback. Vercel serves the application/assets; live
  playing has no per-note network or WebRTC dependency.
- Start browser synthesis with JavaScript in an AudioWorklet. C++/PortAudio
  outputs on its host machine and remains a native reference, not browser
  playback. A WebAssembly port needs a documented reason.
- Process fresh frames with bounded pending work. Keep expensive CV off the UI
  thread and audio dispatch independent of React renders and MIDI processing.
  Avoid blocking work and avoidable allocations in audio rendering.
- Use validated versioned calibration and explicit session/press identities.
  Stop/invalidation releases notes and rejects stale events. Polygon overlap
  alone does not establish finger contact.
- Evaluate accuracy and latency together: under 3% combined detection errors and
  under 50 ms physical-press-to-sound are verification targets, not current claims.
  Follow the [RVTM addendum](docs/rvtm_browser_addendum.md) and inventory; report
  conditions, hardware, distributions and measurement limits.
- Keep versions in manifests/lockfiles and model/runtime assets compatible.
  The architecture lists existing versus planned tools and verification.
## Read First

- `docs/dev_process.md`: PR workflow, issue linking, branch and PR naming,
  review requirements, and documentation style. Follow it for every change.
- `tests/README.md`: how to run each test suite, the known defect list, the
  root cause analysis (RCA) log, and severity rules for defects.
- `tests/verification_test_inventory.md`: every verification test, the
  requirement it covers, its owner, and whether CI runs it.

## Repository Map

| Path | Contents |
| :--- | :--- |
| `frontend/` | Next.js web client: camera, calibration, CV overlays, MIDI utils |
| `frontend/public/audio/` | Static AudioWorklet and shared fixed-voice DSP |
| `frontend/src/app/audio/` | Browser audio owner and user-triggered sound check |
| `frontend/src/diagnostics/` | Shared bounded metrics and explicit camera-video registry |
| `frontend/src/events/` | Shared browser note schema, clocks, session dispatch and audio adapter |
| `frontend/src/cv/` | ArUco marker detection, homography, keyboard geometry, prototype shadow worker and combined per-finger contact state |
| `frontend/src/lib/` | Shared browser utilities, including versioned `localStorage` access |
| `frontend/src/app/api/` | Server routes; `/api/health` checks the recordings database |
| `frontend/src/server/` | Server-only Supabase access (never import from client code) |
| `supabase/` | Supabase CLI config and SQL migrations for shared recordings |
| `backend/` | C++ audio engine (PortAudio) and its nanobind Python module |
| `tests/` | Test inventory, testing guide, and suite subdirectories |
| `tests/audio/` | C++ GoogleTest audio and queue suites |
| `tests/frontend/` | Vitest MIDI tests and contrast audit |
| `tests/python/` | Python tests (currently a placeholder) |
| `tests/automation/` | Repository-process RCA tests |
| `tests/manual/` | Manual test template and completed manual test reports |
| `docs/` | Architecture, browser RVTM addendum, process, SDP, V&V plan, design, subsystem notes |
| `.github/workflows/` | CI: tests, linting, frontend checks, RCA validation/publication |
| `.github/scripts/` | Trusted RCA validation and comment automation |
| `.github/pull_request_template.md` | PR description and RCA authoring instructions |
| `.github/ISSUE_TEMPLATE/` | Defect report template |

## Workflow

1. Start from an issue. If none exists, open one first (see
   `docs/dev_process.md`).
2. Branch as `type/<issue>-short-description` in your fork.
3. Make the smallest change that closes the issue. Do not fix unrelated code
   in the same PR; open or reference a separate issue instead.
4. Run the checks for every area you touched (below) before opening a PR.
5. Update documentation in the same PR (see "Keep Docs in Sync").
6. Open the PR against upstream `main` with `Closes #N` in the description and
   the "What changed / Why / How it was tested" sections.

## Checks to Run

| Area touched | Commands (from repo root unless noted) |
| :--- | :--- |
| Frontend | `cd frontend && npm run lint && npx tsc --noEmit && npx vitest run && npm run test:contrast && npm run build` |
| Frontend browser | With `npm start` running: `npm run test:deployment` and `AUDIO_BROWSER_CHANNEL=chromium npm run test:audio-browser` (`npx playwright install chromium` once) |
| Database | `npx supabase db push --linked` for new migrations; see `docs/supabase.md` |
| Python | `python -m ruff check backend/src tests`, `python -m mypy backend/src --check-untyped-defs`, `python -m pytest` |
| C++ | `cmake -B build -S backend && cmake --build build --config Release && ctest --test-dir build -C Release --output-on-failure` |
| C++ formatting | `clang-format --dry-run --Werror` on changed files (`.clang-format`, clang-format 17) |
| RCA automation | `node --test tests/automation/rca.test.cjs` (Node 22); CI: `rca-tests.yml` |

The C++ build requires Python 3.12 and nanobind (`pip install -r requirements.txt`).
If a check cannot run locally (for example, no audio device or no CMake),
say so in the PR description instead of claiming it passed.

## Keep Docs in Sync

A change is not done until the matching documentation is updated:

- **New, changed, or moved test file:** add or update every affected test row in
  `tests/verification_test_inventory.md` (ID, level, requirement, owner, tool,
  automation, implementation status, CI status, source link, execution evidence).
  When implementing a planned test, update its existing ID in that same PR;
  do not leave it marked Planned or create a duplicate row. Audit the actual
  test cases, not just filenames. Mark partial coverage and hardware skips
  explicitly. Set CI integration only when the workflow invokes the test,
  and link a specific GitHub Actions run/job log once execution is verified.
  A source link, workflow landing page, or successful build alone is not
  evidence that a test passed. Keep unverified results and dates pending.
  Assign owners by the behavior tested: Carl Xu for audio/latency,
  Jadden Picardal for UI, Francis Ozua for computer vision, and Harry Deng
  for MIDI and other areas.
- **New CI job or workflow change:** update the "CI Integrated?" column for
  affected tests and the check table above.
- **Defect found:** High or Medium severity defects get a GitHub issue using the
  defect report template, and a row in the known defects table in
  `tests/README.md`. Severity rules live in `tests/README.md`.
- **RCA-required defect fixed:** High severity defects and the assignment
  example (any severity) require an RCA. Keep the issue's severity and RCA
  requirement fields accurate; use the `rca-required` issue label for older
  reports or additional requested RCAs. Keep the `bug` label on defect issues.
  Add one explicit RCA block per defect to the fix PR using the template in
  `tests/README.md`, and close each target with `Closes #N`. Complete the RCA
  log row in that same PR, including the issue URL, fix PR URL, and regression
  test. Open a draft first if the PR number is needed for the row. Reviewers
  check the analysis and actual evidence before approval. Automation posts
  the merge-time RCA after merge; do not also post it manually. Recover a
  failed publication through the Actions rerun procedure in `tests/README.md`.
- **Manual test of a critical workflow, or one that exposes a critical defect:**
  copy `tests/manual/manual_test_template.md` into a new dated report in
  `tests/manual/`.
- **New folder, subsystem, or moved files:** update the repository tree in
  `docs/dev_process.md` and the map above.
- **New requirement or changed scope:** update the RVTM and SDP, then map at
  least one test to the requirement in the inventory.

## Conventions

- Frontend colors come from `--color-*` tokens in `frontend/src/app/globals.css`.
  Do not hardcode hex values; add new token pairs to `tests/frontend/check-contrast.mjs`.
- Python follows `ruff.toml` (79-character lines). C++ follows `.clang-format`.
- Keep test implementations, helpers, and fixtures in the matching suite
  subdirectory under `tests/`. Frontend Vitest specs belong in `tests/frontend/`;
  configure discovery in `frontend/vitest.config.mts`. Keep package and build
  configuration with its owning tool, and document any necessary exception.
- Remove debug `console.log` calls before opening a PR, especially inside
  per-frame loops.
- Tests that need hardware (camera, audio device) must skip explicitly
  (`GTEST_SKIP()`, `pytest.skip`) rather than return early and report a pass.
