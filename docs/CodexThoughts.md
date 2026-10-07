# CV accuracy thoughts

This document records the current reasoning about intentional finger-contact
detection. It is exploratory design discussion, not evidence that any proposed
method is accurate yet. The relevant target remains rejecting hover while
preserving short presses, releases, chords, and low latency.

## Key overlap

Key overlap is already part of the current implementation. The fingertip is
projected onto the calibrated sheet, then tested against the cached key
polygons to determine which key is underneath it. A small boundary tolerance
helps account for landmark jitter.

Key overlap answers **which key is underneath the fingertip**, but not whether
the finger is actually pressing it. It is therefore a required spatial input
to the contact score, not sufficient contact evidence by itself.

## The idea already in `cv_accuracy_plan.md`

The alternative to using raw MediaPipe `z` as a universal 3D coordinate is an
**empirical contact-surface model**. During calibration, the player hovers over
and touches several known locations on the printed sheet. For each sample,
record the fingertip's sheet `(x, y)`, relative depth, finger identity, hand
or posture features, and the contact label. Fit an expected contact depth:

```text
expected_contact_depth = f(sheet_x, sheet_y[, finger, posture])
```

At runtime, contact is plausible when the fingertip is over a key, its depth is
near the expected local value, and the evidence remains stable for multiple
observations. This does not make MediaPipe `z` metric or perfectly idempotent;
it learns the repeatable part of the camera/model setup and uses a residual
with a measured tolerance. The model may need per-finger or per-hand
normalization if posture changes its residual substantially.

The plan also describes a **geometric plane-depth model**: use marker size and
camera calibration to estimate the physical keyboard plane, deproject a real
3D fingertip into the camera frame, and measure perpendicular distance to that
plane. This is the physically clean solution, but MediaPipe's relative `z`
alone is not the required metric 3D point. It would need compatible camera
intrinsics, plane pose, and a validated 3D-hand estimate.

## Assessment of the proposed methods

### MediaPipe relative `z`

Raw `z` should remain a feature, not a decision rule. It can provide useful
short-term approach/retraction information after subtracting common hand
motion, but it is affected by hand scale, camera viewpoint, occlusion, model
noise, and landmark tracking changes. A fixed threshold is therefore unlikely
to be idempotent across sessions or users. A local calibrated residual and
temporal hysteresis are more defensible than interpreting `z` as height above
the paper.

**Current status:** MediaPipe fingertip `z` is captured during depth
calibration. The persisted per-finger `zLines` map fingertip z to expected
sheet Y; they are calibrated z-dependent position boundaries, not metric
contact-depth values. The live controller now has a per-finger z history and a
predicted-contact state. With knuckle and shadow techniques enabled, decreasing
z across three observations plus crossing the calibrated zLine starts note-on;
fresh shadow evidence must confirm within 150 ms or the provisional note is
released. Both techniques are currently disabled in the debug configuration,
and this path has not been validated for accuracy or latency. The standalone
contact-score experiment remains separate from the live note path.

The saved trial labels support decreasing MediaPipe z as the working direction
during the move phase after excluding its first four settling/hover samples.
There is no per-finger movement-delta threshold. The evaluator uses a 150 ms
history window and currently requires a net decrease; its `Z_LINE_TOLERANCE`
applies only to the predicted sheet-position boundary and is zero for now.
Verify the working direction and behavior with clearly labeled trials before
tuning that tolerance. On tracking loss or eligibility/key changes, discard
the finger's history and prediction latch.

### Knuckle-distance depth estimate

Knuckle distance should be treated as a second depth signal alongside
MediaPipe `z`. During calibration, record both signals at different positions
on the sheet and build two simple models:

```text
expected_z = z_model(sheet_position)
expected_knuckle_distance = knuckle_model(sheet_position)
```

At runtime, compare the observed values with their expected values. These
differences are two separate residuals. If both support the same movement
toward the keyboard, confidence in a press increases.

The knuckle-distance model may be approximately linear from the front of the
sheet to the back. Finger bending, perspective, hand size, and landmark noise
can still affect it, so calibration and testing should determine how reliable
that relationship is. It should be used as another supporting signal, not as a
replacement for fingertip location or the press state machine.

### Separate depth boundaries

The `z` and knuckle signals should keep separate calibrated boundaries. For
example:

```text
z_boundary_y = f_z(z)
knuckle_boundary_y = f_k(knuckle_distance)
```

Each boundary indicates where the fingertip should be for that depth signal to
support a press. If the fingertip crosses both boundaries in the expected
direction, press confidence increases. If only one boundary is crossed, the
finger can remain in candidate-press state while the other contact signals are
checked.

Separate release boundaries should be used as well, so small movements near a
threshold do not repeatedly switch between pressed and hovering.

### Joint angle and velocity

Joint shape can provide a simple posture check. A finger should be curved in a
reasonable way before it is allowed to contribute much press confidence. A
very flat hand can be treated as poor posture or low-confidence input. This
may also help reject accidental detections when the player rests their hand
flatly. A curved finger can still hover, so curvature alone does not establish
contact.

Motion provides transition evidence. Movement toward a key supports a press,
little movement while staying over a key supports hover, and movement away
from the key supports release. Losing key overlap while moving away is strong
release evidence. Motion should be tracked separately for each finger and
smoothed over several frames so landmark noise does not create transitions.

In simple terms:

```text
curved finger + key overlap + movement toward key -> stronger press evidence
curved finger + key overlap + little movement     -> likely hover
pressed finger + movement away + less overlap     -> stronger release evidence
```

Joint shape and motion remain supporting signals. They should contribute to
the contact score and use separate press and release thresholds, rather than
triggering notes by themselves.

### Shadow-based detection

This section describes the original idea. The current prototype uses RGB
k-means segmentation and a combined relative/absolute contour-area rule,
described under [Shadow segmentation and combined contact](#shadow-segmentation-and-combined-contact).
It does not currently require a darkening-then-disappearance sequence. Shadow
candidates now confirm contact after key-overlap and relaxed knuckle gates.

The shadow idea is promising as an independent visual cue. With the overhead
light, the observed pattern is:

```text
hover    -> stable shadow
approach -> shadow becomes darker or larger
contact  -> shadow area disappears beneath the fingertip
release  -> shadow returns
```

The important measurement is the shadow region, not one pixel. Around each
projected fingertip, calculate the shadow area, average darkness, position, and
change over time. A simple first implementation can compare camera pixels with
a local hover background and count pixels that are sufficiently darker than
that background. This does not require another AI model.

The shadow score should look for the sequence of darkening followed by
disappearance while the fingertip remains over the same key. For release, the
returning shadow can support the evidence that the finger moved away.

The shadow region may be offset from the fingertip, so the expected offset from
the overhead light should be calibrated or configured. A local shadow baseline
and temporal smoothing can reduce effects from image noise. Shadow evidence
should still be combined with fingertip location and the other contact signals
so unrelated lighting changes do not create notes.

## Other approaches worth considering

1. **Per-finger calibrated classifier.** Build a small, interpretable model
   over sheet position, relative depth residual, normalized hand scale, joint
   angles, velocities, shadow score, key identity, and short histories. Start
   with logistic regression or a decision tree so the reason for a press is
   inspectable. The output should feed the existing
   `HOVER -> CANDIDATE_PRESS -> PRESSED -> CANDIDATE_RELEASE` state machine,
   not replace it.

2. **Negative-evidence hover model.** Instead of trying to prove physical
   contact from one frame, learn what stable hover looks like for each finger.
   Require a significant, finger-specific departure from that baseline plus
   key overlap. This matches the available data better than an absolute depth
   claim and naturally supports user calibration.

3. **Key-plane image cues.** Use local optical flow, fingertip apparent size,
   contour shape, and the small region around the projected contact point.
   These can distinguish an approach from a stationary hover, but are sensitive
   to motion blur and lighting. They are useful candidates for ablation tests.

4. **Improved monocular geometry.** Use camera intrinsics, marker-derived
   plane pose, fingertip ray geometry, and a validated hand model to estimate
   the fingertip-to-plane distance. This is more principled than raw `z`, but
   should only be pursued if a metric or consistently calibrated 3D hand
   estimate is available.

5. **Actual depth sensing.** A stereo, structured-light, or RGB-D camera could
   supply metric depth and greatly simplify the plane-distance test. It is
   probably unsuitable as the default product assumption because it changes
   hardware requirements, but it is valuable as a ground-truth or research
   instrument for labeling RGB-camera experiments.

6. **Instrumented reference sheet.** For experiments, use capacitive touch,
   pressure-sensitive film, or a manually triggered physical reference to
   label true contact and timing. This would let us measure which features
   predict contact instead of tuning against subjective visual judgment.

## Recommended direction

The most realistic near-term design is a hybrid score:

```text
contact score = key overlap
              + local calibrated depth residual
              + finger-specific motion and joint geometry
              + normalized hand-scale trend
              + optional shadow evidence
```

The score should be evaluated over a short history, remove common hand motion,
keep ownership per fingertip, and use hysteresis for both press and release.
No single feature should trigger a note. In particular, knuckle scale and
shadow change should increase confidence only when they agree with fingertip
location and a plausible press trajectory.

## Implemented contact-score interface (separate from live path)

The score experiment is implemented as a modular interface. Each heuristic
returns a confidence value, a weight, and whether its input is available. The
current heuristic file contains separate entries for:

- key overlap;
- the `z` boundary;
- the knuckle boundary;
- finger posture;
- motion; and
- shadow state.

The score requires key overlap and at least one supporting heuristic. Missing
heuristics are skipped rather than treated as evidence against a press. This
lets each model be implemented and tuned independently while the score keeps
the same interface. This interface is not currently connected to the live
contact state machine; in particular, neither its z-boundary nor motion
heuristic currently predicts live note-on.

The current shape is:

```text
scoreContact(frame) ->
    score
    pressed
    evidence for each heuristic
```

The interface is currently standalone. It is ready to receive the real
calibrated boundaries and temporal state logic as those pieces are connected
to the live detection pipeline.

## Current depth-calibration flow

The current prototype uses the right hand for calibration, then reuses the
result for either hand during playing. The user presses a capture button while
holding the touching hand at five positions:

```text
top-left -> top-right -> bottom-left -> bottom-right -> center
```

Each capture records fingertip placement, knuckle distance, and fingertip `z`.
The current knuckle model remains one-dimensional: the five samples are sorted
by knuckle distance and used to predict the fingertip boundary `y`. The corner
and center locations therefore provide more samples for that distance-to-
boundary curve; they are not yet used as a two-dimensional surface. The
current prototype uses normalized image `y` for this boundary experiment.

## Knuckle heuristic tuning notes

The live prototype now uses knuckles as a permissive eligibility gate, not as
sufficient contact evidence:

```text
key overlap -> relaxed knuckle boundary -> shadow candidate -> pressed
```

The tunable constants are in
`frontend/src/cv/contactPipeline.ts`:

```text
KNUCKLE_RANGE_TOLERANCE          = 0.002
KNUCKLE_PLAYING_MARGIN_Y         = 0.025
KNUCKLE_ELIGIBILITY_HYSTERESIS_Y  = 0.012
```

`KNUCKLE_RANGE_TOLERANCE` allows a small amount of knuckle-distance variation
outside the captured minimum and maximum. Values farther outside the range
remain hover instead of being extrapolated.

`KNUCKLE_PLAYING_MARGIN_Y` expands the playing zone upward in normalized image
`y`: a finger becomes eligible at `y >= fitted_boundary_y - 0.025`.
`KNUCKLE_ELIGIBILITY_HYSTERESIS_Y` keeps an eligible finger in that zone until
it rises above `fitted_boundary_y - 0.025 - 0.012`. Increasing the playing margin
makes entry more permissive; increasing hysteresis only widens retention.
The old knuckle-only rule required entry below the fitted boundary plus 0.012;
increasing that old entry offset would have made contact stricter, not looser.

The debug overlay shows the five captured knuckle distances, the current live
distance, and separate color-coded eligibility boundaries for each finger.
Those lines include the playing margin and the current eligibility hysteresis.
The current
model does not claim that knuckle distance is metric depth; it is an empirical
prototype signal that still needs tuning near the center and at the range
limits.

## Shadow segmentation and combined contact

Visual diagnostics now default to off. Set `SHOW_VISUAL_DEBUG = true` in
`frontend/src/app/CVOverlayCoordinator.tsx` to enable the debug displays
described below. With the flag off, preview masks, contour outlines, guides,
hand-landmark drawing, and per-frame debug state updates are skipped. Contact
evaluation and normal pressed-key feedback remain active. Shadow scheduling
and full-frame transfers are unchanged.

The current shadow prototype segments a dark region near each fingertip and
labels it `hover`, `press candidate`, or `unknown`; fingers outside a key are
shown as `outside key`. Segmentation remains independent of the knuckle
calculation, but its candidate now drives live contact only after key-overlap
and knuckle eligibility both pass. The debug panel shows these gates separately
and displays the FSM state for every tracked fingertip, including fingers
outside a key.

The finger debug panel includes a live 2x index-fingertip crop from the same
camera snapshot used for shadow measurements. The right-hand index is preferred;
if it is absent, the first detected index is shown. Matching guides appear on
the camera overlay even before marker detection or depth calibration is ready.

The purple square marks the full 140x140-pixel crop centered on the fingertip.
The cross marks the tracked fingertip. The debug panel shows the original crop
and a matching black/white k-means mask. The preview is at the top of the debug
panel, defaults to black/white, and has a Camera toggle. Its status reports
received mask frames, waits for an index finger/first result, or shows the worker
error message. Both canvases stay mounted so switching views preserves updates.
Guides never enter the analyzed pixels.
The previous offset circles and separate paper-reference patch are removed.

`shadowHeuristics.ts` groups RGB pixels into three clusters using deterministic
seeds. The darkest occupied cluster becomes black; other visible pixels become
white. A 12-luma minimum separation from the brightest cluster suppresses masks
on nearly uniform paper. Pixels outside the frame remain transparent and do not
contribute to measurements. The black-pixel percentage is shown per finger.
After clustering, pixels above a horizontal cutoff at the fingertip are ignored
and displayed white. `SHADOW_CUTOFF_OFFSET_Y = 0` sets the initial cutoff exactly
at the rounded fingertip image y; a positive offset removes more of the lower
crop, and a negative offset retains more of the upper crop. The purple dashed
line shows this cutoff in both previews. Clustering still uses the whole crop;
brightness, dark area, and contour measurements use only retained pixels.

The largest 8-connected black region with at least one pixel within 45 raw-video
pixels of the fingertip is selected. Components smaller than 12 pixels are
ignored for contour selection. A blue pixel outline marks the selected component
in the mask, and its area is shown in raw-camera pixels. Other retained dark
components stay black. No eligible contour gives area zero; an unavailable crop
gives an unknown state. Nearness and size do not prove that the region is a shadow:
printed lines or remaining skin may still be selected, and selection can switch
between components.

### Contour-contraction or absolute-area candidate

The user reports contour areas above 1,000 pixels while hovering and around 600
while touching, with the larger-then-smaller pattern still visible after the
cutoff. These are informal prototype observations, not accuracy measurements.

`SHADOW_PRESS_AREA_RATIO = 0.30` marks a visual press candidate when the selected
contour area is at most 30% of its recent peak (e.g. 300 pixels for a 1,000-pixel
peak). Alternatively, a valid contour below
`SHADOW_PRESS_ABSOLUTE_AREA_PIXELS = 300` is a candidate even if no larger shadow
was sampled before a fast press. Either condition suffices; key overlap and a
valid, nonzero contour are still required. An absent contour is unknown, not a
candidate. Exactly 300 pixels does not satisfy the absolute rule, but may satisfy
the relative rule. While hovering, the peak is the largest area observed in the
last 2,000 ms (`SHADOW_PEAK_WINDOW_MS`). Once a candidate is reached, its peak is
retained while the candidate continues, so a long hold does not become hover
just because the large-area sample ages out. Recovery above 30% and to at least
300 pixels returns to hover. This initial rule has no extra debounce or separate
release threshold.

In short, for an eligible, valid contour:

```text
press candidate = area / peak <= 0.30 OR area < 300 pixels
hover           = neither condition is true
```

Key overlap is required in the sampled frame and at result delivery. Leaving
the key resets the baseline; unavailable measurements, a missing/zero contour,
or a gap over two seconds also reset it. The first usable contour initializes a
baseline; the relative rule needs to observe a larger shadow before it can show
a contraction candidate, but the absolute rule can mark a small first sample
as a candidate immediately.

The debug panel shows contact state, current area, peak, and area/peak percentage.
The selected contour is green for a candidate and blue otherwise. Moving to
another finger/location or selecting a different component can still cause false
candidates. Lowering the ratio from 70% to 30% requires a larger contraction;
the absolute cutoff is an arbitrary prototype setting that depends on camera
distance, resolution, finger, and lighting. A small hover shadow can satisfy it.
Neither rule establishes safety or reliability. These shadow candidates now
feed the combined contact state machine; neither shadow nor knuckles alone can
start a note in the default combined mode.

### Reading the live contact pipeline

`MarkerTrackingOverlay.tsx` now calls `pipeline.processFrame(...)` once from
its fingertip-processing effect. The controller in
`frontend/src/cv/liveContactPipeline.ts` exposes the sequence directly:

```text
processFrame
  -> checkKeyOverlap
  -> checkKnuckleEligibility
  -> checkShadows (capture and asynchronous worker request)
receiveShadows
  -> checkShadowContact
  -> Finger.checkState (state-specific contact transition)
```

The controller owns worker startup/disposal, the one-in-flight limit, sampling
interval, per-finger gate revisions, stale-result rejection, and the release
watchdog. `Finger` owns each tracked fingertip's contact state and implements
the per-state transitions through `checkState` and its state handlers. The
controller still owns shadow measurement history and asynchronous work.
`contactPipeline.ts` holds the individual overlap, knuckle, and shadow checks.
The overlay supplies frames, calibrated geometry,
and finger observations; it handles note dispatch and visual feedback through
controller callbacks. Contact/note callbacks run before preview rendering;
React visual updates do not gate audio dispatch.

Calibration/tracking changes reset the controller's gates and contact state.
Gate revisions remain monotonic so results pending across a reset cannot
activate a new note. This refactor preserves thresholds, calibration
requirements, hysteresis, freshness, and release behavior. It does not yet
filter shadow requests or reduce pixel transfers. `contactScore.ts` and
`CONTACT_HEURISTICS` remain a standalone weighted-score prototype; they do not
control the live sequence above.

### Technique controls for isolated debugging

Edit `CONTACT_TECHNIQUES` in `liveContactPipeline.ts` and reload the page.
Set both `knuckles` and `shadows` to `true` for combined detection.
Set `knuckles: false` for overlap plus shadow confirmation: knuckle calculations,
calibration requirements, and knuckle debug boundary drawing are bypassed.
Set `shadows: false` for overlap plus calibrated knuckle eligibility: worker
startup, shadow capture/segmentation, previews, and shadow confirmation are
bypassed. Knuckle-only contact ends immediately on lost eligibility and times
out when the latest landmark frame is over 150 ms old. Both flags false selects
overlap-only debugging: a fresh fingertip over a key activates it without
knuckle calibration or shadow processing. Leaving the key releases it, and
landmark frames over 150 ms old time out held notes. This mode isolates spatial
overlap; it does not measure physical finger contact.

`SHOW_VISUAL_DEBUG` remains an independent display flag. Its panel reports which
techniques are enabled and labels disabled evidence explicitly. These are
source-level development settings, not runtime UI toggles or measured accuracy
claims for either isolated technique.

Virtual keyboard highlighting follows detected contact independently of the
recording state. Starting/stopping or pausing recording gates musical events,
not camera feedback. The debug panel also updates contact state when shadow
evidence is disabled or unavailable.

### Combined contact state and note transitions

`frontend/src/cv/finger.ts` owns per-finger transition logic. The live controller
supplies key indexes, knuckle eligibility, and fresh shadow results. State and
gate types and timing constants are defined in `combinedContact.ts`:

```text
hover -> ready -> pressed -> releasing -> ready
                   ^            |
                   +------------+  fresh candidate recovers during release
```

- `hover`: outside a key or outside the relaxed knuckle playing zone.
- `ready`: both gates pass, but no shadow candidate confirms contact yet.
- `pressed`: a fresh shadow candidate passes both gates; the note stays held
  without repeated note-ons.
- `releasing`: a shadow hover/unknown result starts a 60 ms grace period. A
  fresh candidate during that period restores pressed without retriggering.
  Otherwise the note ends and the finger returns to ready. Unknown shadow
  evidence leaves an eligible finger ready while it waits for a usable sample.
- `unavailable`: required calibration, geometry, camera, worker, or shadow
  gates are unavailable. Recovery checks the gates, moves to ready, then lets
  the ready handler evaluate shadow evidence. This state cannot start a note.

`CONTACT_RELEASE_GRACE_MS = 60` and `CONTACT_SHADOW_MAX_AGE_MS = 150` are tunable
in `combinedContact.ts`. There is no extra press confirmation delay: the first
usable candidate can start contact. Unknown and stale shadow results leave an
eligible, unpressed finger in `ready`; for an active press, they start or
continue the release grace period. A 20 ms watchdog finishes release grace,
even if no more worker results arrive. These are prototype time settings, not
measured latency claims; a blocked/backgrounded main thread can delay the
watchdog.

Leaving the key, losing knuckle eligibility, losing a tracked finger, changing
calibration, pausing/stopping tracking, and worker failure release affected
contact without waiting for shadow confirmation. Requests carry a per-finger
gate revision; results from a previous key set, eligibility condition,
calibration/tracking segment, detected handedness, or video dimensions are
ignored. Cached results cannot initiate a new press after a reset. Finger IDs
still use the existing hand-index/landmark scheme; this is not robust persistent
hand identity across every tracking swap or occlusion.

Live key transitions are dispatched from fresh worker results, gate updates,
and the watchdog, before diagnostic drawing or React updates. Drawing no longer
emits note events. Active finger key sets are combined, so one finger releasing
a shared key does not release it while another finger still holds it. Existing
8-pixel overlap tolerance and multi-key overlap behavior are unchanged. Movement
and z-depth are not added as gates in this version.

### Latest prototype feedback and the fast-press fallback

The user observed that fast presses sometimes miss the larger shadow sample,
leaving a small peak and making the relative rule stay hover. At the time of
that observation, shadow snapshots were dispatched no more than 10 times per
second, with at least 100 ms between dispatches; a pending worker job could make
the gap longer. A brief larger shadow can therefore occur between analyzed
snapshots. The interval has since been reduced to 20 ms to allow more frequent
sampling; this does not guarantee that every short press will be captured.
Baseline resets on lost key overlap or an unavailable contour can also remove
the earlier peak. Shortening the 2,000 ms peak window does not capture a missed
sample; it only forgets old samples sooner. That window remains unchanged.

The absolute-area fallback was added to cover a small detected contour even
without a useful peak. After combining the 30% relative rule with the below-300
pixel fallback, the user reported that it "works magnificently." Keep this
combination as the current prototype baseline. This is encouraging qualitative
feedback from the user's setup, not a measured accuracy, latency, or
cross-finger/cross-lighting result. The earlier 1,000-to-600 pixel observation
describes the contraction pattern; it does not satisfy the current rule by
itself (600 / 1,000 = 60%, and 600 is not below 300).

The user reports that the unfiltered mask captures both their visible shadow and
skin. The cutoff is a prototype shortcut for their current camera/hand orientation,
not a general hand segmentation model. It does not establish physical contact.

The prototype runs segmentation in `shadowWorker.ts`, with at most one pending
camera snapshot and a 20 ms minimum dispatch interval (at most 50 Hz). Actual
dispatch frequency also depends on hand-tracking updates, camera availability,
and worker processing time; no fixed 50 Hz rate is guaranteed. Training samples
every fourth pixel in each axis, uses at most eight iterations, and then classifies
every crop pixel. Only the selected index returns a display mask. New shadow
work is skipped while a job is pending; knuckle gate updates and contact timeout
handling do not wait for segmentation.
Worker failure is shown in the debug panel without a UI-thread fallback.

Tune `CLUSTER_COUNT`, `MAX_ITERATIONS`, `TRAINING_STRIDE`, and
`MIN_CLUSTER_LUMA_GAP`, `SHADOW_CUTOFF_OFFSET_Y`, `MIN_CONTOUR_PIXELS`, and
`CONTOUR_NEAR_TIP_RADIUS`, `SHADOW_PRESS_AREA_RATIO`,
`SHADOW_PRESS_ABSOLUTE_AREA_PIXELS`, and `SHADOW_PEAK_WINDOW_MS`
in `shadowHeuristics.ts`. The crop half-size is 70 pixels
(`SHADOW_CROP_RADIUS` in `liveContactPipeline.ts`, reused by the overlay preview
and capped by `MAX_CROP_RADIUS` in the heuristic). `SHADOW_INTERVAL_MS = 20` in `liveContactPipeline.ts` controls the minimum
dispatch interval, not a separate timer. Busy workers still skip new work rather than
queue frames. Brightness transitions are still recorded separately; the
displayed contact state uses
contour contraction or the absolute-area cutoff. The combined contact state,
not the preview mask itself, controls live notes.

### Deferred image-processing optimizations

Keep segmentation unchanged for the first combined-contact experiment. The
current implementation copies and transfers the full camera frame, but k-means
only reads a 140x140 crop around each tracked fingertip. It fits color groups
using every fourth pixel in both axes across the full crop. Classification
loops over the crop, but only pixels at/below the fingertip cutoff are assigned
to the dark group and counted for shadow measurements (roughly 140x70 pixels).
The upper half still influences the fitted color groups. Contour buffers and
searches retain the full crop dimensions. Every tracked finger is segmented,
including fingers outside keys or the knuckle playing zone; contact gating
does not yet skip that segmentation work.

If responsiveness becomes a problem, consider these changes separately:

1. Extract/transfer only fingertip crops instead of copying the full frame;
   retain a matching original crop for the selected debug preview.
2. Fit k-means on only the retained lower rectangle and avoid upper-half pixel
   work/buffers. This changes learned color groups and may change the mask, so
   it is not a behavior-neutral optimization.
3. Segment only overlapping, knuckle-eligible fingers, optionally keeping the
   selected debug index active. Preserve or intentionally reset the hover peak
   when entering eligibility; otherwise relative contact can lose its baseline.
4. Later use movement to schedule shadow processing more selectively, without
   missing fast presses or delaying release/stale-contact handling.

None of these optimizations is implemented here. Actual processing rate and
end-to-end responsiveness still need observation; the 20 ms interval is a cap
on dispatch frequency, not proof of a fixed processing rate or physical latency.

During hover, touch, and lift, compare the visible shadow with the black mask.
Check whether the mask follows the shadow or mainly selects skin and ink.
The filtered contour should preserve the observed larger-then-smaller shadow
sequence during a press. Cutoff placement, contour behavior, and runtime
performance still need broader evaluation despite the positive user feedback.
Useful follow-up observations are fast versus slow presses, held contact and
release, small hover shadows, different fingers, and changes in lighting or
camera distance. Do not interpret a missing contour as contact. No formal tests
or verification-inventory updates were added for this prototype experiment.

## Planned z-depth experiment

Calibration still records separate fingertip `z` values and persists per-finger
z boundary data, but the live contact decision currently ignores z while the
knuckle model is being tuned. The next experiment should compare z and knuckle
independently:

```text
knuckle-only result
z-only result
agreement/disagreement
```

First determine whether z changes consistently between hover and touch, whether
its direction is stable, and whether it agrees with the knuckle candidate near
the sheet center and edges. Only then should z become a supporting heuristic in
the live score.

## Next implementation steps

1. Tune the five-point knuckle calibration, range tolerance, and hysteresis.
2. Run the separate z-depth experiment and compare it with the knuckle result.
3. Preserve per-finger motion and joint history for the contact score.
4. Tune the combined overlap/knuckle/shadow contact behavior across fingers and
   lighting, including fast presses, release grace, stale evidence, and the
   absolute-area cutoff. The integration is implemented but has not yet been
   physically evaluated; consider the deferred optimizations only if needed.
5. Keep the score and each heuristic independently replaceable as the live
   pipeline develops.

The current evidence in `cv_accuracy_plan.md` supports relative depth as a
supporting feature, not a standalone detector. The next implementation should
therefore preserve all landmark and timing features, but keep the contact
decision conservative until the combined experiments show a repeatable gain.
