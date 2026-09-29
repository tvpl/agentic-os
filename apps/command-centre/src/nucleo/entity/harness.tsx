/**
 * Dev harness for the entity (not part of the app bundle): the hero at
 * 560 px and the iris at 44 px beside a mock voice line, with controls for
 * every state, the typing/speaking events, activities, theme and economy.
 * Served by Vite at /src/nucleo/entity/harness.html.
 *
 * `window.__entity` exposes the same controls for scripted captures.
 */
import { StrictMode, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import "../../theme.css";
import type { CoreState } from "../../desktop/coreState";
import { TYPING_EVENT } from "../CoreOrb";
import Entity, { SPEAK_EVENT } from "./Entity";
import { EntityEngine } from "./entityEngine";
import type { EntityActivity } from "./entityParams";

const STATES: CoreState[] = [
  "idle",
  "listening",
  "queued",
  "thinking",
  "tool",
  "responding",
  "waiting",
  "alert",
  "done",
  "cancelled",
  "interrupted",
];

const SAMPLES: Array<Pick<EntityActivity, "kind" | "label">> = [
  { kind: "read", label: "notes/roadmap.md" },
  { kind: "search", label: "grep “invoice”" },
  { kind: "run", label: "npm test" },
  { kind: "web", label: "weather.gov" },
  { kind: "write", label: "draft reply" },
  { kind: "think", label: "planning" },
  { kind: "other", label: "calendar" },
];

interface HarnessApi {
  setState(s: CoreState): void;
  setTheme(t: "dark" | "light"): void;
  speak(ms: number): void;
  type(n: number): void;
  addActivity(kind?: EntityActivity["kind"], label?: string): void;
  clearActivity(): void;
  setEconomy(on: boolean): void;
  benchmark(size: number, variant: "hero" | "iris", frames: number): Promise<number>;
}
declare global {
  interface Window {
    __entity?: HarnessApi;
  }
}

function speakFor(ms: number) {
  const end = performance.now() + ms;
  const burst = () => {
    if (performance.now() > end) return;
    window.dispatchEvent(
      new CustomEvent(SPEAK_EVENT, { detail: { chars: 4 + Math.floor(Math.random() * 30) } }),
    );
    window.setTimeout(burst, 40 + Math.random() * 110);
  };
  burst();
}

function typeKeys(n: number) {
  for (let i = 0; i < n; i++) window.setTimeout(() => window.dispatchEvent(new Event(TYPING_EVENT)), i * 110);
}

async function benchmark(size: number, variant: "hero" | "iris", frames: number): Promise<number> {
  const host = document.createElement("div");
  host.className = `entity entity--${variant}`;
  host.style.cssText = `position:fixed;left:0;top:0;width:${size}px;height:${size}px;`;
  document.body.append(host);
  const gl = document.createElement("canvas");
  gl.className = "entity-gl";
  const hud = document.createElement("canvas");
  hud.className = "entity-hud";
  host.append(gl, hud);
  const e = EntityEngine.create(host, gl, hud, { variant, economy: false }, () => undefined);
  if (!e) {
    host.remove();
    return -1;
  }
  e.setState("thinking", true);
  e.benchmark(10);
  const ms = e.benchmark(frames);
  e.dispose();
  host.remove();
  return ms;
}

const btn: CSSProperties = {
  font: "inherit",
  fontSize: "var(--fs-1)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg-raise)",
  color: "var(--text-dim)",
  cursor: "pointer",
};

function Harness() {
  const [state, setState] = useState<CoreState>("idle");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [economy, setEconomy] = useState(false);
  const [activity, setActivity] = useState<EntityActivity[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.body.style.background = "var(--bg)";
    document.body.style.margin = "0";
  }, [theme]);

  const addActivity = useCallback((kind?: EntityActivity["kind"], label?: string) => {
    const sample = SAMPLES[seq.current % SAMPLES.length]!;
    seq.current += 1;
    const item: EntityActivity = {
      id: `a${seq.current}`,
      kind: kind ?? sample.kind,
      label: label ?? sample.label,
      at: Date.now(),
    };
    setActivity((list) => [...list.filter((a) => Date.now() - a.at < 9000), item].slice(-6));
  }, []);

  useEffect(() => {
    window.__entity = {
      setState,
      setTheme,
      speak: speakFor,
      type: typeKeys,
      addActivity,
      clearActivity: () => setActivity([]),
      setEconomy,
      benchmark,
    };
  }, [addActivity]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "var(--font-mono)",
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 24,
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <div
        id="stage"
        style={{
          width: 820,
          height: 700,
          display: "grid",
          placeItems: "center",
          position: "relative",
          background: "var(--bg)",
        }}
      >
        <div id="hero" style={{ width: 560, height: 560 }}>
          <Entity state={state} variant="hero" economy={economy} activity={activity} />
        </div>
        <div
          id="voice"
          style={{
            position: "absolute",
            bottom: 8,
            left: 80,
            right: 80,
            height: 60,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 12px",
            border: "1px solid var(--nu-edge, var(--border))",
            borderRadius: 14,
            background: "var(--bg-raise)",
          }}
        >
          <div id="iris" style={{ width: 44, height: 44, flex: "none" }}>
            <Entity state={state} variant="iris" economy={economy} />
          </div>
          <span style={{ color: "var(--text-faint)", fontSize: "var(--fs-3)" }}>Ask Mordomo…</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxWidth: 360 }}>
          {STATES.map((s) => (
            <button
              key={s}
              type="button"
              style={{ ...btn, color: s === state ? "var(--agent-text)" : btn.color }}
              onClick={() => setState(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button type="button" style={btn} onClick={() => typeKeys(8)}>
            type ×8
          </button>
          <button type="button" style={btn} onClick={() => speakFor(4000)}>
            speak 4s
          </button>
          <button type="button" style={btn} onClick={() => addActivity()}>
            + activity
          </button>
          <button type="button" style={btn} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            theme: {theme}
          </button>
          <button type="button" style={btn} onClick={() => setEconomy(!economy)}>
            economy: {economy ? "on" : "off"}
          </button>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
