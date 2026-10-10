import fs from "node:fs";
import path from "node:path";

/**
 * A rendezvous for child processes that must act at the same moment: each writes a marker file and waits until
 * `parties` markers exist. It lines processes up by what they have DONE, not by a clock, so a host that starts
 * them late (a loaded CI machine) delays all of them equally instead of letting the race slip by.
 */
export function barrier(dir: string, name: string, parties: number, timeoutMs = 120_000): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.${process.pid}`), "");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (fs.readdirSync(dir).filter((file) => file.startsWith(`${name}.`)).length >= parties) return;
    if (Date.now() > deadline) throw new Error(`barrier ${name}: ${parties} parties did not arrive`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
  }
}
