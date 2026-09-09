import { it, expect } from "vitest";
import { safeSpawn } from "@mordomo/core";

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
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
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
