# CV accuracy and performance TODO

Working checklist based on `CodexThoughts.md` and the current prototype.
Delete items as they are completed. This document records planned work only;
it does not establish measured accuracy or latency.

## Z-calibrated early press prediction

MediaPipe fingertip z is not currently used by the live contact pipeline.
The intended role is to predict note-on from calibrated per-finger depth and
downward movement, then use shadow evidence to confirm the press shortly after
the sound starts.

- [x] Inspect the existing depth calibration capture. It records each
  fingertip's MediaPipe z alongside the shared knuckle-distance measurement
  at all five sheet positions. The in-memory samples retain these paired
  values, but persisted calibration keeps only fitted line coefficients.
  Existing `zLines` fit fingertip z to fingertip sheet Y; they are a
  calibrated z-dependent sheet-position boundary, not a metric contact-depth
  value.
- [x] Reuse the existing per-finger `zLines` as the calibrated z boundary.
  The standalone z-boundary heuristic compares observed fingertip sheet Y to
  the sheet Y predicted from its MediaPipe z. Keep the boundary tolerance at
  zero for now; tolerance tuning is deferred to the z-motion evaluator.
- [x] Add a modular z-motion evaluator that receives prior per-finger z
  samples, that finger's calibrated zLine, and the current fingertip z/sheet
  position. It reports a prediction only when z has decreased within the
  supplied history window and crossed the calibrated boundary. Its local
  `Z_LINE_TOLERANCE` is currently zero and applies to the sheet-position
  crossing only; it does not alter the shared boundary calculation or motion
  direction check.
- [x] Review the saved labeled trials. Treat decreasing MediaPipe z during
  the move phase as the working downward direction after excluding the first
  four settling/hover samples. Use direction only; the calibrated zLine is
  the boundary, so no per-finger movement-delta threshold is planned.
- [x] Maintain a short, timestamped z history for each fingertip in the live
  contact pipeline. While key overlap and knuckle eligibility pass, call the
  evaluator with a 150 ms history window and require two prior samples.
- [x] Trigger note-on once when the z prediction passes. Require fresh shadow
  evidence within 150 ms; if confirmation does not arrive, send note-off and
  cancel the prediction. This path requires both knuckle and shadow techniques
  enabled; both are currently disabled in the debug configuration.
- [x] Clear the fingertip's z history on tracking loss, key changes, or lost
  eligibility. Cancel a pending prediction when its gates are lost, then
  start with fresh z samples after recovery.
- [ ] Evaluate the predictor across fingers and labeled hover, approach,
  contact, and release trials. Measure early-trigger timing, unconfirmed
  predictions, missed presses, and duplicate note-ons before tuning thresholds.

## Deferred experiments

- [ ] Consider lower-half-only clustering separately. The upper half currently
  influences color clusters, so removing it can change segmentation behavior.
- [ ] Consider motion-based scheduling only after the simpler optimizations;
  avoid missing fast presses or delaying held-note release.
- [ ] Observe responsiveness and detection behavior across fast/slow presses,
  chords, holds, releases, fingers, lighting, and camera distance. Do not infer
  achieved latency or accuracy from the 20 ms dispatch interval alone.

## Scope constraint

Do not edit tests or `tests/verification_test_inventory.md` as part of this
requested work.


## calibrate for left hand

## a finger should trigger one key maximum
