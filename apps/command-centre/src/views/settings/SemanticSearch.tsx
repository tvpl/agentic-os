/**
 * Settings › Memória › "Busca por significado" (.specs/features/cerebro-busca-significado, S7; design.md "Bloco"): the
 * second card of the tab, with, in order, the header and its on/off button, the three providers as one radio group,
 * the chosen provider's detail (the sentence, the own server's fields and its test, or the local models with the
 * reranker block), the index line while the search is on, and the help link. Every write is `PUT /api/settings`
 * (`memory.embeddings` or `memory.recall`, each replaced whole) or `POST /api/memory/embedder`.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Download,
  Lock,
  Plug,
  Trash2,
  X,
} from "lucide-react";
import type * as Contracts from "@mordomo/contracts";
import type { SettingsPatch } from "../../api";
import { apiCall } from "../../apiCall";
import { useT, type TKey } from "../../i18n";
import { qk, useRouteQuery } from "../../queries";
import { Button } from "../../components/primitives";
import { useConfirm } from "../../hooks/useConfirm";
import { useTweenNumber } from "../../desktop/useTweenNumber";
import { Modal } from "../../ui";
import { DraftField, type Put, type SaveResult } from "../SettingsFields";
import type { SettingsShape } from "./shared";
import "./semanticSearch.css";

type Embeddings = SettingsShape["memory"]["embeddings"];
type Provider = Embeddings["provider"];
type Recall = SettingsShape["memory"]["recall"];
const RECALL_DEFAULTS: Recall = {
  abstain: true,
  hops: 2,
  tokenBudget: 3000,
  rerank: { enabled: false, candidates: 20, timeoutMs: 15_000 },
};
type Catalog = Contracts.ApiCallResult<"GET /api/memory/embedder">;
export type Model = Catalog["models"][number];
type EmbedderId = NonNullable<NonNullable<Embeddings["local"]>["model"]>;

const PROVIDERS: Array<{ id: Provider; title: TKey; line: TKey }> = [
  { id: "hash", title: "semantic.hash", line: "semantic.hashHint" },
  { id: "http", title: "semantic.http", line: "semantic.httpHint" },
  { id: "local", title: "semantic.local", line: "semantic.localHint" },
];
/** The kinds of a failed test (`EmbeddingError` and `local_crashed`), each spelled in the user's language. */
const KINDS: Record<string, TKey> = {
  timeout: "semantic.kind.timeout",
  status: "semantic.kind.status",
  dimension: "semantic.kind.dimension",
  malformed: "semantic.kind.malformed",
  network: "semantic.kind.network",
  local_crashed: "semantic.kind.localCrashed",
};
/** The texts of the catalog's licenses, shown before a download (door 3's `license.url`; the GET carries the name). */
const LICENSE_URLS: Record<string, string> = {
  Gemma: "https://ai.google.dev/gemma/terms",
  "Apache-2.0": "https://www.apache.org/licenses/LICENSE-2.0",
};
/** design.md "Rodapé do bloco" (G41): the guide's section on the repository's site, opened outside. */
export const HELP_URL =
  "https://github.com/tvpl/agentic-os/blob/main/docs/memory-guide.md#busca-por-significado";
const RECOMMENDED = "embeddinggemma-300m-q4";

/** Megabytes as the screen shows them (G37): decimal, rounded; `down` for the bytes already written. */
const mb = (bytes: number, down = false) => (down ? Math.floor : Math.round)(bytes / 1_000_000);

export function SemanticSearch({ s, put }: { s: SettingsShape; put: Put }) {
  const t = useT();
  const confirm = useConfirm();
  const qc = useQueryClient();
  // The service answers every default; a partial document (an older service, a test) reads as those defaults.
  const emb: Embeddings = {
    enabled: false,
    provider: "hash",
    sendRemote: false,
    ...(s.memory?.embeddings as Partial<Embeddings> | undefined),
  };
  const recall: Recall = { ...RECALL_DEFAULTS, ...(s.memory?.recall as Partial<Recall> | undefined) };
  const status = useRouteQuery(qk.memoryStatus, "GET /api/memory/status");
  const catalog = useRouteQuery(qk.memoryEmbedder, "GET /api/memory/embedder", undefined, {
    // design.md "Enquanto baixa": the state is read again every second while a model downloads.
    refetchInterval: (q) => (q.state.data?.models.some((m) => m.state === "downloading") ? 1000 : false),
  });
  const [recalc, setRecalc] = useState<number | null>(null);
  const index = useMutation({ mutationFn: () => apiCall("POST /api/memory/index") });
  const semantic = status.data?.semantic;
  const sections = semantic?.sections ?? 0;
  const platformOk = catalog.data?.platform.ok !== false;

  // "Troca em andamento": after "Continuar", until a status read after the pass reads idle.
  useEffect(() => {
    if (recalc === null || index.isPending) return;
    if (status.dataUpdatedAt > recalc && status.data?.indexing.state === "idle") setRecalc(null);
  }, [recalc, index.isPending, status.dataUpdatedAt, status.data]);
  useEffect(() => {
    if (recalc === null) return;
    const id = window.setInterval(() => void status.refetch(), 1000);
    return () => window.clearInterval(id);
  }, [recalc, status]);

  /**
   * Save `memory.embeddings`; with a ready index (G42) and `recompute`, only after "Continuar" of "Recalcular o
   * índice?", and then a pass recomputes it. `null`: cancelled, nothing was sent.
   */
  const saveEmbeddings = async (next: Embeddings, recompute: boolean): Promise<SaveResult | null> => {
    const ready = recompute && emb.enabled && sections > 0;
    if (
      ready &&
      !(await confirm({
        title: t("semantic.recompute"),
        body: (
          <>
            <p>{t("semantic.recomputeBody", { n: sections })}</p>
            {next.provider === "http" && <p>{t("semantic.resend", { endpoint: next.endpoint ?? "" })}</p>}
          </>
        ),
        confirmLabel: t("semantic.continue"),
      }))
    )
      return null;
    const res = await put({ memory: { embeddings: next } } as SettingsPatch, true);
    // The catalog's `active` follows the settings (a model put in use can no longer be removed).
    if (res.ok) void qc.invalidateQueries({ queryKey: qk.memoryEmbedder });
    if (ready && res.ok) {
      setRecalc(Date.now());
      index.mutate(undefined, { onSettled: () => void status.refetch() });
    }
    return res;
  };
  const choose = (provider: Provider) => {
    if (provider === emb.provider || (provider === "local" && !platformOk)) return;
    void saveEmbeddings({ ...emb, provider }, true);
  };

  const radios = useRef<Array<HTMLDivElement | null>>([]);
  const onArrow = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const usable = PROVIDERS.filter((p) => p.id !== "local" || platformOk).map((p) => p.id);
    const at = usable.indexOf(emb.provider);
    const next = usable[(at + step + usable.length) % usable.length]!;
    radios.current[PROVIDERS.findIndex((p) => p.id === next)]?.focus();
    choose(next);
  };

  const modelName = (id: string | null | undefined) =>
    catalog.data?.models.find((m) => m.id === id)?.name ?? id ?? "";
  let indexLine: ReactNode = null;
  if (emb.enabled) {
    let text: string;
    if (emb.provider === "hash")
      // "N seções indexadas com o vetor simples": the table's "com {model}" gives way to "com o vetor simples".
      text = t("semantic.indexed", { n: sections }).replace(/ \S+ \{model\}$/, ` ${t("semantic.simple")}`);
    else
      text = t("semantic.indexed", {
        n: sections,
        model: emb.provider === "local" ? modelName(semantic?.model ?? emb.local?.model) : (emb.model ?? ""),
      });
    indexLine = (
      <div className="ss-row ss-s" role="status">
        {recalc !== null ? (
          <span>
            <span className="spinner sm" aria-hidden /> {t("semantic.recalculating")}
          </span>
        ) : (
          <span>{text}</span>
        )}
        {semantic?.error && (
          <span className="tone-warn">
            <AlertTriangle aria-hidden /> {semantic.error}
          </span>
        )}
      </div>
    );
  }

  return (
    <section className="card stack ss" aria-labelledby="ss-title">
      <div className="ss-top">
        <div className="ss-head">
          <h3 id="ss-title" className="ss-b">
            {t("semantic.title")}
          </h3>
          <span className={`ss-state ${emb.enabled ? "tone-ok" : "tone-muted"}`}>
            {emb.enabled ? <CircleCheck aria-hidden /> : <CircleDashed aria-hidden />}
            {t(emb.enabled ? "semantic.on" : "semantic.off")}
          </span>
          <Button
            variant={emb.enabled ? "outline" : "secondary"}
            aria-pressed={emb.enabled}
            aria-label={t("semantic.title")}
            onClick={() =>
              void put({ memory: { embeddings: { ...emb, enabled: !emb.enabled } } } as SettingsPatch, true)
            }
          >
            {t(emb.enabled ? "apps.settings.soundOn" : "apps.settings.soundOff")}
          </Button>
        </div>
        <span className="ss-s">{t("semantic.hint")}</span>
      </div>

      <div role="radiogroup" aria-labelledby="ss-title" className="ss-opts">
        {PROVIDERS.map((p, i) => {
          const checked = p.id === emb.provider;
          const off = p.id === "local" && !platformOk;
          return (
            <div
              key={p.id}
              ref={(el) => void (radios.current[i] = el)}
              role="radio"
              aria-checked={checked}
              aria-disabled={off || undefined}
              tabIndex={checked ? 0 : -1}
              className="ss-opt"
              onClick={() => choose(p.id)}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  choose(p.id);
                } else onArrow(e);
              }}
            >
              {off ? <Lock aria-hidden /> : checked ? <CircleDot aria-hidden /> : <Circle aria-hidden />}
              <span className="ss-col">
                <span className="ss-b">{t(p.title)}</span>
                <span className="ss-s">{t(p.line)}</span>
                {off && <span className="ss-s">{t("semantic.noRuntime")}</span>}
              </span>
              {checked && <span>{t("semantic.inUse")}</span>}
            </div>
          );
        })}
      </div>

      <div className="ss-detail" key={emb.provider}>
        {emb.provider === "hash" && <p>{t("semantic.hashHint")}</p>}
        {emb.provider === "http" && <OwnServer emb={emb} save={saveEmbeddings} />}
        {emb.provider === "local" && (
          <LocalModels
            catalog={catalog}
            emb={emb}
            onUse={(model) => saveEmbeddings({ ...emb, local: { ...emb.local, model } }, true)}
            rerank={recall.rerank.enabled}
            onRerank={() =>
              void put(
                {
                  memory: {
                    recall: { ...recall, rerank: { ...recall.rerank, enabled: !recall.rerank.enabled } },
                  },
                } as SettingsPatch,
                true,
              )
            }
            refresh={() => void qc.invalidateQueries({ queryKey: qk.memoryEmbedder })}
          />
        )}
      </div>

      {indexLine}

      <span className="ss-s">
        <a href={HELP_URL} target="_blank" rel="noopener noreferrer">
          {t("semantic.help")}
        </a>
      </span>
    </section>
  );
}

/** design.md "Servidor seu": the four fields, the remote checkbox and its warning, "Testar conexão" and its result. */
function OwnServer({
  emb,
  save,
}: {
  emb: Embeddings;
  save: (next: Embeddings, recompute: boolean) => Promise<SaveResult | null>;
}) {
  const t = useT();
  // A cancelled "Recalcular o índice?" puts the field back to the server's value.
  const [rev, setRev] = useState(0);
  const test = useMutation({
    mutationFn: () => apiCall("POST /api/memory/embedder", { body: { action: "test" } }),
  });
  // design.md "Confirmações": a new model, like new dimensions, recomputes the index; the address and the key do not.
  const field = (key: "endpoint" | "model" | "apiKeyEnv", label: TKey, mono: boolean) => (
    <DraftField
      id={`ss-${key}`}
      label={t(label)}
      className={mono ? "mono" : undefined}
      serverValue={emb[key] ?? ""}
      parse={(text) => ({ value: text.trim() })}
      save={(value) =>
        save({ ...emb, [key]: value || undefined }, key === "model").then((res) => res ?? { ok: true })
      }
    />
  );
  const result = test.data?.test;
  return (
    <div className="stack">
      {field("endpoint", "semantic.endpoint", true)}
      {field("model", "semantic.model", false)}
      <DraftField
        key={rev}
        id="ss-dimensions"
        label={t("semantic.dimensions")}
        type="number"
        serverValue={(emb.dimensions ?? "") as number | ""}
        format={String}
        parse={(text) =>
          text.trim() === ""
            ? { value: "" as const }
            : /^\d+$/.test(text.trim())
              ? { value: Number(text.trim()) }
              : { error: t("settings.invalidNonNegative") }
        }
        save={async (value) => {
          const res = await save({ ...emb, dimensions: value === "" ? undefined : value }, true);
          if (res) return res;
          setRev((r) => r + 1);
          return { ok: true };
        }}
      />
      {field("apiKeyEnv", "semantic.keyEnv", true)}
      <div className="ss-remote">
        <label className="ss-check">
          <input
            type="checkbox"
            checked={emb.sendRemote}
            onChange={(e) => void save({ ...emb, sendRemote: e.target.checked }, false)}
          />
          {t("semantic.sendRemote")}
        </label>
        <span className="ss-s tone-warn">
          <AlertTriangle aria-hidden /> {t("semantic.remoteWarn")}
        </span>
      </div>
      <div className="ss-test">
        <Button icon={<Plug aria-hidden />} onClick={() => test.mutate()} disabled={test.isPending}>
          {t("semantic.test")}
        </Button>
        <span role="status">
          {test.isPending ? (
            <>
              <span className="spinner sm" aria-hidden /> {t("semantic.testing")}
            </>
          ) : result?.ok ? (
            <span className="tone-ok">
              <CircleCheck aria-hidden />{" "}
              {t("semantic.testOk", { dim: result.dimensions ?? 0, ms: Math.round(result.ms ?? 0) })}
            </span>
          ) : result || test.error ? (
            <span className="tone-warn">
              <AlertTriangle aria-hidden />{" "}
              {t("semantic.failed", {
                kind: result
                  ? KINDS[result.kind ?? ""]
                    ? t(KINDS[result.kind!]!)
                    : (result.kind ?? "")
                  : test.error!.message,
              })}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

/** design.md "Modelo neste computador": the embedders, then the reranker block with its own row (G49). */
function LocalModels(p: {
  catalog: ReturnType<typeof useRouteQuery<"GET /api/memory/embedder">>;
  emb: Embeddings;
  onUse: (id: EmbedderId) => Promise<unknown>;
  rerank: boolean;
  onRerank: () => void;
  refresh: () => void;
}) {
  const t = useT();
  const confirm = useConfirm();
  const [terms, setTerms] = useState<Model | null>(null);
  const act = useMutation({
    mutationFn: (body: { action: "install" | "cancel" | "remove"; id: string; acceptTerms?: true }) =>
      apiCall("POST /api/memory/embedder", { body }),
    onSettled: p.refresh,
  });
  const { catalog } = p;
  if (catalog.isPending)
    return (
      <span className="ss-s">
        <span className="spinner sm" aria-hidden /> {t("semantic.loading")}
      </span>
    );
  if (catalog.isError || !catalog.data)
    return (
      <div className="ss-row" role="alert">
        <AlertTriangle aria-hidden />
        <span>{t("semantic.loadFailed")}</span>
        <Button size="sm" onClick={() => void catalog.refetch()}>
          {t("semantic.retry")}
        </Button>
      </div>
    );
  const { models, active } = catalog.data;
  const embedders = models.filter((m) => m.kind === "embedder");
  const rerankers = models.filter((m) => m.kind === "reranker");
  const install = (m: Model) => {
    if (m.license.acceptRequired) setTerms(m);
    else act.mutate({ action: "install", id: m.id });
  };
  const remove = async (m: Model) => {
    if (
      await confirm({
        title: t("semantic.removeTitle", { name: m.name }),
        body: t("semantic.removeBody", { mb: mb(m.bytes) }),
        danger: true,
        confirmLabel: t("semantic.remove"),
      })
    )
      act.mutate({ action: "remove", id: m.id });
  };
  const row = (m: Model) => (
    <ModelRow
      key={m.id}
      m={m}
      active={m.id === active}
      onInstall={() => install(m)}
      onCancel={() => act.mutate({ action: "cancel", id: m.id })}
      onRemove={() => void remove(m)}
      onUse={m.kind === "embedder" ? () => void p.onUse(m.id as EmbedderId) : undefined}
    />
  );
  return (
    <div className="stack">
      <span className="ss-b">{t("semantic.models")}</span>
      {!embedders.some((m) => m.state === "ready") && <span className="ss-s">{t("semantic.pick")}</span>}
      <ul className="ss-models">{embedders.map(row)}</ul>
      {act.error && (
        <span className="ss-s tone-warn" role="alert">
          <AlertTriangle aria-hidden /> {act.error.message}
        </span>
      )}
      <div className="stack">
        <span className="ss-b">{t("semantic.rerank")}</span>
        <div className="ss-row">
          <Button
            variant={p.rerank ? "outline" : "secondary"}
            aria-pressed={p.rerank}
            aria-label={t("semantic.rerank")}
            disabled={!rerankers.some((m) => m.state === "ready")}
            onClick={p.onRerank}
          >
            {t(p.rerank ? "apps.settings.soundOn" : "apps.settings.soundOff")}
          </Button>
          <span className="ss-s">{t("semantic.rerankHint")}</span>
        </div>
        <ul className="ss-models">{rerankers.map(row)}</ul>
      </div>
      {terms && (
        <Terms
          m={terms}
          onClose={() => setTerms(null)}
          onAccept={() => {
            act.mutate({ action: "install", id: terms.id, acceptTerms: true });
            setTerms(null);
          }}
        />
      )}
    </div>
  );
}

export function ModelRow(p: {
  m: Model;
  active: boolean;
  onInstall: () => void;
  onCancel: () => void;
  onRemove: () => void;
  onUse?: () => void;
}) {
  const t = useT();
  const { m } = p;
  const done = useTweenNumber(m.progress ? mb(m.progress.done, true) : 0, 300);
  const total = mb(m.progress?.total ?? m.bytes);
  const reason = m.reason?.startsWith("network: ")
    ? m.reason.slice("network: ".length)
    : t(m.reason === "checksum" ? "semantic.reason.checksum" : "semantic.reason.host");
  const state = {
    absent: [<CircleDashed key="i" aria-hidden />, t("semantic.absent"), ""],
    downloading: [
      <Download key="i" aria-hidden />,
      t("semantic.downloading", { done: Math.round(done), total }),
      "",
    ],
    ready: [<CircleCheck key="i" aria-hidden />, t("semantic.ready"), "tone-ok"],
    failed: [<AlertTriangle key="i" aria-hidden />, t("semantic.failed", { kind: reason }), "tone-warn"],
  }[m.state];
  const line2 = [
    t("semantic.mb", { mb: mb(m.bytes) }),
    m.dimensions ? t("semantic.dims", { dim: m.dimensions }) : null,
    t("semantic.license", { license: m.license.name }),
  ].filter(Boolean);
  const pct = m.progress && m.progress.total > 0 ? Math.round((m.progress.done / m.progress.total) * 100) : 0;
  return (
    <li className="ss-model" data-model={m.id}>
      <div className="ss-col">
        <span className="ss-row">
          <span className="ss-b">{t("semantic.name", { name: m.name })}</span>
          {m.id === RECOMMENDED && <span className="badge">{t("semantic.recommended")}</span>}
          <span className="ss-s">{t(m.kind === "embedder" ? "semantic.embedder" : "semantic.reranker")}</span>
        </span>
        <span className="ss-s">{line2.join(" · ")}</span>
        {m.state === "downloading" && (
          <span
            className="ss-bar"
            role="progressbar"
            aria-label={m.name}
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span className="ss-fill" style={{ transform: `scaleX(${pct / 100})` }} />
          </span>
        )}
      </div>
      <div className="ss-side">
        <span className={`ss-row ss-s ${state[2]}`}>
          {state[0]}
          {state[1]}
        </span>
        <span className="ss-row">
          {(m.state === "absent" || m.state === "failed") && (
            <Button variant="primary" size="sm" icon={<Download aria-hidden />} onClick={p.onInstall}>
              {t(m.state === "failed" ? "semantic.retry" : "semantic.install")}
            </Button>
          )}
          {m.state === "downloading" && (
            <Button size="sm" icon={<X aria-hidden />} onClick={p.onCancel}>
              {t("semantic.cancel")}
            </Button>
          )}
          {m.state === "ready" && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 aria-hidden />}
              disabled={p.active}
              title={p.active ? t("semantic.removeInUse") : undefined}
              onClick={p.onRemove}
            >
              {t("semantic.remove")}
            </Button>
          )}
          {m.state === "ready" && !p.active && p.onUse && (
            <Button size="sm" icon={<Check aria-hidden />} onClick={p.onUse}>
              {t("semantic.use")}
            </Button>
          )}
        </span>
      </div>
    </li>
  );
}

/** design.md "Diálogo - Licença do modelo". */
function Terms({ m, onClose, onAccept }: { m: Model; onClose: () => void; onAccept: () => void }) {
  const t = useT();
  const box = useRef<HTMLInputElement>(null);
  return (
    <Modal title={t("semantic.terms")} onClose={onClose} narrow initialFocus={() => box.current}>
      <TermsContent m={m} box={box} onCancel={onClose} onAccept={onAccept} />
    </Modal>
  );
}

/** The dialog's body and actions (the gallery draws them in place, without the Modal's portal and focus trap). */
export function TermsContent(p: {
  m: Model;
  box?: RefObject<HTMLInputElement>;
  onCancel: () => void;
  onAccept: () => void;
}) {
  const t = useT();
  const [accepted, setAccepted] = useState(false);
  return (
    <>
      <div className="modal-body stack">
        <a href={LICENSE_URLS[p.m.license.name]} target="_blank" rel="noopener noreferrer">
          {p.m.license.name}
        </a>
        <p>{t("semantic.termsBody")}</p>
        <label className="ss-check">
          <input
            ref={p.box}
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
          />
          {t("semantic.accept")}
        </label>
      </div>
      <div className="modal-actions">
        <Button variant="ghost" onClick={p.onCancel}>
          {t("semantic.cancel")}
        </Button>
        <Button variant="primary" icon={<Download aria-hidden />} disabled={!accepted} onClick={p.onAccept}>
          {t("semantic.install")}
        </Button>
      </div>
    </>
  );
}
