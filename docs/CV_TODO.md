# CV accuracy and performance TODO

Working checklist based on `CodexThoughts.md` and the current prototype.
Delete items as they are completed. This document records planned work only;
it does not establish measured accuracy or latency.

## Z-calibrated early press prediction

MediaPipe fingertip z is not currently used by the live contact pipeline.
The intended role is to predict note-on from calibrated per-finger depth and
downward movement, then use shadow evidence to confirm the press shortly after
the sound starts.

- [ ] Inspect the existing depth calibration data and confirm it records a
  MediaPipe fingertip z value for every finger at each calibration position,
  aligned with the corresponding knuckle depth/reference. If it does not,
  extend the capture flow using the same position-by-position process as the
  knuckle measurements.
- [ ] Build or update per-finger `zLines` from those calibration samples so
  they provide a z boundary at each calibrated position/depth. Give the z
  boundary a tighter tolerance than the knuckle eligibility boundary.
- [ ] Use the saved experiment logs and clearly labeled trials to establish
  the z direction, per-finger movement delta, and calibrated boundary needed
  for prediction. Do not assume one threshold fits every finger.
- [ ] Track a short, timestamped z history for each fingertip. While key
  overlap and knuckle eligibility pass, predict a press when z trends
  downward by a sufficient delta and crosses the calibrated z boundary.
- [ ] Trigger note-on once when the z prediction passes. Require fresh shadow
  evidence to confirm shortly afterward; if confirmation does not arrive in
  the bounded confirmation window, send note-off and cancel the prediction.
- [ ] Clear the fingertip's z history on tracking loss. Cancel a pending
  prediction if tracking, key overlap, or knuckle eligibility is lost, and
  start with fresh z samples after tracking recovers.
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
