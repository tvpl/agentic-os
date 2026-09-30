import { test, expect } from "@playwright/test";
import fs from "node:fs";

test("baseline: 200 warm workspace navigations measured inside the browser", async ({ page }) => {
  // 200 spine round-trips between two scenes, each a real travel: the
  // leaving scene plays out while the arriving one becomes the place.
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  const SCENE: Record<string, string> = { "Second Brain": "brain", Runs: "runs" };
  const label = (name: string) => page.locator(`nav.nu-spine .nu-mod[data-scene="${SCENE[name]}"]`);
  // What is measured is click → that scene's content ready in the arriving scene.
  const ready = (name: string) =>
    name === "Second Brain"
      ? '.nu-scene.on[data-scene="brain"] .bs-search input'
      : '.nu-scene.on[data-scene="runs"] .rs-head';
  for (const name of ["Second Brain", "Runs"]) {
    await label(name).click();
    await expect(page.locator(ready(name)).first()).toBeVisible();
  }
  // Measure browser click dispatch -> target ready for interaction, not the
  // round-trip time of Playwright's command. Data comes from the isolated home.
  const records: Array<{ target: string; durationMs: number }> = [];
  for (let i = 0; i < 200; i++) {
    const name = i % 2 === 0 ? "Second Brain" : "Runs";
    const selector = ready(name);
    const scene = SCENE[name]!;
    const measured = page.evaluate(
      ({ scene, selector }) =>
        new Promise<number>((resolve) => {
          const onClick = (event: MouseEvent) => {
            const target = event.target instanceof Element ? event.target.closest(".nu-mod") : null;
            if (target?.getAttribute("data-scene") !== scene) return;
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
      { scene, selector },
    );
    await expect(page.locator("html")).toHaveAttribute("data-benchmark-armed", "true");
    await label(name).click();
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
