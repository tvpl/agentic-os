/**
 * The commands of the notes view (.specs/features/cerebro-vista-notas, AC 1, AC 16, AC 18; comandos-atalhos
 * design.md): "Definir como Home" and "Fechar aba", in the palette while a tab is open. "Ver notas" and "Ver grafo",
 * with the key `v`, are the brain's (`brain/BrainViewSwitch.tsx`).
 */
import { useMemo, useRef } from "react";
import { Home, X } from "lucide-react";
import { useCommands, type Command } from "../../commands/registry";

export function useNotesCommands(
  active: string | null,
  setHome: (path: string) => void,
  closeTab: (path: string) => Promise<boolean>,
): void {
  const live = useRef({ active, setHome, closeTab });
  live.current = { active, setHome, closeTab };
  const commands = useMemo<Command[]>(
    () => [
      {
        id: "brain.notes.setHome",
        title: "notes.home.setThis",
        group: "view",
        scope: "view:brain",
        icon: Home,
        keywords: ["home", "início", "inicio", "nota", "note"],
        palette: true,
        when: () => live.current.active !== null,
        run: () => {
          const { active, setHome } = live.current;
          if (active) setHome(active);
        },
      },
      {
        id: "brain.notes.closeTab",
        title: "notes.cmd.closeTab",
        group: "view",
        scope: "view:brain",
        icon: X,
        keywords: ["tab", "aba", "close", "fechar"],
        palette: true,
        when: () => live.current.active !== null,
        run: () => {
          const { active, closeTab } = live.current;
          if (active) void closeTab(active);
        },
      },
    ],
    [],
  );
  useCommands(commands);
}
