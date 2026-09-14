/**
 * The app rail (redesign F3): the OS's apps as chrome instead of a widget.
 *
 * The micro-apps tile spent 5×7 permanent grid cells on four links used a
 * handful of times a session. The rail costs a luminous spine until you reach
 * for it, then slides out with the names. A connector that was never finished
 * shows as an amber pip on the closed spine, so the one piece of information
 * the tile carried that mattered survives its removal.
 *
 * Opening is not hover-only: focus opens it too, and a real toggle button
 * carries `aria-expanded` so keyboard and touch are not second-class.
 */
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Plus } from "lucide-react";
import { useT } from "../i18n";
import { useAppRows } from "./appRows";

export default function AppRail() {
  const t = useT();
  const { apps, pending } = useAppRows(3);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const open = pinned || hovered || focused;
  const rows = [...apps, ...pending];

  const enter = () => {
    window.clearTimeout(closeTimer.current);
    setHovered(true);
  };
  // A small grace period: crossing the rail's edge diagonally should not
  // snap it shut under the pointer.
  const leave = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setHovered(false), 180);
  };

  return (
    <nav
      className={`app-rail${open ? " open" : ""}`}
      aria-label={t("desktop.widget.microapps")}
      onPointerEnter={enter}
      onPointerLeave={leave}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <span className="rail-spine" aria-hidden />
      {pending.length > 0 && (
        <span className="rail-pips" aria-hidden>
          {pending.map((row) => (
            <i key={row.to} />
          ))}
        </span>
      )}
      <button
        type="button"
        className="rail-toggle"
        aria-expanded={open}
        aria-label={t(open ? "desktop.dock.collapse" : "desktop.dock.expand")}
        onClick={() => setPinned((v) => !v)}
      >
        <ChevronRight aria-hidden />
      </button>
      <div className="rail-items">
        {rows.map((row, i) => (
          <Link
            key={row.to}
            to={row.to}
            className={`rail-item${row.ghost ? " ghost" : ""}`}
            style={{ "--rail-delay": `${i * 26}ms` } as React.CSSProperties}
            tabIndex={open ? 0 : -1}
            title={row.desc}
          >
            <span className="rail-icon">{row.icon}</span>
            <span className="rail-text">
              <span className="rail-name">{row.name}</span>
              <span className="rail-desc">{row.desc}</span>
            </span>
          </Link>
        ))}
        <Link
          to="/connectors"
          className="rail-item add"
          style={{ "--rail-delay": `${rows.length * 26}ms` } as React.CSSProperties}
          tabIndex={open ? 0 : -1}
        >
          <span className="rail-icon">
            <Plus aria-hidden />
          </span>
          <span className="rail-text">
            <span className="rail-name">{t("desktop.apps.add")}</span>
          </span>
        </Link>
      </div>
    </nav>
  );
}
