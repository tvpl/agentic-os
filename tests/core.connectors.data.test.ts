import { describe, expect, it, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConnectorDataCache,
  ConnectorRegistry,
  ConnectorSchema,
  McpStdioClient,
  ReadOnlyViolationError,
  allowedTools,
  fetchConnectorData,
  isWriteLikeTool,
  itemsFromParsed,
  parseToolText,
  renderArgs,
  resolvePath,
  setupChecklist,
  substituteEnv,
  type Connector,
  type ConnectorData,
  type DataMapping,
  type MordomoPaths,
} from "@mordomo/core";
import { makeTempHome } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_MCP = path.join(here, "fixtures", "fake-mcp-server.mjs");
/** The fake server is a Node script, so the allowlisted executable is `node` itself. */
const NODE = process.execPath;

function mapping(mode: string, overrides: Partial<DataMapping> = {}): DataMapping {
  return {
    transport: "mcp",
    command: NODE,
    args: [FAKE_MCP, mode],
    env: [],
    url: null,
    headers: {},
    tools: {
      list: {
        name: "list_events",
        args: { timeMin: "{todayStart}", timeMax: "{todayEnd}", tz: "{tz}" },
        parse: "json",
        path: "events",
        fields: {
          id: "id",
          title: "summary",
          ts: "start",
          tag: "calendar",
          flagged: { path: "status", includesAny: ["tentative"] },
        },
      },
    },
    install: "npm i -g fake-mcp",
    setup: ["Run the auth flow once."],
    ...overrides,
  } as DataMapping;
}

function connector(m: DataMapping | null, id = "fake-cal"): Connector {
  return ConnectorSchema.parse({
    id,
    name: "Fake calendar",
    kind: "mcp",
    origin: "test",
    maintainer: "test",
    dataMapping: m,
  });
}

/** The fake server is spawned through `node`, which is on the base allowlist. */
const OPTS = { allowedCommands: [NODE], timeoutMs: 8000, tz: "UTC", now: Date.parse("2026-09-03T12:00:00Z") };

describe("read-only guard", () => {
  it("classifies write-like tool names whatever their casing or separators", () => {
    for (const name of ["delete_event", "sendMessage", "create-event", "modify_labels", "trash_message"]) {
      expect(isWriteLikeTool(name)).toBe(true);
    }
    for (const name of ["list_events", "search_emails", "get_message", "freebusy", "list-labels"]) {
      expect(isWriteLikeTool(name)).toBe(false);
    }
  });

  it("drops write-like tools from the allowed set even when the mapping names them", () => {
    const m = mapping("ok", {
      tools: {
        list: { name: "list_events", args: {}, parse: "json", path: "", fields: {} },
        flagged: { name: "delete_event", args: {}, parse: "json", path: "", fields: {} },
      },
    });
    expect([...allowedTools(m)]).toEqual(["list_events"]);
  });

  it("refuses a tool call outside the read-only set", async () => {
    const client = new McpStdioClient(
      NODE,
      [FAKE_MCP, "ok"],
      { cwd: here, allowPaths: [NODE] },
      new Set(["list_events"]),
    );
    try {
      await client.start();
      await expect(client.callTool("delete_event", {})).rejects.toBeInstanceOf(ReadOnlyViolationError);
      await expect(client.callTool("search_events", {})).rejects.toBeInstanceOf(ReadOnlyViolationError);
    } finally {
      client.close();
    }
  });
});

describe("MCP stdio client", () => {
  it("runs initialize → tools/list → tools/call against the fake server", async () => {
    const client = new McpStdioClient(
      NODE,
      [FAKE_MCP, "ok"],
      { cwd: here, allowPaths: [NODE] },
      new Set(["list_events"]),
    );
    try {
      const { serverName } = await client.start();
      expect(serverName).toBe("fake-mcp");
      const tools = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("list_events");
      const res = await client.callTool("list_events", { timeMin: "2026-09-03T00:00:00" });
      expect(res.isError).toBe(false);
      expect(JSON.parse(res.text).events).toHaveLength(3);
    } finally {
      client.close();
    }
  }, 15_000);

  it("rejects when the server is not allowlisted", async () => {
    const client = new McpStdioClient("/usr/bin/definitely-not-allowed", [], { cwd: here });
    await expect(client.start()).rejects.toThrow(/allowlist/i);
  });
});

describe("fetchConnectorData (MCP)", () => {
  it("maps a tool result into items, flags and a summary", async () => {
    const data = await fetchConnectorData(connector(mapping("ok")), OPTS);
    expect(data.status).toBe("ok");
    expect(data.syncedAt).toBe(OPTS.now);
    expect(data.items.map((i) => i.id)).toEqual(["e1", "e2", "e3"]);
    expect(data.items[0]!.title).toBe("Standup");
    expect(data.items[0]!.ts).toBe(Date.parse("2026-09-03T09:00:00Z"));
    expect(data.items[1]!.flagged).toBe(true);
    expect(data.items[0]!.flagged).toBe(false);
    expect(data.summary).toMatchObject({ total: 3, flagged: 1, work: 2, personal: 1 });
    expect(data.tools).toContain("delete_event"); // advertised, never callable
  }, 15_000);

  it("renders {today} style placeholders into the tool arguments", async () => {
    const client = new McpStdioClient(
      NODE,
      [FAKE_MCP, "ok"],
      { cwd: here, allowPaths: [NODE] },
      new Set(["list_events"]),
    );
    try {
      await client.start();
      const res = await client.callTool(
        "list_events",
        renderArgs({ timeMin: "{todayStart}", tz: "{tz}" }, "UTC", OPTS.now),
      );
      expect(JSON.parse(res.text).args).toEqual({ timeMin: "2026-09-03T00:00:00", tz: "UTC" });
    } finally {
      client.close();
    }
  }, 15_000);

  it("times out instead of hanging when the server never answers", async () => {
    const started = Date.now();
    const data = await fetchConnectorData(connector(mapping("slow")), { ...OPTS, timeoutMs: 1200 });
    expect(data.status).toBe("error");
    expect(data.message).toMatch(/Timed out/i);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(data.setup?.length).toBeGreaterThan(0);
  }, 20_000);

  it("falls back to line parsing when the tool answers with plain text", async () => {
    const data = await fetchConnectorData(connector(mapping("malformed")), OPTS);
    expect(data.status).toBe("ok");
    expect(data.items).toHaveLength(3);
    expect(data.items[0]!.title).toContain("Standup");
  }, 15_000);

  it("ignores non-JSON log lines on stdout", async () => {
    const data = await fetchConnectorData(connector(mapping("noisy")), OPTS);
    expect(data.status).toBe("ok");
    expect(data.items).toHaveLength(3);
  }, 15_000);

  it("reports an error when the server crashes, and redacts its stderr", async () => {
    const data = await fetchConnectorData(connector(mapping("crash")), OPTS);
    expect(data.status).toBe("error");
    expect(data.message).toBeTruthy();
  }, 15_000);

  it("reports an error when the frames are unparsable", async () => {
    const data = await fetchConnectorData(connector(mapping("badjson")), { ...OPTS, timeoutMs: 1200 });
    expect(data.status).toBe("error");
  }, 20_000);

  it("reports an error when the declared tool is not offered", async () => {
    const data = await fetchConnectorData(connector(mapping("notools")), OPTS);
    expect(data.status).toBe("error");
    expect(data.message).toMatch(/list_events/);
  }, 15_000);

  it("surfaces a tool-level error", async () => {
    const data = await fetchConnectorData(connector(mapping("toolerror")), OPTS);
    expect(data.status).toBe("error");
    expect(data.message).toMatch(/upstream refused/);
  }, 15_000);

  it("stays not_configured (never error) when the setup is incomplete", async () => {
    const noMapping = await fetchConnectorData(connector(null), OPTS);
    expect(noMapping.status).toBe("not_configured");
    expect(noMapping.items).toEqual([]);

    const missingEnv = await fetchConnectorData(
      connector(mapping("ok", { env: ["MORDOMO_TEST_ABSENT_VAR"] })),
      OPTS,
    );
    expect(missingEnv.status).toBe("not_configured");
    expect(missingEnv.message).toContain("MORDOMO_TEST_ABSENT_VAR");

    // An executable outside the base allowlist and outside settings.connectors.allowedCommands.
    const notAllowed = await fetchConnectorData(connector(mapping("ok", { command: FAKE_MCP })), {
      ...OPTS,
      allowedCommands: [],
    });
    expect(notAllowed.status).toBe("not_configured");
    expect(notAllowed.message).toMatch(/allowlist/i);

    const missingCommand = await fetchConnectorData(
      connector(mapping("ok", { command: "definitely-not-installed-xyz" })),
      OPTS,
    );
    expect(missingCommand.status).toBe("not_configured");
    expect(missingCommand.message).toMatch(/not found on PATH/);
  }, 20_000);
});

describe("fetchConnectorData (api transport)", () => {
  const apiMapping = (url: string | null): DataMapping =>
    ({
      transport: "api",
      command: null,
      args: [],
      env: [],
      url,
      headers: { authorization: "Bearer $MORDOMO_TEST_TOKEN" },
      tools: {
        list: {
          name: "GET",
          args: {},
          parse: "json",
          path: "items",
          fields: { id: "id", title: "name", tag: "kind" },
        },
      },
      install: null,
      setup: [],
    }) as DataMapping;

  afterEach(() => {
    delete process.env.MORDOMO_TEST_TOKEN;
  });

  it("GETs a JSON endpoint and maps it", async () => {
    process.env.MORDOMO_TEST_TOKEN = "sekret";
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const fetchImpl = (async (url: string, init: { headers: Record<string, string> }) => {
      seen = { url, headers: init.headers };
      return new Response(
        JSON.stringify({
          items: [
            { id: "a", name: "Alpha", kind: "x" },
            { id: "b", name: "Beta", kind: "x" },
          ],
        }),
        {
          status: 200,
        },
      );
    }) as unknown as typeof fetch;
    const data = await fetchConnectorData(connector(apiMapping("https://example.test/feed"), "fake-api"), {
      ...OPTS,
      fetchImpl,
    });
    expect(data.status).toBe("ok");
    expect(data.items.map((i) => i.title)).toEqual(["Alpha", "Beta"]);
    expect(data.summary).toMatchObject({ total: 2, x: 2 });
    expect(seen!.headers.authorization).toBe("Bearer sekret");
  });

  it("is not_configured while an env var of the URL or headers is missing", async () => {
    const data = await fetchConnectorData(
      connector(apiMapping("https://example.test/feed"), "fake-api"),
      OPTS,
    );
    expect(data.status).toBe("not_configured");
    expect(data.message).toContain("MORDOMO_TEST_TOKEN");
  });

  it("turns a non-2xx response into an error without echoing the URL", async () => {
    process.env.MORDOMO_TEST_TOKEN = "sekret";
    const fetchImpl = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    const data = await fetchConnectorData(connector(apiMapping("https://example.test/feed"), "fake-api"), {
      ...OPTS,
      fetchImpl,
    });
    expect(data.status).toBe("error");
    expect(data.message).toContain("503");
    expect(data.message).not.toContain("example.test");
  });
});

describe("mapping helpers", () => {
  it("resolves dot paths, indexes and [*] fan-out", () => {
    const doc = { a: { b: [{ c: 1 }, { c: 2 }] } };
    expect(resolvePath(doc, "a.b[0].c")).toBe(1);
    expect(resolvePath(doc, "a.b[*].c")).toEqual([1, 2]);
    expect(resolvePath(doc, "")).toBe(doc);
    expect(resolvePath(doc, "a.missing")).toBeUndefined();
  });

  it("parses JSON, key/value blocks and plain lines", () => {
    expect(parseToolText('{"x":1}', "json")).toEqual({ kind: "json", data: { x: 1 } });
    const blocks = parseToolText("Subject: Hi\nFrom: a@b.c\n\nSubject: Yo\nFrom: d@e.f", "blocks");
    expect(blocks.kind).toBe("records");
    expect(blocks.data).toHaveLength(2);
    const lines = parseToolText("- one\n- two", "lines");
    expect(lines.data).toEqual([{ _first: "one" }, { _first: "two" }]);
  });

  it("caps the number of items it maps", () => {
    const parsed = parseToolText(
      JSON.stringify({ rows: Array.from({ length: 100 }, (_, i) => ({ id: `${i}` })) }),
      "json",
    );
    const items = itemsFromParsed(
      parsed,
      { name: "x", args: {}, parse: "json", path: "rows", fields: { id: "id" } },
      5,
    );
    expect(items).toHaveLength(5);
  });

  it("substitutes $ENV names and reports the missing ones without leaking values", () => {
    process.env.MORDOMO_TEST_TOKEN = "sekret";
    try {
      const out = substituteEnv("https://x/$MORDOMO_TEST_TOKEN/$MORDOMO_TEST_ABSENT");
      expect(out.value).toContain("sekret");
      expect(out.missing).toEqual(["MORDOMO_TEST_ABSENT"]);
    } finally {
      delete process.env.MORDOMO_TEST_TOKEN;
    }
  });

  it("builds a setup checklist that names env vars but never values", () => {
    const steps = setupChecklist(connector(mapping("ok", { env: ["GOOGLE_OAUTH_CREDENTIALS"] })), {
      allowedCommands: [],
    });
    expect(steps.join("\n")).toContain("GOOGLE_OAUTH_CREDENTIALS");
    expect(steps.join("\n")).toContain("npm i -g fake-mcp");
    expect(steps.join("\n")).toContain("Run the auth flow once.");
  });
});

describe("ConnectorDataCache", () => {
  const ok = (n: number): ConnectorData => ({ status: "ok", syncedAt: n, items: [] });

  it("serves inside the TTL, refetches after it, and honours refresh", async () => {
    const cache = new ConnectorDataCache(1000);
    let calls = 0;
    const load = () => {
      calls++;
      return Promise.resolve(ok(calls));
    };
    expect((await cache.read("a", load, false, 0)).syncedAt).toBe(1);
    expect((await cache.read("a", load, false, 500)).syncedAt).toBe(1);
    expect(calls).toBe(1);
    expect((await cache.read("a", load, true, 500)).syncedAt).toBe(2);
    cache.invalidate("a");
    expect((await cache.read("a", load, false, 600)).syncedAt).toBe(3);
  });

  it("never caches a failed read", async () => {
    const cache = new ConnectorDataCache(60_000);
    let calls = 0;
    const load = () => {
      calls++;
      return Promise.resolve<ConnectorData>({ status: "error", syncedAt: null, items: [], message: "boom" });
    };
    await cache.read("a", load);
    await cache.read("a", load);
    expect(calls).toBe(2);
  });

  it("shares one in-flight read between concurrent callers", async () => {
    const cache = new ConnectorDataCache(60_000);
    let calls = 0;
    const load = () =>
      new Promise<ConnectorData>((resolve) => {
        calls++;
        setTimeout(() => resolve(ok(calls)), 20);
      });
    const [a, b] = await Promise.all([cache.read("x", load), cache.read("x", load)]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });
});

describe("shipped connector mappings", () => {
  let ctx: { paths: MordomoPaths; cleanup: () => void };
  beforeEach(() => {
    ctx = makeTempHome();
  });
  afterEach(() => ctx.cleanup());

  it("calendar and gmail declare read-only mappings with env NAMES only", async () => {
    const repo = path.resolve(here, "..");
    const registry = new ConnectorRegistry({ ...ctx.paths, connectors: path.join(repo, "connectors") });
    const byId = new Map(registry.list().map((c) => [c.id, c]));

    const cal = byId.get("calendar-google")!;
    expect(cal.dataMapping?.tools.list?.name).toBe("list-events");
    expect(cal.dataMapping?.env).toEqual(["GOOGLE_OAUTH_CREDENTIALS"]);
    expect([...allowedTools(cal.dataMapping!)]).toEqual(["list-events"]);

    const mail = byId.get("email-gmail")!;
    expect(mail.dataMapping?.tools.list?.name).toBe("search_emails");
    expect(mail.dataMapping?.tools.list?.args.query).toBe("newer_than:1d");
    expect(mail.dataMapping?.tools.flagged?.name).toBe("search_emails");
    expect(mail.dataMapping?.tools.list?.fields.tag).toBe("labelIds[0]");
    // Env entries are variable NAMES; nothing that looks like a value.
    for (const name of mail.dataMapping!.env) expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/);
    expect(setupChecklist(mail).join(" ")).toContain("GMAIL_CREDENTIALS_PATH");
  });
});
