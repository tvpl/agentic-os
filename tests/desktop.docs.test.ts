import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** distribuicao: the runbook, the README and the workflow say the same thing (.specs/features/distribuicao, AC 38, 41). */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const workflow = read(".github/workflows/release.yml");
const runbook = read("docs/release.md");

const names = (text: string) =>
  [...new Set([...text.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]!))].sort();

describe("C49 the secrets of the workflow, of its header and of the runbook are one list", () => {
  const used = names(workflow);
  const header = workflow.slice(0, workflow.indexOf("\non:"));
  const documented = [
    ...new Set(
      [...runbook.slice(runbook.indexOf("## 2.")).matchAll(/^\| `([A-Z][A-Z0-9_]{5,})` \|/gm)].map(
        (m) => m[1]!,
      ),
    ),
  ].sort();

  it("C49 the workflow uses exactly ten secrets, and GITHUB_TOKEN is not one of them", () => {
    expect(used).toEqual([
      "APPLE_APP_PASSWORD",
      "APPLE_ID",
      "APPLE_TEAM_ID",
      "MACOS_CERT_P12_BASE64",
      "MACOS_CERT_PASSWORD",
      "MACOS_SIGN_IDENTITY",
      "TAURI_SIGNING_PRIVATE_KEY",
      "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
      "WINDOWS_CERT_PASSWORD",
      "WINDOWS_CERT_PFX_BASE64",
    ]);
    expect(workflow).not.toMatch(/secrets\.GITHUB_TOKEN/);
  });

  it("C49 the header comment of release.yml names every one of them (the convention it started), and no other", () => {
    const mentioned = [
      ...new Set([...header.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g)].map((m) => m[1]!)),
    ]
      .filter((n) => used.includes(n) || /^(MACOS|APPLE|WINDOWS|TAURI)_/.test(n))
      .sort();
    expect(mentioned).toEqual(used);
  });

  it("C49 docs/release.md documents every secret in a table row and documents no secret the workflow does not use", () => {
    expect(documented).toEqual(used);
  });
});

describe("C50 the runbook has what the owner needs, and says what was not run", () => {
  it("C50 it has the sections: what a release is, the secrets, cutting, verifying, the updater, rolling back, the shell, what was not run", () => {
    const headings = [...runbook.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      "1. What a release is",
      "2. One-time setup: the secrets",
      "3. Cutting a release",
      "4. Verifying a release",
      "5. The updater",
      "6. Rolling back",
      "7. The shell and its service",
      "8. What was not run",
      "9. When something fails",
    ]);
  });

  it("C50 the honest list names Windows, macOS, notarization, the workflow on GitHub and a real updater roundtrip as never run", () => {
    const section = runbook.slice(runbook.indexOf("## 8."), runbook.indexOf("## 9."));
    for (const item of [
      "**Windows**",
      "**macOS**",
      "**Notarization**",
      "release **workflow itself**",
      "real updater roundtrip",
    ])
      expect(section, item).toContain(item);
    expect(section).toContain("Never executed");
    expect(section).toContain("throwaway key");
  });

  it("C50 every script and npm script the runbook runs exists, and every file it links to is there", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    for (const m of runbook.matchAll(/node (scripts\/[a-z-]+\.mjs)/g))
      expect(fs.existsSync(path.join(ROOT, m[1]!)), m[1]).toBe(true);
    for (const m of runbook.matchAll(/npm run ([a-z:-]+)/g))
      expect(Object.keys(pkg.scripts), m[1]).toContain(m[1]);
    for (const m of runbook.matchAll(/\]\((\.\.?\/[^)#]+)/g))
      expect(fs.existsSync(path.join(ROOT, "docs", m[1]!)), m[1]).toBe(true);
    for (const named of ["release.yml", "smoke/gui.sh", "tauri.updater.conf.json"])
      expect(runbook, named).toContain(named);
  });

  it("C50 the README and the install guide point at it, and the CHANGELOG has the entry with what changed for existing proofs", () => {
    expect(read("README.md")).toContain("(docs/release.md)");
    expect(read("docs/install.md")).toContain("(release.md)");
    const unreleased = read("CHANGELOG.md").split("\n## ")[1]!;
    expect(unreleased).toContain("distribuicao");
    expect(unreleased).toContain("41 network points and 17 entries (was 37 and");
  });
});

describe("C62 what the window cannot do is written where a person looks, and says what was and was not observed", () => {
  const install = read("docs/install.md").replace(/\s+/g, " ");
  const notRun = runbook.slice(runbook.indexOf("## 8.")).replace(/\s+/g, " ");

  it("C62 saving a file from the window (blob: downloads) is a limit in the install guide and a 'not run' row in the runbook: seen on Linux, other systems unobserved, fix is an owner question", () => {
    expect(install).toContain("Exports that download a file do not save anything from the app's window");
    expect(install).toContain("Seen on Linux; macOS and Windows were not tried");
    expect(notRun).toContain('`<a download href="blob:…">`');
    expect(notRun).toContain("On **Linux** it was run");
    expect(notRun).toContain("macOS and Windows were **not** observed");
    expect(notRun).toContain("owner question");
  });

  it("C62 the claim is true of the code: the address policy refuses blob: and data:, and the window has no download handler", () => {
    const nav = read("apps/desktop/shell-core/src/nav.rs");
    expect(nav).toContain('"blob:http://127.0.0.1:41234/uuid"');
    expect(nav).toContain('"data:text/html,<script>1</script>"');
    expect(read("apps/desktop/src-tauri/src/shell.rs")).not.toContain("on_download");
    // and the page does build such a link (so the limit is real, not hypothetical)
    expect(read("apps/command-centre/src/views/settings/diagnostics.tsx")).toContain(
      "URL.createObjectURL(blob)",
    );
  });

  it("C62 the README of the desktop crate says which cargo commands need the payload first", () => {
    const readme = read("apps/desktop/README.md").replace(/\s+/g, " ");
    expect(readme).toContain("needs `apps/desktop/payload` first");
  });
});
