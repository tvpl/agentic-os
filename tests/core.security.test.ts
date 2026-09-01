import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  redactSecrets,
  isInside,
  resolveInsideRoots,
  PathAccessError,
  makeExcludeMatcher,
  isSecretFile,
  assertAllowed,
  ExecutableNotAllowedError,
  safeSpawn,
} from "@mordomo/core";
import { makeTempHome } from "./helpers.js";

describe("secret redaction", () => {
  it("redacts common token shapes", () => {
    const input = [
      "key sk-abc123def456ghi789jkl000",
      "gh ghp_ABCDEFGHIJKLMNOPQRSTUVWX123456",
      "slack xoxb-1234567890-abcdefghij",
      "aws AKIAIOSFODNN7EXAMPLE",
      "password=SuperSecret123",
      "Authorization: Bearer abcdefghij1234567890XYZ",
    ].join("\n");
    const out = redactSecrets(input);
    expect(out).not.toContain("sk-abc123def456ghi789jkl000");
    expect(out).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWX123456");
    expect(out).not.toContain("SuperSecret123");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out).toContain("[REDACTED");
  });

  it("keeps normal text intact", () => {
    const text = "Fix the login page and update the docs.";
    expect(redactSecrets(text)).toBe(text);
  });
});

describe("path containment", () => {
  it("accepts paths inside roots and rejects traversal", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const inside = path.join(paths.home, "notes.md");
      fs.writeFileSync(inside, "hello");
      expect(resolveInsideRoots([paths.home], inside)).toBe(fs.realpathSync(inside));
      expect(() => resolveInsideRoots([paths.home], path.join(paths.home, "..", "escape.txt"))).toThrow(
        PathAccessError,
      );
      expect(() => resolveInsideRoots([paths.home], "/etc/passwd")).toThrow(PathAccessError);
    } finally {
      cleanup();
    }
  });

  it("refuses symlink escapes", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const link = path.join(paths.home, "sneaky");
      fs.symlinkSync("/etc", link);
      expect(() => resolveInsideRoots([paths.home], path.join(link, "passwd"))).toThrow(PathAccessError);
    } finally {
      cleanup();
    }
  });

  it("isInside handles prefixes correctly", () => {
    expect(isInside("/a/b", "/a/b/c")).toBe(true);
    expect(isInside("/a/b", "/a/bc")).toBe(false);
  });
});

describe("exclusions and secret files", () => {
  it("matches segments and globs", () => {
    const match = makeExcludeMatcher(["node_modules", ".env.*", "*.pem"]);
    expect(match("project/node_modules/pkg/index.js")).toBe(true);
    expect(match("config/.env.local")).toBe(true);
    expect(match("certs/server.pem")).toBe(true);
    expect(match("src/index.ts")).toBe(false);
  });

  it("flags secret files", () => {
    expect(isSecretFile("/home/x/.env")).toBe(true);
    expect(isSecretFile("/home/x/id_rsa")).toBe(true);
    expect(isSecretFile("/home/x/notes.md")).toBe(false);
  });
});

describe("safe spawn", () => {
  it("rejects non-allowlisted executables", () => {
    expect(() => assertAllowed("/bin/rm")).toThrow(ExecutableNotAllowedError);
    expect(() => assertAllowed("bash")).toThrow(ExecutableNotAllowedError);
  });

  it("runs allowlisted commands with argv arrays and enforces timeouts", async () => {
    const ok = safeSpawn("node", ["-e", "console.log('argv-safe $(echo nope)')"], {
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });
    const result = await ok.result;
    expect(result.exitCode).toBe(0);
    // No shell: command substitution must NOT be evaluated.
    expect(result.stdout).toContain("$(echo nope)");

    const hang = safeSpawn("node", ["-e", "setTimeout(() => {}, 60000)"], {
      cwd: process.cwd(),
      timeoutMs: 500,
    });
    const hung = await hang.result;
    expect(hung.timedOut).toBe(true);
    expect(hung.exitCode).not.toBe(0);
  }, 20_000);
});
