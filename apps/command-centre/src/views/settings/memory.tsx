/** Settings › memory (split out of Settings.tsx, refino item 17). */
import { useState } from "react";
import { ArrowRight, CheckCircle2, RefreshCw, X } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../api";

import { useT } from "../../i18n";
import { Button, Field } from "../../components/primitives";
import { useConfirm } from "../../hooks/useConfirm";
import { isAbsolutePath } from "../shared";
import {
  DraftField,
  joinComma,
  joinLines,
  parseCommaList,
  parseHttpsList,
  parseLineList,
  sameList,
  type Put,
} from "../SettingsFields";
import type { SettingsShape } from "./shared";
import { Tooltip } from "../../ui";
import { ContextsSettings } from "../../contexts/ContextsSettings";

export function MemoryTab({ s, put }: { s: SettingsShape; put: Put }) {
  const t = useT();
  const confirm = useConfirm();
  const [newPath, setNewPath] = useState("");
  const [newArea, setNewArea] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const addFolder = useMutation({
    mutationFn: () =>
      api.putSettings({
        indexedFolders: [...s.indexedFolders, { path: newPath.trim(), area: newArea || null, enabled: true }],
      }),
    onSuccess: () => {
      setNewPath("");
      setNewArea("");
      void put({}, true);
    },
    onError: (err: Error) => setPathError(err.message),
  });
  const removeFolder = async (path: string) => {
    if (
      await confirm({
        title: t("settings.removeFolder"),
        body: path,
        danger: true,
        confirmLabel: t("common.delete"),
      })
    )
      void put({ indexedFolders: s.indexedFolders.filter((x) => x.path !== path) });
  };
  const pathOk = !newPath.trim() || isAbsolutePath(newPath);

  return (
    <div className="card stack">
      <div className="field">
        <span className="label">{t("settings.folders")}</span>
        {s.indexedFolders.length === 0 && <p className="widget-muted">{t("settings.noFolders")}</p>}
        {s.indexedFolders.map((f, i) => (
          <div key={f.path} className="folder-row">
            <span className="mono truncate" title={f.path}>
              {f.path}
            </span>
            <select
              className="input sm"
              value={f.area ?? ""}
              aria-label={`${t("brain.filterArea")} ${f.path}`}
              onChange={(e) => {
                const folders = [...s.indexedFolders];
                folders[i] = { ...f, area: e.target.value || null };
                void put({ indexedFolders: folders }, true);
              }}
            >
              <option value="">—</option>
              {s.areas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <Tooltip label={t("common.delete")}>
              <Button
                size="sm"
                variant="ghost"
                icon={<X aria-hidden />}
                aria-label={`${t("common.delete")} ${f.path}`}
                onClick={() => void removeFolder(f.path)}
              />
            </Tooltip>
          </div>
        ))}
      </div>
      <Field
        label={t("settings.addFolder")}
        htmlFor="st-newfolder"
        hint={t("settings.folderHint")}
        error={pathError ?? (pathOk ? undefined : t("settings.folderAbsolute"))}
      >
        <div className="folder-add">
          <input
            id="st-newfolder"
            className="input mono"
            placeholder={t("settings.folderPh")}
            value={newPath}
            aria-invalid={!pathOk || Boolean(pathError)}
            onChange={(e) => {
              setNewPath(e.target.value);
              setPathError(null);
            }}
          />
          <select
            className="input"
            value={newArea}
            onChange={(e) => setNewArea(e.target.value)}
            aria-label={t("brain.filterArea")}
          >
            <option value="">—</option>
            {s.areas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="primary"
            icon={<CheckCircle2 aria-hidden />}
            disabled={!newPath.trim() || !pathOk}
            loading={addFolder.isPending}
            onClick={() => addFolder.mutate()}
          >
            {t("settings.addFolder")}
          </Button>
        </div>
      </Field>
      {/* After the indexed folders (cerebro-contextos design: "Configurações › Memória › Contextos"). */}
      <ContextsSettings />
      <p className="hint">
        <RefreshCw size={11} style={{ verticalAlign: -1 }} aria-hidden /> {t("brain.refresh")}:{" "}
        {t("nav.brain")} <ArrowRight size={11} style={{ verticalAlign: -1 }} aria-hidden />{" "}
        {t("brain.refresh")}
      </p>
      <DraftField
        id="st-areas"
        label={t("settings.areas")}
        hint={t("settings.areasHint")}
        serverValue={s.areas}
        format={joinComma}
        equals={sameList}
        parse={parseCommaList(t, { required: true })}
        save={(areas) => put({ areas })}
      />
      <DraftField
        id="st-excludes"
        label={t("settings.excludes")}
        hint={t("settings.excludesHint")}
        className="mono"
        rows={8}
        serverValue={s.excludes}
        format={joinLines}
        equals={sameList}
        parse={parseLineList}
        save={(excludes) => put({ excludes })}
      />
      <DraftField
        id="st-registries"
        label={t("apps.settings.registries")}
        hint={t("apps.settings.registriesHint")}
        className="mono"
        placeholder="https://example.com/mordomo-skills/index.json"
        serverValue={s.marketplace?.registries ?? []}
        format={joinComma}
        equals={sameList}
        parse={parseHttpsList(t)}
        save={(registries) => put({ marketplace: { registries } }, true)}
      />
    </div>
  );
}
