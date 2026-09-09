import { test, expect } from "@playwright/test";
import fs from "node:fs";

// Explicit, six-minute measurement, separate from routine functional checks.
test("render profile resource comparison after five minute warmup", async ({ page }) => {
  test.skip(process.env.MORDOMO_RESOURCE_BENCH !== "1", "Run explicitly with MORDOMO_RESOURCE_BENCH=1");
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/brain");
  await page.evaluate(() => localStorage.setItem("mordomo.renderProfile", "immersive"));
  await page.reload();
  await expect(page.locator("canvas.brain-canvas")).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const metrics = async () =>
    Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const output = "artifacts/execution-2026-09-07/render-resources.json";
  const result = {
    startedAt: new Date().toISOString(),
    viewport: page.viewportSize(),
    scope:
      "Headless Chromium renderer task duration and JS heap; 5-minute warmup, three 10-second samples per profile; no forced GC, no provider, no GPU/RSS or frame-rate claim.",
    samples: [] as Array<Record<string, unknown>>,
  };
  fs.mkdirSync("artifacts/execution-2026-09-07", { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  await page.waitForTimeout(300_000);
  for (let repeat = 0; repeat < 3; repeat++)
    for (const profile of ["immersive", "economy"]) {
      await page.evaluate((profile) => localStorage.setItem("mordomo.renderProfile", profile), profile);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-render-profile", profile);
      await expect(page.locator("canvas.brain-canvas")).toBeVisible();
      await page.waitForTimeout(1000);
      const before = await metrics();
      await page.waitForTimeout(10_000);
      const after = await metrics();
      const cpuPercent =
        (100 * (after.TaskDuration! - before.TaskDuration!)) / (after.Timestamp! - before.Timestamp!);
      expect(Number.isFinite(cpuPercent)).toBe(true);
      result.samples.push({
        repeat,
        profile,
        cpuPercent,
        jsHeapBytes: after.JSHeapUsedSize,
        documents: after.Documents,
        nodes: after.Nodes,
        listeners: after.JSEventListeners,
      });
      fs.writeFileSync(output, JSON.stringify(result, null, 2));
    }
  await cdp.detach();
});
