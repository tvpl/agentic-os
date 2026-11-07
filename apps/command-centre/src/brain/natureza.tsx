/**
 * The nature of what the brain holds, on screen (.specs/features/cerebro-natureza, design.md "Selo de natureza" and
 * "Busca e preview"): the badges (an icon and a text, the colour only a support), the readers of a file's `fields`
 * through the closed lists of door 1, the row of nature filters of the search, and the due count the entries show.
 * Everything here is light and shared; the "Revisões" screen itself is a chunk of its own (`reviews/`).
 */
import { useState } from "react";
import {
  Archive,
  CircleCheck,
  CircleDashed,
  Compass,
  FileText,
  FlaskConical,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";
import { useT, type TKey } from "../i18n";
import { useRouteQuery } from "../queries";
import { useWorkContext } from "../contexts/useWorkContext";
import "./natureza.css";

/** The five natures, in the order of design.md's table (and of the filters). */
export const NATUREZAS = ["fato", "relato", "plano", "hipotese", "opiniao"] as const;
export type Natureza = (typeof NATUREZAS)[number];
export const ESCOPOS = ["pessoal", "equipe", "externo"] as const;
export type Escopo = (typeof ESCOPOS)[number];

/** Icon, text and tone class of each badge (design.md "Selo de natureza"); `none` is "Não classificado". */
const BADGE: Record<Natureza | "none", [LucideIcon, TKey, string]> = {
  fato: [CircleCheck, "nature.fato", "tone-ok"],
  relato: [FileText, "nature.relato", "tone-muted"],
  plano: [Compass, "nature.plano", "tone-info"],
  hipotese: [FlaskConical, "nature.hipotese", "tone-warn"],
  opiniao: [MessageCircle, "nature.opiniao", "tone-accent"],
  none: [CircleDashed, "nature.none", "tone-muted"],
};
const SCOPE: Record<Escopo, TKey> = {
  pessoal: "scope.pessoal",
  equipe: "scope.equipe",
  externo: "scope.externo",
};

/** As `normalizeFieldKey` compares a value (core/src/memory/fields.ts). */
const norm = (raw: string) =>
  raw
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** A file's nature read through the closed list (door 1, amendment 2): null when absent or outside it. */
export function natureOf(fields: Readonly<Record<string, string>> | undefined): Natureza | null {
  const v = fields?.natureza === undefined ? "" : norm(fields.natureza);
  return (NATUREZAS as readonly string[]).includes(v) ? (v as Natureza) : null;
}
export function escopoOf(fields: Readonly<Record<string, string>> | undefined): Escopo | null {
  const v = fields?.escopo === undefined ? "" : norm(fields.escopo);
  return (ESCOPOS as readonly string[]).includes(v) ? (v as Escopo) : null;
}
/** The day an archived note was abandoned (`status: archived` and `abandoned: AAAA-MM-DD`), or null. */
export function abandonedOf(fields: Readonly<Record<string, string>> | undefined): string | null {
  const day = fields?.abandoned?.trim() ?? "";
  return fields?.status !== undefined && norm(fields.status) === "archived" && /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? day
    : null;
}

/** The short name of a nature ("Plano", not the badge's whole sentence): the suggestion and the notices. */
export function natureName(t: (key: TKey) => string, n: Natureza): string {
  return n === "plano" ? t("notes.callout.plano") : t(BADGE[n][1]);
}

/** The nature badge: always the icon and the text. `dense` (a list of hits) says only "Plano", with the rest as `title`. */
export function NatureBadge({
  n,
  dense = false,
  label,
}: {
  n: Natureza | null;
  dense?: boolean;
  label?: string;
}) {
  const t = useT();
  const [Icon, key, tone] = BADGE[n ?? "none"];
  const short = dense && n === "plano";
  return (
    <span className={`badge meta nb ${tone}`} title={short ? t(key) : undefined}>
      <Icon aria-hidden />
      {label ?? (short ? natureName(t, "plano") : t(key))}
    </span>
  );
}

/** The scope badge: text only, smaller. */
export function ScopeBadge({ s }: { s: Escopo }) {
  const t = useT();
  return <span className="badge meta nb nb-scope">{t(SCOPE[s])}</span>;
}

export function AbandonedBadge({ date }: { date: string }) {
  const t = useT();
  return (
    <span className="badge meta nb tone-muted">
      <Archive aria-hidden />
      {t("nature.abandoned", { date })}
    </span>
  );
}

/** Toggle `v` in a list of choices (the filters' `aria-pressed` buttons). */
export function toggled<T>(list: readonly T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/** One row of filter buttons with `aria-pressed`, each a badge (the natures) or a scope's name. */
export function FilterRow<T extends Natureza | Escopo>({
  label,
  values,
  chosen,
  onChange,
  dense,
}: {
  label: string;
  values: readonly T[];
  chosen: readonly T[];
  onChange: (next: T[]) => void;
  dense?: boolean;
}) {
  const t = useT();
  return (
    <div className="nb-filters" role="group" aria-label={label}>
      {values.map((v) => (
        <button
          key={v}
          type="button"
          className="nb-filter"
          aria-pressed={chosen.includes(v)}
          onClick={() => onChange(toggled(chosen, v))}
        >
          {(NATUREZAS as readonly string[]).includes(v) ? (
            <NatureBadge n={v as Natureza} dense={dense} />
          ) : (
            t(SCOPE[v as Escopo])
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * The search's nature filters (design.md "Busca e preview", amendment 15): hidden until "Filtros" is pressed, five
 * buttons (the routes take the five natures only). The parent holds the choice and sends it as `natureza=`.
 */
export function NatureSearchFilters({
  chosen,
  onChange,
}: {
  chosen: readonly Natureza[];
  onChange: (next: Natureza[]) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="nb-search">
      <button type="button" className="btn ghost sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {t("reviews.filters")}
      </button>
      {open && (
        <FilterRow
          label={t("reviews.filter.nature")}
          values={NATUREZAS}
          chosen={chosen}
          onChange={onChange}
          dense
        />
      )}
    </div>
  );
}

/** "Revisões": the screen's route, in both shells (`useBrainMode().go("reviews")`). */
export const REVIEWS_PATH = "/brain/reviews";

/** How many files fell due in the active context (`total` of `kind=due`), for "Revisões (N)"; 0 until known. */
export function useReviewsDue(): number {
  const work = useWorkContext();
  const query = { kind: "due" as const, limit: 1, ...(work.query ? { context: work.query } : {}) };
  const due = useRouteQuery(
    ["memory", "reviews", "count", query],
    "GET /api/memory/reviews",
    { query },
    {
      enabled: work.ready,
      staleTime: 30_000,
    },
  );
  return due.data?.total ?? 0;
}
