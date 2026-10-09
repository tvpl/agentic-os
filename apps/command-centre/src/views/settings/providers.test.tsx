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

function setup(providers: ProviderSnapshot[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(qk.providers, providers);
  const s = { providers: {} } as unknown as SettingsShape;
  render(
    <QueryClientProvider client={qc}>
      <ProvidersTab s={s} put={() => Promise.resolve({ ok: true })} />
    </QueryClientProvider>,
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

  it("shows nothing for a server that does not send versionStatus", () => {
    const old = snapshot("claude", "0.0.1", "0.0.1", "older");
    delete old.versionStatus;
    delete old.installedVersion;
    delete old.testedVersions;
    setup([old]);
    expect(screen.queryAllByRole("note")).toEqual([]);
  });
});
