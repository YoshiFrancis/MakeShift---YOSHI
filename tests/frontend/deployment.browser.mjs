/* Deployment smoke test (#89). Run against `npm run build && npm start`
 * or a Vercel URL:
 *   MAKE_SHIFT_URL=https://make-shift-seven.vercel.app npm run test:deployment
 * MAKE_SHIFT_URL defaults to http://127.0.0.1:3000. BROWSER_CHANNEL selects
 * the browser (default "chromium": full Chromium in new headless mode; the
 * headless shell has no camera support). Install: npx playwright install chromium
 * EXPECT_DATABASE=ok additionally requires /api/health to reach Supabase.
 * Uses fake media devices; real camera and speaker checks stay manual.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const requireFromFrontend = createRequire(
  new URL("../../frontend/package.json", import.meta.url),
);
const { chromium } = requireFromFrontend("playwright");
// The runtime WASM must match the exactly pinned npm wrapper version.
const tasksVisionVersion =
  requireFromFrontend("./package.json").dependencies["@mediapipe/tasks-vision"];

const base = (process.env.MAKE_SHIFT_URL || "http://127.0.0.1:3000").replace(
  /\/+$/,
  "",
);
// Each page must finish its asynchronous model/WASM setup before the test
// moves on, since the app catches those failures and displays them instead.
const INIT_TIMEOUT = 60_000;
const PAGES = {
  "/": async (page) => {
    const status = page.getByText(/MediaPipe (ready|unavailable)/);
    await status.waitFor({ timeout: INIT_TIMEOUT });
    assert.match(await status.innerText(), /MediaPipe ready/);
  },
  "/calibration": async (page) => {
    for (const attribute of ["data-hand-detection", "data-sheet-detector"]) {
      const settled = page.locator(`[${attribute}]:not([${attribute}="loading"])`);
      await settled.waitFor({ timeout: INIT_TIMEOUT });
      assert.equal(await settled.getAttribute(attribute), "ready", attribute);
    }
  },
  "/audio": null,
  "/tutorial": null,
  "/about": null,
};
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${tasksVisionVersion}/wasm`;
const ASSETS = [
  [base + "/audio/piano-worklet.js", /javascript/],
  [base + "/audio/synth.js", /javascript/],
  [base + "/models/hand_landmarker.task", /^application\/octet-stream/],
  [WASM_BASE + "/vision_wasm_internal.js", /javascript/],
  [WASM_BASE + "/vision_wasm_internal.wasm", /application\/wasm/],
];

const results = {};

async function checkAssets(request) {
  for (const [url, type] of ASSETS) {
    const response = await request.get(url);
    assert.equal(response.status(), 200, `${url} must load`);
    const contentType = response.headers()["content-type"] || "";
    assert.match(contentType, type, `${url} served as ${contentType}`);
    assert((await response.body()).length > 0, `${url} must not be empty`);
  }
  results.assets = `${ASSETS.length} loaded with expected types`;
}

async function checkPages(context) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [path, waitForInit] of Object.entries(PAGES)) {
    const response = await page.goto(base + path);
    assert.equal(response?.status(), 200, `${path} must return 200`);
    await waitForInit?.(page);
    await page.waitForLoadState("networkidle");
    // Next's route announcer is an always-present, empty alert region.
    const alerts = (await page.getByRole("alert").allInnerTexts()).filter(
      (text) => text.trim(),
    );
    assert.deepEqual(alerts, [], `${path} must not display errors`);
    assert.deepEqual(errors, [], `${path} must load without uncaught errors`);
  }
  await page.close();
  results.pages = Object.keys(PAGES).join(", ");
}

// Recovery means the overlay is gone and the preview shows the new stream's
// frames; a live track alone could still sit behind a frozen preview.
async function expectLivePreview(page, status, message) {
  await page.waitForFunction(() => window.testCameraStream?.active);
  await status.filter({ hasText: message }).waitFor({ state: "detached" });
  await page.waitForFunction(
    () => document.querySelector("video")?.srcObject === window.testCameraStream,
  );
  await page.evaluate(async () => {
    const video = document.querySelector("video");
    const nextFrame = () =>
      new Promise((resolve) => video.requestVideoFrameCallback(resolve));
    const first = await nextFrame();
    let second = await nextFrame();
    while (second === first) second = await nextFrame();
  });
}

async function checkCameraRecovery(browser) {
  const context = await browser.newContext({ permissions: ["camera"] });
  // Deterministic denial: the first request rejects like a blocked prompt.
  await context.addInitScript(() => {
    const devices = navigator.mediaDevices;
    const original = devices.getUserMedia.bind(devices);
    let calls = 0;
    devices.getUserMedia = (constraints) => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new DOMException("denied", "NotAllowedError"));
      }
      return original(constraints).then((stream) => {
        window.testCameraStream = stream;
        return stream;
      });
    };
  });
  const page = await context.newPage();
  // Calibration renders the camera status overlay (home overlays: #112).
  await page.goto(base + "/calibration");
  const status = page.getByRole("status");
  await status.filter({ hasText: "Camera access blocked" }).waitFor();
  await page.getByRole("button", { name: "Try again" }).click();
  await expectLivePreview(page, status, "Camera access blocked");
  // Camera loss: an ended track must surface an error, not a frozen preview.
  await page.evaluate(() => {
    for (const track of window.testCameraStream.getVideoTracks()) {
      track.stop();
      track.dispatchEvent(new Event("ended"));
    }
  });
  await status.filter({ hasText: "Camera disconnected" }).waitFor();
  await page.getByRole("button", { name: "Try again" }).click();
  await expectLivePreview(page, status, "Camera disconnected");
  await context.close();
  results.camera = "denial, retry, loss and recovery handled";
}

async function checkLocalPlaying(context) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/audio");
  await page.waitForLoadState("networkidle");
  const requests = [];
  // The browser itself may fetch the favicon lazily; that is not app traffic.
  page.on("request", (request) => {
    if (!new URL(request.url()).pathname.startsWith("/favicon")) {
      requests.push(request.url());
    }
  });
  for (let round = 0; round < 3; round += 1) {
    await page
      .getByRole("button", { name: "Enable audio", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Audio enabled" })
      .waitFor();
    // The worklet module loads once per AudioContext; notes must not fetch.
    const beforeNotes = requests.length;
    for (const name of ["Soft A4", "Loud A4", "Ten-note chord"]) {
      await page.getByRole("button", { name }).click();
      await page.waitForTimeout(100);
    }
    await page.getByRole("button", { name: "Stop sound" }).click();
    await page.getByRole("status").filter({ hasText: "Stopped." }).waitFor();
    assert.deepEqual(
      requests.slice(beforeNotes),
      [],
      "playing notes must not make network requests",
    );
  }
  assert.deepEqual(errors, []);
  await page.close();
  results.localPlaying = "3 enable/play/stop rounds, 0 note requests";
}

async function checkHealth(request) {
  const response = await request.get(base + "/api/health");
  const body = await response.json();
  // Without Supabase secrets the route reports unconfigured; anything else
  // (including 503 error) means the health route or database is broken.
  const allowed =
    process.env.EXPECT_DATABASE === "ok"
      ? [[200, "ok"]]
      : [[200, "ok"], [503, "unconfigured"]];
  const actual = [response.status(), body.database?.status];
  assert(
    allowed.some(([code, state]) => code === actual[0] && state === actual[1]),
    `/api/health returned ${JSON.stringify(actual)}, expected one of ${JSON.stringify(allowed)}`,
  );
  results.database = body.database.status;
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chromium",
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  try {
    const context = await browser.newContext();
    await checkAssets(context.request);
    await checkPages(context);
    await checkLocalPlaying(context);
    await checkHealth(context.request);
    await context.close();
    await checkCameraRecovery(browser);
    console.log(
      JSON.stringify(
        { url: base, browser: browser.version(), ...results },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
