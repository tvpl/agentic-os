/**
 * Accessible list view: the same nodes as the canvas, keyboard-navigable
 * (audit item 43). Arrow keys move between files, Enter opens the preview.
 */
import { useMemo, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import type { GraphData, GraphNode } from "../api";
import { useT } from "../i18n";

export function FileList({
  graph,
  groupOf,
  selectedId,
  onSelect,
  onClose,
}: {
  graph: GraphData;
  groupOf: (n: GraphNode) => string;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [filter, setFilter] = useState("");
  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const map = new Map<string, GraphNode[]>();
    for (const n of graph.nodes) {
      if (needle && !n.name.toLowerCase().includes(needle) && !n.path.toLowerCase().includes(needle)) continue;
      const g = groupOf(n);
      const list = map.get(g) ?? [];
      list.push(n);
      map.set(g, list);
    }
    return [...map.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([key, nodes]) => ({ key, nodes: nodes.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 400) }));
  }, [graph, groupOf, filter]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-file]"));
    const idx = items.findIndex((b) => b === document.activeElement);
    const next = items[(idx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  return (
    <aside className="brain2-list" aria-label={t("brain.listView")}>
      <div className="brain2-list-head">
        <input className="input sm" placeholder={t("common.search")} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("common.search")} />
        <button className="btn ghost sm icon-only" onClick={onClose} aria-label={t("common.close")}>
          <X aria-hidden />
        </button>
      </div>
      <div className="brain2-list-body" role="listbox" tabIndex={0} onKeyDown={onKey} aria-label={t("brain.listView")} aria-activedescendant={selectedId != null ? `bl-${selectedId}` : undefined}>
        {groups.map((g) => (
          <div key={g.key} role="group" aria-label={g.key}>
            <div className="hud-label brain2-list-group">
              {g.key} <span className="count">{g.nodes.length}</span>
            </div>
            {g.nodes.map((n) => (
              <button
                key={n.id}
                id={`bl-${n.id}`}
                role="option"
                aria-selected={n.id === selectedId}
                data-file
                className={`brain2-list-item${n.id === selectedId ? " selected" : ""}`}
                onClick={() => onSelect(n.id)}
                title={n.path}
              >
                <span className="truncate">{n.name}</span>
              </button>
            ))}
          </div>
        ))}
        {groups.length === 0 && <p className="widget-muted">{t("common.empty")}</p>}
      </div>
    </aside>
  );
}
