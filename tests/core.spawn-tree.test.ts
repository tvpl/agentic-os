import { spawn } from "node:child_process";
import fs from "node:fs";
import { it, expect } from "vitest";
import { safeSpawn } from "@mordomo/core";
import { processAlive } from "./helpers.js";

it.skipIf(process.platform === "win32")(
  "cancellation kills a TERM-resistant descendant even when its parent exits first",
  async () => {
    const ready = Promise.withResolvers<number>();
    const childCode = "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)";
    const parentCode = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:['ignore','pipe','ignore']});c.stdout.once('data',()=>console.log(c.pid));setInterval(()=>{},1000);`;
    const handle = safeSpawn(process.execPath, ["-e", parentCode], {
      cwd: process.cwd(),
      timeoutMs: 5000,
      onStdout: (chunk) => {
        if (/^\d+\s*$/.test(chunk)) ready.resolve(Number(chunk.trim()));
      },
    });
    const pid = await ready.promise;
    const alive = () => processAlive(pid);
    try {
      handle.cancel("fixture", 50);
      await handle.result;
      await expect.poll(alive, { timeout: 1000 }).toBe(false);
    } finally {
      // Own fixture only; never rely on process-name matching for cleanup.
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
      handle.kill("SIGKILL");
    }
  },
);

it("C3 liveness: alive, gone", () => {
  expect(processAlive(process.pid)).toBe(true);
  // PIDs are bounded well below this on every supported OS.
  expect(processAlive(2 ** 30)).toBe(false);
});

it.skipIf(process.platform !== "linux")("C4 liveness: a zombie is not alive", async () => {
  // `sh` starts a short-lived child in the background, then becomes `sleep`,
  // which never waits: the child exits after the exec and stays a zombie of
  // `sleep`, on any Linux. (An instant child could exit while `sh` is still
  // `sh`, which reaps it — the race that made this test flaky under load.)
  const parent = spawn("sh", ["-c", "sleep 0.3 & echo $!; exec sleep 5"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  try {
    const zombie = await new Promise<number>((resolve) =>
      parent.stdout!.once("data", (chunk: Buffer) => resolve(Number(String(chunk).trim()))),
    );
    await expect
      .poll(() => fs.readFileSync(`/proc/${zombie}/stat`, "utf8").split(") ")[1]![0], { timeout: 2000 })
      .toBe("Z");
    expect(processAlive(zombie)).toBe(false);
  } finally {
    parent.kill("SIGKILL");
  }
});
