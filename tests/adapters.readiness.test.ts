import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import { CodexAdapter } from "@mordomo/adapter-codex";
import { CursorAdapter } from "@mordomo/adapter-cursor";
import { FAKE_BIN, makeTempHome } from "./helpers.js";

describe("provider readiness evidence", () => {
  for (const [name, Adapter, marker] of [
    ["claude", ClaudeAdapter, ".claude/.credentials.json"],
    ["codex", CodexAdapter, ".codex/auth.json"],
  ] as const) {
    it(`${name}: credential presence is not proof of a valid session`, async () => {
      const { paths, cleanup } = makeTempHome();
      try {
        const file = path.join(paths.home, marker);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "{}");
        const adapter = new Adapter({ binaryPath: path.join(FAKE_BIN, name), homeDir: paths.home });
        expect((await adapter.authenticate()).authenticated).toBe("unknown");
        expect((await adapter.healthCheck()).ok).toBe(false);
      } finally {
        cleanup();
      }
    });
  }
  it("the e2e fake claude reads as signed in on a machine with no ~/.claude (FAKE_CLAUDE_LOGGED_IN)", async () => {
    vi.stubEnv("FAKE_CLAUDE_LOGGED_IN", "1");
    try {
      const adapter = new ClaudeAdapter({ binaryPath: path.join(FAKE_BIN, "claude") });
      expect((await adapter.authenticate()).authenticated).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  for (const Adapter of [ClaudeAdapter, CodexAdapter, CursorAdapter]) {
    it(`${Adapter.name}: unknown auth must not produce a green health status`, async () => {
      const adapter = new Adapter();
      vi.spyOn(adapter, "detect").mockResolvedValue({
        installed: true,
        binaryPath: "/test",
        version: "test",
        supportedFlags: [],
        notes: [],
      });
      vi.spyOn(adapter, "authenticate").mockResolvedValue({
        authenticated: "unknown",
        method: null,
        detail: "unverified",
      });
      expect((await adapter.healthCheck()).ok).toBe(false);
    });
  }
  for (const output of ["Not logged in", "Unauthenticated", "Not authenticated", "Login required"]) {
    it(`cursor: zero exit code with '${output}' is not an active login`, async () => {
      const { paths, cleanup } = makeTempHome();
      try {
        const binaryPath = path.join(paths.home, "cursor-agent");
        fs.writeFileSync(binaryPath, `#!/bin/sh\nprintf '%s\\n' '${output}'\n`, { mode: 0o755 });
        expect((await new CursorAdapter({ binaryPath }).authenticate()).authenticated).toBe(false);
      } finally {
        cleanup();
      }
    });
  }
});

describe("Claude advertised auth status command", () => {
  for (const [payload, exitCode, expected] of [
    ['{"loggedIn":true,"email":"private@example.test"}', 0, true],
    ['{"loggedIn":false}', 1, false],
    ['{"loggedIn":false}', 0, false],
    ['{"loggedIn":true}', 1, "unknown"],
    ['{"loggedIn":"true"}', 0, "unknown"],
    ["unexpected output", 0, "unknown"],
  ] as const) {
    it(`validates status shape and exit (${payload}, ${exitCode})`, async () => {
      const { paths, cleanup } = makeTempHome();
      try {
        const binaryPath = path.join(paths.home, "claude");
        fs.writeFileSync(
          binaryPath,
          `#!/bin/sh
case "$1" in
--version) echo test; exit 0;;
--help) echo '  auth [options] Authentication'; exit 0;;
auth) printf '%s\\n' '${payload}'; exit ${exitCode};;
esac
exit 2
`,
          { mode: 0o755 },
        );
        const result = await new ClaudeAdapter({ binaryPath }).authenticate();
        expect(result.authenticated).toBe(expected);
        expect(result.detail).not.toContain("private@example.test");
      } finally {
        cleanup();
      }
    });
  }
});
