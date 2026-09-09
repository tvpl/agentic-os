import { test, expect } from "@playwright/test";
import fs from "node:fs";

test("baseline: 200 warm workspace navigations measured inside the browser", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  const dock = page.getByRole("navigation", { name: "Workspace navigation" });
  for (const name of ["Second Brain", "Pixel Studio"]) {
    await dock.getByRole("button", { name, exact: true }).click();
    await expect(
      page.locator(name === "Second Brain" ? ".brain2-panel input" : ".pxs-stage canvas").first(),
    ).toBeVisible();
  }
  // Measure browser click dispatch -> target ready for interaction, not the
  // round-trip time of Playwright's command. Data comes from the isolated home.
  const records: Array<{ target: string; durationMs: number }> = [];
  for (let i = 0; i < 200; i++) {
    const name = i % 2 === 0 ? "Second Brain" : "Pixel Studio";
    const selector = i % 2 === 0 ? ".brain2-panel input" : ".pxs-stage canvas";
    const measured = page.evaluate(
      ({ name, selector }) =>
        new Promise<number>((resolve) => {
          const onClick = (event: MouseEvent) => {
            const target = event.target instanceof Element ? event.target.closest(".dock-app") : null;
            if (target?.getAttribute("aria-label") !== name) return;
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
    await dock.getByRole("button", { name, exact: true }).click();
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
