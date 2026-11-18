/**
 * "Busca por significado" in a real browser (.specs/features/cerebro-busca-significado, C109, C131-C134, C136;
 * design.md "Bloco - Busca por significado"): the block's place and parts in both shells, the keyboard, axe at WCAG
 * A/AA in both themes and both shells with each provider, a download, a failure and the license dialog, the rendered
 * geometry of a model row and of the remote warning at 1 440 px, the gallery's entry, and the plan's independent test
 * of S7 against the real service with a loopback `/v1/embeddings` server of 768 dimensions in place of a model.
 *
 * What only a downloaded model would show (a download in progress, a failed one, the license) is answered by
 * `page.route` from the body the screen sends (L-052); every other request goes to the real service, whose
 * `memory.embeddings` and `memory.recall` are put back after each test. The interface reads pt-BR, so the claims'
 * own words are the ones asserted.
 */
import http from "node:http";
import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

type Shell = "moldura" | "nucleo";
type Theme = "dark" | "light";
type Json = Record<string, any>;
const SHELLS: Shell[] = ["moldura", "nucleo"];
const THEMES: Theme[] = ["dark", "light"];
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const BLOCK = "section.ss";

const GEMMA = {
  id: "embeddinggemma-300m-q4",
  kind: "embedder",
  name: "EmbeddingGemma 300M",
  bytes: 209_000_000,
  dimensions: 768,
  license: { name: "Gemma", acceptRequired: true },
  state: "absent",
};
const QWEN = {
  id: "qwen3-embedding-0.6b-q4f16",
  kind: "embedder",
  name: "Qwen3-Embedding 0.6B",
  bytes: 567_000_000,
  dimensions: 1024,
  license: { name: "Apache-2.0", acceptRequired: false },
  state: "absent",
};
const RERANKER = {
  id: "qwen3-reranker-0.6b-q4",
  kind: "reranker",
  name: "Qwen3-Reranker 0.6B",
  bytes: 1_007_000_000,
  license: { name: "Apache-2.0", acceptRequired: false },
  state: "absent",
};

async function seed(page: Page, shell: Shell, theme: Theme): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const fed = (patch: (j: Json) => Json) => async (route: Route) => {
    try {
      const response = await route.fetch();
      if (!response.ok()) return await route.fulfill({ response });
      await route.fulfill({ response, json: patch(await response.json()) });
    } catch {
      /* disposed with the page it was for */
    }
  };
  await page.route(
    /\/api\/(v1\/)?ui-preferences(\?.*)?$/,
    fed((j) => ({ ...j, shell })),
  );
  await page.route(
    "**/api/v1/meta",
    fed((j) => ({ ...j, theme, language: "pt-BR" })),
  );
}

/** The settings the screen reads, with `memory.embeddings` (and the status's `semantic`) changed by the test. */
async function feign(page: Page, embeddings: Json, semantic: Json = {}): Promise<void> {
  await page.route(/\/api\/v1\/settings(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    try {
      const response = await route.fetch();
      const json = await response.json();
      json.memory = { ...json.memory, embeddings: { ...json.memory.embeddings, ...embeddings } };
      await route.fulfill({ response, json });
    } catch {
      /* disposed */
    }
  });
  await page.route(/\/api\/v1\/memory\/status(\?.*)?$/, async (route) => {
    try {
      const response = await route.fetch();
      const json = await response.json();
      json.semantic = { ...json.semantic, ...semantic };
      await route.fulfill({ response, json });
    } catch {
      /* disposed */
    }
  });
}

/** `GET /api/memory/embedder` answers `catalog`; a `POST` is answered by `post` from its body, or refused. */
async function catalogRoute(
  page: Page,
  catalog: () => Json,
  post: (body: Json) => Json | null = () => null,
): Promise<void> {
  await page.route(/\/api\/v1\/memory\/embedder(\?.*)?$/, async (route) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: catalog() });
    const answer = post(req.postDataJSON() as Json);
    if (answer) return route.fulfill({ json: answer });
    return route.fulfill({
      status: 400,
      json: { error: { code: "validation", message: `not expected: ${req.postData()}` } },
    });
  });
}

async function open(page: Page, shell: Shell, theme: Theme, width = 1440): Promise<void> {
  await seed(page, shell, theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/#/settings?tab=memory");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  if (shell === "moldura") await expect(page.locator('[data-shell="moldura"]')).toBeVisible();
  else await expect(page.locator(".nu-shell")).toBeVisible();
  await expect(page.locator(BLOCK)).toBeVisible();
}

async function api(
  page: Page,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  return page.evaluate(
    async ([m, u, b]) => {
      const token = document.querySelector<HTMLMetaElement>('meta[name="mordomo-token"]')?.content ?? "";
      const res = await fetch(u as string, {
        method: m as string,
        headers: { "x-mordomo-token": token, ...(b ? { "content-type": "application/json" } : {}) },
        ...(b ? { body: JSON.stringify(b) } : {}),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    [method, url, body],
  );
}

async function serious(page: Page, ...include: string[]) {
  const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  for (const sel of include) builder.include(sel);
  const result = await builder.analyze();
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }));
}

/** Every element with text of its own under `scope` drawn under 12px. */
async function under12(page: Page, scope: string) {
  return page.evaluate((sel) => {
    const out: string[] = [];
    let seen = 0;
    for (const root of document.querySelectorAll(sel))
      for (const el of [root, ...root.querySelectorAll("*")] as HTMLElement[]) {
        if (el.closest("svg, [aria-hidden='true'], .sr-only")) continue;
        const own = [...el.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? "")
          .join("")
          .trim();
        const rect = el.getBoundingClientRect();
        if (!own || !rect.width || !rect.height) continue;
        seen++;
        const px = parseFloat(getComputedStyle(el).fontSize);
        if (px < 12) out.push(`${px}px ${own.slice(0, 60)}`);
      }
    return { seen, out };
  }, scope);
}

/** What `memory.embeddings` and `memory.recall` were before the test, put back after it. */
let stored: Json | null = null;
test.beforeEach(async ({ page }) => {
  stored = null;
  await page.goto("/");
  stored = (await api(page, "GET", "/api/v1/settings")).json.memory;
  // the test's own routes take effect on a fresh load
  await page.goto("about:blank");
});
test.afterEach(async ({ page }) => {
  if (!stored) return;
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.goto("about:blank");
  await page.goto("/");
  const back = await api(page, "PUT", "/api/v1/settings", {
    memory: { embeddings: stored.embeddings, recall: stored.recall },
  }).catch(() => null);
  if (back && back.status !== 200) throw new Error(`settings not put back: ${JSON.stringify(back.json)}`);
});

/* ---------------- C109: the place and the parts ---------------- */

for (const shell of SHELLS) {
  test(`C109 ${shell}: the second .card.stack of Settings › Memória, after the indexed folders; header, radio group, detail, index line (search on) and the footer link, in order`, async ({
    page,
  }) => {
    await feign(page, { enabled: true, provider: "hash" }, { enabled: true, sections: 42 });
    await open(page, shell, "dark");
    const cards = page.locator(".tab-panel > .card.stack");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText("Pastas indexadas");
    await expect(cards.nth(1)).toHaveClass(/\bss\b/);
    await expect(page.locator(`${BLOCK} > [role=status]`)).toHaveText(
      "42 seções indexadas com o vetor simples",
    );
    const parts = await page
      .locator(`${BLOCK} > *`)
      .evaluateAll((els) => els.map((e) => e.getAttribute("role") ?? e.className));
    expect(parts).toEqual(["ss-top", "radiogroup", "ss-detail", "status", "ss-s"]);
    await expect(page.locator(`${BLOCK} > .ss-top h3`)).toHaveText("Busca por significado");
    await expect(page.locator(`${BLOCK} > .ss-s a`)).toHaveText("Como instalar o Ollama");
  });

  test(`C109 ${shell}: with the search off there is no index line`, async ({ page }) => {
    await feign(page, { enabled: false, provider: "hash" });
    await open(page, shell, "dark");
    const parts = await page
      .locator(`${BLOCK} > *`)
      .evaluateAll((els) => els.map((e) => e.getAttribute("role") ?? e.className));
    expect(parts).toEqual(["ss-top", "radiogroup", "ss-detail", "ss-s"]);
  });
}

/* ---------------- C131: the keyboard ---------------- */

/** Press Tab `n` times from where focus is and name each element it lands on. */
async function tabs(page: Page, n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Tab");
    out.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLInputElement | null;
        return (
          el?.getAttribute("aria-label") ??
          el?.getAttribute("role") ??
          el?.labels?.[0]?.textContent ??
          el?.textContent ??
          ""
        ).trim();
      }),
    );
  }
  return out;
}

for (const shell of SHELLS) {
  test(`C131 ${shell}: Tab goes to the on/off button, the radio group (one stop), the server's fields, the checkbox, Testar conexão and the footer link; the arrows move the choice`, async ({
    page,
  }) => {
    await feign(page, {
      enabled: false,
      provider: "http",
      endpoint: "http://127.0.0.1:11434/v1/embeddings",
      model: "nomic-embed-text",
      dimensions: 768,
    });
    await open(page, shell, "dark");
    await page.locator(`${BLOCK} .ss-head button`).focus();
    expect(await tabs(page, 8)).toEqual([
      "radio",
      "Endereço",
      "Modelo",
      "Dimensões",
      "Variável da chave",
      "Permitir servidor fora deste computador",
      "Testar conexão",
      "Como instalar o Ollama",
    ]);
    // Shift+Tab from the radio group goes straight back to the button: one stop
    await page.locator(`${BLOCK} [role=radio][aria-checked=true]`).focus();
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe(
      "Busca por significado",
    );
    // the arrows choose: the page answers the PUT itself, so nothing is stored
    const sent: unknown[] = [];
    await page.route(/\/api\/v1\/settings$/, async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      sent.push(route.request().postDataJSON());
      await route.fulfill({
        status: 500,
        json: { error: { code: "internal", message: "kept by the test" } },
      });
    });
    await page.locator(`${BLOCK} [role=radio][aria-checked=true]`).focus();
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => sent.length).toBe(1);
    expect((sent[0] as Json).memory.embeddings.provider).toBe("local");
    await expect(page.locator(`${BLOCK} [role=radio]`).nth(2)).toBeFocused();
  });

  test(`C131 ${shell}: the model actions, then the reranker button, then the footer link; Enter activates a button; Tab stays inside the license dialog`, async ({
    page,
  }) => {
    await feign(page, { enabled: false, provider: "local", local: { model: QWEN.id } });
    await catalogRoute(page, () => ({
      active: null,
      platform: { ok: true },
      models: [GEMMA, QWEN, { ...RERANKER, state: "ready" }],
    }));
    await open(page, shell, "dark");
    await expect(page.locator(`${BLOCK} .ss-model`)).toHaveCount(3);
    await page.locator(`${BLOCK} .ss-head button`).focus();
    expect(await tabs(page, 6)).toEqual([
      "radio",
      "Baixar",
      "Baixar",
      "Releitura mais cuidadosa",
      "Remover",
      "Como instalar o Ollama",
    ]);
    // Enter on Gemma's Baixar opens the license dialog; Tab stays inside it
    await page.locator(`${BLOCK} .ss-model[data-model="${GEMMA.id}"] button`).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Termos do modelo" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Li e aceito os termos")).toBeFocused();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
}

/* ---------------- C132: axe and the 12px floor ---------------- */

const LOCAL_STATES = () => ({
  active: null,
  platform: { ok: true },
  models: [
    { ...GEMMA, state: "downloading", progress: { done: 120_000_000, total: 209_000_000 } },
    { ...QWEN, state: "failed", reason: "checksum" },
    RERANKER,
  ],
});
const VIEWS: Array<[string, Json]> = [
  ["Palavras e vetor simples", { enabled: true, provider: "hash" }],
  [
    "Servidor seu",
    {
      enabled: true,
      provider: "http",
      endpoint: "http://127.0.0.1:11434/v1/embeddings",
      model: "m",
      dimensions: 8,
    },
  ],
  ["Modelo neste computador, a model downloading and a failed one", { enabled: false, provider: "local" }],
];

for (const theme of THEMES)
  for (const shell of SHELLS) {
    for (const [name, embeddings] of VIEWS)
      test(`C132 ${shell} ${theme}: ${name} has no serious axe violation and no text under 12px`, async ({
        page,
      }) => {
        await feign(page, embeddings, { enabled: embeddings.enabled, sections: 7 });
        await catalogRoute(page, LOCAL_STATES);
        await open(page, shell, theme);
        if (embeddings.provider === "local") {
          await expect(page.locator(`${BLOCK} [role=progressbar]`)).toHaveCount(1);
          await expect(page.locator(`${BLOCK} .ss-model`).nth(1)).toContainText(
            "Falhou: soma de verificação diferente",
          );
        }
        expect(await serious(page, BLOCK)).toEqual([]);
        const sizes = await under12(page, BLOCK);
        expect(sizes.seen).toBeGreaterThan(5);
        expect(sizes.out).toEqual([]);
      });

    test(`C132 ${shell} ${theme}: the license dialog open has no serious axe violation and no text under 12px`, async ({
      page,
    }) => {
      await feign(page, { enabled: false, provider: "local" });
      await catalogRoute(page, () => ({
        active: null,
        platform: { ok: true },
        models: [GEMMA, QWEN, RERANKER],
      }));
      await open(page, shell, theme);
      await page.locator(`${BLOCK} .ss-model[data-model="${GEMMA.id}"] button`).click();
      const dialog = page.getByRole("dialog", { name: "Termos do modelo" });
      await expect(dialog).toBeVisible();
      expect(await serious(page, '[role="dialog"]')).toEqual([]);
      const sizes = await under12(page, '[role="dialog"]');
      expect(sizes.seen).toBeGreaterThan(3);
      expect(sizes.out).toEqual([]);
    });
  }

/* ---------------- C133: rendered geometry ---------------- */

for (const shell of SHELLS)
  test(`C133 ${shell} at 1 440 px: each model row's state and actions sit right of line 1 and line 2 and level with the row; the warning sits beside the checkbox`, async ({
    page,
  }) => {
    await feign(page, { enabled: false, provider: "local" });
    await catalogRoute(page, () => ({
      active: GEMMA.id,
      platform: { ok: true },
      models: [
        { ...GEMMA, state: "ready" },
        { ...QWEN, state: "downloading", progress: { done: 1, total: 567_000_000 } },
        { ...RERANKER, state: "failed", reason: "host_not_allowed" },
      ],
    }));
    await open(page, shell, "dark", 1440);
    const rows = page.locator(`${BLOCK} .ss-model`);
    await expect(rows).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const g = await rows.nth(i).evaluate((row) => {
        const box = (el: Element) => el.getBoundingClientRect();
        const name = box(row.querySelector(".ss-col .ss-b")!);
        const line2 = box(row.querySelector(".ss-col > .ss-s")!);
        const r = box(row);
        const side = [...row.querySelectorAll(".ss-side > *")].map((el) => box(el));
        return { name, line2, row: r, side };
      });
      expect(g.side).toHaveLength(2);
      for (const s of g.side) {
        expect(s.left, "right of the name").toBeGreaterThan(g.name.right);
        expect(s.left, "right of line 2").toBeGreaterThanOrEqual(g.line2.right);
        expect(s.top, "level with the row").toBeGreaterThanOrEqual(g.row.top - 0.5);
        expect(s.bottom, "level with the row").toBeLessThanOrEqual(g.row.bottom + 0.5);
        expect(s.top, "beside line 1 or line 2, not below them").toBeLessThan(g.line2.bottom);
      }
    }
    // the own server: the warning on the checkbox's line, to its right
    await page.unroute(/\/api\/v1\/settings(\?.*)?$/);
    await feign(page, { enabled: false, provider: "http", endpoint: "http://127.0.0.1:11434/v1/embeddings" });
    await page.reload();
    await expect(page.locator(`${BLOCK} .ss-remote`)).toBeVisible();
    const w = await page.locator(`${BLOCK} .ss-remote`).evaluate((el) => {
      const [label, warn] = [...el.children].map((c) => c.getBoundingClientRect());
      return { label: label!, warn: warn! };
    });
    expect(w.warn.left).toBeGreaterThanOrEqual(w.label.right);
    expect(w.warn.top).toBeLessThan(w.label.bottom);
    expect(w.warn.bottom).toBeGreaterThan(w.label.top);
  });

/* ---------------- C134: the gallery ---------------- */

for (const theme of THEMES)
  test(`C134 the gallery has a Busca por significado entry (the header, three options with one disabled, a model row in each of the four states, the license dialog) with no serious axe violation (${theme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/gallery.html?theme=${theme}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    const story = page.locator("#story-semantic");
    await expect(story.locator(".ss-head h3")).toHaveText("Search by meaning");
    await expect(story.locator("[role=radio]")).toHaveCount(3);
    await expect(story.locator('[role=radio][aria-disabled="true"] svg.lucide-lock')).toHaveCount(1);
    const states = story.locator(".ss-model .ss-side > .ss-row:first-child");
    await expect(states).toHaveText([
      "Not downloaded",
      "Downloading: 120 of 219 MB",
      "Ready",
      "Failed: checksum mismatch",
    ]);
    await expect(story.locator('[role="dialog"]')).toContainText("I have read and accept the terms");
    expect(await serious(page, "#story-semantic")).toEqual([]);
  });

/* ---------------- C136: the plan's independent test of S7 ---------------- */

/** A loopback `/v1/embeddings` of 768 dimensions in place of a model. */
async function embeddingsServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { input: string[] };
      const vector = (t: string) =>
        Array.from({ length: 768 }, (_, i) => ((t.length * (i + 3) + i) % 11) + 1);
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ data: body.input.map((t) => ({ embedding: vector(t) })) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/embeddings`,
    close: () =>
      new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
  };
}

for (const shell of SHELLS) {
  test(`C136 ${shell}: Servidor seu with a loopback server: the fields, Testar conexão reads OK: 768 dimensões, the button turns it Ligada, and after a pass the index line names the model`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    const server = await embeddingsServer();
    try {
      // start from the words, off
      expect(
        (
          await api(page, "PUT", "/api/v1/settings", {
            memory: { embeddings: { enabled: false, provider: "hash", sendRemote: false } },
          })
        ).status,
      ).toBe(200);
      await page.goto("about:blank");
      await open(page, shell, "dark");
      await page
        .locator(BLOCK)
        .getByRole("radio", { name: /Servidor seu/ })
        .click();
      await expect(page.locator(BLOCK).getByRole("radio", { name: /Servidor seu/ })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      const fill = async (label: string, value: string, key: string, stored: unknown) => {
        const input = page.locator(BLOCK).getByLabel(label, { exact: true });
        await input.fill(value);
        await input.press("Enter");
        await expect
          .poll(async () => (await api(page, "GET", "/api/v1/settings")).json.memory.embeddings[key])
          .toEqual(stored);
      };
      await fill("Endereço", server.url, "endpoint", server.url);
      await fill("Modelo", "e2e-embed", "model", "e2e-embed");
      await fill("Dimensões", "768", "dimensions", 768);
      const stored = (await api(page, "GET", "/api/v1/settings")).json.memory.embeddings;
      expect(stored).toMatchObject({
        provider: "http",
        endpoint: server.url,
        model: "e2e-embed",
        dimensions: 768,
      });
      await page.locator(BLOCK).getByRole("button", { name: "Testar conexão" }).click();
      await expect(page.locator(`${BLOCK} .ss-test [role=status]`)).toHaveText(
        /^\s*OK: 768 dimensões, \d+ ms$/,
        {
          timeout: 15_000,
        },
      );
      await page.locator(`${BLOCK} .ss-head button`).click();
      await expect(page.locator(`${BLOCK} .ss-state`)).toHaveText("Ligada");
      const pass = await api(page, "POST", "/api/v1/memory/index");
      expect(pass.status, JSON.stringify(pass.json)).toBe(200);
      const status = await api(page, "GET", "/api/v1/memory/status");
      const n = status.json.semantic.sections as number;
      expect(n).toBeGreaterThan(0);
      await page.reload();
      await expect(page.locator(`${BLOCK} > [role=status]`)).toHaveText(
        `${n} seções indexadas com e2e-embed`,
        {
          timeout: 15_000,
        },
      );
    } finally {
      await server.close();
    }
  });

  test(`C136 ${shell}: the local download flow (license, Baixar, progress, Pronto, Usar este modelo) against answers that honour the body`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    expect(
      (
        await api(page, "PUT", "/api/v1/settings", {
          memory: { embeddings: { enabled: false, provider: "local", sendRemote: false } },
        })
      ).status,
    ).toBe(200);
    const state = { gemma: { ...GEMMA } as Json, active: null as string | null, bodies: [] as Json[] };
    await catalogRoute(
      page,
      () => {
        const g = state.gemma;
        if (g.state === "downloading") {
          g.progress = { done: Math.min(g.progress.done + 80_000_000, g.bytes), total: g.bytes };
          if (g.progress.done >= g.bytes) {
            g.state = "ready";
            delete g.progress;
          }
        }
        return { active: state.active, platform: { ok: true }, models: [structuredClone(g), QWEN, RERANKER] };
      },
      (body) => {
        state.bodies.push(body);
        if (JSON.stringify(body) !== JSON.stringify({ action: "install", id: GEMMA.id, acceptTerms: true }))
          return null;
        state.gemma = { ...state.gemma, state: "downloading", progress: { done: 0, total: GEMMA.bytes } };
        return { state: "downloading", model: GEMMA.id };
      },
    );
    await page.goto("about:blank");
    page.on("request", (req) => {
      if (req.method() === "PUT" && /\/api\/v1\/settings$/.test(req.url())) state.active = GEMMA.id;
    });
    await open(page, shell, "dark");
    const gemma = page.locator(`${BLOCK} .ss-model[data-model="${GEMMA.id}"]`);
    await expect(gemma).toContainText("Não baixado");
    await gemma.getByRole("button", { name: "Baixar" }).click();
    const dialog = page.getByRole("dialog", { name: "Termos do modelo" });
    await expect(dialog.getByRole("button", { name: "Baixar" })).toBeDisabled();
    await dialog.getByLabel("Li e aceito os termos").check();
    await dialog.getByRole("button", { name: "Baixar" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(gemma.getByRole("progressbar")).toBeVisible();
    await expect(gemma).toContainText(/Baixando: \d+ de 209 MB/);
    await expect(gemma).toContainText("Pronto", { timeout: 15_000 });
    expect(state.bodies).toEqual([{ action: "install", id: GEMMA.id, acceptTerms: true }]);
    await gemma.getByRole("button", { name: "Usar este modelo" }).click();
    await expect
      .poll(async () => (await api(page, "GET", "/api/v1/settings")).json.memory.embeddings.local?.model)
      .toBe(GEMMA.id);
    await expect(gemma.getByRole("button", { name: "Usar este modelo" })).toHaveCount(0, { timeout: 5000 });
    await expect(gemma.getByRole("button", { name: "Remover" })).toBeDisabled();
  });
}
