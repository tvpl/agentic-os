/**
 * Playwright `webServer` command: prepare the isolated home, then run the real
 * CLI in the foreground and forward signals so Playwright can stop it cleanly.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { CLI, E2E_HOME, FAKE_BIN, prepareE2eHome } from "./home.mjs";

prepareE2eHome({ fresh: process.env.MORDOMO_E2E_KEEP_HOME !== "1" });

const child = spawn(process.execPath, [CLI, "start", "--foreground"], {
  stdio: "inherit",
  env: {
    ...process.env,
    MORDOMO_HOME: E2E_HOME,
    PATH: `${FAKE_BIN}${path.delimiter}${process.env.PATH ?? ""}`,
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
