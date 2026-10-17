// @vitest-environment jsdom
/**
 * The index progress of the Second Brain bar (.specs/features/cerebro-v2, C42): the phase and the counters in text, a
 * Cancel button while a pass runs, and how a pass that did not finish ended, in text with its icon.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { IndexProgress } from "./IndexProgress";
import { dictionaries } from "../i18n";
import { installPage, mount } from "../ui/testkit";

installPage();

type Props = ComponentProps<typeof IndexProgress>;
const show = (over: Partial<Props> = {}) =>
  mount(
    <IndexProgress progress={null} refreshing={false} note={null} onCancel={() => undefined} {...over} />,
  );
const status = () => screen.queryByRole("status");

describe("C42 the progress of an index pass", () => {
  const PHASES = [
    ["scan", "Scanning"],
    ["index", "Indexing"],
    ["prune", "Removing"],
    ["related", "Computing relations"],
    ["vectors", "Vectors"],
  ] as const;
  for (const [phase, text] of PHASES) {
    it(`C42 shows the phase ${phase} as "${text}" with the counters, and a Cancel button`, () => {
      const onCancel = vi.fn();
      show({ progress: { phase, scanned: 40, total: 120, added: 1, updated: 0, removed: 0 }, onCancel });
      expect(status()!.textContent).toContain(`${text} · 40 / 120`);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(dictionaries["pt-BR"][`brain.index.phase.${phase}` as const]).toBeTruthy();
    });
  }

  it("C42 a pass that reports no phase still shows the counters, and one that has not reported shows an ellipsis", () => {
    const { unmount } = show({ progress: { scanned: 3, added: 0, updated: 0, removed: 0 } });
    expect(status()!.textContent).toContain("Indexing · 3");
    unmount();
    show({ refreshing: true });
    expect(status()!.textContent).toContain("…");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("C42 a cancelled pass says so in text with an icon, and a failed one says the index was kept; neither has a Cancel button", () => {
    const { unmount } = show({ note: "cancelled" });
    expect(status()!.textContent).toBe("Indexing cancelled");
    expect(status()!.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    unmount();
    show({ note: "failed" });
    expect(status()!.textContent).toBe("The indexer stopped; the previous index was kept.");
    expect(dictionaries["pt-BR"]["brain.index.cancelled"]).toBe("Indexação cancelada");
    expect(dictionaries["pt-BR"]["brain.index.failed"]).toBe(
      "O indexador parou; o índice anterior foi mantido.",
    );
  });

  it("C42 nothing is shown when no pass runs and none ended badly; a running pass wins over an old note", () => {
    const { unmount } = show();
    expect(status()).toBeNull();
    unmount();
    show({ note: "cancelled", refreshing: true });
    expect(status()!.textContent).not.toContain("cancelled");
  });
});
