// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, apiUrl } from "./api";

describe("API version prefix", () => {
  it("C6 the UI prefixes v1 once", () => {
    expect(apiUrl("/api/runs")).toBe("/api/v1/runs");
    expect(apiUrl("/api/v1/runs")).toBe("/api/v1/runs");
    expect(apiUrl("/api/runs/abc/stream?token=t")).toBe("/api/v1/runs/abc/stream?token=t");
    expect(apiUrl("/assets/logo.svg")).toBe("/assets/logo.svg");
  });
});

describe("streams without a credential in the URL", () => {
  type Handler = ((e: unknown) => void) | null;
  class FakeEventSource {
    static instances: FakeEventSource[] = [];
    onopen: Handler = null;
    onmessage: Handler = null;
    onerror: Handler = null;
    closed = false;
    constructor(readonly url: string) {
      FakeEventSource.instances.push(this);
    }
    addEventListener() {}
    close() {
      this.closed = true;
    }
  }
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  let issued = 0;

  beforeEach(() => {
    FakeEventSource.instances = [];
    requests.length = 0;
    issued = 0;
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: { method: string; body?: string }) => {
        requests.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
        issued += 1;
        return Promise.resolve(new Response(JSON.stringify({ ticket: `tk_${issued}` }), { status: 200 }));
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("C34 streams open with a ticket", async () => {
    const stop = api.streamEvents(() => undefined, { onError: () => undefined });
    await settle();
    expect(requests).toEqual([{ url: "/api/v1/stream-tickets", method: "POST", body: { target: "events" } }]);
    expect(FakeEventSource.instances.map((i) => i.url)).toEqual(["/api/v1/events?ticket=tk_1"]);
    stop();

    // A close hands over to the caller, whose next stream resumes after the last frame this one saw.
    let errored = 0;
    const second = api.streamEvents(() => undefined, { onError: () => (errored += 1) });
    await settle();
    const live = FakeEventSource.instances.at(-1)!;
    expect(live.url).toBe("/api/v1/events?ticket=tk_2");
    live.onmessage?.({ data: JSON.stringify({ type: "run.finished", payload: {} }), lastEventId: "7" });
    live.onerror?.({});
    expect(live.closed).toBe(true);
    expect(errored).toBe(1);
    second();
    api.streamEvents(() => undefined);
    await settle();
    expect(FakeEventSource.instances.at(-1)!.url).toBe("/api/v1/events?ticket=tk_3&since=7");

    // A stream closed before its ticket arrives never opens.
    const before = FakeEventSource.instances.length;
    api.streamEvents(() => undefined)();
    await settle();
    expect(FakeEventSource.instances).toHaveLength(before);

    // No URL the UI opens carries the token.
    for (const instance of FakeEventSource.instances) expect(instance.url).not.toContain("token=");
  });

  it("C34 a run stream reopens with a new ticket until its final frame", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const run = "11111111-1111-4111-8111-111111111111";
    const stop = api.streamRun(run, (e) => seen.push(String(e.type)));
    await vi.advanceTimersByTimeAsync(0);
    expect(requests.at(-1)).toEqual({
      url: "/api/v1/stream-tickets",
      method: "POST",
      body: { target: "run", runId: run },
    });
    const first = FakeEventSource.instances.at(-1)!;
    expect(first.url).toBe(`/api/v1/runs/${run}/stream?ticket=tk_1`);
    first.onmessage?.({ data: JSON.stringify({ type: "assistant" }), lastEventId: "41" });
    first.onerror?.({});
    expect(first.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    const second = FakeEventSource.instances.at(-1)!;
    expect(second.url).toBe(`/api/v1/runs/${run}/stream?ticket=tk_2&since=41`);
    second.onmessage?.({ data: JSON.stringify({ type: "run_state", status: "done" }) });
    expect(second.closed).toBe(true);
    second.onerror?.({});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(seen).toEqual(["assistant", "run_state"]);
    stop();
    for (const instance of FakeEventSource.instances) expect(instance.url).not.toContain("token=");
  });
});

describe("which credential the page runs with", () => {
  afterEach(() => {
    localStorage.clear();
    document.head.innerHTML = "";
    vi.resetModules();
  });

  it("the token the server injected is the owner's; a stored device token is a paired device", async () => {
    vi.resetModules();
    document.head.innerHTML = '<meta name="mordomo-token" content="owner-token" />';
    const owner = await import("./api");
    expect(owner.isPairedDevice()).toBe(false);
    expect(owner.getToken()).toBe("owner-token");

    vi.resetModules();
    document.head.innerHTML = '<meta name="mordomo-token" content="" />';
    localStorage.setItem("mordomo.deviceToken", "device-token");
    const device = await import("./api");
    expect(device.isPairedDevice()).toBe(true);
    expect(device.getToken()).toBe("device-token");

    vi.resetModules();
    localStorage.clear();
    const unpaired = await import("./api");
    expect(unpaired.isPairedDevice()).toBe(false);
    expect(unpaired.needsPairing()).toBe(true);
  });
});
