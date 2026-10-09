import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../../apps/api/src/context.js";
import { buildServer } from "../../apps/api/src/server.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "../helpers.js";

/**
 * A real server over a temporary home, one folder of the user's, the owner's token and a paired device's:
 * what every proof that asks "can a paired device, or the owner, read the owner token through this route" needs.
 */
export interface SecureServer {
  ctx: AppContext;
  app: FastifyInstance;
  /** Real path of the MordomoOS home. */
  home: string;
  /** Real path of an indexed folder outside the home. */
  userFolder: string;
  ownerToken: string;
  deviceToken: string;
  asOwner(): Record<string, string>;
  asDevice(): Record<string, string>;
  principals(): ReadonlyArray<readonly ["device" | "owner", Record<string, string>]>;
  tokenFile(): string;
  close(): Promise<void>;
}

export async function startSecureServer(prefix = "mordomo-sec-"): Promise<SecureServer> {
  const restorePath = withFakeBinPath();
  const tmp = makeTempHome(prefix);
  const home = fs.realpathSync(tmp.paths.home);
  const ctx = new AppContext(tmp.paths.home);
  const userFolder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}user-`)));
  const settings = ctx.settings();
  settings.setupCompleted = true;
  settings.remote.enabled = true;
  settings.remote.allowedHosts = ["mordomo.local"];
  settings.indexedFolders = [{ path: userFolder, area: null, enabled: true }];
  settings.providers.claude.enabled = true;
  settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
  ctx.settingsStore.save(settings);
  ctx.reloadAdapters();
  const ownerToken = ctx.token();
  const app = await buildServer(ctx);
  const asOwner = () => ({ "x-mordomo-token": ownerToken, "content-type": "application/json" });
  const start = await app.inject({ method: "POST", url: "/api/pair/start", headers: asOwner(), payload: {} });
  const claim = await app.inject({
    method: "POST",
    url: "/api/pair/claim",
    payload: { code: (start.json() as { code: string }).code, name: "lost phone" },
  });
  const deviceToken = (claim.json() as { token: string }).token;
  const asDevice = () => ({
    "x-mordomo-token": deviceToken,
    "content-type": "application/json",
    host: "mordomo.local:4777",
  });
  return {
    ctx,
    app,
    home,
    userFolder,
    ownerToken,
    deviceToken,
    asOwner,
    asDevice,
    principals: () =>
      [
        ["device", asDevice()],
        ["owner", asOwner()],
      ] as const,
    tokenFile: () => path.join(home, "config", "token"),
    async close() {
      await ctx.runs.shutdown(2000);
      await app.close();
      ctx.close();
      fs.rmSync(userFolder, { recursive: true, force: true });
      restorePath();
      tmp.cleanup();
    },
  };
}
