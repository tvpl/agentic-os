import { expect } from "vitest";
import type { Json, MemoriaWorld } from "./memoriaWorld.js";

/** Open an SSE URL on the world's server (listening on a free port), read until `until`, hang up. */
export async function stream(
  w: MemoriaWorld,
  url: string,
  until: RegExp,
  act: () => Promise<void>,
): Promise<string> {
  if (!w.app.server.listening) await w.app.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(w.app.server.address() as { port: number }).port}`;
  const ac = new AbortController();
  const res = await fetch(`${base}${url}`, { signal: ac.signal });
  expect(res.status, url).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let body = "";
  const first = await reader.read();
  body += decoder.decode(first.value);
  await act();
  const deadline = Date.now() + 5000;
  while (!until.test(body) && Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((r) =>
        setTimeout(() => r({ done: true, value: undefined }), 500),
      ),
    ]);
    if (chunk.done) {
      if (Date.now() >= deadline) break;
      continue;
    }
    body += decoder.decode(chunk.value);
  }
  ac.abort();
  return body;
}

export const ticket = async (
  w: MemoriaWorld,
  headers: Record<string, string>,
  payload: Json,
): Promise<string> => {
  const res = await w.call("POST", "/api/stream-tickets", payload, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.ticket as string;
};
