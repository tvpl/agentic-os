/**
 * The `global` commands: what answers in either shell — the palette and the
 * shortcuts sheet, the apps, and the actions that used to live inside the
 * palette (`components/CommandPalette.tsx`). Registered by `OsShell`.
 */
import { useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Archive,
  BrainCircuit,
  CalendarClock,
  FilePlus,
  Grid3x3,
  Keyboard,
  LayoutGrid,
  ListTree,
  Palette,
  Plug,
  Plus,
  RefreshCw,
  Repeat,
  Settings as SettingsIcon,
  Sparkles,
  Stethoscope,
  SunMoon,
  Volume2,
} from "lucide-react";
import { api, type UiShell } from "../api";
import { apiCall } from "../apiCall";
import { useT, type TKey } from "../i18n";
import { qk, useSaveUiPreferences } from "../queries";
import { useToast } from "../components/ui";
import { OPEN_PANEL_EVENT, type PaletteOpenDetail } from "../components/CommandPalette";
import { useOsNavigate } from "../hooks/useViewTransition";
import { getNotifySound, setNotifySound, useNotifications } from "../hooks/useNotifications";
import { errorMessage } from "../views/shared";
import { openOnboarding } from "../onboarding/state";
import { openNoteEditor } from "../brain/noteEvents";
import { useCommands, type Command } from "./registry";

/** Opens the palette (and closes it: the palette registers the same keys in its own `modal` scope). */
export const PALETTE_KEY = "Mod+K";

export interface GlobalCommandsOptions {
  shell: UiShell;
  openPalette: (initial?: PaletteOpenDetail) => void;
  openHelp: () => void;
  onMetaChanged: () => void;
}

const APP_ROWS: Array<[id: string, to: string, icon: Command["icon"], title: TKey, keywords: string[]]> = [
  ["brain", "/brain", BrainCircuit, "nav.brain", ["memory", "graph", "brain", "cerebro", "files"]],
  ["skills", "/skills", Sparkles, "nav.skills", ["sop", "commands"]],
  ["routines", "/routines", CalendarClock, "nav.routines", ["cron", "schedule", "agenda"]],
  ["runs", "/runs", ListTree, "nav.runs", ["history", "logs", "execucoes"]],
  ["connectors", "/connectors", Plug, "nav.connectors", ["mcp", "integrations"]],
  ["pixel", "/pixel", Grid3x3, "nav.pixel", ["pixel", "art", "sprite"]],
  ["settings", "/settings", SettingsIcon, "nav.settings", ["preferences", "config", "configuracoes"]],
];

export function useGlobalCommands(opts: GlobalCommandsOptions): void {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useOsNavigate();
  const { notify } = useNotifications();
  const savePreferences = useSaveUiPreferences();
  const { pathname } = useLocation();
  // What changes every render is read at run time, so the commands keep their identity (and order).
  const now = { ...opts, t, toast, qc, navigate, notify, savePreferences, pathname };
  const live = useRef(now);
  live.current = now;
  const { shell } = opts;

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => live.current.navigate(to);
    /** An action that talks to the server: its failure is a toast, as it was in the palette. */
    const task = (label: TKey, fn: () => Promise<void>) => () => {
      fn().catch((err: unknown) => {
        const { t, toast } = live.current;
        toast(t("shell.action.failed", { action: t(label), error: errorMessage(err, t) }), "danger");
      });
    };
    const frame = shell === "moldura";
    const switchTitle: TKey = frame ? "moldura.palette.toNucleo" : "moldura.palette.toFrame";
    const out: Command[] = [
      {
        id: "palette.open",
        title: "shell.shortcuts.openPalette",
        group: "navigation",
        scope: "global",
        // Ctrl+M stays the palette on a Mac too: it is not a text-editing key there (plan Assumptions).
        keys: [PALETTE_KEY, "Mod+M", "Ctrl+M"],
        run: () => live.current.openPalette(),
      },
    ];
    // The Núcleo's apps are scenes over the core: Escape goes home. The frame's are pages.
    if (!frame)
      out.push({
        id: "global.home",
        title: "cmd.home",
        group: "navigation",
        scope: "global",
        keys: ["Escape"],
        when: () => live.current.pathname !== "/",
        run: go("/"),
      });
    for (const [id, to, icon, title, keywords] of APP_ROWS)
      out.push({
        id: `app:${id}`,
        title,
        group: "apps",
        scope: "global",
        icon,
        keywords,
        palette: true,
        run: go(to),
      });
    out.push(
      {
        id: "app:home",
        // "/" is the core in the Núcleo and the Today page in the frame.
        title: frame ? "moldura.nav.today" : "nav.dashboard",
        group: "apps",
        scope: "global",
        icon: LayoutGrid,
        keywords: ["desktop", "home", "os", "today", "hoje"],
        palette: true,
        run: go("/"),
      },
      {
        id: "action:onboarding",
        title: "shell.action.onboarding",
        group: "actions",
        scope: "global",
        icon: Sparkles,
        keywords: ["tour", "guide", "onboarding", "guia", "ajuda", "help", "tutorial"],
        palette: true,
        // The frame's tour has no places to point at yet.
        when: () => live.current.shell === "nucleo",
        run: openOnboarding,
      },
      {
        id: "action:reindex",
        title: "shell.action.reindex",
        group: "actions",
        scope: "global",
        icon: RefreshCw,
        keywords: ["index", "rebuild", "memory", "reindexar"],
        palette: true,
        run: task("shell.action.reindex", async () => {
          await apiCall("POST /api/memory/index");
          live.current.toast(live.current.t("shell.action.reindexDone"), "ok");
          await live.current.qc.invalidateQueries({ queryKey: ["memory"] });
        }),
      },
      {
        id: "action:backup",
        title: "shell.action.backup",
        group: "actions",
        scope: "global",
        icon: Archive,
        keywords: ["backup", "export", "save"],
        palette: true,
        run: task("shell.action.backup", async () => {
          const res = await apiCall("POST /api/backups", { body: {} });
          live.current.toast(live.current.t("shell.action.backupDone", { name: res.name }), "ok");
          await live.current.qc.invalidateQueries({ queryKey: qk.backups });
        }),
      },
      {
        id: "action:doctor",
        title: "shell.action.doctor",
        group: "actions",
        scope: "global",
        icon: Stethoscope,
        keywords: ["doctor", "health", "diagnostics", "check", "diagnostico"],
        palette: true,
        run: task("shell.action.doctor", async () => {
          const rep = await apiCall("GET /api/doctor", { query: { audit: "0" } });
          const { t, toast, notify, qc, navigate } = live.current;
          const text = t("shell.action.doctorDone", { ok: rep.ok, warn: rep.warn, fail: rep.fail });
          toast(text, rep.fail > 0 ? "danger" : "ok");
          notify({
            kind: "system",
            title: t("shell.action.doctor"),
            body: text,
            href: "/settings?tab=diagnostics",
            tone: rep.fail > 0 ? "danger" : "ok",
          });
          qc.setQueryData(qk.doctor, rep);
          navigate("/settings?tab=diagnostics");
        }),
      },
      {
        id: "action:new-skill",
        title: "shell.action.newSkill",
        group: "actions",
        scope: "global",
        icon: Plus,
        keywords: ["skill", "create", "nova"],
        palette: true,
        run: go("/skills?new=1"),
      },
      {
        id: "action:new-note",
        title: "note.new",
        group: "actions",
        scope: "global",
        icon: FilePlus,
        keywords: ["note", "nota", "memory", "memoria", "write", "escrever", "create", "criar"],
        palette: true,
        run: () => openNoteEditor({ mode: "new" }),
      },
      {
        id: "action:now",
        title: "now.title",
        group: "actions",
        scope: "global",
        icon: Activity,
        keywords: ["now", "objective", "objetivo", "agora", "steps"],
        palette: true,
        run: () => window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: "now" })),
      },
      {
        id: "action:open-panel",
        title: "desktop.dock.add",
        group: "actions",
        scope: "global",
        icon: Plus,
        keywords: ["panel", "painel", "window", "janela", "open", "abrir", "instrument", "widget"],
        palette: true,
        // Project an instrument (a lâmina): the frame has none.
        when: () => live.current.shell === "nucleo",
        run: () => live.current.openPalette({ mode: "panels" }),
      },
      {
        id: "action:toggle-theme",
        title: "shell.action.toggleTheme",
        group: "actions",
        scope: "global",
        icon: SunMoon,
        keywords: ["dark", "light", "theme", "tema", "escuro", "claro"],
        palette: true,
        run: task("shell.action.toggleTheme", async () => {
          const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
          await api.putSettings({ theme: next });
          live.current.onMetaChanged();
          live.current.toast(live.current.t("shell.palette.themeToggled", { theme: next }), "ok");
        }),
      },
      {
        id: "action:presets",
        title: "shell.action.presets",
        group: "actions",
        scope: "global",
        icon: Palette,
        keywords: ["preset", "accent", "colour", "color", "cor", "forest", "ocean", "mono"],
        palette: true,
        run: () => live.current.openPalette({ mode: "theme" }),
      },
      {
        id: "action:brain",
        title: "shell.action.brain",
        group: "actions",
        scope: "global",
        icon: BrainCircuit,
        keywords: ["brain", "memory", "graph"],
        palette: true,
        run: go("/brain"),
      },
      {
        id: "action:shortcuts",
        title: "shell.action.shortcuts",
        group: "actions",
        scope: "global",
        icon: Keyboard,
        keywords: ["keys", "help", "atalhos", "?"],
        keys: ["?"],
        palette: true,
        run: () => live.current.openHelp(),
      },
      {
        id: "action:sound",
        title: "shell.action.sound",
        group: "actions",
        scope: "global",
        icon: Volume2,
        keywords: ["sound", "audio", "notification", "som"],
        palette: true,
        run: () => {
          const next = !getNotifySound();
          setNotifySound(next);
          live.current.toast(live.current.t(next ? "shell.action.soundOn" : "shell.action.soundOff"), "ok");
        },
      },
      {
        id: "action:switch-shell",
        title: switchTitle,
        group: "actions",
        scope: "global",
        icon: Repeat,
        keywords: [
          "interface",
          "shell",
          "switch",
          "mudar",
          "trocar",
          "nucleo",
          "núcleo",
          "moldura",
          "frame",
          "app",
        ],
        palette: true,
        run: task(switchTitle, async () => {
          await live.current.savePreferences({ shell: frame ? "nucleo" : "moldura" });
          const { t, toast } = live.current;
          toast(t(frame ? "moldura.palette.switchedToNucleo" : "moldura.palette.switchedToFrame"), "ok");
        }),
      },
    );
    return out;
  }, [shell]);
  useCommands(commands);
}
