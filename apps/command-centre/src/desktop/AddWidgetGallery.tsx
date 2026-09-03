/**
 * "Add widget" gallery (analysis item 23): every registry entry that is not
 * on the desktop, plus a duplicate of the ones that allow it. Placing a
 * widget finds the first free slot for its default box, so nothing lands on
 * top of what is already there.
 */
import { Plus } from "lucide-react";
import { Popover } from "../components/primitives";
import { useT } from "../i18n";
import {
  DEFAULT_LAYOUT,
  WIDGET_ORDER,
  findFreeSpot,
  nextDuplicateId,
  type LayoutMap,
  type WidgetId,
} from "./defaultLayout";
import { WIDGET_REGISTRY } from "./registry";

export interface AddWidgetGalleryProps {
  layout: LayoutMap;
  rows: number;
  anchor: HTMLElement;
  onAdd: (next: LayoutMap) => void;
  onClose: () => void;
}

/** Widgets that can be added right now: hidden instances first, then duplicable ones. */
export function addableWidgets(layout: LayoutMap): Array<{ id: string; base: WidgetId; duplicate: boolean }> {
  const out: Array<{ id: string; base: WidgetId; duplicate: boolean }> = [];
  for (const base of WIDGET_ORDER) {
    const box = layout[base];
    if (!box || !box.visible) out.push({ id: base, base, duplicate: false });
    else if (WIDGET_REGISTRY[base].duplicable)
      out.push({ id: nextDuplicateId(layout, base), base, duplicate: true });
  }
  return out;
}

export default function AddWidgetGallery({ layout, rows, anchor, onAdd, onClose }: AddWidgetGalleryProps) {
  const t = useT();
  const options = addableWidgets(layout);

  const add = (id: string, base: WidgetId) => {
    const def = WIDGET_REGISTRY[base];
    const spot = findFreeSpot(layout, def.box.w, def.box.h, rows);
    const previous = layout[id] ?? DEFAULT_LAYOUT[base]!;
    onAdd({ ...layout, [id]: { ...previous, ...spot, w: def.box.w, h: def.box.h, visible: true } });
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
