# MakeShift Repository Organization

## Repository Tree

```text
MakeShift/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   └── defect_report.yml        # defect (bug) report form
│   ├── pull_request_template.md    # PR sections and RCA instructions
│   ├── scripts/
│   │   └── rca.cjs                 # trusted RCA validator/publisher
│   └── workflows/
│       ├── bypass-checks.yml        # no-op test/lint jobs for non-Python PRs
│       ├── bypass-frontend.yml      # no-op frontend job for non-frontend PRs
│       ├── frontend-ci.yml          # lint, type check, contrast audit, build
│       ├── linting.yml              # ruff, mypy, clang-format
│       ├── preview.yml              # Vercel preview link for PRs labeled preview-link
│       ├── rca.yml                  # validate RCA evidence; publish after merge
│       ├── rca-tests.yml            # regression tests for RCA automation
│       └── testing.yml              # pytest, CMake build, CTest
├── backend/
│   ├── CMakeLists.txt               # audio library, nanobind module, GoogleTest
│   └── src/
│       ├── API/
│       ├── audio/                   # AudioEngine (PortAudio) and SpscQueue
│       ├── CV/
│       ├── MIDI/
│       ├── Bindings.cpp             # nanobind Python bindings
│       └── __init__.py
├── docs/
│   ├── architecture.md              # browser target, tooling, delivery boundaries
│   ├── rvtm_browser_addendum.md      # browser requirement/test reconciliation
│   ├── browser_audio.md             # browser DSP, transport and verification
│   ├── audio.md                     # polyphony and voice stealing
│   ├── audio_events.md              # native audio event queue contract
│   ├── piano_integration.md         # one-octave shared-event consumers and limits
│   ├── live_session.md              # readiness states, tracking timeout and recovery
│   ├── note_events.md               # shared browser event/session/clock contract
│   ├── dev_process.md
│   ├── piano_sheet.md               # printable sheet and ArUco marker IDs
│   ├── Piano Sheet.png
│   ├── sdp.md
│   ├── Design Document.pdf
│   └── Final Verification and Validation Plan.pdf
├── frontend/
│   ├── public/
│   │   ├── audio/                   # piano-worklet.js and shared synth.js
│   │   └── models/                  # MediaPipe hand landmarker model
│   ├── src/
│   │   ├── app/
│   │   │   ├── audio/                  # browser owner and Audio check page
│   │   │   ├── about/
│   │   │   ├── calibration/
│   │   │   ├── cv/                  # hand landmark overlay and drawing
│   │   │   ├── documentation/
│   │   │   ├── midi/                # MIDI recording utils
│   │   │   ├── tutorial/
│   │   │   ├── CameraContext.tsx
│   │   │   ├── CameraStatusOverlay.tsx
│   │   │   ├── MarkerTrackingOverlay.tsx
│   │   │   ├── globals.css          # --color-* theme tokens
│   │   │   ├── layout.tsx
│   │   │   ├── lighting.ts
│   │   │   ├── page.tsx
│   │   │   ├── SideNav.tsx          # shared responsive nav tabs
│   │   │   └── useHandLandmarker.ts
│   │   ├── cv/                      # ArUco detection, homography, key geometry
│   │   │   ├── contactPipeline.ts    # individual overlap, knuckle, and shadow checks
│   │   │   ├── liveContactPipeline.ts # controller: eligibility, shadow worker/history, releases
│   │   │   ├── combinedContact.ts    # prototype per-finger gated press/release state
│   │   │   ├── shadowHeuristics.ts   # prototype RGB k-means dark-region segmentation
│   │   │   └── shadowWorker.ts       # bounded background shadow segmentation
│   │   ├── events/                  # shared schema, clocks, session and audio adapter
│   │   └── shims/                # empty fs shim and type-only MIDI declaration bridge
│   ├── package.json
│   ├── package-lock.json
│   ├── vitest.config.mts            # discovers tests/frontend/
│   ├── tsconfig.json
│   ├── next.config.ts
│   └── README.md
├── tests/
│   ├── README.md                    # commands, known defects, RCA log
│   ├── verification_test_inventory.md
│   ├── audio/
│   │   ├── test_audio.cpp
│   │   └── test_audio_events.cpp
│   ├── automation/
│   │   └── rca.test.cjs             # RCA parser, validation, publication tests
│   ├── frontend/
│   │   ├── browserAudio.test.ts      # production DSP offline rendering
│   │   ├── browserAudioLifecycle.test.ts # browser owner mocks
│   │   ├── browserAudio.browser.mjs  # production browser graph check
│   │   ├── homePage.test.ts
│   │   ├── pianoIntegration.test.ts # deterministic note-to-audio/MIDI/feedback
│   │   ├── liveSession.test.ts       # readiness transitions and stale-input safety
│   │   ├── noteEvents.test.ts        # shared events, lifecycle, clocks and MessagePort
│   │   ├── midiExport.browser.mjs  # production Export UI and downloaded MIDI bytes
│   │   ├── midiUtils.test.ts
│   │   └── check-contrast.mjs
│   ├── python/
│   │   └── test_dummy.py
│   └── manual/                     # manual test template and completed reports
├── .clang-format
├── .gitignore
├── AGENTS.md                        # contributor and coding agent instructions
├── CLAUDE.md                        # points to AGENTS.md
├── LICENSE
├── README.md
├── requirements.txt
└── ruff.toml
```
### Project Structure

References discussing horizontal / layered file structure: 
1. https://www.esveo.com/en/blog/wv/
2. https://labs.madisoft.it/folder-structure-for-big-projects-package-by-type-layer-or-feature/

MakeShift follows an approach similar to a horizontal/layered file structure with a subsystem-based organization. The main folders correspond to the project's major subsystems, including frontend, CV, MIDI, audio, and testing. This allows the different technical subsystems to be easily separated, with each subsystem containing the code relevant to its specific functionality.

Each subsystem should remain as independent as reasonably possible and expose a clearly defined interface for interacting with other subsystems. This separation allows team members to work on individual subsystems without unnecessarily affecting other parts of the project, while providing clear boundaries for communication between components.

## Branching Model

We use a fork-and-pull-request workflow:

- Each developer creates and works from their own fork of the repository.
- Feature or fix branches are created in the developer fork (for example: `feature/audio-sync`).
- Pull requests are opened from fork branches into the upstream repository `main` branch.
- All feature updates are merged through pull requests (no direct pushes to `main`).
- Feature branches are automatically deleted after their pull request is merged.

## Code Development and Review Policy

### Pull Request Requirements

- Every code change must be submitted through a pull request.
- Every feature update must be merged through the PR process.
- PRs must target the upstream `main` branch from a branch in a personal fork.
- PR descriptions should clearly explain:
  - what changed
  - why it changed
  - how it was tested

### CI and Quality Gates

- CI must pass before a PR can be merged.
- CI checks include:
  - tests passing
  - code quality/lint/cleanliness checks passing
- PRs with failing CI checks are not eligible for merge.

### Preview Deployments

Add the `preview-link` label to a PR to deploy it to Vercel. The
`Vercel preview` workflow comments the link on the PR (updating the same
comment on later runs), then removes the label. Previews are public.

- **Review first.** The workflow runs with the base branch's copy of the
  workflow and a Vercel token, and the preview builds with the Preview
  environment, whose server-side secrets include the Supabase secret key.
  Label a fork PR only after reading its diff, especially changes to
  `vercel.json`, `next.config.ts`, `package.json` or server routes.
- **Redeploy** by re-adding the label after reviewing new commits; pushes
  alone do not redeploy.
- The runner never installs or runs PR code. It uploads the PR source and
  Vercel builds it remotely.
- **Setup:** the repository owner adds a `VERCEL_TOKEN` Actions secret
  (Settings > Secrets and variables > Actions) holding a Vercel access token
  for the `make-shift` project owner. Without it, the workflow fails and
  comments a link to the run. The org and project IDs are not secret and
  live in `preview.yml`.

### Running Python Checks Locally

From the repository root, install the dependencies and run the same Python
checks as CI:

```sh
python -m pip install -r requirements.txt
python -m ruff check backend/src tests
python -m mypy backend/src --check-untyped-defs
python -m pytest --cov=backend --cov-report=term-missing
```

Ruff checks Python style, common errors, and import sorting in one command.
The rules and 79-character line limit are configured in `ruff.toml`. To apply
available fixes locally, run `python -m ruff check --fix backend/src tests`
and review the changes before committing. CI checks files without changing them.

### Testing and Defect Documentation

- A PR that adds or changes a test updates its row in
  `tests/verification_test_inventory.md`. Put test implementations, fixtures,
  and helpers in the matching `tests/audio/`, `tests/frontend/`,
  `tests/python/`, or `tests/automation/` directory. Keep runner configuration
  with its owning package/build system. Commands are in [the testing guide](../tests/README.md#running-the-tests).
- Defects are filed with the defect report issue template. Severity decides
  how much documentation is needed (see `tests/README.md`).
- High severity fixes and the assignment example (regardless of severity)
  require an RCA. Mark the assignment example in the defect issue form;
  use the `rca-required` issue label for older issues or team-requested RCAs.
- The author writes a separate RCA block for each target bug issue in the
  fix PR description and includes `Closes #N` for each target. Complete the
  corresponding RCA log row in `tests/README.md` in that PR. Open the PR as
  a draft to obtain its URL before filling the Fix PR cell if necessary.
- The `RCA requirements` check validates eligibility, seven required fields,
  an evidence link, and a complete log row. Reviewers still verify the actual
  root cause, test results, regression coverage, and any PR description edits
  before merge. Automation checks structure, not the truth of the analysis.
- After merge, `Publish RCA` posts the description captured by the merge
  event to the selected issue. Authors do not need to copy comments manually.
  See `tests/README.md` for the exact template and failed-run recovery.
- Run `node --test tests/automation/rca.test.cjs` on Node 22 when changing RCA automation.
  The `RCA automation tests` workflow runs on every PR and main push.

### Review and Approval Rules

- At least one reviewer approval is required before merge.
- The required approval must be completed on the PR before it is merged into `main`.
- The merge to `main` happens only after:
  - CI passes
  - minimum reviewer approval threshold is met

## Naming Conventions

### Branch Names

Branches live in a personal fork and follow `type/short-description`:

- `type` is one of `feature`, `fix`, `docs`, `test`, `refactor`, or `chore`.
- `short-description` is lowercase and hyphen-separated, a few words at most.

Examples:

- `feature/midi-note-on`
- `fix/calibration-restart-button`
- `docs/sprint-cadence`
- `test/midi-unit-tests`

If a branch maps to a single issue, including the issue number is encouraged:
`feature/41-midi-note-on`.

### Pull Request Titles

PR titles use the same shape, `type: short summary`:

- a lowercase `type` prefix matching the branch type
- a short, imperative summary of what the PR does

Examples:

- `feature: generate MIDI note-on events`
- `fix: calibration restart button not resetting state`
- `docs: sprint close-out and project view refresh process`

## Linking Issues to Pull Requests

Every PR should trace back to an issue on the project board.

- Put a GitHub closing keyword and the issue number in the **PR description**
  (not just the title), so the issue is linked and closed automatically when the
  PR merges into `main`: `Closes #41`.
- Use one keyword per issue if a PR finishes more than one:
  `Closes #41`, `Closes #42`.
- If a PR relates to an issue but does not finish it, reference it without a
  closing keyword so the issue stays open: `Part of #46`.
- Auto-closing still respects our review rules: the issue closes when the PR
  merges, which only happens after CI passes and a reviewer approves.
- Anything that cannot be linked to an existing issue needs an issue opened for
  it first, so the sprint views stay accurate.

Example PR description:

```text
**What changed**

added note-on event generation for the MIDI subsystem.

**Why**

first half of the note event pipeline. Closes #41, part of #46.

**How it was tested**

added unit tests under tests/, passing locally and in CI.
```

## Sprint Cadence and Project Board Upkeep

We work in 2-week sprints. Sprints start and end on **Wednesday**, since that is
when the whole team is scheduled to meet.

### Closing Out a 2-Week Chunk of Work

At the end of every sprint (each sprint-boundary Wednesday) we hold a combined
review and planning meeting:

- **Review.** As a team we walk through everything that was done over the past
  two weeks: merged PRs, work still in flight, and anything that got blocked.
- **Closing issues.** Issues are closed during this meeting by explicit team
  agreement. An issue is only closed once the team agrees its acceptance
  criteria are met and the corresponding PR has been merged into `main`
  (which already requires passing CI and at least one reviewer approval).
  Anything that is not agreed to be done stays open and is carried into the
  next sprint.
- **Planning.** In the same meeting we scope the next two weeks: we write or
  refine the issues for the upcoming sprint and assign owners, so that each
  team member leaves the meeting knowing what they are responsible for.

### Refreshing Our Views

Both project views are refreshed at the sprint boundary, in the same Wednesday
meeting, so they always reflect current state:

- **Roadmap.** Updated at the end of each 2-week cycle. We adjust dates and
  status for items completed during the sprint, and re-time any items that
  slipped, so the roadmap matches actual progress rather than the original plan.
- **Next 2 Weeks.** Refreshed at the start of each 2-week cycle. Completed
  issues drop off as they are closed during review, carried-over issues stay,
  and the newly scoped issues from planning are added in. The view should only
  ever contain work that is in scope for the current sprint.
