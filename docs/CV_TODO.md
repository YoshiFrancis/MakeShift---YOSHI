# CV accuracy and performance TODO

Working checklist based on `CodexThoughts.md` and the current prototype.
Delete items as they are completed. This document records planned work only;
it does not establish measured accuracy or latency.

See the [contact state machine proposal](contact_state_machine.md) for the
planned per-finger press and release states.

## Direction

- [ ] Deprioritize joint curvature for the current front-facing camera angle:
  curved and flat fingers appeared too similar in the user's observations.
  Keep knuckles as a permissive eligibility gate and shadows as contact
  confirmation.

## Shadow scheduling — next

Shadow analysis now runs only for fingers over a key and inside the knuckle
playing zone. A selected debug preview can request one additional diagnostic
crop without allowing that finger to activate a note.

- [x] Calculate key overlap and knuckle eligibility before capturing pixels.
- [x] Submit only fingers with key overlap and valid knuckle eligibility.
  If visual debugging needs an ineligible index-finger preview, keep that
  request explicitly diagnostic so it cannot activate a note.
- [x] Skip shadow capture entirely when no fingers need analysis or a preview.
- [x] Compute shared knuckle distance once per hand and reuse it per finger.
- [x] Reset shadow measurement and peak history when eligibility is lost, so
  an old baseline is not reused when the finger re-enters the playing zone.
- [x] Continue sampling eligible held fingers so shadow recovery can release
  notes. Preserve immediate release on lost eligibility, freshness timeouts,
  gate revisions, and rejection of stale worker results.

## Pixel transfer — after scheduling

- [x] Extract and transfer only the required 140×140 fingertip crops instead
  of reading and transferring the full camera frame for shadow analysis.
- [x] Preserve crop coordinates, out-of-frame behavior, and a matching camera
  preview from the same snapshot when debugging is enabled.
- [x] Keep crop size, clustering, cutoff, contour selection, and contact
  thresholds unchanged initially, including the 30% relative-area rule and
  below-300-pixel absolute-area fallback.
- [x] Preserve the one-in-flight-job limit; skip pending work rather than
  building a frame queue.

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
