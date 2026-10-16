/**
 * Fails a test file that asked the translator for a key no dictionary has (limpeza-legado, round 1: the UI suite
 * asked 344 times for `status.completed` and the screen would have shown the key). `tf` records the miss only
 * under vitest (`missingKeys`). A key a test asks for ON PURPOSE, to prove the fallback, is listed with the reason.
 */
import { afterAll } from "vitest";
import { missingKeys } from "../i18n";

const ASKED_ON_PURPOSE: Record<string, string> = {};

afterAll(() => {
  const lost = [...(missingKeys ?? [])].filter((k) => !(k in ASKED_ON_PURPOSE)).sort();
  if (lost.length > 0) throw new Error(`asked for translation keys no dictionary has: ${lost.join(", ")}`);
});
