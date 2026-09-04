/**
 * Visual + console inspection of the Command Centre against a LIVE server.
 * Usage: node tests/e2e/visual-check.mjs [outDir]
 * Requires: service running at 127.0.0.1:4777, Chromium available to
 * playwright-core (executablePath fallback /opt/pw-browsers/chromium).
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const outDir = process.argv[2] ?? "playwright-report";
fs.mkdirSync(outDir, { recursive: true });

const BASE = "http://127.0.0.1:4777";
const routes = [
  ["dashboard", "/#/"],
  ["skills", "/#/skills"],
  ["skill-detail", "/#/skills/workspace-digest"],
  ["brain", "/#/brain"],
  ["routines", "/#/routines"],
  ["runs", "/#/runs"],
  ["connectors", "/#/connectors"],
  ["pixel", "/#/pixel"],
  ["settings", "/#/settings"],
];
const widths = [
  ["desktop", 1440, 900],
  ["laptop", 1024, 768],
  ["tablet", 768, 1000],
];

const executablePath = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const browser = await chromium.launch({ executablePath });
const consoleErrors = [];
let failures = 0;

for (const [wName, width, height] of widths) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`[${wName}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => consoleErrors.push(`[${wName}] pageerror: ${err.message}`));

  for (const [name, route] of routes) {
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    // horizontal overflow check (the body must never scroll sideways)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 2) {
      failures++;
      console.log(`OVERFLOW ${wName}/${name}: ${overflow}px`);
    }
    await page.screenshot({ path: path.join(outDir, `${wName}-${name}.png`), fullPage: false });
  }

  if (wName === "desktop") {
    // keyboard navigation sanity: tab through the dashboard, activate nav via keyboard
    await page.goto(`${BASE}/#/`, { waitUntil: "networkidle" });
    const focusables = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      focusables.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          return el ? `${el.tagName}:${el.textContent?.trim().slice(0, 20) ?? ""}` : "none";
        }),
      );
    }
    console.log("TAB ORDER:", focusables.join(" → "));
    if (focusables.every((f) => f === "none" || f.startsWith("BODY"))) {
      failures++;
      console.log("KEYBOARD NAV: no focusable elements reached");
    }
  }
  await page.close();
}

await browser.close();
console.log(`\nconsole errors: ${consoleErrors.length}`);
for (const e of consoleErrors.slice(0, 10)) console.log("  " + e);
console.log(`layout failures: ${failures}`);
process.exit(consoleErrors.length > 0 || failures > 0 ? 1 : 0);
