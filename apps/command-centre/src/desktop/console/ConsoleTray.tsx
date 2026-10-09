/**
 * The context tray (prototype `#tray`): one chip per panel open on the stage,
 * whatever its kind. Clicking a chip writes `@ref` into the draft; a chip
 * whose panel the draft already points at is lit, so the tray reads as
 * "what the agent will be looking at" before anything is sent.
 */
import { useT } from "../../i18n";
import { PANEL_GLYPH, type OpenPanel } from "../panelKinds";

export function ConsoleTray({
  panels,
  referenced,
  onPick,
}: {
  panels: ReadonlyArray<OpenPanel>;
  referenced: ReadonlySet<string>;
  onPick: (ref: string) => void;
}) {
  const t = useT();
  return (
    <div className="cons-tray" aria-label={t("desktop.doc.context")}>
      <span className="cons-h">{t("desktop.doc.context")}</span>
      {panels.map((panel) => (
        <button
          key={panel.id}
          type="button"
          className={`chp${referenced.has(panel.id) ? " on" : ""}`}
          title={panel.path ?? panel.title}
          onClick={() => onPick(panel.ref)}
        >
          <span aria-hidden>{PANEL_GLYPH[panel.kind]}</span>@{panel.ref}
        </button>
      ))}
    </div>
  );
}
