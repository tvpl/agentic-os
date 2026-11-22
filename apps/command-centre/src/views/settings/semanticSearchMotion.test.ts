// @vitest-environment jsdom
/**
 * The motion and the type of "Busca por significado" (.specs/features/cerebro-busca-significado, C128 and C130;
 * design.md "Movimento"): every animation and transition of the block's stylesheet inside
 * `@media (prefers-reduced-motion: no-preference)` (ui.source C15's reader, with transitions), the progress bar
 * growing by `transform: scaleX` in 240 ms `ease-out`, the progress number tweening in 300 ms, a new provider's
 * detail entering by `opacity` in 200 ms; with motion reduced the number shows its value at once and every state reads
 * the same text and draws the same icons. C130: the repository's stylelint config reports nothing on the stylesheet,
 * no text of it is under 12px and the block's sizes are the type scale's 12px and 13px.
 */
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import postcss from "postcss";
import stylelint from "stylelint";
import type * as ApiModule from "../../api";
import { installPage, motion } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { SemanticSearch } from "./SemanticSearch";
import type { SettingsShape } from "./shared";
import { EMB, GEMMA, QWEN, RECALL, RERANKER, net, resetNet } from "./semanticSearchNet";

vi.mock("../../api", async (importOriginal) =>
  (await import("./semanticSearchNet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 60_000 });

installPage();
beforeEach(() => resetNet());

const FILE = join(__dirname, "semanticSearch.css");
const CSS = readFileSync(FILE, "utf8");

/** The `animation`/`transition` declarations not inside `@media (prefers-reduced-motion: no-preference)`. */
function motionOutsideNoPreference(css: string): string[] {
  const out: string[] = [];
  postcss.parse(css).walkDecls(/^(animation|transition)(-[a-z-]+)?$/, (d) => {
    for (let p: postcss.Container | postcss.Document | undefined = d.parent; p; p = p.parent)
      if (
        p.type === "atrule" &&
        (p as postcss.AtRule).name === "media" &&
        /prefers-reduced-motion:\s*no-preference/.test((p as postcss.AtRule).params)
      )
        return;
    out.push(`${(d.parent as postcss.Rule).selector} { ${d.prop}: ${d.value} }`);
  });
  return out;
}
function rule(selector: string, inMotion: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(CSS).walkRules(selector, (r) => {
    const media = r.parent?.type === "atrule" && /no-preference/.test((r.parent as postcss.AtRule).params);
    if (media === inMotion) r.walkDecls((d) => void (out[d.prop] = d.value));
  });
  return out;
}
function keyframes(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(CSS).walkAtRules("keyframes", (k) => {
    if (k.params === name) k.walkRules("from", (r) => r.walkDecls((d) => void (out[d.prop] = d.value)));
  });
  return out;
}

const LOCAL = { ...EMB, provider: "local", local: { model: GEMMA.id } };
const downloading = (done: number) => ({
  ...GEMMA,
  state: "downloading",
  progress: { done, total: 209_000_000 },
});
function draw(embeddings: Record<string, unknown>) {
  const s = { memory: { embeddings, recall: RECALL } } as unknown as SettingsShape;
  return renderWith(createElement(SemanticSearch, { s, put: () => Promise.resolve({ ok: true as const }) }), {
    lang: "pt-BR",
  });
}
const shown = () => document.querySelector(".ss-model .ss-side > .ss-row")!.textContent;

describe("C128 nothing moves for someone who asked for less, and what moves is timed as the design says", () => {
  it("C128 the reader finds an animation or a transition outside the no-preference block, and leaves the ones inside", () => {
    expect(motionOutsideNoPreference(".a { animation: x 1s }")).toHaveLength(1);
    expect(motionOutsideNoPreference(".a { transition: opacity 1s }")).toHaveLength(1);
    expect(
      motionOutsideNoPreference("@media (prefers-reduced-motion: reduce) { .a { transition: x 1s } }"),
    ).toHaveLength(1);
    expect(
      motionOutsideNoPreference("@media (prefers-reduced-motion: no-preference) { .a { animation: x 1s } }"),
    ).toEqual([]);
  });

  it("C128 every animation and transition of semanticSearch.css is inside the no-preference block, and there are some", () => {
    expect(motionOutsideNoPreference(CSS)).toEqual([]);
    expect((CSS.match(/(animation|transition):/g) ?? []).length).toBe(2);
  });

  it("C128 the bar grows from the left by transform scaleX in 240 ms ease-out; the detail enters by opacity in 200 ms", async () => {
    expect(rule(".ss-fill", false)["transform-origin"]).toBe("left center");
    expect(rule(".ss-fill", true)).toEqual({ transition: "transform 240ms ease-out" });
    const enter = rule(".ss-detail", true).animation!.split(/\s+/);
    expect(enter.slice(1)).toEqual(["200ms", "ease-out"]);
    expect(keyframes(enter[0]!)).toEqual({ opacity: "0" });
    // the bar's width is the share written, drawn as a scale of the full track
    models(downloading(120_000_000));
    draw(LOCAL);
    await waitFor(() => expect(document.querySelector(".ss-fill")).not.toBeNull());
    expect((document.querySelector(".ss-fill") as HTMLElement).style.transform).toBe("scaleX(0.57)");
  });

  const models = (...list: Record<string, unknown>[]) =>
    (net.catalog = { ...net.catalog, models: [...list, QWEN, RERANKER] });

  for (const reduced of [true, false])
    it(`C128 with motion ${reduced ? "reduced the progress number shows its value at once" : "allowed the progress number rises to its value in 300 ms"}`, async () => {
      motion.reduced = reduced;
      models(downloading(0));
      vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
      const r = draw(LOCAL);
      await waitFor(() => expect(shown()).toBe("Baixando: 0 de 209 MB"));
      models(downloading(120_000_000));
      await act(() => r.qc.invalidateQueries({ queryKey: ["memory", "embedder"] }));
      // the bar is not tweened: it says when the new progress has been drawn
      await waitFor(() =>
        expect(document.querySelector("[role=progressbar]")!.getAttribute("aria-valuenow")).toBe("57"),
      );
      if (reduced) {
        await waitFor(() => expect(shown()).toBe("Baixando: 120 de 209 MB"));
        return;
      }
      act(() => void vi.advanceTimersByTime(150));
      const mid = Number(/Baixando: (\d+)/.exec(shown()!)![1]);
      expect(mid).toBeGreaterThan(0);
      expect(mid).toBeLessThan(120);
      act(() => void vi.advanceTimersByTime(160));
      expect(shown()).toBe("Baixando: 120 de 209 MB");
    });

  /** What the block says and how many icons it draws, once anything that moves has settled. */
  async function read(reduced: boolean, embeddings: Record<string, unknown>) {
    motion.reduced = reduced;
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const r = draw(embeddings);
    if (embeddings.provider === "local")
      await waitFor(() => expect(document.querySelector(".ss-model")).not.toBeNull());
    act(() => void vi.advanceTimersByTime(400));
    const root = document.querySelector(".ss")!;
    const out = { text: root.textContent, icons: root.querySelectorAll("svg").length };
    r.unmount();
    vi.useRealTimers();
    return out;
  }
  const states: Array<[string, Record<string, unknown>, Record<string, unknown>[]]> = [
    ["the words", EMB, [GEMMA]],
    [
      "the own server",
      { ...EMB, provider: "http", endpoint: "http://127.0.0.1:11434/v1/embeddings" },
      [GEMMA],
    ],
    [
      "every model state",
      LOCAL,
      [
        downloading(120_000_000),
        { ...QWEN, state: "failed", reason: "checksum" },
        { ...RERANKER, state: "ready" },
      ],
    ],
  ];
  it.each(states)(
    "C128 %s read the same text and draw the same icons with motion reduced and allowed",
    async (_n, emb, list) => {
      net.catalog = { ...net.catalog, models: list };
      const allowed = await read(false, emb);
      const reduced = await read(true, emb);
      expect(allowed).toEqual(reduced);
      expect(reduced.icons).toBeGreaterThan(0);
    },
  );
});

describe("C130 the stylesheet, the type floor and the tokens", () => {
  const config = join(__dirname, "..", "..", "..", "..", "..", "stylelint.config.mjs");
  const warnings = async (code: string) => {
    const { results } = await stylelint.lint({ code, codeFilename: FILE, configFile: config });
    return results.flatMap((r) => r.warnings.map((w) => `${w.rule}: ${w.text}`));
  };

  it("C130 stylelint (tokens only) reports no warning on semanticSearch.css, and does report a colour literal", async () => {
    expect(await warnings(CSS)).toEqual([]);
    expect((await warnings(".ss-x { color: #fff; }\n")).join("\n")).toContain("color-no-hex");
  });

  it("C130 every font size of the block is a token of the scale, 12px (ss-s) and 13px (ss-b, weight 600), none under it", () => {
    const sizes: string[] = [];
    postcss.parse(CSS).walkDecls(/^font(-size)?$/, (d) => void sizes.push(d.value));
    expect(sizes.sort()).toEqual(["var(--fs-2)", "var(--fs-3)"]);
    expect(rule(".ss-s", false)).toEqual({ "font-size": "var(--fs-2)", color: "var(--text-dim)" });
    expect(rule(".ss-b", false)).toEqual({ margin: "0", "font-size": "var(--fs-3)", "font-weight": "600" });
  });

  it("C130 the colours of the states are tokens: tone-ok, tone-warn and tone-muted", () => {
    expect(rule(".ss .tone-ok", false)).toEqual({ color: "var(--ok)" });
    expect(rule(".ss .tone-warn", false)).toEqual({ color: "var(--warn)" });
    expect(rule(".ss .tone-muted", false)).toEqual({ color: "var(--text-faint)" });
  });
});
