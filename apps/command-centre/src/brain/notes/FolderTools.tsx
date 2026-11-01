/**
 * The tools of a folder (.specs/features/cerebro-memoria-confiavel, design.md "Diálogo - Permissões da pasta" and
 * "Diálogos - Exportar pasta e Importar pasta"): the 480px `Modal`s "Permissões de <pasta>" (AC 103), "Exportar pasta"
 * (AC 113) and "Importar pasta" (AC 114), and the block "Pastas com acesso restrito" of Settings › Memória (AC 105).
 * One chunk, fetched the first time one of them is drawn (C147).
 */
import { useState } from "react";
import { CircleCheck, CornerLeftUp } from "lucide-react";
import { ApiError } from "../../api";
import { apiCall } from "../../apiCall";
import { useT } from "../../i18n";
import { qk, useInvalidate, useOsSettings } from "../../queries";
import { Modal } from "../../ui";
import { errorMessage } from "../../views/shared";
import { LEVEL, type Access, type Level } from "../memoria";
import "./folderTools.css";

type T = ReturnType<typeof useT>;
type Entry = Access & { path: string };
const AUDIENCES = ["agents", "devices"] as const;
const LEVELS: Level[] = ["write", "read", "hide"];
const HINT = {
  agents: {
    write: "access.agents.write.hint",
    read: "access.agents.read.hint",
    hide: "access.agents.hide.hint",
  },
  devices: {
    write: "access.devices.write.hint",
    read: "access.devices.read.hint",
    hide: "access.devices.hide.hint",
  },
} as const;
const base = (p: string) => p.slice(p.replace(/\/+$/, "").lastIndexOf("/") + 1).replace(/\/+$/, "");

export type FolderToolProps =
  | { kind: "access" | "export"; path: string; name: string; onClose: () => void }
  | { kind: "import"; onClose: () => void; onImported: (folder: string) => void }
  | { kind: "restricted" };

export default function FolderTool(p: FolderToolProps) {
  if (p.kind === "access") return <AccessModal {...p} />;
  if (p.kind === "export") return <ExportModal {...p} />;
  if (p.kind === "import") return <ImportModal {...p} />;
  return <Restricted />;
}

/** The list as it is saved, and the call that saves another: the whole array, every other entry kept (L-042). */
function useList() {
  const invalidate = useInvalidate();
  const list: Entry[] = useOsSettings().data?.folderAccess ?? [];
  const save = async (next: Entry[]) => {
    await apiCall("PUT /api/settings", { body: { folderAccess: next } });
    await invalidate(qk.settings, ["memory", "tree"]);
  };
  return { list, save };
}

function AccessModal({ path, name, onClose }: { path: string; name: string; onClose: () => void }) {
  const t = useT();
  const { list, save } = useList();
  const own = list.find((e) => e.path === path);
  // The nearest entry above the folder decides when it has none of its own.
  const above = own
    ? undefined
    : list
        .filter((e) => path.startsWith(`${e.path.replace(/\/+$/, "")}/`))
        .sort((a, b) => b.path.length - a.path.length)[0];
  const [levels, setLevels] = useState<Access>(() => {
    const from = own ?? above;
    return { agents: from?.agents ?? "write", devices: from?.devices ?? "write" };
  });
  const [error, setError] = useState<string | null>(null);
  const run = (next: Entry[]) => save(next).then(onClose, (err: unknown) => setError(errorMessage(err)));
  const others = list.filter((e) => e !== own);
  return (
    <Modal title={t("access.title", { name })} onClose={onClose} className="ft-modal">
      <p className="mono ft-path">{path}</p>
      {AUDIENCES.map((aud) => (
        <div key={aud} className="field">
          <label htmlFor={`ft-${aud}`}>{t(aud === "agents" ? "access.agents" : "access.devices")}</label>
          <select
            id={`ft-${aud}`}
            className="input"
            value={levels[aud]}
            aria-describedby={`ft-${aud}-hint`}
            onChange={(e) => setLevels({ ...levels, [aud]: e.target.value as Level })}
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {t(LEVEL[aud][l])}
              </option>
            ))}
          </select>
          <span className="ft-hint" id={`ft-${aud}-hint`}>
            {t(HINT[aud][levels[aud]])}
          </span>
        </div>
      ))}
      {above && (
        // A short label (12px, design.md), not a sentence like the hints above.
        <div className="ft-inherited">
          <CornerLeftUp aria-hidden /> {t("access.inherited", { folder: base(above.path) })}
        </div>
      )}
      {error && (
        <p className="ft-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          {t("common.cancel")}
        </button>
        {own && (
          <button type="button" className="btn ghost" onClick={() => void run(others)}>
            {t("access.remove")}
          </button>
        )}
        <button
          type="button"
          className="btn primary"
          onClick={() =>
            void run(
              own ? list.map((e) => (e === own ? { path, ...levels } : e)) : [...list, { path, ...levels }],
            )
          }
        >
          {t("common.save")}
        </button>
      </div>
    </Modal>
  );
}

const size = (n: number) =>
  n < 1024 ? `${n} B` : n < 1 << 20 ? `${Math.round(n / 1024)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`;

/** A request's state in a dialog: running, its answer, or the message of its refusal. */
function useAsk<R>(message: (err: unknown) => string) {
  const [state, setState] = useState<{ busy?: boolean; done?: R; error?: string }>({});
  const ask = (call: () => Promise<R>) => {
    setState({ busy: true });
    call().then(
      (done) => setState({ done }),
      (err: unknown) => setState({ error: message(err) }),
    );
  };
  return [state, ask] as const;
}
const coded = (t: T, codes: Record<string, string>) => (err: unknown) =>
  (err instanceof ApiError && codes[err.code ?? ""]) || errorMessage(err, t);

function ExportModal({ path, name, onClose }: { path: string; name: string; onClose: () => void }) {
  const t = useT();
  const [state, ask] = useAsk<{ path: string; files: number; bytes: number }>(
    coded(t, { folder_too_large: t("export.tooLarge") }),
  );
  const done = state.done;
  return (
    <Modal title={`${t("export.run")} ${name}`} onClose={onClose} className="ft-modal">
      {done ? (
        <p className="ft-done">
          <CircleCheck aria-hidden /> {t("export.done", { n: done.files, size: size(done.bytes) })}{" "}
          <span className="mono">{done.path}</span>
        </p>
      ) : (
        <p>{t("export.intro")}</p>
      )}
      {state.busy && (
        <p role="status">
          <span className="spinner sm" aria-hidden /> {t("export.copying")}
        </p>
      )}
      {state.error && (
        <p className="ft-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="modal-actions">
        {done ? (
          <>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void apiCall("POST /api/memory/open", { body: { p: done.path } }).catch(() => undefined)
              }
            >
              {t("export.open")}
            </button>
            <button type="button" className="btn ghost" onClick={onClose}>
              {t("common.close")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={state.busy}
            onClick={() => ask(() => apiCall("POST /api/memory/export", { body: { folder: path } }))}
          >
            {t("export.run")}
          </button>
        )}
      </div>
    </Modal>
  );
}

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: (folder: string) => void }) {
  const t = useT();
  const invalidate = useInvalidate();
  const [source, setSource] = useState("");
  const [name, setName] = useState<string | null>(null);
  const folder = name ?? base(source.trim());
  const [state, ask] = useAsk<{ folder: string; files: number; skipped: string[] }>(
    coded(t, { exists: t("import.exists"), forbidden_path: t("import.forbidden") }),
  );
  const done = state.done;
  const run = () =>
    ask(async () => {
      const r = await apiCall("POST /api/memory/import", { body: { sourceDir: source.trim(), folder } });
      await invalidate(["memory", "tree"]);
      onImported(r.folder);
      return r;
    });
  return (
    <Modal title={t("import.menu").replace("…", "")} onClose={onClose} className="ft-modal">
      <div className="field">
        <label htmlFor="ft-source">{t("import.source")}</label>
        <input
          id="ft-source"
          className="input mono"
          value={source}
          aria-describedby="ft-source-hint"
          onChange={(e) => setSource(e.target.value)}
        />
        <span className="ft-hint" id="ft-source-hint">
          {t("import.sourceHint")}
        </span>
      </div>
      <div className="field">
        <label htmlFor="ft-name">{t("import.name")}</label>
        <input id="ft-name" className="input" value={folder} onChange={(e) => setName(e.target.value)} />
      </div>
      {done && (
        <div role="status">
          <p className="ft-done">
            <CircleCheck aria-hidden /> {t("import.done", { n: done.files })}
          </p>
          {done.skipped.length > 0 && (
            <>
              <p>{t("import.skipped", { m: done.skipped.length })}</p>
              <ul className="mono">
                {done.skipped.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {state.error && (
        <p className="ft-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="modal-actions">
        {done ? (
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("common.close")}
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={state.busy || !source.trim() || !folder}
            onClick={run}
          >
            {t("import.run")}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Settings › Memória, after the indexed folders: one row per entry, or "Nenhuma pasta restrita." (AC 105). */
function Restricted() {
  const t = useT();
  const { list, save } = useList();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="field">
      <span className="label">{t("access.restricted")}</span>
      {list.length === 0 && <p className="widget-muted">{t("access.none")}</p>}
      {list.map((e) => (
        <div key={e.path} className="folder-row">
          <span className="mono truncate">{e.path}</span>
          <span>{`${t("access.agents")}: ${t(LEVEL.agents[e.agents])}`}</span>
          <span>{`${t("access.devices")}: ${t(LEVEL.devices[e.devices])}`}</span>
          <button type="button" className="btn sm" onClick={() => setOpen(e.path)}>
            {t("access.menu")}
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => void save(list.filter((x) => x !== e)).catch(() => undefined)}
          >
            {t("access.remove")}
          </button>
        </div>
      ))}
      {open && <AccessModal path={open} name={base(open)} onClose={() => setOpen(null)} />}
    </div>
  );
}
