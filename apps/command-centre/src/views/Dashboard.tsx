import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BrainCircuit,
  FileCode,
  FileImage,
  FileText,
  Grid3x3,
  Play,
  Plus,
  Settings2,
  Sparkles,
} from "lucide-react";
import {
  api,
  type ArtifactEntry,
  type Meta,
  type Metrics,
  type ModelishOption,
  type ProviderId,
  type ProviderSnapshot,
  type RoutineStatus,
  type RunRecord,
  type Skill,
} from "../api";
import { I18nContext, useT } from "../i18n";
import { ErrorBox, Loading, Modal, StatusBadge, formatDuration, timeAgo, useApi, useToast } from "../components/ui";

/* ============================================================================
   Dashboard 2.0 — the orbital command centre.
   Centre: animated particle core (real indexed files) ringed by recent
   artifacts. Left: micro apps + clock. Right: skills deck + routines board.
============================================================================ */

interface DashData {
  meta: Meta;
  providers: ProviderSnapshot[];
  skills: Skill[];
  routines: RoutineStatus[];
  artifacts: ArtifactEntry[];
  runs: RunRecord[];
  metrics: Metrics;
}

export default function Dashboard() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const [matrixFor, setMatrixFor] = useState<Skill | null>(null);
  const { data, error, offline, loading, reload } = useApi<DashData>(async () => {
    const [meta, providers, skills, routines, artifacts, runs, metrics] = await Promise.all([
      api.get<Meta>("/api/meta"),
      api.get<ProviderSnapshot[]>("/api/providers"),
      api.get<Skill[]>("/api/skills"),
      api.get<RoutineStatus[]>("/api/routines"),
      api.get<ArtifactEntry[]>("/api/artifacts/recent?limit=22"),
      api.get<RunRecord[]>("/api/runs?limit=30"),
      api.get<Metrics>("/api/metrics"),
    ]);
    return { meta, providers, skills, routines, artifacts, runs, metrics };
  });

  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error && !data) return <div className="page"><ErrorBox message={error} offline={offline} onRetry={reload} /></div>;
  if (!data) return null;

  const running = data.runs.filter((r) => ["running", "queued"].includes(r.status));
  const failures = data.runs.filter((r) => r.status === "failed").slice(0, 3);
  const unhealthy = data.routines.filter((r) => !r.healthy);

  const switchDefault = async (provider: ProviderId) => {
    try {
      await api.put("/api/providers/default", { provider });
      toast(`${t("dash.activeProvider")}: ${provider}`, "ok");
      reload();
    } catch (err) {
      toast((err as Error).message, "danger");
    }
  };

  const runSkill = async (skill: Skill) => {
    if (skill.inputs.some((i) => i.required)) {
      navigate(`/skills/${skill.slug}`);
      return;
    }
    try {
      const res = await api.post<{ runId: string }>(`/api/skills/${skill.slug}/run`, { inputs: {} });
      toast(`▶ /${skill.slug}`, "ok");
      navigate(`/runs/${res.runId}`);
    } catch (err) {
      toast((err as Error).message, "danger");
    }
  };

  const deckSkills = (() => {
    const favorites = data.skills.filter((s) => s.favorite && s.enabled);
    const rest = data.skills.filter((s) => s.enabled && !s.favorite);
    return [...favorites, ...rest].slice(0, 6);
  })();

  return (
    <div className="page wide">
      <div className="page-head" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="dot ok" aria-hidden />
          <span className="hud-label">
            {t("dash.activeProvider")}: <span style={{ color: "var(--accent)" }}>{data.providers.find((p) => p.isDefault)?.id ?? "—"}</span>
          </span>
        </div>
        <div className="segmented" role="group" aria-label={t("dash.providers")}>
          {data.providers.map((p) => (
            <button
              key={p.id}
              className={p.isDefault ? "active" : ""}
              disabled={!p.enabled}
              title={p.enabled ? (p.isDefault ? t("dash.default") : t("dash.makeDefault")) : t("common.disabled")}
              onClick={() => !p.isDefault && p.enabled && switchDefault(p.id)}
            >
              <span className={`dot ${p.enabled ? (p.health.ok ? "ok" : p.health.installed ? "warn" : "danger") : "dim"}`} style={{ marginRight: 6 }} />
              {p.id}
            </button>
          ))}
        </div>
      </div>

      <div className="dash-grid">
        {/* -------- left column -------- */}
        <div>
          <div className="card">
            <h2><Grid3x3 aria-hidden /> {t("dash.microapps")}</h2>
            <Link className="microapp-row" to="/brain">
              <span className="ma-icon"><BrainCircuit aria-hidden /></span>
              <span>
                <span className="ma-name" style={{ display: "block" }}>{t("nav.brain")}</span>
                <span className="ma-desc">{t("microapp.brain.desc")}</span>
              </span>
              <span className="ma-arrow">→</span>
            </Link>
            <Link className="microapp-row" to="/pixel">
              <span className="ma-icon"><Grid3x3 aria-hidden /></span>
              <span>
                <span className="ma-name" style={{ display: "block" }}>{t("nav.pixel")}</span>
                <span className="ma-desc">{t("microapp.pixel.desc")}</span>
              </span>
              <span className="ma-arrow">→</span>
            </Link>
            <Link className="microapp-row" to="/connectors">
              <span className="ma-icon" style={{ background: "transparent", color: "var(--text-faint)" }}><Plus aria-hidden /></span>
              <span>
                <span className="ma-name" style={{ display: "block", color: "var(--text-dim)" }}>{t("conn.title")}</span>
                <span className="ma-desc">{t("microapp.notConfigured")}</span>
              </span>
              <span className="ma-arrow">→</span>
            </Link>
          </div>

          <ClockCard timezone={data.meta ? undefined : undefined} routines={data.routines} />

          {(failures.length > 0 || unhealthy.length > 0) && (
            <div className="card">
              <h2>{t("dash.attention")}</h2>
              {unhealthy.map((r) => (
                <div className="list-row" key={r.id}>
                  <div className="truncate">
                    <Link to="/routines">{r.name}</Link>
                    <div className="meta">{t("routines.failing")}</div>
                  </div>
                  <span className="badge danger">{r.recentFailures}×</span>
                </div>
              ))}
              {failures.map((r) => (
                <div className="list-row" key={r.id}>
                  <div className="truncate">
                    <Link to={`/runs/${r.id}`}>{r.skillSlug ?? r.promptSummary.slice(0, 40)}</Link>
                    <div className="meta truncate">{r.error}</div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* -------- centre: orbital core -------- */}
        <div>
          <OrbitalCore
            systemName={data.meta.name}
            artifacts={data.artifacts}
            onOpenBrain={() => navigate("/brain")}
            onOpenRun={(runId) => navigate(`/runs/${runId}`)}
          />
          <div className="metrics-strip">
            <div className="stat">
              <span className="value accented">{data.metrics.last7d}</span>
              <span className="label">{t("dash.metrics")} · {t("dash.metricRuns")}</span>
            </div>
            <div className="stat">
              <span className="value">{data.metrics.successRate == null ? "—" : `${Math.round(data.metrics.successRate * 100)}%`}</span>
              <span className="label">{t("dash.metricSuccess")}</span>
            </div>
            <div className="stat">
              <span className="value">{formatDuration(data.metrics.avgDurationMs)}</span>
              <span className="label">{t("dash.metricAvg")}</span>
            </div>
            <div className="stat">
              <span className="value">{running.length}</span>
              <span className="label">{t("dash.running")}</span>
            </div>
            {running.slice(0, 2).map((r) => (
              <div key={r.id} style={{ alignSelf: "center" }}>
                <Link to={`/runs/${r.id}`} className="badge info" style={{ textDecoration: "none" }}>
                  <span className="spinner" style={{ width: 10, height: 10 }} aria-hidden /> {r.skillSlug ?? r.provider}
                </Link>
              </div>
            ))}
          </div>
        </div>

        {/* -------- right column -------- */}
        <div className="dash-right">
          <div className="card">
            <h2 style={{ justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}><Sparkles aria-hidden /> {t("dash.deck")}</span>
              <span style={{ display: "flex", gap: 10, alignItems: "center", textTransform: "none", letterSpacing: 0 }}>
                <span style={{ fontSize: 10, color: "var(--text-faint)" }}>{t("dash.tapToRun")}</span>
                <Link to="/skills" className="btn sm outline-accent" style={{ fontSize: 10, padding: "2px 8px" }}>{t("dash.addSkill")}</Link>
              </span>
            </h2>
            {deckSkills.length === 0 ? (
              <p style={{ color: "var(--text-faint)", margin: 0 }}>{t("dash.noFavorites")}</p>
            ) : (
              <div className="deck-grid">
                {deckSkills.map((s) => (
                  <div className="deck-card" key={s.slug}>
                    <DeckIcon skill={s} />
                    <Link to={`/skills/${s.slug}`} className="slug" style={{ color: "var(--text)" }}>/{s.slug}</Link>
                    <div className="config">
                      <span className="model">{shortModel(s.recommendedModel)}</span>
                      <span className="sep">·</span>
                      <span className="effort">{s.recommendedEffort === "default" ? t("effort.default") : t(`effort.${s.recommendedEffort}` as Parameters<typeof t>[0])}</span>
                    </div>
                    <div className="deck-actions">
                      <button className="btn sm outline-accent" onClick={() => runSkill(s)} aria-label={`${t("common.run")} /${s.slug}`}>
                        <Play aria-hidden />
                      </button>
                      <button className="btn sm ghost" onClick={() => setMatrixFor(s)} aria-label={`${t("matrix.title")} /${s.slug}`}>
                        <Settings2 aria-hidden />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <RoutinesBoard routines={data.routines} runs={data.runs} />
        </div>
      </div>

      {matrixFor && (
        <ModelEffortMatrix
          skill={matrixFor}
          providers={data.providers}
          onClose={() => setMatrixFor(null)}
          onSaved={() => {
            setMatrixFor(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function shortModel(model: string | null): string {
  if (!model) return "AUTO";
  const m = model.toLowerCase();
  for (const name of ["opus", "sonnet", "haiku", "fable", "gpt-5.2", "gpt-5", "o4"]) {
    if (m.includes(name)) return name.toUpperCase();
  }
  return model.slice(0, 10).toUpperCase();
}

function DeckIcon({ skill }: { skill: Skill }) {
  const slug = skill.slug;
  if (slug.includes("news")) return <FileText className="deck-icon" aria-hidden />;
  if (slug.includes("html") || slug.includes("pixel")) return <FileImage className="deck-icon" aria-hidden />;
  if (slug.includes("review") || slug.includes("sdd") || slug.includes("harness")) return <FileCode className="deck-icon" aria-hidden />;
  return <Sparkles className="deck-icon" aria-hidden />;
}

/* ---------- orbital core: particle sphere + artifact ring ---------- */
function OrbitalCore({
  systemName,
  artifacts,
  onOpenBrain,
  onOpenRun,
}: {
  systemName: string;
  artifacts: ArtifactEntry[];
  onOpenBrain: () => void;
  onOpenRun: (runId: string) => void;
}) {
  const t = useT();
  const { lang } = useContext(I18nContext);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [recentFiles, setRecentFiles] = useState<Array<{ name: string; mtime: number }>>([]);
  const [chips, setChips] = useState<
    Array<{ key: string; label: string; ts: number; kind: "artifact" | "file"; runId: string | null; left: number; top: number }>
  >([]);
  const [tip, setTip] = useState<{ x: number; y: number; text: string; sub: string } | null>(null);

  // Particle sphere fed by the real graph (sampled).
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let alive = true;
    const COLORS = ["#c084fc", "#f472b6", "#fb923c", "#22d3ee", "#fde047", "#4ade80", "#a5b4fc"];
    let points: Array<{ x: number; y: number; z: number; c: string; p: number }> = [];

    void api
      .get<{ nodes: Array<{ area: string | null; name: string; mtime: number }> }>("/api/memory/graph?maxNodes=700")
      .then((g) => {
        setRecentFiles(
          g.nodes
            .slice()
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 18)
            .map((n) => ({ name: n.name, mtime: n.mtime })),
        );
        const areas = [...new Set(g.nodes.map((n) => n.area ?? "•"))];
        const colorOf = new Map(areas.map((a, i) => [a, COLORS[i % COLORS.length]!]));
        let seed = 7;
        const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        // Small workspaces still deserve a lively core: cycle real files with
        // jitter until the cloud has enough particles to feel alive.
        const MIN_POINTS = 520;
        const source =
          g.nodes.length > 0
            ? Array.from({ length: Math.max(MIN_POINTS, g.nodes.length) }, (_, i) => g.nodes[i % g.nodes.length]!)
            : [];
        points = source.map((n) => {
          // Random point in a fuzzy ball, denser toward the centre.
          const u = rand();
          const r = 82 * Math.cbrt(u) + rand() * 16;
          const theta = rand() * TWO_PI;
          const phi = Math.acos(2 * rand() - 1);
          return {
            x: r * Math.sin(phi) * Math.cos(theta),
            y: r * Math.sin(phi) * Math.sin(theta) * 0.85,
            z: r * Math.cos(phi),
            c: colorOf.get(n.area ?? "•") ?? "#94a3b8",
            p: rand() * TWO_PI,
          };
        });
        if (points.length === 0) {
          // Empty index: a sparse decorative core, clearly minimal.
          points = Array.from({ length: 60 }, () => ({
            x: (rand() - 0.5) * 90,
            y: (rand() - 0.5) * 70,
            z: (rand() - 0.5) * 90,
            c: "#5b5546",
            p: rand() * TWO_PI,
          }));
        }
      })
      .catch(() => undefined);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = wrap.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const frame = (now: number) => {
      if (!alive) return;
      const rect = wrap.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height * 0.55;
      const tSec = now / 1000;
      const rot = reduceMotion ? 0.6 : tSec * 0.12;
      ctx.clearRect(0, 0, rect.width, rect.height);

      // wireframe polyhedron hint
      const styles = getComputedStyle(document.documentElement);
      ctx.strokeStyle = styles.getPropertyValue("--border").trim() || "#262218";
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 0.7;
      const R = Math.min(rect.width, rect.height) * 0.34;
      const verts: Array<[number, number]> = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TWO_PI + rot * 0.25;
        verts.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R * 0.92]);
      }
      ctx.beginPath();
      for (let i = 0; i < verts.length; i++) {
        for (let j = i + 1; j < verts.length; j++) {
          if ((i + j) % 3 === 0) {
            ctx.moveTo(verts[i]![0], verts[i]![1]);
            ctx.lineTo(verts[j]![0], verts[j]![1]);
          }
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      for (const pt of points) {
        const x = pt.x * cos - pt.z * sin;
        const z = pt.x * sin + pt.z * cos;
        const depth = (z + 110) / 220;
        const px = cx + x * 1.15;
        const py = cy + pt.y * 1.15;
        const twinkle = reduceMotion ? 0.9 : 0.65 + 0.35 * Math.sin(tSec * 1.6 + pt.p);
        ctx.globalAlpha = Math.max(0.15, (0.35 + depth * 0.65) * twinkle);
        ctx.fillStyle = pt.c;
        const size = 1.3 + depth * 2.1;
        ctx.fillRect(px - size / 2, py - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // Position chips along an arc around the core: artifacts first, then the
  // most recently touched workspace files (real data either way).
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const place = () => {
      const rect = wrap.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height * 0.55;
      const R = Math.min(rect.width, rect.height) * 0.44;
      const seen = new Set<string>();
      const combined: Array<{ key: string; label: string; ts: number; kind: "artifact" | "file"; runId: string | null }> = [];
      for (const a of artifacts) {
        const key = `a-${a.runId}-${a.file}`;
        if (seen.has(key)) continue;
        seen.add(key);
        combined.push({ key, label: a.file, ts: a.createdAt, kind: "artifact", runId: a.runId });
      }
      for (const f of recentFiles) {
        if (combined.length >= 20) break;
        const key = `f-${f.name}-${f.mtime}`;
        if (seen.has(key)) continue;
        seen.add(key);
        combined.push({ key, label: f.name, ts: f.mtime, kind: "file", runId: null });
      }
      const n = combined.length;
      setChips(
        combined.map((chip, i) => {
          // Arc sweeping over the top, like the reference ring.
          const a = Math.PI * (0.58 + (1.84 * i) / Math.max(1, n - 1));
          return { ...chip, left: cx + Math.cos(a) * R, top: cy + Math.sin(a) * R * 0.74 };
        }),
      );
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [artifacts, recentFiles]);

  return (
    <div className="orbital-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} aria-hidden />
      <div className="orbital-title">
        <div className="name">
          <span className="accent">{systemName.replace(/\s*os$/i, "")}</span>{" "}
          <span style={{ fontWeight: 400 }}>Agentic OS</span>
        </div>
        <div className="byline">{t("dash.brainSub")}</div>
      </div>
      <button className="orbital-core-btn" onClick={onOpenBrain} aria-label={t("dash.brainCta")} title={t("dash.brainCta")} />
      {chips.length === 0 && (
        <div style={{ position: "absolute", bottom: 18, left: 0, right: 0, textAlign: "center", color: "var(--text-faint)", fontSize: 12 }}>
          {t("dash.noArtifacts")}
        </div>
      )}
      {chips.map((chip) => (
        <button
          key={chip.key}
          className="orbit-chip"
          style={{ left: chip.left, top: chip.top, opacity: chip.kind === "file" ? 0.82 : 1 }}
          onClick={() => (chip.runId ? onOpenRun(chip.runId) : onOpenBrain())}
          onMouseEnter={(e) =>
            setTip({ x: e.clientX, y: e.clientY, text: chip.label, sub: timeAgo(chip.ts, lang) })
          }
          onMouseLeave={() => setTip(null)}
          aria-label={chip.label}
        >
          <span className="day-tag">{ageTag(chip.ts)}</span>
          {chipIcon(chip.label)}
        </button>
      ))}
      {tip && wrapRef.current && (
        <div
          className="orbit-tooltip"
          style={{
            left: tip.x - wrapRef.current.getBoundingClientRect().left + 12,
            top: tip.y - wrapRef.current.getBoundingClientRect().top + 12,
          }}
        >
          {tip.text}
          <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{tip.sub}</div>
        </div>
      )}
    </div>
  );
}

const TWO_PI = Math.PI * 2;

function ageTag(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return "1D";
  if (days < 14) return `${days}D`;
  return `${Math.floor(days / 7)}W`;
}

function chipIcon(file: string) {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "svg", "gif", "webp"].includes(ext)) return <FileImage aria-hidden />;
  if (["ts", "tsx", "js", "py", "sh", "json", "html", "css"].includes(ext)) return <FileCode aria-hidden />;
  return <FileText aria-hidden />;
}

/* ---------- clock / today widget ---------- */
function ClockCard({ routines }: { timezone?: string; routines: RoutineStatus[] }) {
  const t = useT();
  const { lang } = useContext(I18nContext);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const week = isoWeek(now);
  const dateLine = now.toLocaleDateString(lang, { month: "short", day: "2-digit", year: "numeric", weekday: "short" });
  const upcoming = routines
    .filter((r) => r.enabled && r.nextRunAt)
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
    .slice(0, 3);

  return (
    <div className="card">
      <h2>{t("dash.clock")}</h2>
      <div className="hud-label" style={{ color: "var(--accent)" }}>Wk{week} | {dateLine}</div>
      <div className="display-digits clock-time" role="timer">
        {now.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </div>
      <div className="clock-zones">
        <div className="zone">
          <div className="z-time">{now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}</div>
          <div className="z-label">UTC</div>
        </div>
        {routines[0]?.timezone && routines[0].timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone && (
          <div className="zone">
            <div className="z-time">
              {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: routines[0].timezone })}
            </div>
            <div className="z-label">{routines[0].timezone.split("/").pop()?.replace("_", " ")}</div>
          </div>
        )}
      </div>
      <QuarterDots now={now} />
      <div className="hud-label" style={{ margin: "14px 0 4px" }}>{t("dash.whatsNext")}</div>
      {upcoming.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-faint)" }}>{t("dash.noNext")}</p>
      ) : (
        upcoming.map((r) => (
          <div className="list-row" key={r.id} style={{ padding: "5px 0" }}>
            <Link to="/routines" className="truncate" style={{ color: "var(--text)", fontSize: 13 }}>{r.name}</Link>
            <span className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>
              {r.nextRunAt ? new Date(r.nextRunAt).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" }) : "—"}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function QuarterDots({ now }: { now: Date }) {
  const week = isoWeek(now);
  return (
    <div className="q-dots" aria-hidden>
      {[0, 1, 2, 3].map((q) => (
        <div className="q-row" key={q}>
          <span className="q-label">Q{q + 1}</span>
          {Array.from({ length: 13 }, (_, i) => {
            const w = q * 13 + i + 1;
            return <span key={i} className={`qd ${w === week ? "now" : w < week ? "past" : ""}`} />;
          })}
        </div>
      ))}
    </div>
  );
}

/* ---------- routines board ---------- */
function RoutinesBoard({ routines, runs }: { routines: RoutineStatus[]; runs: RunRecord[] }) {
  const t = useT();
  const { lang } = useContext(I18nContext);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const firedToday = runs.filter(
    (r) => r.origin === "routine" && r.createdAt >= todayStart.getTime() && !["queued", "running"].includes(r.status),
  ).length;

  const rows = routines
    .map((r) => {
      const firedTodayAt = r.lastFiredAt && r.lastFiredAt >= todayStart.getTime() ? r.lastFiredAt : null;
      const ts = r.enabled ? (r.nextRunAt ?? firedTodayAt) : firedTodayAt;
      return { r, ts, fired: !!firedTodayAt && (!r.nextRunAt || (r.nextRunAt && new Date(r.nextRunAt).getDate() !== new Date().getDate())) };
    })
    .sort((a, b) => (a.ts ?? Infinity) - (b.ts ?? Infinity));

  const nextId = rows.find((row) => row.r.enabled && row.r.nextRunAt)?.r.id ?? null;

  return (
    <div className="card">
      <h2 style={{ justifyContent: "space-between" }}>
        <span>{t("dash.board")}</span>
        <span style={{ fontSize: 10, color: "var(--text-faint)", textTransform: "none", letterSpacing: 0 }}>
          {firedToday}/{routines.filter((r) => r.enabled).length || routines.length} {t("dash.firedToday")}
        </span>
      </h2>
      {rows.length === 0 ? (
        <p style={{ color: "var(--text-faint)", margin: 0 }}>
          <Link to="/routines">{t("routines.new")} →</Link>
        </p>
      ) : (
        rows.map(({ r, ts, fired }) => {
          const isNext = r.id === nextId;
          const status = !r.enabled ? t("board.paused") : fired ? t("board.fired") : isNext ? t("board.next") : t("board.queued");
          return (
            <div className={`board-row${isNext ? " next" : ""}${fired || !r.enabled ? " fired" : ""}`} key={r.id}>
              <span className="time">
                {ts ? new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--"}
              </span>
              <Link to="/routines" className="name truncate" style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>
                {r.name}
              </Link>
              <span className="status">{status}</span>
            </div>
          );
        })
      )}
    </div>
  );
}

/* ---------- model × effort matrix ---------- */
function ModelEffortMatrix({
  skill,
  providers,
  onClose,
  onSaved,
}: {
  skill: Skill;
  providers: ProviderSnapshot[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const enabled = providers.filter((p) => p.enabled && skill.providers.includes(p.id));
  const [provider, setProvider] = useState<ProviderId>(
    (providers.find((p) => p.isDefault && enabled.includes(p))?.id ?? enabled[0]?.id ?? "claude") as ProviderId,
  );
  const [models, setModels] = useState<ModelishOption[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.get<ModelishOption[]>(`/api/providers/${provider}/models`).then(setModels).catch(() => setModels([]));
  }, [provider]);

  const efforts = ["low", "medium", "high", "default"] as const;
  const effortLabel: Record<(typeof efforts)[number], string> = {
    low: t("effort.low"),
    medium: t("effort.medium"),
    high: t("effort.high"),
    default: t("effort.default"),
  };

  const pick = async (model: string | null, effort: (typeof efforts)[number]) => {
    setBusy(true);
    try {
      const { body, skillFile, resources, bodyLineCount, thick, favorite, ...front } = skill as Skill &
        Record<string, unknown>;
      void skillFile; void resources; void bodyLineCount; void thick; void favorite;
      delete (front as Record<string, unknown>).dir;
      await api.put(`/api/skills/${skill.slug}`, {
        frontmatter: { ...front, recommendedModel: model, recommendedEffort: effort },
        body,
      });
      toast(`/${skill.slug}: ${shortModel(model)} · ${effortLabel[effort]}`, "ok");
      onSaved();
    } catch (err) {
      toast((err as Error).message, "danger");
      setBusy(false);
    }
  };

  const rows: Array<{ id: string | null; label: string }> = [
    { id: null, label: "AUTO" },
    ...models.map((m) => ({ id: m.id, label: shortModel(m.id) })),
  ];

  return (
    <Modal title={`/${skill.slug} — ${t("matrix.title")}`} onClose={onClose}>
      <p style={{ color: "var(--text-dim)", marginTop: 0, fontSize: 13 }}>{t("matrix.hint")}</p>
      {enabled.length > 1 && (
        <div className="segmented sm" style={{ marginBottom: 12 }}>
          {enabled.map((p) => (
            <button key={p.id} className={provider === p.id ? "active" : ""} onClick={() => setProvider(p.id)}>
              {p.id}
            </button>
          ))}
        </div>
      )}
      <table className="matrix">
        <thead>
          <tr>
            <th />
            {efforts.map((e) => <th key={e}>{effortLabel[e]}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const activeRow = (skill.recommendedModel ?? null) === row.id;
            return (
              <tr key={row.id ?? "auto"} className={activeRow ? "active-row" : ""}>
                <td className="model-name">{row.label}</td>
                {efforts.map((e) => (
                  <td className="cell" key={e}>
                    <button
                      className={`m-dot${activeRow && skill.recommendedEffort === e ? " selected" : ""}`}
                      disabled={busy}
                      onClick={() => void pick(row.id, e)}
                      aria-label={`${row.label} · ${effortLabel[e]}`}
                      aria-pressed={activeRow && skill.recommendedEffort === e}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
}
