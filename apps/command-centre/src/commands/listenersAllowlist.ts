/**
 * The key listeners that stay on the page outside the registry
 * (.specs/features/comandos-atalhos, C16): file by file, how many, and why they
 * are not commands. The source check (`commands.source.test.ts`) and the runtime
 * probe (`commands.probe.test.tsx`) both hold the app to this list: the reader
 * to these counts, the probe to at most this many call sites per file.
 */
export const OUTSIDE_THE_REGISTRY: Record<string, [count: number, why: string]> = {
  "commands/registry.ts": [1, "the one listener of the key manager"],
  "components/dialog.tsx": [
    1,
    "the dialog stack: Escape and Tab of the dialog on top, stopped before they leave it",
  ],
  "components/primitives.tsx": [1, "a popover's own Escape, captured while it is open"],
  "nucleo/pending/FocusMode.tsx": [
    1,
    "the focus mode is a layer of its own: while it is up it is the only surface (design: stays)",
  ],
  "onboarding/useTourSurface.ts": [1, "the guided tour owns the keyboard while it is up (design: stays)"],
  "runs/Replay.tsx": [1, "the replay's own transport keys (design: stays)"],
  "nucleo/scenes/SkillsScene.tsx": [
    2,
    "the Skills ring's type-to-find (design: stays) and its sheet's Escape, captured before the shell's",
  ],
  "nucleo/scenes/BrainScene.tsx": [
    2,
    "the constellation's Escape chain, captured before the shell's, and Shift+1-4 for its four arrangements",
  ],
  "nucleo/scenes/RunsScene.tsx": [
    1,
    "Escape steps back one thing at a time (the run, then the zoom), captured before the shell's",
  ],
  "nucleo/scenes/RoutinesScene.tsx": [1, "Escape closes the classic sheet, captured before the shell's"],
  "nucleo/NucleoScene.tsx": [1, "Escape folds the bloomed core, before the shell's"],
};
