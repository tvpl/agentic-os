/**
 * The key listeners that stay on the page outside the registry
 * (.specs/features/comandos-atalhos, C16): file by file, how many, and why they
 * are not commands. The source check (`commands.source.test.ts`) and the runtime
 * probe (`commands.probe.test.tsx`) both hold the app to this list: the reader
 * to these counts, the probe to at most this many call sites per file.
 */
export const OUTSIDE_THE_REGISTRY: Record<string, [count: number, why: string]> = {
  "commands/registry.ts": [1, "the one listener of the key manager"],
  "ui/layers.ts": [
    1,
    "`useDrawer`: Escape and Tab of the panel on top that stays where it is in the tree (the narrow sidebar, the conversation and the document drawers), stopped before they leave it",
  ],
  "nucleo/pending/FocusMode.tsx": [
    1,
    "the focus mode is a layer of its own: while it is up it is the only surface (design: stays)",
  ],
  "onboarding/useTourSurface.ts": [1, "the guided tour owns the keyboard while it is up (design: stays)"],
  "runs/Replay.tsx": [1, "the replay's own transport keys (design: stays)"],
  "nucleo/scenes/SkillsScene.tsx": [
    1,
    "the Skills ring's type-to-find and arrows (design: stays); the sheet is a Modal, which takes its own Escape",
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

/**
 * The key listeners that a dependency puts on the page while the app runs
 * (.specs/features/primitivas, door 5): package by package, how many call sites,
 * and why none of them is a command. The primitives are Radix, which listens on
 * its own; the runtime probe attributes a listener to the package whose code
 * added it (not to React DOM, which only delegates `onKeyDown`) and fails on a
 * package that is not here.
 */
export const OUTSIDE_THE_REGISTRY_DEPS: Record<string, [count: number, why: string]> = {
  "@radix-ui/react-dismissable-layer": [
    1,
    "Escape of the top layer of a dialog, popover, menu or tooltip, on the document in capture; it runs the layer's close and marks the key handled, so the registry (which ignores a key already handled) never sees it",
  ],
  "@radix-ui/react-menu": [
    1,
    "remembers whether the last input was the keyboard (for the focus ring of a menu item); it reads no key and runs no command",
  ],
};
