/* Production profiling with a synthetic camera. No physical latency claim. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
const require = createRequire(
  new URL("../../frontend/package.json", import.meta.url),
);
const { chromium } = require("playwright");
const base = process.env.MAKE_SHIFT_URL || "http://127.0.0.1:3100";
const output = new URL(
  "../../frontend/test-results/performance/",
  import.meta.url,
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PERFORMANCE_BROWSER_CHANNEL || "msedge",
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
try {
  const context = await browser.newContext({ permissions: ["camera"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    // Profile a returning visit; onboarding is verified separately.
    localStorage.setItem("hasVisited", "true");
    window.profileContexts = [];
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args) {
        super(...args);
        window.profileContexts.push(this);
      }
    };
  });
  await page.goto(base + "/audio");
  await page
    .getByText("Pipeline diagnostics (optional)", { exact: true })
    .click();
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  await page
    .getByLabel("Workload / repeatable steps")
    .fill(
      "3 audio enable/chord/stop + home CV + navigation cycles; synthetic camera, no calibration",
    );
  await page
    .getByLabel("Hardware / camera / audio device")
    .fill(
      `${os.cpus()[0].model}; ${Math.round(os.totalmem() / 2 ** 30)}GiB; fake camera; headless audio`,
    );
  await page
    .getByLabel("Configuration / model / delegate")
    .fill(
      "Production; fake camera; MediaPipe default GPU with CPU fallback; 3 cycles",
    );
  await page.getByLabel("Build commit").fill(commit);
  await page
    .getByRole("button", { name: "Start diagnostics", exact: true })
    .click();
  const cycles = [];
  for (let i = 0; i < 3; i++) {
    await page
      .getByRole("button", { name: "Enable audio", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Ten-note chord", exact: true })
      .click();
    await page.waitForTimeout(1100);
    await page.getByRole("button", { name: "Stop sound", exact: true }).click();
    await page.getByRole("link", { name: "MakeShift", exact: true }).click();
    await page.waitForFunction(() =>
      window.profileContexts.every((c) => c.state === "closed"),
    );
    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        return (
          text.includes("MediaPipe ready") ||
          text.includes("MediaPipe unavailable")
        );
      },
      { timeout: 30000 },
    );
    const status = await page.locator("body").innerText();
    await page.waitForTimeout(3000);
    cycles.push({
      cycle: i + 1,
      audioContextsClosed: await page.evaluate(() =>
        window.profileContexts.every((c) => c.state === "closed"),
      ),
      handModelReady: status.includes("MediaPipe ready"),
      handDelegate: status.includes("MediaPipe ready (GPU)")
        ? "GPU"
        : status.includes("MediaPipe ready (CPU)")
          ? "CPU"
          : null,
    });
    await page.getByRole("link", { name: "Audio check", exact: true }).click();
    await page
      .getByRole("button", { name: "Enable audio", exact: true })
      .waitFor();
    await page.waitForTimeout(1100);
  }
  await page
    .getByRole("button", { name: "Stop diagnostics", exact: true })
    .click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export diagnostics", exact: true })
    .click();
  const download = await downloaded;
  const report = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(report.enabled, false);
  assert.equal(report.metrics.transfer.mean, null);
  assert.equal(report.resourceSnapshots.at(-1).resources.audioContexts, 0);
  assert.equal(report.resourceSnapshots.at(-1).resources.audioNodes, 0);
  assert.equal(report.resourceSnapshots.at(-1).resources.handModels, 0);
  assert.equal(report.resourceSnapshots.at(-1).resources.markerDetectors, 0);
  assert.equal(
    report.resourceSnapshots.at(-1).resources.mediaTracks,
    1,
    "shared camera persists across client navigation",
  );
  assert.equal(report.resourceSnapshots.at(-1).resources.workers, null);
  assert(report.resourceSnapshots.length <= 32);
  assert(cycles.every((c) => c.audioContextsClosed));
  await writeFile(
    new URL("profile.json", output),
    JSON.stringify(
      { browser: browser.version(), cycles, errors, report },
      null,
      2,
    ),
  );
  // Same warm scene and external rAF probe in both modes; reverse order on pair two.
  await page.getByRole("link", { name: "MakeShift", exact: true }).click();
  await page.waitForFunction(() =>
    document.body.innerText.includes("MediaPipe ready"),
  );
  await page.waitForTimeout(3000);
  const overheadTrials = [];
  for (const enabled of [false, true, true, false]) {
    if (enabled)
      await page
        .getByRole("button", { name: "Start diagnostics", exact: true })
        .click();
    const pacing = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const values = [];
          const start = performance.now();
          let previous = null;
          function tick(now) {
            if (previous !== null && values.length < 1000)
              values.push(now - previous);
            previous = now;
            if (now - start < 4000) requestAnimationFrame(tick);
            else {
              values.sort((a, b) => a - b);
              resolve({
                samples: values.length,
                elapsedMs: now - start,
                meanIntervalMs:
                  values.reduce((a, b) => a + b, 0) / values.length,
                p95IntervalMs: values[Math.ceil(values.length * 0.95) - 1],
              });
            }
          }
          requestAnimationFrame(tick);
        }),
    );
    overheadTrials.push({ enabled, ...pacing });
    if (enabled)
      await page
        .getByRole("button", { name: "Stop diagnostics", exact: true })
        .click();
  }
  await writeFile(
    new URL("overhead.json", output),
    JSON.stringify(
      {
        browser: browser.version(),
        commit,
        workload:
          "same warm home scene; synthetic camera; no hands or markers; four 4-second rAF trials, off/on/on/off",
        hardware: report.metadata.hardware,
        configuration: report.metadata.configuration,
        cameraAtExport: report.cameraAtExport,
        trials: overheadTrials,
        limitation:
          "Short synthetic runs include both native timing noise and diagnostics cost. External rAF probe is identical in both modes; this is not physical latency or proof of negligible overhead on other hardware.",
      },
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        browser: browser.version(),
        cycles,
        errors,
        frames: report.frames,
        metrics: report.metrics,
        overhead: report.instrumentationOverhead,
        finalResources: report.resourceSnapshots.at(-1),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
