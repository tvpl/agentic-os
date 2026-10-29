/**
 * "New context…" (.specs/features/cerebro-contextos/design.md, "Tela - Novo contexto"), and the same dialog filled in
 * for "Edit" (the id never changes). A name, then the folders: picked from the indexed folders and the subfolders the
 * index knows (two levels, found by name), or typed. The first folder is the primary one. A typed folder outside the
 * indexed folders says so, and "Index and create" adds it to the indexed folders, runs an index pass and then creates
 * the context (AC 35). The route's refusal is shown in the dialog, which stays open.
 */
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FolderPlus, MoreHorizontal, Plus, X } from "lucide-react";
import { api, type SystemInfo } from "../api";
import { apiCall } from "../apiCall";
import { useT } from "../i18n";
import { qk, useApiQuery, useOsSettings } from "../queries";
import { Button } from "../components/primitives";
import { DropdownMenu, Modal, Popover, Tooltip } from "../ui";
import { errorMessage, isAbsolutePath } from "../views/shared";
import { useWorkContext, type WorkContextView } from "./useWorkContext";

/** The whole index's graph (the Second Brain's cache when no context is active): its folders are what the index knows. */
const GRAPH_PARAMS = { maxNodes: 3000 };
const GRAPH_PATH = "/api/memory/graph?maxNodes=3000";
const NAME_MAX = 60;

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/[\\/]+$/, "") : p);
const sepOf = (p: string) => (p.includes("\\") && !p.includes("/") ? "\\" : "/");
const within = (folder: string, p: string) => p === folder || p.startsWith(folder + sepOf(folder));

/** The indexed folders and, under each, the folders the index holds files in, down to two levels. */
export function folderChoices(roots: readonly string[], dirs: readonly string[]): string[] {
  const out = new Set<string>();
  for (const root of roots) {
    out.add(root);
    const sep = sepOf(root);
    for (const dir of dirs) {
      if (!dir.startsWith(root + sep)) continue;
      const parts = dir
        .slice(root.length + 1)
        .split(sep)
        .filter(Boolean);
      if (parts[0]) out.add(root + sep + parts[0]);
      if (parts[1]) out.add(root + sep + parts[0] + sep + parts[1]);
    }
  }
  return [...out];
}

export function NewContextDialog({ onClose, editing }: { onClose: () => void; editing?: WorkContextView }) {
  const t = useT();
  const qc = useQueryClient();
  const work = useWorkContext();
  const settings = useOsSettings();
  const graph = useApiQuery<{ nodes: Array<{ dir: string }> }>(qk.memoryGraph(GRAPH_PARAMS), GRAPH_PATH, {
    staleTime: 60_000,
  });
  const info = useApiQuery<SystemInfo>(["system", "info"], "/api/system/info", { staleTime: 60_000 });
  const [name, setName] = useState(editing?.name ?? "");
  const [folders, setFolders] = useState<string[]>(editing?.paths.map((p) => p.path) ?? []);
  const [typed, setTyped] = useState("");
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const typedRef = useRef<HTMLInputElement>(null);

  const roots = useMemo(
    () => (settings.data?.indexedFolders ?? []).filter((f) => f.enabled).map((f) => trimSlash(f.path)),
    [settings.data],
  );
  const choices = useMemo(
    () => folderChoices(roots, [...new Set((graph.data?.nodes ?? []).map((n) => n.dir))]),
    [roots, graph.data],
  );
  const memoryDir = info.data ? `${trimSlash(info.data.home)}${sepOf(info.data.home)}memory` : null;
  const indexed = (p: string) =>
    roots.some((root) => within(root, p)) || (memoryDir !== null && within(memoryDir, p));
  const outside = folders.filter((p) => !indexed(p));
  const indexFirst = !editing && outside.length > 0;
  const shown = choices.filter(
    (c) => !folders.includes(c) && c.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const add = (p: string) => {
    const path = trimSlash(p.trim());
    if (!path || folders.includes(path)) return;
    setFolders((list) => [...list, path]);
    setError(null);
  };
  const addTyped = () => {
    if (!isAbsolutePath(typed)) return;
    add(typed);
    setTyped("");
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await apiCall("PATCH /api/contexts/:id", {
          params: { id: editing.id },
          body: { name: name.trim(), paths: folders },
        });
        await qc.invalidateQueries({ queryKey: qk.contexts });
      } else {
        if (indexFirst) {
          // AC 35, in this order: the folders join the indexed ones, an index pass runs, then the context is made.
          await api.putSettings({
            indexedFolders: [
              ...(settings.data?.indexedFolders ?? []),
              ...outside.map((path) => ({ path, area: null, enabled: true })),
            ],
          });
          await apiCall("POST /api/memory/index");
          void qc.invalidateQueries({ queryKey: qk.settings });
        }
        const made = await apiCall("POST /api/contexts", { body: { name: name.trim(), paths: folders } });
        // The list holds the new context before it is made active, so it is never judged gone.
        qc.setQueryData(qk.contexts, (old: { contexts: WorkContextView[] } | undefined) => ({
          contexts: [...(old?.contexts ?? []).filter((c) => c.id !== made.id), made],
        }));
        await work.choose(made.id);
        void qc.invalidateQueries({ queryKey: qk.contexts });
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const ready = name.trim().length > 0 && folders.length > 0;
  return (
    <Modal
      title={editing ? t("context.editTitle") : t("context.new").replace(/…$/, "")}
      onClose={onClose}
      className="ctx-dialog"
    >
      <form
        className="ctx-form"
        onSubmit={(e) => {
          e.preventDefault();
          // Enter in the typed path adds it; anywhere else it is the footer's action.
          if (typed.trim() && document.activeElement === typedRef.current) addTyped();
          else if (ready && !busy) void submit();
        }}
      >
        <label className="field" htmlFor="ctx-name">
          <span className="label">{t("context.name")}</span>
          <input
            id="ctx-name"
            className="input"
            value={name}
            maxLength={NAME_MAX}
            required
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
        </label>
        <div className="field">
          <span className="label" id="ctx-folders-l">
            {t("context.folders")}
          </span>
          <ul className="ctx-folders" aria-labelledby="ctx-folders-l">
            {folders.map((p, i) => (
              <li key={p} className="ctx-folder">
                <div className="ctx-folder-row">
                  <span className="ctx-folder-path mono">{p}</span>
                  {i === 0 ? (
                    <span className="badge ctx-primary">{t("context.primary")}</span>
                  ) : (
                    <DropdownMenu
                      trigger={
                        <button
                          type="button"
                          className="btn sm ghost"
                          aria-label={t("context.more", { path: p })}
                        >
                          <MoreHorizontal aria-hidden />
                        </button>
                      }
                      tip={t("context.more", { path: p })}
                      items={[
                        {
                          id: "primary",
                          label: t("context.makePrimary"),
                          onSelect: () => setFolders((list) => [p, ...list.filter((x) => x !== p)]),
                        },
                      ]}
                    />
                  )}
                  <Tooltip label={t("context.remove", { path: p })}>
                    <button
                      type="button"
                      className="btn sm ghost"
                      aria-label={t("context.remove", { path: p })}
                      onClick={() => setFolders((list) => list.filter((x) => x !== p))}
                    >
                      <X aria-hidden />
                    </button>
                  </Tooltip>
                </div>
                {!indexed(p) && (
                  <p className="ctx-folder-warn">
                    <AlertTriangle aria-hidden />
                    {t("context.notIndexed")}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div className="ctx-folder-add">
            <Button
              ref={addRef}
              type="button"
              size="sm"
              icon={<FolderPlus aria-hidden />}
              aria-expanded={picking}
              onClick={() => setPicking((v) => !v)}
            >
              {t("context.addFolder")}
            </Button>
            <input
              ref={typedRef}
              className="input sm mono"
              aria-label={t("context.typePath")}
              placeholder={t("context.typePath")}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              icon={<Plus aria-hidden />}
              disabled={!isAbsolutePath(typed)}
              onClick={addTyped}
            >
              {t("context.addTyped")}
            </Button>
          </div>
          <Popover
            open={picking}
            onClose={() => setPicking(false)}
            anchor={addRef}
            ariaLabel={t("context.addFolder")}
            className="ctx-pick"
          >
            <input
              className="input sm"
              aria-label={t("context.searchFolders")}
              placeholder={t("context.searchFolders")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {shown.length === 0 ? (
              <p className="ctx-pick-none">{t("context.noMatch")}</p>
            ) : (
              <ul className="ctx-pick-list">
                {shown.map((c) => (
                  <li key={c}>
                    <button
                      type="button"
                      className="ctx-pick-item mono"
                      data-depth={roots.includes(c) ? 0 : 1}
                      onClick={() => {
                        add(c);
                        setPicking(false);
                      }}
                    >
                      {c}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Popover>
        </div>
        {error && (
          <p className="ctx-dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button type="button" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!ready} loading={busy}>
            {editing ? t("common.save") : indexFirst ? t("context.indexAndCreate") : t("context.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
