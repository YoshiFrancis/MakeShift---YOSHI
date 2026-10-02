# Deployment and Browser Support

Vercel hosts MakeShift (#89). Vercel serves pages, the AudioWorklet, the
DSP module and the hand model; jsDelivr serves the MediaPipe WASM runtime at
the exact version pinned in `frontend/package.json`. Once loaded, camera,
CV, audio and MIDI run on the device: playing makes no network requests
(checked by `npm run test:deployment`). The only server route,
`/api/health`, verifies hosted database configuration ([Supabase](supabase.md)).

| Setting | Value |
| :--- | :--- |
| Vercel project | `jaddenkis-projects/make-shift`, root directory `frontend`, Node 24.x |
| Production | <https://make-shift-seven.vercel.app> (from `main`) |
| Previews | One per branch or `vercel deploy`; public (Vercel Authentication off since 2026-09-30) |
| Environment variables | Synced from Infisical `makeshift` (Production to Production, Development to Preview) |

## Runtime assets

| Asset | Served from | Expected type |
| :--- | :--- | :--- |
| `/audio/piano-worklet.js`, `/audio/synth.js` | Vercel static | `application/javascript` |
| `/models/hand_landmarker.task` | Vercel static | `application/octet-stream` |
| `vision_wasm_internal.{js,wasm}` | jsDelivr `@mediapipe/tasks-vision@<pinned>` | `application/javascript`, `application/wasm` |

Keep `@mediapipe/tasks-vision` pinned exactly: the WASM URL uses the same
version, and a mismatch fails at model load.

## Permissions and activation

- **HTTPS is required** for camera access (`localhost` is exempt). Vercel
  serves HTTPS by default.
- **Camera:** requested on page load. Denial shows "Camera access blocked";
  a lost camera (unplugged, access revoked) shows "Camera disconnected". Both
  offer "Try again". The camera needs at least 1280x720.
- **Audio:** browsers block sound until a user gesture, so audio starts only
  from "Enable audio". A suspended context (for example after backgrounding)
  reports "Audio is unavailable" and resumes through "Enable audio" without
  replaying held notes.

## Compatibility checklist

Automated coverage runs only in Chromium with fake devices. Mark the other
entries only from a completed manual report in `tests/manual/`.

| Browser | Camera + CV | Audio | Status |
| :--- | :--- | :--- | :--- |
| Chrome / Edge (desktop, current) | Supported | Supported | Automated in CI (fake devices); Edge audio run locally 2026-09-24 |
| Firefox (desktop, current) | Expected | Expected | Manual check pending (5.1.1) |
| Safari 17+ (macOS) | Expected | Expected | Manual check pending (5.1.1) |
| Mobile browsers | Not targeted | Not targeted | Out of scope |

## Verifying a deployment

```sh
cd frontend
npm run build && npm start                       # or use a Vercel URL
npm run test:deployment                          # MAKE_SHIFT_URL=<url> for remote
EXPECT_DATABASE=ok MAKE_SHIFT_URL=<preview-url> npm run test:deployment
```

Previews are public so reviewers can open them. They use the Preview
environment secrets server-side only; no secret reaches the browser.
