/**
 * The spine (immersive shell): the OS's modules down the left edge — the
 * five places you live in first, a hairline, then the rest, and Settings at
 * the foot. Each is a glyph that names itself on hover and carries a live
 * mark when something is happening inside it. The module you are in is lit
 * and connected to the edge by a beam. Going to one is a zoom *through* its
 * glyph: the shell reads the press as the journey's origin.
 */
import {
  Atom,
  BrainCircuit,
  CalendarClock,
  FolderOpen,
  Grid3x3,
  Images,
  LayoutDashboard,
  Plug,
  Settings,
  Sparkles,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { useT } from "../i18n";
import { SCENES, type SceneDef, type SceneId } from "./scenes";
import { originFromElement } from "./travel";

const ICONS: Record<SceneId, LucideIcon> = {
  nucleo: Atom,
  brain: BrainCircuit,
  runs: Waves,
  skills: Sparkles,
  routines: CalendarClock,
  dashboards: LayoutDashboard,
  connectors: Plug,
  artifacts: FolderOpen,
  generations: Images,
  pixel: Grid3x3,
  settings: Settings,
};

export interface ModuleSpineProps {
  current: SceneId;
  onGo: (scene: SceneDef) => void;
  /** Live marks: a number or a short word shown on the glyph's corner. */
  marks?: Partial<Record<SceneId, string>>;
}

export default function ModuleSpine({ current, onGo, marks = {} }: ModuleSpineProps) {
  const t = useT();
  const main = SCENES.filter((s) => s.main);
  const rest = SCENES.filter((s) => !s.main && s.id !== "settings");
  const settings = SCENES.find((s) => s.id === "settings")!;
  const item = (scene: SceneDef, key?: number) => {
    const Icon = ICONS[scene.id];
    const on = scene.id === current;
    return (
      <li key={scene.id}>
        <button
          type="button"
          className={`nu-mod${on ? " on" : ""}`}
          data-scene={scene.id}
          aria-current={on ? "page" : undefined}
          aria-label={t(scene.labelKey)}
          onClick={(e) => {
            originFromElement(e.currentTarget);
            onGo(scene);
          }}
        >
          <span className="nu-mod-glyph" aria-hidden>
            <Icon aria-hidden />
          </span>
          {marks[scene.id] && <span className="nu-mod-mark mono">{marks[scene.id]}</span>}
          <span className="nu-mod-label" aria-hidden>
            {t(scene.labelKey)}
            {key !== undefined && <kbd>{key}</kbd>}
          </span>
        </button>
      </li>
    );
  };
  return (
    <nav className="nu-spine" aria-label={t("nucleo.horizon.label")} data-onboarding="modes">
      <ul className="nu-spine-main">{main.map((s, i) => item(s, i + 1))}</ul>
      <span className="nu-spine-rule" aria-hidden />
      <ul className="nu-spine-rest">{rest.map((s) => item(s))}</ul>
      <span className="sp" />
      <ul className="nu-spine-foot">{item(settings)}</ul>
    </nav>
  );
}
