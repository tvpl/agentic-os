/**
 * "Entidades" (.specs/features/cerebro-entidades-resumos, S6 and the S8 card; design.md "Vista - Entidades"): the
 * people, projects, tags and terms the notes name (`GET /api/memory/entities`), by kind in four tabs with their counts,
 * searched by a word of the name, and one entity's panel (`GET /api/memory/entities/:key`, `?key=` in the route) with
 * its mentions, the entities it appears with, the names that may be the same and the owner's corrections
 * (`POST /api/memory/entities/corrections`), each with the 8 s notice and "Desfazer". Between the search and the list,
 * the card of the AI suggestions (`GET` and `POST /api/memory/entities/suggestions`, `memory.entities.llm.enabled`).
 * The same screen is the frame's page at `/brain/entities` and the Núcleo's brain panel there; a chunk of its own,
 * fetched the first time it is opened (AC 85).
 */
import { useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useInfiniteQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CircleCheck,
  FileText,
  Loader,
  Lock,
  Merge,
  MoreHorizontal,
  Search,
  Sparkles,
  Split,
  Users,
  X,
} from "lucide-react";
import type { ApiCallResult } from "@mordomo/contracts";
import { ApiError } from "../../api";
import { apiCall } from "../../apiCall";
import { useCommands, type Command } from "../../commands/registry";
import { Field } from "../../components/primitives";
import { AppRouteContext } from "../../desktop/appRoute";
import { useConfirm } from "../../hooks/useConfirm";
import { prefersReducedMotion } from "../../hooks/useViewTransition";
import { useT } from "../../i18n";
import { qk, useOsSettings, useRouteQuery } from "../../queries";
import { DropdownMenu, Tabs } from "../../ui";
import { useBrainMode } from "../BrainViewSwitch";
import { Fold } from "../notes/Fold";
import { termSpan } from "../notes/MentionsFold";
import { ENTITY_KINDS, KIND_ICON, entityLink, type EntityKind } from "./entityKinds";
import "../notes/notes.css";
import "./entities.css";

export type EntityDetail = ApiCallResult<"GET /api/memory/entities/:key">;
export type Suggestions = ApiCallResult<"GET /api/memory/entities/suggestions">;
export type Suggestion = Suggestions["items"][number];
type T = ReturnType<typeof useT>;
type Body = { action: string; key?: string; other?: string; name?: string; id?: number; suggestion?: string };

const PAGE = 50;
const FILES_PAGE = 20;
const NOTICE_MS = 8_000;
const LEAVE_MS = 150;
const SEARCH_MS = 300;
const POLL_MS = 2_000;
const OPEN_BATCH = new Set(["queued", "running", "waiting_approval"]);
const LIST_KEY = ["memory", "entities"] as const;

const pad = (n: number) => String(n).padStart(2, "0");
/** "24/11", the local day. */
const dayOf = (at: number) => {
  const d = new Date(at);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
};
/** "24/11, 10:00", the local day and hour. */
const whenOf = (at: number) => {
  const d = new Date(at);
  return `${dayOf(at)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const kindOfKey = (key: string) => key.slice(0, key.indexOf(":")) as EntityKind;
const providerName = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

/** `text` with `name` in weight 600 where it sits as a whole word (the mentions' rule), the rest as it is. */
function Excerpt({ text, name }: { text: string; name: string }) {
  const span = termSpan(text, name);
  if (!span) return <span className="ent-excerpt">{text}</span>;
  return (
    <span className="ent-excerpt">
      {text.slice(0, span[0])}
      <b>{text.slice(span[0], span[1])}</b>
      {text.slice(span[1])}
    </span>
  );
}

/** A sentence whose `code` spans are written between backticks in the locale. */
const withCode = (text: string) =>
  text.split("`").map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));

function KindChip({ kind }: { kind: EntityKind }) {
  const t = useT();
  const Icon = KIND_ICON[kind];
  return (
    <span className="ent-chip">
      <Icon aria-hidden size={14} />
      {t(`entities.kind.${kind}`)}
    </span>
  );
}

/** The route's own search: the panel's in the Núcleo, the router's in the frame. */
function useEntitiesSearch(): string {
  const panel = useContext(AppRouteContext);
  const location = useLocation();
  return panel?.search ?? location.search;
}

interface Notice {
  text: string;
  undo?: number;
}

export default function EntitiesView() {
  const t = useT();
  const qc = useQueryClient();
  const brain = useBrainMode();
  const settings = useOsSettings({ staleTime: 30_000 });
  const search = useEntitiesSearch();
  const openKey = new URLSearchParams(search).get("key");
  const [tab, setTab] = useState<EntityKind>(() =>
    openKey && ENTITY_KINDS.includes(kindOfKey(openKey)) ? kindOfKey(openKey) : "perfil",
  );
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => setQ(typed.trim()), SEARCH_MS);
    return () => window.clearTimeout(id);
  }, [typed]);

  const counts = useQueries({
    queries: ENTITY_KINDS.map((kind) => ({
      queryKey: [...LIST_KEY, "count", kind],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiCall("GET /api/memory/entities", { query: { kind, limit: 1 } }, { signal }),
      retry: false,
    })),
  });
  const list = useInfiniteQuery({
    queryKey: [...LIST_KEY, "list", tab, q],
    queryFn: ({ pageParam, signal }) =>
      apiCall(
        "GET /api/memory/entities",
        { query: { kind: tab, ...(q ? { q } : {}), limit: PAGE, offset: pageParam } },
        { signal },
      ),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const seen = pages.reduce((n, p) => n + p.items.length, 0);
      return seen < last.total ? seen : undefined;
    },
    retry: false,
  });
  const disabled = [list.error, ...counts.map((c) => c.error)].some(
    (e) => e instanceof ApiError && e.code === "entities_disabled",
  );

  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const rows = (list.data?.pages ?? []).flatMap((p) => p.items).filter((e) => !gone.has(e.key));

  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = (next: Notice | null) => {
    window.clearTimeout(timer.current);
    setNotice(next);
    if (next) timer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  };
  const refresh = () => qc.invalidateQueries({ queryKey: LIST_KEY });
  const open = (key: string | null) => brain.go("entities", key ? entityLink(key) : "");
  const undo = async (id: number) => {
    show(null);
    try {
      await apiCall("POST /api/memory/entities/corrections", { body: { action: "undo", id } });
    } finally {
      setGone(new Set());
      setLeaving(new Set());
      void refresh();
    }
  };
  /** One correction; answers the row written, or null when it was refused (the refusal is the caller's to show). */
  const correct = (body: Body) => apiCall("POST /api/memory/entities/corrections", { body: body as never });
  const done = (text: string, id: number) => {
    show({ text, undo: id });
    void refresh();
  };

  // j/k move in the list, Enter opens (design.md "Lista"); a bare key never acts inside a field.
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const live = useRef({ rows, at: -1 });
  live.current.rows = rows;
  useCommands(
    useMemo<Command[]>(() => {
      const move = (by: number) => {
        const l = live.current;
        if (l.rows.length === 0) return;
        l.at = Math.min(l.rows.length - 1, Math.max(0, l.at + by));
        rowButtons.current.get(l.rows[l.at]!.key)?.focus();
      };
      return [
        {
          id: "entities.next",
          title: "reviews.cmd.next",
          group: "view",
          scope: "view:entities",
          keys: ["j"],
          run: () => move(1),
        },
        {
          id: "entities.prev",
          title: "reviews.cmd.prev",
          group: "view",
          scope: "view:entities",
          keys: ["k"],
          run: () => move(-1),
        },
      ];
    }, []),
  );

  const anyEntity = counts.every((c) => c.data !== undefined) && counts.every((c) => c.data!.total === 0);
  const tabs = ENTITY_KINDS.map((kind, i) => ({
    id: kind,
    label: t(`entities.tab.${kind}`, { n: counts[i]!.data?.total ?? "…" }),
  }));

  const ignored = (key: string) => {
    if (prefersReducedMotion()) setGone((g) => new Set(g).add(key));
    else {
      setLeaving((g) => new Set(g).add(key));
      window.setTimeout(() => setGone((g) => new Set(g).add(key)), LEAVE_MS);
    }
    open(null);
  };

  const listBody = (): ReactNode => {
    if (list.isPending)
      return (
        <p className="ent-state" role="status">
          <span className="spinner sm" aria-hidden /> {t("entities.loading")}
        </p>
      );
    if (list.isError)
      return (
        <div className="ent-band" role="alert">
          <AlertTriangle aria-hidden />
          <span>{t("entities.failed")}</span>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              void list.refetch();
              for (const c of counts) if (c.isError) void c.refetch();
            }}
          >
            {t("entities.retry")}
          </button>
        </div>
      );
    if (anyEntity && !q)
      return (
        <div className="ent-empty">
          <p className="ent-line">
            <Users aria-hidden /> {t("entities.empty")}
          </p>
          <p className="ent-small">{withCode(t("entities.empty.why"))}</p>
        </div>
      );
    if (rows.length === 0)
      return (
        <p className="ent-state">
          {q
            ? t("entities.search.none", { q })
            : t("entities.tabEmpty", { kind: t(`entities.kind.${tab}`).toLowerCase() })}
        </p>
      );
    return (
      <>
        <ul className="ent-rows">
          {rows.map((e, i) => (
            <li key={e.key} className="ent-row" data-leaving={leaving.has(e.key) ? "" : undefined}>
              <button
                type="button"
                className="ent-pick"
                aria-current={e.key === openKey ? "true" : undefined}
                ref={(el) => void (el ? rowButtons.current.set(e.key, el) : rowButtons.current.delete(e.key))}
                onFocus={() => (live.current.at = i)}
                onClick={() => open(e.key)}
              >
                <span className="ent-row-top">
                  <span className="ent-name">{e.name}</span>
                  <span className="ent-count">
                    {e.files === 1 ? t("entities.files.one") : t("entities.files", { n: e.files })}
                  </span>
                </span>
                {e.aliases.length > 0 && (
                  <span className="ent-aliases">{e.aliases.slice(0, 3).join(" · ")}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {list.hasNextPage && (
          <button
            type="button"
            className="btn sm"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {t("entities.more")}
          </button>
        )}
      </>
    );
  };

  const entities = settings.data?.memory?.entities ?? { enabled: true, llm: { enabled: false } };
  const turnOn = async () => {
    await apiCall("PUT /api/settings", { body: { memory: { entities: { ...entities, enabled: true } } } });
    await qc.invalidateQueries({ queryKey: qk.settings });
    void refresh();
  };

  return (
    <div className="ent-view" data-open={openKey && !disabled ? "" : undefined}>
      <div className="ent-cols">
        <section className="ent-listcol">
          <header className="ent-head">
            <h1 className="ent-h1">{t("entities.title")}</h1>
            <p className="ent-small">{t("entities.lede")}</p>
          </header>
          {disabled ? (
            <div className="ent-off">
              <p className="ent-line">
                <Lock aria-hidden /> {t("entities.off")}
              </p>
              <button type="button" className="btn primary" onClick={() => void turnOn()}>
                {t("entities.turnOn")}
              </button>
            </div>
          ) : (
            <Tabs.Root
              value={tab}
              onChange={(id) => setTab(id as EntityKind)}
              ids={{ panel: () => "ent-list-panel" }}
            >
              <Tabs.List className="ent-tabs">
                {tabs.map((x) => (
                  <Tabs.Tab key={x.id} value={x.id}>
                    {x.label}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
              <div className="ent-search">
                <Search aria-hidden />
                <input
                  type="search"
                  className="input"
                  aria-label={t("entities.search")}
                  placeholder={t("entities.search")}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </div>
              <SuggestionsCard
                provider={providerName(settings.data?.defaultProvider ?? "claude")}
                llmOn={entities.llm.enabled}
                onToggle={async () => {
                  await apiCall("PUT /api/settings", {
                    body: {
                      memory: { entities: { ...entities, llm: { enabled: !entities.llm.enabled } } },
                    },
                  });
                  await qc.invalidateQueries({ queryKey: qk.settings });
                }}
                onCorrect={correct}
                onDone={done}
              />
              <Tabs.Panel className="ent-list">{listBody()}</Tabs.Panel>
            </Tabs.Root>
          )}
        </section>
        {!disabled && (
          <section className="ent-panelcol">
            {openKey ? (
              <EntityPanel
                key={openKey}
                entityKey={openKey}
                onOpen={open}
                onCorrect={correct}
                onDone={done}
                onIgnored={ignored}
              />
            ) : (
              <p className="ent-state ent-none">{t("entities.none")}</p>
            )}
          </section>
        )}
      </div>
      {notice && (
        <div className="ent-notice" role="status">
          <Check aria-hidden />
          <span>{notice.text}</span>
          {notice.undo !== undefined && (
            <button type="button" className="btn sm" onClick={() => void undo(notice.undo!)}>
              {t("entities.undo")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type Correct = (body: Body) => Promise<{ correction: { id: number } }>;

/** The sentence of a refused correction (design.md "Estados": conflict and limit), or the error's own message. */
function refusal(t: T, err: unknown, action: "merge" | "separate" | "other"): string {
  if (err instanceof ApiError && err.code === "too_many_corrections") return t("entities.limit");
  if (err instanceof ApiError && err.code === "correction_conflict" && action !== "other")
    return t(action === "merge" ? "entities.conflict.merge" : "entities.conflict.separate");
  return err instanceof Error ? err.message : String(err);
}

function EntityPanel({
  entityKey,
  onOpen,
  onCorrect,
  onDone,
  onIgnored,
}: {
  entityKey: string;
  onOpen: (key: string | null) => void;
  onCorrect: Correct;
  onDone: (text: string, id: number) => void;
  onIgnored: (key: string) => void;
}) {
  const t = useT();
  const brain = useBrainMode();
  const confirm = useConfirm();
  const nameId = useId();
  const detail = useRouteQuery(
    [...LIST_KEY, "one", entityKey],
    "GET /api/memory/entities/:key",
    { params: { key: entityKey } },
    { retry: false },
  );
  const [band, setBand] = useState<string | null>(null);
  const [separated, setSeparated] = useState<ReadonlySet<string>>(new Set());
  const [files, setFiles] = useState(FILES_PAGE);
  const [draft, setDraft] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const editing = draft !== null;
  useEffect(() => {
    if (editing) {
      field.current?.focus();
      field.current?.select();
    }
  }, [editing]);

  const back = (
    <button type="button" className="btn sm ent-back" onClick={() => onOpen(null)}>
      <ArrowLeft aria-hidden /> {t("entities.back")}
    </button>
  );
  if (detail.isPending)
    return (
      <div className="ent-panel">
        {back}
        <p className="ent-state" role="status">
          <span className="spinner sm" aria-hidden /> {t("entities.loading")}
        </p>
      </div>
    );
  if (detail.isError)
    return (
      <div className="ent-panel">
        {back}
        <div className="ent-band" role="alert">
          <AlertTriangle aria-hidden />
          <span>{t("entities.failed")}</span>
          <button type="button" className="btn sm" onClick={() => void detail.refetch()}>
            {t("entities.retry")}
          </button>
        </div>
      </div>
    );
  const e = detail.data;
  const run = async (action: "merge" | "separate" | "other", body: Body, text: string) => {
    setBand(null);
    try {
      const res = await onCorrect(body);
      onDone(text, res.correction.id);
      return res;
    } catch (err) {
      setBand(refusal(t, err, action));
      return null;
    }
  };
  const merge = async (dup: EntityDetail["duplicates"][number]) => {
    const ok = await confirm({
      title: t("entities.confirmMerge", { a: e.name, b: dup.name }),
      body: t("entities.confirmMerge.body"),
      confirmLabel: t("entities.merge"),
    });
    if (ok) await run("merge", { action: "merge", key: e.key, other: dup.key }, t("entities.notice.merged"));
  };
  const separate = async (dup: EntityDetail["duplicates"][number]) => {
    const res = await run(
      "separate",
      { action: "separate", key: e.key, other: dup.key },
      t("entities.notice.separated"),
    );
    if (res) setSeparated((s) => new Set(s).add(dup.key));
  };
  const ignore = async () => {
    const ok = await confirm({
      title: t("entities.confirmIgnore", { name: e.name }),
      body: t("entities.confirmIgnore.body"),
      confirmLabel: t("entities.remove"),
      danger: true,
    });
    if (!ok) return;
    const res = await run("other", { action: "ignore", key: e.key }, t("entities.notice.ignored"));
    if (res) onIgnored(e.key);
  };
  const rename = async (name: string) => {
    const res = (await run(
      "other",
      { action: "rename", key: e.key, name },
      t("entities.notice.renamed"),
    )) as { entity?: { key: string } } | null;
    if (!res) return;
    setDraft(null);
    if (res.entity && res.entity.key !== e.key) onOpen(res.entity.key);
  };

  const byFile = new Map<number, EntityDetail["mentions"]>();
  for (const m of e.mentions) byFile.set(m.fileId, [...(byFile.get(m.fileId) ?? []), m]);
  const groups = [...byFile.values()];
  const dups = e.duplicates.filter((d) => !separated.has(d.key));
  const shownCorrections = e.corrections.filter(
    (c) => c.undoneAt === null && ["merge", "separate", "ignore", "rename"].includes(c.action),
  );
  const goFile = (fileId: number) => brain.go("graph", `?sel=${fileId}`);

  return (
    <div className="ent-panel ent-panel-in">
      {back}
      {band && (
        <div className="ent-band" role="alert">
          <AlertTriangle aria-hidden />
          <span>{band}</span>
        </div>
      )}
      <header className="ent-phead">
        <div className="ent-phead-row">
          {draft === null ? (
            <h2 className="ent-pname" id={nameId}>
              {e.name}
            </h2>
          ) : (
            <form
              className="ent-rename"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (draft.trim()) void rename(draft.trim());
              }}
            >
              <Field label={t("entities.rename")} htmlFor={`${nameId}-field`}>
                <input
                  id={`${nameId}-field`}
                  className="input"
                  ref={field}
                  value={draft}
                  maxLength={80}
                  onChange={(ev) => setDraft(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Escape") {
                      ev.preventDefault();
                      ev.stopPropagation();
                      setDraft(null);
                    }
                  }}
                />
              </Field>
              <button type="submit" className="btn sm primary">
                {t("entities.save")}
              </button>
              <button type="button" className="btn sm" onClick={() => setDraft(null)}>
                {t("entities.cancel")}
              </button>
            </form>
          )}
          <KindChip kind={e.kind} />
          <DropdownMenu
            align="end"
            items={[
              { id: "rename", label: t("entities.rename"), onSelect: () => setDraft(e.name) },
              { id: "ignore", label: t("entities.ignore"), onSelect: () => void ignore() },
            ]}
            trigger={
              <button type="button" className="btn sm ent-menu" aria-label={t("notes.reader.more")}>
                <MoreHorizontal aria-hidden />
              </button>
            }
          />
        </div>
        {e.aliases.length > 0 && (
          <p className="ent-small">{t("entities.aliases", { aliases: e.aliases.join(" · ") })}</p>
        )}
        {e.home && (
          <button type="button" className="btn sm ent-home" onClick={() => goFile(e.home!.fileId)}>
            <FileText aria-hidden /> {t("entities.openNote")}
          </button>
        )}
      </header>

      <section className="ent-sec ent-mentions">
        <h3 className="ent-h3">{t("entities.mentions", { n: e.mentions.length })}</h3>
        <ul className="ent-files">
          {groups.slice(0, files).map((ms) => (
            <li key={ms[0]!.fileId}>
              <button type="button" className="ent-link" onClick={() => goFile(ms[0]!.fileId)}>
                {baseName(ms[0]!.path)}
              </button>
              {ms.map((m) => (
                <p key={`${m.line}:${m.name}`} className="ent-mline">
                  {t("entities.line", { line: m.line })} · <Excerpt text={m.excerpt} name={m.name} />
                </p>
              ))}
            </li>
          ))}
        </ul>
        {groups.length > files && (
          <button type="button" className="btn sm" onClick={() => setFiles((n) => n + FILES_PAGE)}>
            {t("entities.more")}
          </button>
        )}
      </section>

      <section className="ent-sec ent-related">
        <h3 className="ent-h3">{t("entities.related")}</h3>
        <div className="ent-chips">
          {e.related.slice(0, 10).map((r) => (
            <button key={r.key} type="button" className="btn sm" onClick={() => onOpen(r.key)}>
              {r.name} <span className="ent-shared">{r.shared}</span>
            </button>
          ))}
        </div>
      </section>

      {dups.length > 0 && (
        <section className="ent-sec ent-dups">
          <h3 className="ent-h3">{t("entities.duplicates")}</h3>
          <ul className="ent-duprows">
            {dups.map((d) => (
              <li key={d.key} className="ent-dup">
                <span className="ent-name">{d.name}</span>
                <span className="ent-count">
                  {t("entities.similar", { pct: Math.round(d.similarity * 100) })}
                </span>
                <button type="button" className="btn sm" onClick={() => void merge(d)}>
                  <Merge aria-hidden /> {t("entities.merge")}
                </button>
                <button type="button" className="btn sm" onClick={() => void separate(d)}>
                  <Split aria-hidden /> {t("entities.separate")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {shownCorrections.length > 0 && (
        <div className="ent-sec ent-corrections">
          <Fold title={t("entities.corrections", { n: shownCorrections.length })} shut>
            <ul className="ent-corrows">
              {shownCorrections.map((c) => (
                <li key={c.id}>
                  <CorrectionText c={c} e={e} />
                  <button
                    type="button"
                    className="ent-link"
                    onClick={() =>
                      void onCorrect({ action: "undo", id: c.id }).then(
                        () => void detail.refetch(),
                        (err: unknown) => setBand(refusal(t, err, "other")),
                      )
                    }
                  >
                    {t("entities.undo")}
                  </button>
                </li>
              ))}
            </ul>
          </Fold>
        </div>
      )}
    </div>
  );
}

const normOfKey = (key: string) => key.slice(key.indexOf(":") + 1);
/** The normalized name (door 2) as far as the screen needs it: to find a name the correction stores by its norm. */
const normOfName = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** The name an entity's detail shows for `norm` (Landing 11a): its own, an alias, or a related or maybe-same entity's. */
function nameInDetail(e: EntityDetail, norm: string): string | undefined {
  if (normOfKey(e.key) === norm) return e.name;
  return (
    e.aliases.find((a) => normOfName(a) === norm) ??
    [...e.related, ...e.duplicates].find((r) => normOfKey(r.key) === norm)?.name
  );
}

/** One row of "Correções": the other side by the name the audience sees it with, never by the norm the correction stores. */
function CorrectionText({ c, e }: { c: EntityDetail["corrections"][number]; e: EntityDetail }) {
  const t = useT();
  const day = dayOf(c.createdAt);
  const norm = c.names.find((n) => n !== normOfKey(e.key)) ?? "";
  const local = c.action === "merge" || c.action === "separate" ? nameInDetail(e, norm) : undefined;
  const found = useRouteQuery(
    [...LIST_KEY, "named", norm],
    "GET /api/memory/entities",
    { query: { q: norm, limit: 10 } },
    {
      enabled: (c.action === "merge" || c.action === "separate") && norm !== "" && local === undefined,
      retry: false,
    },
  );
  const shown =
    local ??
    found.data?.items.find((i) => normOfKey(i.key) === norm || i.aliases.some((a) => normOfName(a) === norm))
      ?.name ??
    "";
  // With no name to give, the row leaves out the table's own "com <nome>" (cut at the placeholder, in either language).
  const named = (key: "entities.correction.merge" | "entities.correction.separate") =>
    shown === "" ? t(key, { name: "\0", day }).replace(/ \S+ \0/, "") : t(key, { name: shown, day });
  if (c.action === "merge") return <span>{named("entities.correction.merge")}</span>;
  if (c.action === "separate") return <span>{named("entities.correction.separate")}</span>;
  if (c.action === "rename")
    return <span>{t("entities.correction.rename", { name: c.name ?? "", day })}</span>;
  return <span>{t("entities.correction.ignore", { day })}</span>;
}

/** "Juntar com <nome>": the entity's name as the list answers it, its norm until then. */
function MergeTarget({ entityKey }: { entityKey: string }) {
  const t = useT();
  const one = useRouteQuery(
    [...LIST_KEY, "one", entityKey],
    "GET /api/memory/entities/:key",
    { params: { key: entityKey } },
    { retry: false },
  );
  return (
    <span className="ent-line">
      {t("entities.ai.mergeWith", { name: one.data?.name ?? entityKey.slice(entityKey.indexOf(":") + 1) })}
      <KindChip kind={kindOfKey(entityKey)} />
    </span>
  );
}

function SuggestionsCard({
  provider,
  llmOn,
  onToggle,
  onCorrect,
  onDone,
}: {
  provider: string;
  llmOn: boolean;
  onToggle: () => Promise<void>;
  onCorrect: Correct;
  onDone: (text: string, id: number) => void;
}) {
  const t = useT();
  const brain = useBrainMode();
  const qc = useQueryClient();
  const titleId = useId();
  const [nothing, setNothing] = useState(false);
  const [band, setBand] = useState<string | null>(null);
  const sugg = useRouteQuery(
    [...LIST_KEY, "suggestions"],
    "GET /api/memory/entities/suggestions",
    undefined,
    {
      retry: false,
      refetchInterval: (query) =>
        query.state.data?.lastBatch && OPEN_BATCH.has(query.state.data.lastBatch.status) ? POLL_MS : false,
    },
  );
  const last = sugg.data?.lastBatch;
  const reading = !!last && OPEN_BATCH.has(last.status);
  const run = useRouteQuery(
    ["runs", last?.id ?? null],
    "GET /api/runs/:id",
    { params: { id: last?.id ?? "" } },
    { enabled: reading, retry: false },
  );
  const request = run.data?.run.request;
  const files =
    request && request.kind === "skill" && typeof request.inputs.files === "string"
      ? request.inputs.files.split("\n").filter(Boolean).length
      : null;
  const items = sugg.data?.items ?? [];

  const ask = async () => {
    setNothing(false);
    setBand(null);
    try {
      await apiCall("POST /api/memory/entities/suggestions");
    } catch (err) {
      if (err instanceof ApiError && err.code === "nothing_to_read") setNothing(true);
      else setBand(err instanceof Error ? err.message : String(err));
      return;
    }
    await qc.invalidateQueries({ queryKey: [...LIST_KEY, "suggestions"] });
  };
  const decide = async (s: Suggestion, action: "accept" | "reject") => {
    setBand(null);
    try {
      const res = await onCorrect({ action, suggestion: s.id });
      onDone(t(action === "accept" ? "entities.ai.accepted" : "entities.ai.rejected"), res.correction.id);
    } catch (err) {
      setBand(refusal(t, err, "other"));
    }
  };

  const state = (): ReactNode => {
    if (nothing) return <span>{t("entities.ai.nothing")}</span>;
    if (!last) return <span>{t("entities.ai.none")}</span>;
    if (reading)
      return (
        <>
          <Loader aria-hidden />
          <span>{t("entities.ai.reading", { n: files ?? "…" })}</span>
          <button
            type="button"
            className="btn sm"
            onClick={() =>
              void apiCall("POST /api/runs/:id/cancel", { params: { id: last.id } }).then(() =>
                qc.invalidateQueries({ queryKey: [...LIST_KEY, "suggestions"] }),
              )
            }
          >
            {t("entities.cancel")}
          </button>
        </>
      );
    if (last.reason)
      return (
        <>
          <AlertTriangle aria-hidden />
          <span>{t("entities.ai.refused", { reason: last.reason })}</span>
        </>
      );
    return (
      <>
        <CircleCheck aria-hidden />
        <span>
          {t("entities.ai.last", { day: dayOf(last.finishedAt ?? last.startedAt), n: items.length })}
        </span>
      </>
    );
  };

  return (
    <section className="card ent-ai" aria-labelledby={titleId}>
      <div className="ent-ai-top">
        <h2 className="ent-ai-title" id={titleId}>
          {t("entities.ai.title")}
        </h2>
        <button
          type="button"
          className="btn sm"
          aria-pressed={llmOn}
          aria-label={t("entities.ai.title")}
          onClick={() => void onToggle()}
        >
          {t(llmOn ? "apps.settings.soundOn" : "apps.settings.soundOff")}
        </button>
      </div>
      <p className="ent-small">{t("entities.ai.lede", { provider })}</p>
      <div className="ent-ai-state">
        <p className="ent-small ent-line">{state()}</p>
        <button type="button" className="btn sm" disabled={reading} onClick={() => void ask()}>
          <Sparkles aria-hidden /> {t("entities.ai.ask")}
        </button>
      </div>
      {llmOn && sugg.data?.nextBatchAt !== undefined && (
        <p className="ent-small">{t("entities.ai.next", { when: whenOf(sugg.data.nextBatchAt) })}</p>
      )}
      {band && (
        <div className="ent-band" role="alert">
          <AlertTriangle aria-hidden />
          <span>{band}</span>
        </div>
      )}
      {items.length > 0 ? (
        <Fold title={t("entities.ai.items", { n: items.length })}>
          <ul className="ent-suggs">
            {items.map((s) => (
              <li key={s.id} className="ent-sugg">
                <div className="ent-sugg-main">
                  <p className="ent-line">
                    <KindChip kind={s.kind} />
                    <span className="ent-sname">{s.name}</span>
                  </p>
                  {s.mergeWith ? (
                    <MergeTarget entityKey={s.mergeWith} />
                  ) : (
                    s.aliases.length > 0 && (
                      <p className="ent-small">{t("entities.ai.also", { aliases: s.aliases.join(" · ") })}</p>
                    )
                  )}
                  {s.evidence.map((ev) => (
                    <p key={`${ev.fileId}:${ev.line}`} className="ent-mline">
                      <button
                        type="button"
                        className="ent-link"
                        onClick={() => brain.go("graph", `?sel=${ev.fileId}`)}
                      >
                        {baseName(ev.path)}
                      </button>{" "}
                      · {t("entities.line", { line: ev.line })} · <Excerpt text={ev.excerpt} name={s.name} />
                    </p>
                  ))}
                </div>
                <div className="ent-sugg-acts">
                  <button type="button" className="btn sm primary" onClick={() => void decide(s, "accept")}>
                    <Check aria-hidden /> {t("entities.ai.accept")}
                  </button>
                  <button type="button" className="btn sm" onClick={() => void decide(s, "reject")}>
                    <X aria-hidden /> {t("entities.ai.reject")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Fold>
      ) : (
        last && !reading && !last.reason && <p className="ent-small">{t("entities.ai.nothingNew")}</p>
      )}
    </section>
  );
}
