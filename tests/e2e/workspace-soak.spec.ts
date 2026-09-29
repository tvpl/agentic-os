import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { E2E_HOME } from "./home.mjs";

test("bounded workspace endurance with simulated runs and real local persistence", async ({
  page,
  request,
}) => {
  const minutes = Number(process.env.MORDOMO_SOAK_MINUTES ?? 0);
  test.skip(minutes === 0, "Explicit endurance run: set MORDOMO_SOAK_MINUTES=120 or 480");
  if (!Number.isFinite(minutes) || minutes < 0.1 || minutes > 480)
    throw new Error("Invalid endurance duration");
  test.setTimeout((minutes + 3) * 60_000);
  const output = process.env.MORDOMO_SOAK_OUTPUT ?? `artifacts/workspace-soak-${Date.now()}`;
  const intermittent = process.env.MORDOMO_SOAK_PROFILE === "intermittent";
  fs.mkdirSync(output, { recursive: true });
  const headers = { "x-mordomo-token": process.env.MORDOMO_TOKEN! };
  const started = Date.now();
  const uncaught: string[] = [];
  let view = page;
  view.on("pageerror", (error) => uncaught.push(error.message));
  let previous = started;
  let gaps = 0;
  let cycles = 0;
  let completed = false;
  const bundle = crypto.createHash("sha256");
  const fingerprint = (directory: string) => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) fingerprint(file);
      else if (entry.isFile()) {
        bundle.update(file);
        bundle.update(fs.readFileSync(file));
      }
    }
  };
  for (const dir of [
    "core/dist",
    "adapters/claude/dist",
    "adapters/cursor/dist",
    "adapters/codex/dist",
    "apps/api/dist",
    "apps/command-centre/dist",
  ])
    fingerprint(dir);
  fs.writeFileSync(
    `${output}/manifest.json`,
    JSON.stringify(
      {
        startedAt: new Date(started).toISOString(),
        minutes,
        profile: intermittent ? "intermittent" : "cycles",
        environment: {
          platform: os.platform(),
          release: os.release(),
          arch: os.arch(),
          node: process.version,
          logicalCpus: os.cpus().length,
          totalMemoryBytes: os.totalmem(),
        },
        home: E2E_HOME,
        bundleSha256: bundle.digest("hex"),
        lockSha256: crypto.createHash("sha256").update(fs.readFileSync("package-lock.json")).digest("hex"),
        scope:
          "Chromium and API/SQLite real; synthetic files and fake Claude CLI; navigation, run history/SSE replay, index, offline/reconnect and tab reopen. No external provider/conector, no real macOS suspend.",
      },
      null,
      2,
    ),
  );
  try {
    do {
      const now = Date.now();
      if (now - previous > 120_000) gaps++;
      previous = now;
      const health = await request.get("/api/health", { headers });
      expect(health.ok()).toBe(true);
      expect((await health.json()).ok).toBe(true);
      // Eight-hour profile alternates five minutes of activity and five of
      // observed idle time. Keep sampling during idle; do not invent samples
      // for host suspension or issue synthetic prompts throughout the night.
      const idle = intermittent && Math.floor((now - started) / 300_000) % 2 === 1;
      if (!idle) {
        if (cycles % 5 === 0) {
          fs.writeFileSync(
            path.join(E2E_HOME, "memory", "endurance.md"),
            `# Endurance\nSynthetic cycle ${cycles}.`,
          );
          expect((await request.post("/api/memory/index", { headers })).ok()).toBe(true);
        }
        const submitted = await request.post("/api/runs", {
          headers,
          data: {
            prompt: `Read-only synthetic endurance cycle ${cycles}`,
            mode: "read_only",
            submissionId: crypto.randomUUID(),
          },
        });
        expect(submitted.ok()).toBe(true);
        const { runId } = await submitted.json();
        await expect
          .poll(
            async () => {
              const response = await request.get(`/api/runs/${runId}`, { headers });
              return (await response.json()).run.status;
            },
            { timeout: 20000 },
          )
          .toBe("done");
        const replay = await request.get(`/api/runs/${runId}/stream`, { headers });
        const text = await replay.text();
        expect(text).toContain('"run_state"');
        expect(text).toContain('"done"');
        await view.goto(`/#/runs/${runId}`);
        await expect(view.locator(".rs-run .rs-pill")).toHaveText(/done/i);
        // The apps are scenes, reached from the launcher.
        for (const [name, selector] of [
          ["Second Brain", '.nu-scene.on[data-scene="brain"] .bs'],
          ["Pixel Studio", ".pxs-stage"],
          ["Core", ".nu-nucleo"],
        ]) {
          await view.keyboard.press("Control+M");
          await view.getByRole("dialog").getByRole("option", { name: name!, exact: true }).click();
          await expect(view.locator(".launcher")).toHaveCount(0);
          await expect(view.locator(selector!)).toBeVisible();
        }
        if (cycles % 10 === 0) {
          await view.context().setOffline(true);
          await view.waitForTimeout(1000);
          await view.context().setOffline(false);
          await view.reload();
          await expect(view.locator(".nu-shell")).toBeVisible();
        }
      }
      const cdp = await view.context().newCDPSession(view);
      await cdp.send("Performance.enable");
      const metrics = Object.fromEntries(
        (await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]),
      );
      await cdp.detach();
      expect(uncaught).toEqual([]);
      fs.appendFileSync(
        `${output}/samples.jsonl`,
        JSON.stringify({
          at: new Date().toISOString(),
          cycle: cycles,
          elapsedMs: Date.now() - started,
          idle,
          heapBytes: metrics.JSHeapUsedSize,
          documents: metrics.Documents,
          listeners: metrics.JSEventListeners,
        }) + "\n",
      );
      cycles++;
      if (cycles % 20 === 0 && !idle) {
        const context = view.context();
        await view.close();
        view = await context.newPage();
        view.on("pageerror", (error) => uncaught.push(error.message));
      }
      const remaining = minutes * 60000 - (Date.now() - started);
      if (remaining > 0) await view.waitForTimeout(Math.min(30_000, remaining));
    } while (Date.now() - started < minutes * 60000);
    expect(gaps, "Unobserved gaps invalidate the endurance pass").toBe(0);
    completed = true;
  } finally {
    fs.writeFileSync(
      `${output}/result.json`,
      JSON.stringify(
        {
          completed,
          passed: completed && gaps === 0 && uncaught.length === 0,
          cycles,
          gaps,
          elapsedMs: Date.now() - started,
          uncaught,
        },
        null,
        2,
      ),
    );
  }
});
