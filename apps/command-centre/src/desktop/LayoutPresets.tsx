import { useEffect, useState } from "react";
import { Modal, useToast } from "../components/ui";
import { useT } from "../i18n";
import { normalizeWindows } from "./defaultWindows";
import type { Size, WindowMap } from "./windowModel";

const PREFIX = "mordomo.layoutPreset.v1.";
interface Preset {
  id: string;
  name: string;
  layout: WindowMap;
}
function readPresets(): Preset[] {
  const presets: Preset[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? "null");
        if (
          value?.version !== 1 ||
          typeof value.name !== "string" ||
          !value.name.trim() ||
          !value.layout ||
          typeof value.layout !== "object" ||
          Array.isArray(value.layout)
        )
          continue;
        const boxes = Object.values(value.layout);
        if (
          boxes.length > 100 ||
          !boxes.every(
            (box) =>
              box &&
              typeof box === "object" &&
              ["x", "y", "w", "h"].every((field) =>
                Number.isFinite((box as Record<string, unknown>)[field]),
              ) &&
              "visible" in box &&
              typeof box.visible === "boolean",
          )
        )
          continue;
        presets.push({ id: key, name: value.name.slice(0, 60), layout: value.layout });
      } catch {
        /* One damaged preset does not hide the others. */
      }
    }
  } catch {
    /* Storage may be disabled. Saving reports that explicitly. */
  }
  return presets.sort((a, b) => a.name.localeCompare(b.name));
}

/** Device-local presets; separate keys prevent one tab replacing another's catalogue. */
export function LayoutPresets({
  layout,
  stage,
  onApply,
  onClose,
}: {
  layout: WindowMap;
  stage: Size;
  onApply: (layout: WindowMap) => void;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [presets, setPresets] = useState(readPresets);
  const [name, setName] = useState("");
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(PREFIX)) setPresets(readPresets());
    };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);
  const save = () => {
    if (!name.trim()) return;
    try {
      localStorage.setItem(
        PREFIX + crypto.randomUUID(),
        JSON.stringify({ version: 1, name: name.trim().slice(0, 60), layout }),
      );
      setPresets(readPresets());
      setName("");
      toast(t("common.saved"), "ok");
    } catch {
      toast(t("os.presetStorageError"), "danger");
    }
  };
  return (
    <Modal title={t("os.layoutPresets")} onClose={onClose} narrow>
      <p className="hint">{t("os.layoutPresetsHint")}</p>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label htmlFor="layout-preset-name">{t("os.presetName")}</label>
        <input
          id="layout-preset-name"
          className="input"
          maxLength={60}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button className="btn" disabled={!name.trim()} type="submit">
          {t("os.presetSave")}
        </button>
      </form>
      <div className="stack" style={{ marginTop: 16 }}>
        {presets.map((preset) => (
          <div key={preset.id} className="row">
            <button
              className="btn"
              onClick={() => {
                onApply(normalizeWindows(preset.layout, stage));
                onClose();
              }}
            >
              {preset.name}
            </button>
            <button
              className="btn ghost"
              aria-label={`${t("common.delete")}: ${preset.name}`}
              onClick={() => {
                try {
                  localStorage.removeItem(preset.id);
                  setPresets(readPresets());
                } catch {
                  toast(t("os.presetStorageError"), "danger");
                }
              }}
            >
              {t("common.delete")}
            </button>
          </div>
        ))}
        {presets.length === 0 && <p className="hint">{t("common.empty")}</p>}
      </div>
    </Modal>
  );
}
