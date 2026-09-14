/**
 * "Add widget" gallery (analysis item 23): every registry entry that is not
 * on the desktop, plus a duplicate of the ones that allow it. A new window
 * opens at the least-covered spot on the stage and on top of the stack, so
 * it neither lands under what is already there nor hides it.
 */
import { Plus } from "lucide-react";
import { Popover } from "../components/primitives";
import { useT } from "../i18n";
import { WIDGET_ORDER, nextDuplicateId, type WidgetId } from "./defaultLayout";
import { defaultWindows } from "./defaultWindows";
import { placeNew, topZ, type Size, type WindowMap } from "./windowModel";
import { WIDGET_REGISTRY } from "./registry";

export interface AddWidgetGalleryProps {
  layout: WindowMap;
  stage: Size;
  anchor: HTMLElement;
  onAdd: (next: WindowMap) => void;
  onClose: () => void;
}

/** Widgets that can be added right now: hidden instances first, then duplicable ones. */
export function addableWidgets(layout: WindowMap): Array<{ id: string; base: WidgetId; duplicate: boolean }> {
  const out: Array<{ id: string; base: WidgetId; duplicate: boolean }> = [];
  for (const base of WIDGET_ORDER) {
    const box = layout[base];
    if (!box || !box.visible) out.push({ id: base, base, duplicate: false });
    else if (WIDGET_REGISTRY[base].duplicable)
      out.push({ id: nextDuplicateId(layout, base), base, duplicate: true });
  }
  return out;
}

export default function AddWidgetGallery({ layout, stage, anchor, onAdd, onClose }: AddWidgetGalleryProps) {
  const t = useT();
  const options = addableWidgets(layout);

  const add = (id: string, base: WidgetId) => {
    const fallback = defaultWindows(stage)[base]!;
    const previous = layout[id] ?? fallback;
    const size = { w: previous.w || fallback.w, h: previous.h || fallback.h };
    const spot = placeNew(size, layout, stage);
    onAdd({
      ...layout,
      [id]: { ...previous, ...spot, ...size, z: topZ(layout) + 1, visible: true, minimized: false },
    });
    onClose();
  };

  return (
    <Popover
      open
      onClose={onClose}
      anchor={anchor}
      placement="top-start"
      ariaLabel={t("desktop.add.title")}
      className="add-gallery"
    >
      <div className="wc-head">
        <span className="hud-label accent">{t("desktop.add.title")}</span>
      </div>
      {options.length === 0 ? (
        <p className="widget-muted">{t("desktop.add.all")}</p>
      ) : (
        <>
          <p className="widget-muted">{t("desktop.add.hint")}</p>
          <div className="add-grid">
            {options.map(({ id, base, duplicate }) => (
              <button key={id} type="button" className="add-tile" onClick={() => add(id, base)}>
                <span className="add-icon" aria-hidden>
                  {WIDGET_REGISTRY[base].icon}
                </span>
                <span className="add-name truncate">{t(WIDGET_REGISTRY[base].titleKey)}</span>
                {duplicate && (
                  <span className="add-dup" aria-hidden>
                    <Plus />
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </Popover>
  );
}
