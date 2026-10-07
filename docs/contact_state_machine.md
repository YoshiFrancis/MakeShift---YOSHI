# Contact state machine

This describes the per-finger contact state machine. Z-motion prediction is
implemented in the live pipeline when the knuckle and shadow techniques are
enabled; both technique switches are currently disabled in the debug
configuration.

```mermaid
stateDiagram-v2
    [*] --> Invalid
    Invalid --> Ready: tracking and gates recover
    Hover --> Ready: key and knuckle gates pass
    Ready --> Predicted: z decreases across history and crosses zLine; send note-on
    Ready --> Pressed: shadow candidate confirms directly
    Predicted --> Pressed: fresh shadow confirms within 150 ms
    Predicted --> Ready: confirmation timeout; send note-off
    Pressed --> Releasing: shadow returns
    Releasing --> Pressed: contact evidence returns during grace period
    Releasing --> Hover: release confirmed or key/knuckle gate is lost
    Hover --> Invalid: tracking or required inputs become stale
    Ready --> Invalid: tracking or required inputs become stale
    Predicted --> Invalid: tracking or required inputs become stale; send note-off
    Pressed --> Invalid: tracking or required inputs become stale
    Releasing --> Invalid: tracking or required inputs become stale
```

Each finger has its own state and short history.

- **Invalid:** Tracking, calibration, or required eligibility inputs are
  missing or stale. Release an active note immediately. Recovery passes through
  Hover or Ready; it never starts a note directly.
- **Hover:** The finger is tracked, but there is no press in progress. Key
  overlap and knuckle eligibility are required to begin a press candidate.
- **Predicted:** Key overlap and knuckle eligibility pass, z decreases across
  three observations in the 150 ms history window, and the fingertip crosses
  its calibrated zLine. Send note-on once, then wait up to 150 ms for fresh
  shadow confirmation. If confirmation does not arrive, send note-off.
- **Pressed:** Shadow evidence confirms contact while the key and knuckle gates
  still pass. The note is already active from prediction.
- **Releasing:** The shadow returns.
  Start a short grace period to filter jitter. Return to Pressed if contact
  evidence returns in time; otherwise send note-off once and return to Hover.

In the live implementation, `ready` means the key and knuckle gates pass. It
stays ready when shadow evidence is unknown or stale; neither condition can
start a note. `unavailable` is for missing tracking or required gates. Recovery
checks those gates, moves to `ready`, and lets the ready handler evaluate
shadow evidence on the next state check.

Key overlap and knuckle eligibility gate prediction. Each fingertip has its
own timestamped z history. The current working direction is decreasing z
during approach; no per-finger movement-delta threshold is used. The zLine
crossing is evaluated locally with `Z_LINE_TOLERANCE` in
`zMotionPrediction.ts`; its current value is zero. Losing tracking, key
overlap, or knuckle eligibility clears history and releases an active note.
Z-based release prediction is not implemented; release continues to use shadow
evidence and its grace period.

The live evaluator uses availability, key overlap, knuckle eligibility, z
prediction, fresh shadow results, and release grace. `frontend/src/cv/finger.ts`
owns the per-finger state transitions. Its `checkState` method dispatches to
state-specific handlers; `combinedContact.ts` contains the shared state and
gate types plus timing constants. `liveContactPipeline.ts` owns z histories and
prediction latches; `zMotionPrediction.ts` evaluates z direction and zLine
crossing. The ready handler still permits shadow-only confirmation. Unknown or
stale shadow evidence keeps an otherwise eligible finger ready unless a z
prediction has already started. See
[CV accuracy and performance TODO](CV_TODO.md) for planned work.
