// @vitest-environment jsdom
/**
 * Settings › providers tells the owner when the installed CLI is outside the
 * range this release was developed against (`versionStatus` of `GET
 * /api/providers`), and says nothing when it is inside or unknown.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProviderId, ProviderSnapshot } from "../../api";
import { I18nContext, type Lang } from "../../i18n";
import { qk } from "../../queries";
import { ProvidersTab } from "./providers";
import type { SettingsShape } from "./shared";

function snapshot(
  id: string,
  rawVersion: string | null,
  installedVersion: string | null,
  versionStatus: ProviderSnapshot["versionStatus"],
): ProviderSnapshot {
  return {
    id: id as ProviderId,
    displayName: id,
    enabled: true,
    isDefault: false,
    defaultModel: null,
    defaultEffort: "default",
    health: { ok: true, installed: true, authenticated: true, version: rawVersion, detail: "" },
    installedVersion,
    versionStatus,
    testedVersions: { min: "2.0.0", max: "2.1.291" },
  };
}

function setup(providers: ProviderSnapshot[], lang: Lang = "en") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(qk.providers, providers);
  const s = { providers: {} } as unknown as SettingsShape;
  render(
    <I18nContext.Provider value={{ lang, setLang: () => {} }}>
      <QueryClientProvider client={qc}>
        <ProvidersTab s={s} put={() => Promise.resolve({ ok: true })} />
      </QueryClientProvider>
    </I18nContext.Provider>,
  );
}

afterEach(cleanup);

describe("provider version notice", () => {
  it("C14 an untested CLI version shows a notice", () => {
    setup([
      snapshot("claude", "0.0.1 (Claude Code)", "0.0.1", "older"),
      snapshot("codex", "codex-cli 99.0.0", "99.0.0", "newer"),
      snapshot("cursor", "2.1.0 (Claude Code)", "2.1.0", "tested"),
      snapshot("acme", "dev build", null, "unknown"),
    ]);
    const notes = screen.getAllByRole("note").map((n) => n.textContent);
    const range = "the range this MordomoOS release was developed against (2.0.0–2.1.291)";
    // The parsed version, not the CLI's own `--version` text, and what the owner can do about it.
    expect(notes).toEqual([
      `Installed version 0.0.1 is older than ${range}. Runs still go ahead; update the CLI if something looks wrong.`,
      `Installed version 99.0.0 is newer than ${range}. Runs still go ahead; if usage, cost or changed files look incomplete, update MordomoOS.`,
    ]);
    expect(notes.join(" ")).not.toMatch(/codex-cli|Claude Code/);
    expect(screen.queryByText(/Installed version 2\.1\.0/)).toBeNull();
    expect(screen.queryByText(/dev build is/)).toBeNull();
  });

  it("C28 the notice sits in its own provider card, between the header and the login block", () => {
    const claude = snapshot("claude", "0.0.1", "0.0.1", "older");
    claude.health = { ...claude.health, authenticated: false };
    claude.loginCommand = "claude login";
    setup([
      claude,
      snapshot("codex", "99.0.0", "99.0.0", "newer"),
      snapshot("cursor", "2.1.0", "2.1.0", "tested"),
    ]);

    const cards = Array.from(document.querySelectorAll(".provider-row"));
    expect(cards).toHaveLength(3);
    const notes = screen.getAllByRole("note");
    expect(notes).toHaveLength(2);
    // One note per card, each inside the card of the provider it is about, and none in the tested one.
    expect(cards.map((c) => c.querySelectorAll('[role="note"]').length)).toEqual([1, 1, 0]);
    expect(cards[0]?.contains(notes[0] ?? null)).toBe(true);
    expect(cards[0]?.textContent).toContain("0.0.1");
    expect(cards[1]?.contains(notes[1] ?? null)).toBe(true);
    expect(cards[1]?.textContent).toContain("99.0.0");
    // A direct child of the card: after the head (name, status, actions), before the login recovery and the settings grid.
    const order = (card: Element | undefined) =>
      Array.from(card?.children ?? []).map((c) => (c.getAttribute("role") === "note" ? "note" : c.className));
    expect(order(cards[0])).toEqual(["provider-head", "note", "auth-recovery", "grid grid-2"]);
    expect(order(cards[1])).toEqual(["provider-head", "note", "grid grid-2"]);
    expect(order(cards[2])).toEqual(["provider-head", "grid grid-2"]);
    // One paragraph of plain text: a single line of copy, no markup inside it.
    for (const note of notes) {
      expect(note.tagName).toBe("P");
      expect(note.childElementCount).toBe(0);
      // Information tone (`meta`), not an alert: neither a badge nor a warning class (design.md, Forma).
      expect(note.className).toBe("meta");
    }
  });

  it("C28 the notice reads in Portuguese too, with the parsed version and no raw --version text", () => {
    setup(
      [
        snapshot("claude", "0.0.1 (Claude Code)", "0.0.1", "older"),
        snapshot("codex", "codex-cli 99.0.0", "99.0.0", "newer"),
        snapshot("cursor", "2.1.0", "2.1.0", "tested"),
      ],
      "pt-BR",
    );
    const range = "a faixa com que esta versão do MordomoOS foi desenvolvida (2.0.0–2.1.291)";
    const notes = screen.getAllByRole("note").map((n) => n.textContent);
    expect(notes).toEqual([
      `A versão instalada 0.0.1 é mais antiga que ${range}. As execuções seguem normalmente; atualize a CLI se algo parecer errado.`,
      `A versão instalada 99.0.0 é mais recente que ${range}. As execuções seguem normalmente; se o uso, o custo ou os arquivos alterados parecerem incompletos, atualize o MordomoOS.`,
    ]);
    expect(notes.join(" ")).not.toMatch(/codex-cli|Claude Code/);
  });

  it("shows nothing for a server that does not send versionStatus", () => {
    const old = snapshot("claude", "0.0.1", "0.0.1", "older");
    delete old.versionStatus;
    delete old.installedVersion;
    delete old.testedVersions;
    setup([old]);
    expect(screen.queryAllByRole("note")).toEqual([]);
  });

  // C29: each field the notice reads is missing on its own. The server may send `versionStatus` older/newer and
  // still lack the parsed version or the range (a CLI whose `--version` has no semver, a manifest without a range);
  // the notice must then stay out instead of printing "Installed version undefined" (design.md, "Quando aparece").
  describe("C29 the notice needs every field it prints, each missing on its own", () => {
    const cases: Array<[string, (p: ProviderSnapshot) => void]> = [
      ["installedVersion absent", (p) => delete p.installedVersion],
      ["installedVersion null", (p) => (p.installedVersion = null)],
      ["installedVersion empty", (p) => (p.installedVersion = "")],
      ["testedVersions absent", (p) => delete p.testedVersions],
      ["testedVersions null", (p) => (p.testedVersions = null)],
    ];
    for (const status of ["older", "newer"] as const) {
      for (const [label, strip] of cases) {
        it(`${status} with ${label} shows no notice`, () => {
          const bare = snapshot("claude", "raw --version text", "1.2.3", status);
          strip(bare);
          // A second, complete provider proves the screen did render a notice for the others.
          setup([bare, snapshot("codex", "99.0.0", "99.0.0", status)]);
          const cards = Array.from(document.querySelectorAll(".provider-row"));
          expect(cards).toHaveLength(2);
          expect(cards[0]?.querySelectorAll('[role="note"]')).toHaveLength(0);
          expect(cards[1]?.querySelectorAll('[role="note"]')).toHaveLength(1);
          expect(document.body.textContent).not.toMatch(/undefined|null|NaN/);
        });
      }
    }

    it("the notice itself is the plain `meta` paragraph, in both languages", () => {
      for (const lang of ["en", "pt-BR"] as const) {
        setup(
          [snapshot("claude", "0.0.1", "0.0.1", "older"), snapshot("codex", "99.0.0", "99.0.0", "newer")],
          lang,
        );
        const notes = screen.getAllByRole("note");
        expect(notes.map((n) => [n.tagName, n.className])).toEqual([
          ["P", "meta"],
          ["P", "meta"],
        ]);
        cleanup();
      }
    });
  });
});
