/**
 * The flows added after the smoke suite (plan Ondas 1–3), driven through the
 * UI against the fake Claude CLI: pairing a remote device, mid-run tool
 * approval, squads (sub-agent fan-out) and a marketplace install from a
 * local registry.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect, chromium, type APIRequestContext, type Page } from "@playwright/test";

const BASE = "http://127.0.0.1:4777";
const token = () => process.env.MORDOMO_TOKEN ?? "";
const home = () => process.env.MORDOMO_HOME ?? "";
const headers = () => ({ "x-mordomo-token": token(), "content-type": "application/json" });

async function api<T>(
  request: APIRequestContext,
  method: "get" | "post" | "put" | "delete",
  url: string,
  data?: unknown,
): Promise<T> {
  const res = await request[method](`${BASE}${url}`, {
    headers: headers(),
    ...(data === undefined ? {} : { data }),
  });
  if (!res.ok()) throw new Error(`${method.toUpperCase()} ${url} → ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

async function waitFor(
  request: APIRequestContext,
  url: string,
  pred: (body: unknown) => boolean,
  ms = 20_000,
): Promise<unknown> {
  const t0 = Date.now();
  for (;;) {
    const body = await api<unknown>(request, "get", url);
    if (pred(body)) return body;
    if (Date.now() - t0 > ms)
      throw new Error(`timeout waiting on ${url}: ${JSON.stringify(body).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function open(page: Page, route: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  await page.goto(route);
  await page.waitForLoadState("networkidle");
  return errors;
}

test.describe.configure({ mode: "serial" });

test("a remote device pairs with a code and reaches the desktop", async ({ request }) => {
  await api(request, "put", "/api/settings", {
    remote: { enabled: true, allowedHosts: ["mordomo.test"], deviceTtlDays: 30 },
  });
  // A non-loopback host name that resolves here: the shell must show the pairing screen, not inject the token.
  const browser = await chromium.launch({
    executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined,
    args: ["--host-resolver-rules=MAP mordomo.test 127.0.0.1"],
  });
  try {
    const page = await browser.newPage();
    const errors = await open(page, "http://mordomo.test:4777/#/");
    await expect(page.locator(".pairing-screen")).toBeVisible();
    expect(await page.content()).not.toContain(token());
    const { code } = await api<{ code: string }>(request, "post", "/api/pair/start", {});
    expect(code).toMatch(/^\d{6}$/);
    await page.getByLabel(/pairing code|código de pareamento/i).fill(code);
    await page.getByLabel(/device name|nome do dispositivo/i).fill("e2e phone");
    await page.getByRole("button", { name: /^pair$|^parear$/i }).click();
    await expect(page.locator(".desktop")).toBeVisible({ timeout: 15_000 });
    expect(
      errors.filter((e) => !/401/.test(e)),
      errors.join("\n"),
    ).toEqual([]);
    const devices = await api<{ devices: Array<{ name: string }> }>(request, "get", "/api/devices");
    expect(devices.devices.some((d) => d.name === "e2e phone")).toBe(true);
    // The wrong code is refused.
    const bad = await request.post(`${BASE}/api/pair/claim`, { data: { code: "000000", name: "x" } });
    expect(bad.status()).toBe(401);
  } finally {
    await browser.close();
    await api(request, "put", "/api/settings", {
      remote: { enabled: false, allowedHosts: [], deviceTtlDays: 30 },
    });
  }
});

test("a tool prompt mid-run is approved from the run page", async ({ page, request }) => {
  const run = await api<{ runId?: string; id?: string }>(request, "post", "/api/runs", {
    prompt: "[[sleep:12]] keep running for the approval test",
    mode: "read_only",
  });
  const runId = run.runId ?? run.id!;
  await waitFor(
    request,
    `/api/runs/${runId}`,
    (b) => (b as { run: { status: string } }).run.status === "running",
  );
  const approval = await api<{ id: string }>(request, "post", "/api/approvals/tool", {
    runId,
    toolName: "Write",
    input: { file_path: "/tmp/e2e-note.md", content: "hello" },
    toolUseId: "tu_e2e",
  });
  const errors = await open(page, `/#/runs/${runId}`);
  const card = page.locator(".approval-inline, .tool-approval").first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText(/Write/);
  await card
    .getByRole("button", { name: /allow|approve|permitir|aprovar/i })
    .first()
    .click();
  await waitFor(
    request,
    `/api/approvals/${approval.id}`,
    (b) => (b as { status: string }).status === "approved",
    10_000,
  );
  await expect(page.locator(".run-title .badge")).toHaveText(/done|conclu/i, { timeout: 25_000 });
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a run fans out into a squad of sub-agents", async ({ page, request }) => {
  const run = await api<{ runId?: string; id?: string }>(request, "post", "/api/runs", {
    prompt: "parent run for the squad",
    mode: "read_only",
  });
  const runId = run.runId ?? run.id!;
  await waitFor(
    request,
    `/api/runs/${runId}`,
    (b) => (b as { run: { status: string } }).run.status === "done",
  );
  const errors = await open(page, `/#/runs/${runId}`);
  await page
    .getByRole("button", { name: /fan out|dividir/i })
    .first()
    .click();
  await page
    .getByLabel(/fan out|dividir/i)
    .fill("First sub-task: list the docs.\n\nSecond sub-task: summarise the README.");
  await page.getByRole("button", { name: /^launch$|^lançar$/i }).click();
  await expect(page.locator(".squad-list li")).toHaveCount(2, { timeout: 15_000 });
  const children = (await waitFor(
    request,
    `/api/runs/${runId}/children`,
    (b) =>
      Array.isArray(b) &&
      b.length === 2 &&
      (b as Array<{ status: string }>).every((r) => r.status === "done"),
    25_000,
  )) as Array<{ parentRunId: string | null }>;
  expect(children.every((c) => c.parentRunId === runId)).toBe(true);
  await expect(page.locator(".squad-list li").first()).toContainText(/done|conclu/i, { timeout: 15_000 });
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the marketplace installs a verified skill from a local registry", async ({ page, request }) => {
  // Build a file:// registry inside the e2e home: index.json + the skill files with digests.
  const dir = path.join(home(), "registry");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "e2e-hello"), { recursive: true });
  const skillMd = [
    "---",
    "name: E2E Hello",
    "slug: e2e-hello",
    "description: A skill installed by the e2e suite",
    "version: 1.0.0",
    "---",
    "",
    "Say hello and stop.",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "e2e-hello", "SKILL.md"), skillMd);
  const sha = crypto.createHash("sha256").update(skillMd).digest("hex");
  const fileUrl = pathToFileURL(path.join(dir, "e2e-hello", "SKILL.md")).href;
  fs.writeFileSync(
    path.join(dir, "index.json"),
    JSON.stringify({
      name: "e2e registry",
      skills: [
        {
          slug: "e2e-hello",
          name: "E2E Hello",
          description: "A skill installed by the e2e suite",
          version: "1.0.0",
          files: { "SKILL.md": { url: fileUrl, sha256: sha } },
        },
      ],
    }),
  );
  await api(request, "put", "/api/settings", {
    marketplace: { registries: [pathToFileURL(path.join(dir, "index.json")).href] },
  });
  await request.delete(`${BASE}/api/skills/e2e-hello`, { headers: headers() }).catch(() => undefined);

  const errors = await open(page, "/#/skills");
  await page
    .getByRole("button", { name: /marketplace/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const row = dialog.locator(".market-list li", { hasText: "E2E Hello" });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.getByRole("button", { name: /^install$|^instalar$/i }).click();
  await expect(row.getByRole("button", { name: /reinstall|reinstalar/i })).toBeVisible({ timeout: 10_000 });
  const skill = await api<{ slug: string; name: string }>(request, "get", "/api/skills/e2e-hello");
  expect(skill.name).toBe("E2E Hello");
  expect(errors, errors.join("\n")).toEqual([]);

  // A file that no longer matches its published digest is refused before anything touches the catalog.
  fs.writeFileSync(
    path.join(dir, "e2e-hello", "SKILL.md"),
    skillMd + "\n<!-- tampered after publishing -->\n",
  );
  const bad = await request.post(`${BASE}/api/skills/install`, {
    headers: headers(),
    data: { slug: "e2e-hello", force: true },
  });
  expect(bad.ok()).toBe(false);
  const reason = await bad.text();
  expect(reason, reason).toMatch(/sha|digest|verif/i);
  const still = await api<{ body: string }>(request, "get", "/api/skills/e2e-hello");
  expect(still.body).not.toContain("tampered");
  await api(request, "put", "/api/settings", { marketplace: { registries: [] } });
});
