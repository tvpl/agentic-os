/**
 * Playwright globalSetup. The server (and its home) is already up by the time
 * this runs — Playwright starts `webServer` first — so the job here is only to
 * publish the home and the local API token to the spec workers via env.
 */
import { E2E_HOME, readE2eToken } from "./home.mjs";

export default function globalSetup(): void {
  process.env.MORDOMO_HOME = E2E_HOME;
  const token = readE2eToken();
  if (token) process.env.MORDOMO_TOKEN = token;
}
