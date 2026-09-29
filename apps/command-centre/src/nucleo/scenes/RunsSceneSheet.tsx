/**
 * "Full detail" (Runs scene): a glass sheet from the right edge holding the
 * run's complete detail view — cost, tokens, context, cwd, prompt, the
 * searchable log and replay, files changed, artifacts, run again, continue,
 * copy log — so nothing the Runs app had is lost behind the river.
 */
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useT } from "../../i18n";
import RunDetail from "../../runs/RunDetail";

export default function RunsSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const closeFn = useRef(onClose);
  closeFn.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    const sheet = sheetRef.current;
    if (!sheet) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement;
      // A field inside the detail (the follow-up, the log search) takes its own Escape.
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable) return;
      e.preventDefault();
      closeFn.current();
    };
    sheet.addEventListener("keydown", onKeyDown);
    return () => sheet.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <aside ref={sheetRef} className="rs-sheet" role="dialog" aria-label={t("scene.runs.detail.title")}>
      <header className="rs-sheet-head">
        <span className="rs-eyebrow">{t("scene.runs.detail")}</span>
        <button
          ref={closeRef}
          type="button"
          className="rs-x"
          aria-label={t("scene.runs.detail.close")}
          title={t("scene.runs.detail.close")}
          onClick={onClose}
        >
          <X aria-hidden />
        </button>
      </header>
      <div className="rs-sheet-body">
        <RunDetail key={id} id={id} />
      </div>
    </aside>
  );
}
