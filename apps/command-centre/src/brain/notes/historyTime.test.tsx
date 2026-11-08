// @vitest-environment jsdom
process.env.TZ = "America/Sao_Paulo";
/**
 * The local date and time of a version (.specs/features/cerebro-memoria-confiavel, C101; L-053): under
 * `TZ=America/Sao_Paulo`, pinned here and asserted, a version at `2026-11-01T02:30:00Z` (23:30 of 31 October locally,
 * where the UTC day is already 1 November) is titled "Versão de 31/10/2026 23:30", and the row's `Tooltip` reads that
 * date and time.
 */
import { describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { HistoryRow } from "./HistoryFold";
import VersionDialog from "./VersionDialog";

vi.mock("../../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);

installPage();

const AT = Date.parse("2026-11-01T02:30:00Z");
const V = { id: 7, at: AT, author: "owner", origin: "save", sha256: "sha256:old" };

describe("C101 the version's date and time are local", () => {
  it("C101 the zone is pinned: 2026-11-01T02:30:00Z is 23:30 of 31 October here", () => {
    expect(process.env.TZ).toBe("America/Sao_Paulo");
    expect(new Date(AT).getDate()).toBe(31);
    expect(new Date(AT).getHours()).toBe(23);
    expect(new Date(AT).toISOString().slice(0, 10)).toBe("2026-11-01");
  });

  it("C101 the dialog is titled Versão de 31/10/2026 23:30", async () => {
    renderWith(<VersionDialog version={V} onClose={() => undefined} onRestored={() => undefined} />, {
      lang: "pt-BR",
    });
    expect(await screen.findByRole("dialog", { name: "Versão de 31/10/2026 23:30" })).toBeTruthy();
  });

  it("C101 the row's Tooltip reads 31/10/2026 23:30", async () => {
    renderWith(
      <ul>
        <HistoryRow version={V} current={false} onOpen={() => undefined} />
      </ul>,
      { lang: "pt-BR" },
    );
    act(() => screen.getByRole("button").focus());
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toContain("31/10/2026 23:30");
    expect(tip.textContent).not.toContain("01/11/2026");
  });
});
