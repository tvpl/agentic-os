// @vitest-environment jsdom
/**
 * The motion of "Perguntar" (.specs/features/cerebro-perguntar, C96; design.md "Movimento"): the result enters with
 * `opacity` and `translateY(4px)` in 200 ms, `ease-out`; each paragraph 40 ms after the one before it, at most 8; every
 * animation and transition of the view's stylesheet is inside `@media (prefers-reduced-motion: no-preference)`, so with
 * `reduce` nothing animates; the view moves nothing from script (no timer or frame of its own for motion), and an
 * answer reads the same text with motion reduced or allowed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import postcss from "postcss";
import type * as ApiModule from "../../api";
import { installPage, motion } from "../../ui/testkit";
import { resetNet } from "../notes/testnet";
import {
  ONBOARDING,
  detail,
  mountAsk,
  on,
  only,
  para,
  questionField,
  resetAsk,
  sendButton,
  shows,
} from "./testkit";

vi.mock("../../api", async (importOriginal) =>
  (await import("../notes/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 30_000 });

installPage();
beforeEach(() => {
  resetNet();
  resetAsk();
});

const CSS = readFileSync(join(__dirname, "ask.css"), "utf8");
const SOURCE = readFileSync(join(__dirname, "AskView.tsx"), "utf8");

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
/** The declarations of `selector` inside the no-preference block. */
function inMotion(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(CSS).walkAtRules("media", (m) => {
    if (!/no-preference/.test(m.params)) return;
    m.walkRules((r) => {
      if (r.selector === selector) r.walkDecls((d) => void (out[d.prop] = d.value));
    });
  });
  return out;
}
function keyframes(name: string, at: "from" | "to"): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(CSS).walkAtRules("keyframes", (k) => {
    if (k.params === name) k.walkRules(at, (r) => r.walkDecls((d) => void (out[d.prop] = d.value)));
  });
  return out;
}
/** Every selector of the stylesheet that names a `.ask-par:nth-child(n)`, by n. */
function staggers(): Map<number, string | undefined> {
  const out = new Map<number, string | undefined>();
  postcss.parse(CSS).walkRules((r) => {
    const m = /^\.ask-par:nth-child\((\d+)\)$/.exec(r.selector);
    if (!m) return;
    let delay: string | undefined;
    r.walkDecls("animation-delay", (d) => void (delay = d.value));
    out.set(Number(m[1]), delay);
  });
  return out;
}

describe("C96 the motion of the view", () => {
  it("C96 the reader finds an animation or a transition outside the no-preference block, and leaves the ones inside", () => {
    expect(motionOutsideNoPreference(".a { animation: x 1s }")).toHaveLength(1);
    expect(
      motionOutsideNoPreference("@media (prefers-reduced-motion: reduce) { .a { transition: opacity 1s } }"),
    ).toHaveLength(1);
    expect(
      motionOutsideNoPreference("@media (prefers-reduced-motion: no-preference) { .a { animation: x 1s } }"),
    ).toEqual([]);
  });

  it("C96 every animation and transition of ask.css is inside the no-preference block, and there are some", () => {
    expect(motionOutsideNoPreference(CSS)).toEqual([]);
    expect((CSS.match(/animation:/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("C96 the result enters with opacity 0 and translateY(4px) in 200 ms ease-out", () => {
    const result = inMotion(".ask-result").animation!.split(/\s+/);
    expect(result.slice(1)).toEqual(["200ms", "ease-out", "both"]);
    expect(keyframes(result[0]!, "from")).toEqual({ opacity: "0", transform: "translateY(4px)" });
    expect(keyframes(result[0]!, "to")).toEqual({});
  });

  it("C96 each paragraph enters the same way, 40 ms after the one before it, at most 8", () => {
    const par = inMotion(".ask-par").animation!.split(/\s+/);
    expect(par.slice(1)).toEqual(["200ms", "ease-out", "both"]);
    expect(keyframes(par[0]!, "from")).toEqual({ opacity: "0", transform: "translateY(4px)" });
    expect([...staggers().entries()].sort(([a], [b]) => a - b)).toEqual(
      [2, 3, 4, 5, 6, 7, 8].map((n) => [n, `${(n - 1) * 40}ms`]),
    );
    for (const n of [2, 8])
      expect(inMotion(`.ask-par:nth-child(${n})`)["animation-delay"]).toBe(`${(n - 1) * 40}ms`);
  });

  it("C96 the view moves nothing from script: no animation API, frame or tween of its own", () => {
    expect(SOURCE).not.toMatch(
      /requestAnimationFrame|\.animate\(|useTweenNumber|prefersReducedMotion|setInterval/,
    );
  });

  for (const reduced of [true, false])
    it(`C96 with motion ${reduced ? "reduced" : "allowed"} an answer reads its two paragraphs and the same citations at once`, async () => {
      motion.reduced = reduced;
      on(
        "ask",
        only(
          { question: "O que decidi?", mode: "direct", scope: { kind: "all" } },
          { status: "running", id: "run-1" },
        ),
      );
      shows(detail({ answer: { paragraphs: [para("Um.", ONBOARDING), para("Dois.", ONBOARDING)] } }));
      mountAsk();
      await waitFor(() => expect(questionField()).not.toBeNull());
      fireEvent.change(questionField(), { target: { value: "O que decidi?" } });
      fireEvent.click(sendButton());
      await waitFor(() => expect(document.querySelectorAll(".ask-par")).toHaveLength(2));
      expect([...document.querySelectorAll(".ask-par")].map((p) => p.textContent)).toEqual([
        "Um.onboarding.md § Decisão",
        "Dois.onboarding.md § Decisão",
      ]);
      cleanup();
    });
});
