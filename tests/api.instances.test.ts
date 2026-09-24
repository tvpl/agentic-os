import { describe, expect, it } from "vitest";
import {
  buildStatus,
  isOlderService,
  isServiceCommand,
  orphanProcesses,
  parsePidList,
  parseProcessList,
  sameInstall,
} from "../apps/api/src/instances.js";

describe("service instances", () => {
  it("recognises MordomoOS service command lines and ignores everything else", () => {
    expect(isServiceCommand("/usr/bin/node /x/apps/api/dist/cli.js start --foreground")).toBe(true);
    expect(isServiceCommand("node C:\\MordomoOS\\lib\\mordomo.mjs start --foreground")).toBe(true);
    expect(isServiceCommand("/usr/bin/node /x/apps/api/dist/cli.js status")).toBe(false);
    expect(isServiceCommand("grep cli.js start")).toBe(false);
    expect(isServiceCommand("vite --config apps/command-centre/vite.config.ts")).toBe(false);
  });

  it("parses a ps listing into pid + command and drops non-service lines", () => {
    const text = [
      "  3967 /usr/bin/node /x/apps/api/dist/cli.js start --foreground",
      "51882 /usr/bin/node /x/apps/api/dist/cli.js start --foreground",
      "  120 /sbin/launchd",
      "garbage line",
    ].join("\n");
    expect(parseProcessList(text).map((p) => p.pid)).toEqual([3967, 51882]);
  });

  it("orphans are same-install siblings that are neither this process nor the pidfile owner", () => {
    const entry = "/x/apps/api/dist/cli.js";
    const all = [
      { pid: 1, command: "node /x/apps/api/dist/cli.js start --foreground" },
      { pid: 2, command: "node /x/apps/api/dist/cli.js start --foreground" },
      { pid: 3, command: "node /x/apps/api/dist/cli.js start --foreground" },
      // another checkout / the e2e server: never a leftover of this install
      { pid: 4, command: "node /other/apps/api/dist/cli.js start --foreground" },
    ];
    const none = new Set<number>();
    expect(orphanProcesses(all, 2, 3, entry, none).map((p) => p.pid)).toEqual([1]);
    expect(orphanProcesses(all, null, 3, entry, none).map((p) => p.pid)).toEqual([1, 2]);
    // a same-install process that is listening somewhere is another home's live server, never a leftover
    expect(orphanProcesses(all, null, 3, entry, new Set([1])).map((p) => p.pid)).toEqual([2]);
  });

  it("sameInstall compares entry paths case-insensitively and across slash styles", () => {
    expect(sameInstall("node C:\\MordomoOS\\lib\\mordomo.mjs start", "c:/mordomoos/lib/mordomo.mjs")).toBe(
      true,
    );
    expect(sameInstall("node /a/cli.js start", "/b/cli.js")).toBe(false);
  });

  it("a build is stale only when the files on disk are newer than the process", () => {
    expect(buildStatus(1000, 5000).stale).toBe(false);
    expect(buildStatus(5000, 1000).stale).toBe(true);
    expect(buildStatus(2500, 1000).stale).toBe(false); // within the write tolerance
    expect(buildStatus(0, 1000).stale).toBe(false); // unknown install time
  });

  it("`mordomo launch` restarts a server that reports itself stale or whose build is older than ours", () => {
    expect(isOlderService({ name: "M", version: "0.8.0", stale: true }, 0)).toBe(true);
    expect(isOlderService({ name: "M", version: "0.8.0", stale: false, installedAt: 1000 }, 9000)).toBe(true);
    expect(isOlderService({ name: "M", version: "0.8.0", stale: false, installedAt: 9000 }, 1000)).toBe(
      false,
    );
    expect(isOlderService({ name: "M", version: "0.7.0" }, 9000)).toBe(false); // older server: no build info, leave it
  });

  it("parsePidList tolerates blank lines and junk", () => {
    expect([...parsePidList("12\n\n 34 \nabc\n0")]).toEqual([12, 34]);
  });
});
