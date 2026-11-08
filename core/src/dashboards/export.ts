import path from "node:path";
import type { DashboardSnapshot, DashboardSpec, SnapshotWidget } from "@mordomo/contracts";

/**
 * The HTML a dashboard is exported as (.specs/features/cerebro-paineis, AC 55, amendment 20, `design.md` "HTML
 * exportado"): one page with the header (title, date, "Atualizado às HH:MM", the sources), the KPIs and the cards in the
 * snapshot's order, each chart an inline SVG followed by a table of the same values, a question dashboard's citations as
 * `nome § seção`, and the footer "Exportado do MordomoOS em <data>". No script, no external resource (no `src`, no
 * `url(`, no `@import`, no `<link>`); every text is escaped; a connector item with an `http(s)` `href` is a link.
 */

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const WEEKDAYS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Every text and attribute goes through this. Besides the markup characters, `(`, `@` and `=` are written as
 * references, so no text of a note or a connector can spell `url(`, `@import` or `src=` in the file (AC 55); a browser
 * shows them as they were.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\(/g, "&#40;")
    .replace(/@/g, "&#64;")
    .replace(/=/g, "&#61;");
}

const hhmm = (at: number) => {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const shortDate = (at: number) => {
  const d = new Date(at);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const longDate = (at: number) => {
  const d = new Date(at);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
};

/** The local `AAAA-MM-DDTHHMM` of an export's file name (amendment 20). */
export function exportStamp(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}`;
}

type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] =>
  Array.isArray(v) ? v.filter((x): x is Row => typeof x === "object" && x !== null) : [];
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const SOURCE_STATE: Readonly<Record<string, string>> = {
  ok: "ok",
  error: "erro",
  not_configured: "não configurado",
  unavailable: "indisponível",
};
const CHIP: Readonly<Record<string, string>> = {
  remaining: "restantes",
  open: "abertas",
  behind: "atrasados",
};

/** A line chart of the points, one series, in the light theme's chart colour. */
function sparkline(points: Array<{ label: string; value: number }>): string {
  const w = 96;
  const h = 32;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const xy = points.map((p, i) => {
    const x = points.length === 1 ? w / 2 : (i * w) / (points.length - 1);
    const y = h - 2 - ((p.value - min) / span) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = xy[xy.length - 1]!.split(",");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Tendência"><polyline fill="none" stroke="#c2410c" stroke-width="2" points="${xy.join(" ")}"/><circle cx="${last[0]}" cy="${last[1]}" r="3" fill="#c2410c"/></svg>`;
}

/** Horizontal bars, one series, with the track behind each. */
function bars(categories: Array<{ label: string; value: number }>): string {
  const max = Math.max(...categories.map((c) => c.value), 1);
  const lines = categories
    .map((c, i) => {
      const y = i * 28;
      const width = Math.round((c.value / max) * 240);
      return `<text x="0" y="${y + 16}">${escapeHtml(c.label)}</text><rect x="120" y="${y + 4}" width="240" height="18" fill="#e7e2d8"/><rect x="120" y="${y + 4}" width="${width}" height="18" fill="#c2410c"/><text x="368" y="${y + 16}">${escapeHtml(c.value)}</text>`;
    })
    .join("");
  return `<svg class="bars" viewBox="0 0 420 ${categories.length * 28}" width="420" height="${categories.length * 28}" role="img" aria-label="Barras">${lines}</svg>`;
}

function table(head: string[], body: unknown[][]): string {
  const th = head.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const tr = body.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

const link = (title: unknown, href: unknown): string =>
  typeof href === "string" && /^https?:\/\//i.test(href)
    ? `<a href="${escapeHtml(href)}">${escapeHtml(title)}</a>`
    : escapeHtml(title);

/** The body of one card, by its kind. */
function body(widget: SnapshotWidget): string {
  if (widget.status === "error")
    return `<p class="state">${escapeHtml(widget.error ?? "Não foi possível carregar.")}</p>`;
  const data = (widget.data ?? {}) as Row;
  switch (widget.kind) {
    case "kpi": {
      const value = num(data.value);
      const of = num(data.of);
      const delta = num(data.delta);
      const chip = data.chip as { rule?: string; n?: number } | undefined;
      const series = rows(data.series).map((p) => ({
        label: `${shortDate(num(p.at) ?? 0)} ${hhmm(num(p.at) ?? 0)}`,
        value: num(p.value) ?? 0,
      }));
      const head = `<p class="value">${escapeHtml(value ?? "—")}${of !== null ? `<span class="of">/${escapeHtml(of)}</span>` : ""}</p>`;
      const trend =
        delta !== null
          ? `<p class="delta">${escapeHtml(`${delta > 0 ? "↑ +" : delta < 0 ? "↓ −" : ""}${Math.abs(delta)}`)}</p>`
          : "";
      const chipText =
        chip?.rule && CHIP[chip.rule]
          ? `<p class="chip">${escapeHtml(`${chip.n ?? 0} ${CHIP[chip.rule]}`)}</p>`
          : "";
      const chart =
        series.length > 0
          ? sparkline(series) +
            table(
              ["Hora", "Valor"],
              series.map((p) => [p.label, p.value]),
            )
          : '<p class="state">Sem histórico ainda</p>';
      return head + trend + chipText + chart;
    }
    case "bars": {
      const categories = rows(data.categories).map((c) => ({
        label: typeof c.label === "string" ? c.label : "(sem valor)",
        value: num(c.count) ?? num(c.value) ?? 0,
      }));
      if (categories.length === 0) return '<p class="state">Sem dados para comparar.</p>';
      return (
        bars(categories) +
        table(
          ["Categoria", "Valor"],
          categories.map((c) => [c.label, c.value]),
        )
      );
    }
    case "table": {
      const columns = Array.isArray(data.columns) ? data.columns.map(String) : [];
      const body = rows(data.rows).map((r) => (Array.isArray(r.cells) ? r.cells : []));
      if (body.length === 0) return '<p class="state">Nada para mostrar.</p>';
      return table(columns, body);
    }
    case "note":
      return `<p class="note">${escapeHtml(typeof data.text === "string" ? data.text : (data.excerpt ?? ""))}</p>`;
    case "agenda": {
      const items = rows(data.items);
      if (items.length === 0) return '<p class="state">Agenda livre hoje.</p>';
      return `<ul>${items
        .map(
          (i) =>
            `<li>${num(i.ts) !== null ? `<span class="time">${escapeHtml(hhmm(num(i.ts)!))}</span> ` : ""}${link(i.title, i.href)}${i.subtitle ? ` <span class="sub">${escapeHtml(i.subtitle)}</span>` : ""}</li>`,
        )
        .join("")}</ul>`;
    }
    default: {
      const items = rows(data.items);
      if (items.length === 0) return '<p class="state">Nada para mostrar.</p>';
      return `<ul>${items
        .map((i) => {
          const text = i.text ?? i.title ?? i.name ?? i.subject ?? i.skill ?? i.description ?? "";
          const box = widget.kind === "checklist" ? `${i.done === true ? "☑" : "☐"} ` : "";
          const extra = i.subtitle ?? i.due ?? i.state ?? i.health ?? null;
          return `<li>${escapeHtml(box)}${link(text, i.href)}${extra !== null && extra !== undefined ? ` <span class="sub">${escapeHtml(extra)}</span>` : ""}</li>`;
        })
        .join("")}</ul>`;
    }
  }
}

function citations(widget: SnapshotWidget): string {
  const list = rows((widget.data as Row | undefined)?.citations);
  if (list.length === 0) return "";
  const items = list
    .map(
      (c) =>
        `<li>${escapeHtml(`${typeof c.name === "string" ? c.name : path.basename(String(c.path ?? ""))} § ${String(c.section ?? "")}`)}</li>`,
    )
    .join("");
  return `<div class="sources"><p>Fontes</p><ul>${items}</ul></div>`;
}

const STYLE = `
body{font-family:system-ui,sans-serif;color:#1c1917;background:#fdfcf9;margin:24px;font-size:14px}
header p{color:#57534e;font-size:12px;margin:2px 0}
h1{font-size:24px;margin:0 0 4px}
h2{font-size:13px;margin:0 0 8px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin:16px 0}
section{border:1px solid #e7e2d8;border-radius:8px;padding:12px;background:#ffffff}
.value{font-size:32px;font-weight:600;margin:0}.of{font-size:20px;color:#57534e}
.delta,.chip,.sub,.time,.state{color:#57534e;font-size:12px}
table{border-collapse:collapse;margin-top:8px;font-size:12px}
th,td{border-bottom:1px solid #e7e2d8;padding:2px 8px;text-align:left}
td:last-child{text-align:right;font-variant-numeric:tabular-nums}
ul{margin:0;padding-left:18px}.sources{margin-top:8px;font-size:12px;color:#57534e}
svg text{font-size:12px;fill:#1c1917}
footer{color:#57534e;font-size:12px}
`;

/** The page of a dashboard's stored snapshot, at `now` (the export's date). */
export function renderDashboardHtml(
  definition: Pick<DashboardSpec, "title" | "kind" | "widgets">,
  snapshot: DashboardSnapshot,
  now: number,
): string {
  const titleOf = (w: SnapshotWidget) => {
    const own = definition.widgets.find((d) => d.id === w.id)?.title;
    const data = (w.data ?? {}) as Row;
    return (
      own ??
      (typeof data.title === "string"
        ? data.title
        : w.id === "como-foi-feita"
          ? "Como esta resposta foi feita"
          : w.id)
    );
  };
  const sources = snapshot.sources
    .map(
      (s) =>
        `<li>${escapeHtml(s.id)}: ${escapeHtml(SOURCE_STATE[s.status] ?? s.status)}${s.message ? ` — ${escapeHtml(s.message)}` : ""}</li>`,
    )
    .join("");
  const cards = snapshot.widgets
    .map((w) => `<section><h2>${escapeHtml(titleOf(w))}</h2>${body(w)}${citations(w)}</section>`)
    .join("\n");
  return [
    "<!doctype html>",
    '<html lang="pt-BR">',
    '<head><meta charset="utf-8">',
    `<title>${escapeHtml(definition.title)}</title>`,
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    `<header><h1>${escapeHtml(definition.title)}</h1><p>${escapeHtml(longDate(snapshot.generatedAt))}</p><p>${escapeHtml(`Atualizado às ${hhmm(snapshot.generatedAt)}`)}</p><ul class="sources">${sources}</ul></header>`,
    `<main>\n${cards}\n</main>`,
    `<footer><p>${escapeHtml(`Exportado do MordomoOS em ${shortDate(now)}`)}</p></footer>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
