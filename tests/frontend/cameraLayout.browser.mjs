/* Production layout regression for #156. Run after npm run build && npm start.
 * Measures the home camera feed with getBoundingClientRect at desktop and
 * mobile viewports, in the default state, after a recording finishes (Export
 * and Delete controls visible) and with the audio error alert shown. On lg
 * the feed must match the calibration camera and about content boxes.
 * The completed take is seeded through Home's React hooks and the error
 * through Home's LiveSession; lookups are guarded so a UI or session change
 * fails this test explicitly.
 * Uses Playwright's bundled Chromium unless LAYOUT_BROWSER_CHANNEL is set.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");

const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1080 },
  { width: 390, height: 844 },
];
const STATES = ["default", "recorded", "audio-error", "recorded+audio-error"];
const LG = 1024; // Tailwind lg breakpoint
const TOLERANCE = 1; // px, for subpixel rounding

const browser = await chromium.launch({
  channel: process.env.LAYOUT_BROWSER_CHANNEL || undefined,
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});

async function seed(page, state) {
  await page.evaluate((state) => {
    const button = document.querySelector('button[aria-label="Start recording"]');
    const key = Object.keys(button).find((name) => name.startsWith("__reactFiber$"));
    let fiber = button[key];
    while (fiber) {
      const first = fiber.memoizedState;
      let hook = first;
      while (hook) {
        const recorder = hook.memoizedState?.current;
        if (typeof recorder?.startRecording === "function" &&
            typeof recorder?.stopRecording === "function") {
          // Home owns recorder and consumer refs, then completedRecording state.
          const completed = hook.next?.next;
          if (!completed?.queue?.dispatch || completed.memoizedState !== null)
            throw new Error("Completed-recording fixture no longer matches Home hooks");
          // Home's first hook holds its LiveSession.
          const session = first.memoizedState;
          if (typeof session?.prepare !== "function" ||
              typeof session?.emit !== "function" || !("message" in session))
            throw new Error("Audio-error fixture no longer matches Home's LiveSession");
          if (state.startsWith("recorded")) {
            completed.queue.dispatch({
              id: "layout-regression", name: "Layout regression", bpm: 120,
              createdAt: "2026-09-30T00:00:00.000Z",
              notes: [{ pitch: "C3", velocity: 80, startMs: 0, durationMs: 500 }],
            });
          }
          if (state.endsWith("audio-error")) {
            // Same state and message as a failed LiveSession.prepare().
            session.state = "error";
            session.message = "Audio could not start. Select Enable audio to retry; " +
              "check browser audio permissions.";
            session.emit();
          }
          return;
        }
        hook = hook.next;
      }
      fiber = fiber.return;
    }
    throw new Error("Recorder fixture not found; update test for Home's state layout");
  }, state);
  if (state.startsWith("recorded"))
    await page.getByRole("button", { name: "Delete .MIDI Recording" }).waitFor();
  if (state.endsWith("audio-error"))
    await page.getByRole("alert").filter({ hasText: "Audio could not start." }).waitFor();
}

const within = (inner, outer) =>
  inner.left >= outer.left - TOLERANCE && inner.top >= outer.top - TOLERANCE &&
  inner.right <= outer.right + TOLERANCE && inner.bottom <= outer.bottom + TOLERANCE;

// Size of the 16:9 box on another page that shares Home's layout.
async function referenceBox(viewport, path, selector) {
  const page = await browser.newPage({ viewport });
  await page.goto(new URL(path, process.env.MAKE_SHIFT_URL || "http://127.0.0.1:3000").href);
  const box = await page.locator(selector).first().boundingBox();
  await page.close();
  assert(box, `${path}: reference box not found`);
  return box;
}

const sameSize = (a, b) =>
  Math.abs(a.width - b.width) <= TOLERANCE && Math.abs(a.height - b.height) <= TOLERANCE;

const results = [];
try {
  for (const viewport of VIEWPORTS) {
    const references = viewport.width >= LG ? {
      calibration: await referenceBox(viewport, "/calibration", "video >> xpath=.."),
      about: await referenceBox(viewport, "/about", "h1 >> xpath=../.."),
    } : {};
    for (const state of STATES) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(process.env.MAKE_SHIFT_URL || "http://127.0.0.1:3000");
      await page.getByRole("button", { name: "Start recording", exact: true }).waitFor();
      await seed(page, state);
      const box = await page.evaluate(() => {
        const rect = (el) => {
          if (!el) return null;
          const { left, top, right, bottom, width, height } = el.getBoundingClientRect();
          return { left, top, right, bottom, width, height };
        };
        const feed = document.querySelector("video").parentElement;
        return {
          feed: rect(feed),
          wrapper: rect(feed.parentElement),
          status: rect(feed.querySelector('[role="status"]')),
          // Session status line above the feed (role="alert" on error).
          banner: rect([...document.querySelectorAll('p[role="status"], p[role="alert"]')]
            .find((el) => !feed.contains(el))),
        };
      });
      const label = `${viewport.width}x${viewport.height} ${state}`;
      const { feed, wrapper, status, banner } = box;
      const ratio = feed.width / feed.height;
      assert(Math.abs(ratio - 16 / 9) < 0.01, `${label}: feed ratio ${ratio}`);
      assert(within(feed, wrapper), `${label}: feed overflows its wrapper`);
      assert(feed.right <= viewport.width + TOLERANCE, `${label}: feed wider than viewport`);
      for (const [name, reference] of Object.entries(references)) {
        assert(sameSize(feed, reference), `${label}: feed ${Math.round(feed.width)}x` +
          `${Math.round(feed.height)} differs from ${name} ${Math.round(reference.width)}x` +
          `${Math.round(reference.height)}`);
      }
      if (status) assert(within(status, feed), `${label}: status message clipped`);
      assert(banner, `${label}: session status line missing`);
      assert(banner.bottom <= feed.top + TOLERANCE, `${label}: status line overlaps feed`);
      assert(within(banner, { left: 0, top: 0, right: viewport.width, bottom: viewport.height }),
        `${label}: status line outside viewport`);
      assert.deepEqual(errors, [], `${label}: page errors`);
      results.push(`${label}: ${Math.round(feed.width)}x${Math.round(feed.height)}`);
      await page.close();
    }
  }
  console.log(results.join("\n"));
  console.log(`PASS: camera feed 16:9, contained and sized like calibration/about in ${results.length} layouts (${await browser.version()})`);
} finally {
  await browser.close();
}
