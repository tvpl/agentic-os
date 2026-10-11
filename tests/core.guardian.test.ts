import { spawn } from "node:child_process";
import { it, expect } from "vitest";

it.skipIf(process.platform === "win32")(
  "guardian clears the owned process tree after its API parent is killed",
  async () => {
    const ready = Promise.withResolvers<number>();
    const provider = "process.on('SIGTERM',()=>{});console.log(process.pid);setInterval(()=>{},1000)";
    const code = `import {safeSpawn} from './core/dist/internal.js';safeSpawn(process.execPath,['-e',${JSON.stringify(provider)}],{cwd:process.cwd(),onStdout:chunk=>process.stdout.write(chunk)});`;
    const parent = spawn(process.execPath, ["--input-type=module", "-e", code], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    parent.stdout.on("data", (chunk) => {
      output += chunk;
      if (/^\d+\n/.test(output)) ready.resolve(Number(output.trim()));
    });
    parent.on("error", ready.reject);
    const timer = setTimeout(() => ready.reject(new Error("Fixture did not start")), 5000);
    let pid: number | undefined;
    try {
      pid = await ready.promise;
      parent.kill("SIGKILL");
      await expect
        .poll(
          () => {
            try {
              process.kill(pid!, 0);
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 8000 },
        )
        .toBe(false);
    } finally {
      clearTimeout(timer);
      parent.kill("SIGKILL");
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* fixture already cleaned */
        }
      }
    }
  },
  15000,
);
