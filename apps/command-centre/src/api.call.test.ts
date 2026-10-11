// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiCall } from "./apiCall";

/** Contratos REST (.specs/features/contratos-rest, C30): `apiCall` makes the request the route's key describes. */
describe("apiCall", () => {
  const seen: Array<{ url: string; method: string; body: unknown; headers: Record<string, string> }> = [];
  beforeEach(() => {
    seen.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (
          url: string,
          init: { method: string; body?: string; headers: Record<string, string>; signal?: AbortSignal },
        ) => {
          if (init.signal?.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
          seen.push({
            url,
            method: init.method,
            body: init.body === undefined ? undefined : JSON.parse(init.body),
            headers: init.headers,
          });
          return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        },
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("C30 apiCall builds the request from the route", async () => {
    // The method and the /api/v1 URL come from the key; a parameter is encoded, never spliced as it is.
    await apiCall("GET /api/runs/:id", { params: { id: "a b/../c" } });
    expect(seen[0]).toMatchObject({ method: "GET", url: "/api/v1/runs/a%20b%2F..%2Fc", body: undefined });

    // The query is serialised: numbers as text, a flag as 1, a flag that is off and a key with no value left out.
    await apiCall("GET /api/runs", { query: { limit: 5, status: "failed", provider: undefined } });
    expect(seen[1]!.url).toBe("/api/v1/runs?limit=5&status=failed");
    await apiCall("GET /api/skills/registry", { query: { refresh: true } });
    expect(seen[2]!.url).toBe("/api/v1/skills/registry?refresh=1");
    await apiCall("GET /api/skills/registry", { query: { refresh: false } });
    expect(seen[3]!.url).toBe("/api/v1/skills/registry");
    await apiCall("GET /api/artifacts/file", { query: { p: "notes/a&b.md" } });
    expect(seen[4]!.url).toBe("/api/v1/artifacts/file?p=notes%2Fa%26b.md");
    // A space is %20, as in the URLs the screens spelled by hand, and the keys keep the order they were given.
    await apiCall("GET /api/memory/search", { query: { q: "two words", limit: 8 } });
    expect(seen[5]!.url).toBe("/api/v1/memory/search?q=two%20words&limit=8");
    seen.splice(5, 1);

    // The body goes as JSON, with the method of the key.
    await apiCall("POST /api/runs", { body: { prompt: "hello" } });
    expect(seen[5]).toMatchObject({ method: "POST", url: "/api/v1/runs", body: { prompt: "hello" } });
    expect(seen[5]!.headers["content-type"]).toBe("application/json");
    await apiCall("PUT /api/providers/default", { body: { provider: "claude" } });
    expect(seen[6]).toMatchObject({
      method: "PUT",
      url: "/api/v1/providers/default",
      body: { provider: "claude" },
    });
    await apiCall("PATCH /api/sessions/:id", { params: { id: "s1" }, body: { title: "t" } });
    expect(seen[7]).toMatchObject({ method: "PATCH", url: "/api/v1/sessions/s1", body: { title: "t" } });
    await apiCall("DELETE /api/sessions/:id", { params: { id: "s1" } });
    expect(seen[8]).toMatchObject({ method: "DELETE", url: "/api/v1/sessions/s1", body: undefined });

    // No input, no body: nothing is sent as a body, and the request options reach the fetch.
    await apiCall("POST /api/system/restart");
    expect(seen[9]).toMatchObject({ method: "POST", url: "/api/v1/system/restart", body: undefined });
    const controller = new AbortController();
    controller.abort();
    await expect(apiCall("GET /api/meta", undefined, { signal: controller.signal })).rejects.toThrow();
  });
});
