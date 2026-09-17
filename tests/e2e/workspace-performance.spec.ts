import { test, expect } from "@playwright/test";
import fs from "node:fs";

test("baseline: 200 warm workspace navigations measured inside the browser", async ({ page }) => {
  // 200 dock round-trips through a live desktop (G2: panels, not pages) take longer than 200 page loads did.
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  // Both apps are panels on the stage now (G2), opened from their pods (G5):
  // a pod click brings one to the front rather than swapping pages, so what
  // is measured is click → that app's panel on top with its content ready.
  const POD: Record<string, string> = { "Second Brain": "app:brain", Runs: "runs" };
  const pod = (name: string) => page.locator(`.pod-arc .pod[data-pod="${POD[name]}"]`);
  const ready = (name: string) =>
    name === "Second Brain"
      ? '.panel.on[data-panel="app:brain"] .brain2-panel input'
      : '.panel.on[data-panel="app:runs"] .page';
  for (const name of ["Second Brain", "Runs"]) {
    await pod(name).click();
    await expect(page.locator(ready(name)).first()).toBeVisible();
  }
  // Measure browser click dispatch -> target ready for interaction, not the
  // round-trip time of Playwright's command. Data comes from the isolated home.
  const records: Array<{ target: string; durationMs: number }> = [];
  for (let i = 0; i < 200; i++) {
    const name = i % 2 === 0 ? "Second Brain" : "Runs";
    const selector = ready(name);
    const measured = page.evaluate(
      ({ name, selector }) =>
        new Promise<number>((resolve) => {
          const onClick = (event: MouseEvent) => {
            const target = event.target instanceof Element ? event.target.closest(".pod") : null;
            if (!target?.getAttribute("aria-label")?.startsWith(`${name}:`)) return;
            document.removeEventListener("click", onClick, true);
            const start = performance.now();
            const check = () => {
              const element = document.querySelector(selector);
              if (
                element &&
                element.getBoundingClientRect().width > 0 &&
                getComputedStyle(element).visibility !== "hidden"
              ) {
                resolve(performance.now() - start);
              } else requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
          };
          document.addEventListener("click", onClick, true);
          document.documentElement.dataset.benchmarkArmed = "true";
        }),
      { name, selector },
    );
    await expect(page.locator("html")).toHaveAttribute("data-benchmark-armed", "true");
    await pod(name).click();
    records.push({ target: name, durationMs: await measured });
    await page.evaluate(() => delete document.documentElement.dataset.benchmarkArmed);
  }
  expect(records).toHaveLength(200);
  fs.mkdirSync("artifacts/execution-2026-09-06", { recursive: true });
  fs.writeFileSync(
    "artifacts/execution-2026-09-06/navigation-baseline.json",
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        viewport: page.viewportSize(),
        samples: records,
        scope:
          "Warm click dispatch to rendered target control; fixture, 100 samples per app. Not input-to-photon or a measure of provider latency. No performance gate established yet.",
      },
      null,
      2,
    ),
  );
});
