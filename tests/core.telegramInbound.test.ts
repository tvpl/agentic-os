import { describe, expect, it } from "vitest";
import {
  TelegramPoller,
  approvalKeyboard,
  defaultSettings,
  parseCommand,
  type TelegramUpdate,
} from "@mordomo/core";

/** The phone answers back: buttons and commands become decisions, strangers get silence. */

function settingsWith(chatId = "42") {
  const s = defaultSettings();
  s.channels.telegram = { enabled: true, botTokenEnv: "TG_TOKEN", chatId, minTone: "warn", inbound: true };
  return s;
}

function fakeTelegram(updates: TelegramUpdate[]) {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = String(url).split("/").pop()!;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ method, body });
    if (method === "getUpdates") {
      const offset = Number(body.offset ?? 0);
      return new Response(
        JSON.stringify({ ok: true, result: updates.filter((u) => u.update_id >= offset) }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("telegram inbound", () => {
  it("parses buttons and commands", () => {
    expect(parseCommand("ap:abc-123456")).toEqual({
      type: "resolve",
      id: "abc-123456",
      decision: "approved",
    });
    expect(parseCommand("/deny 0123abcd")).toEqual({ type: "resolve", id: "0123abcd", decision: "denied" });
    expect(parseCommand("/approve@MyBot 0123abcd")).toEqual({
      type: "resolve",
      id: "0123abcd",
      decision: "approved",
    });
    expect(parseCommand("/pending")).toEqual({ type: "pending" });
    expect(parseCommand("hello there")).toBeNull();
    expect(approvalKeyboard("x1").inline_keyboard).toHaveLength(1);
  });

  it("resolves a button tap from the configured chat and answers the callback", async () => {
    const resolved: Array<[string, string]> = [];
    const tg = fakeTelegram([
      {
        update_id: 10,
        callback_query: { id: "cb1", data: "ap:approval-1", message: { message_id: 7, chat: { id: 42 } } },
      },
    ]);
    const poller = new TelegramPoller({
      getSettings: () => settingsWith("42"),
      env: { TG_TOKEN: "t0k" },
      fetchImpl: tg.fetchImpl,
      pollSeconds: 0,
      resolve: async (id, decision) => {
        resolved.push([id, decision]);
        return { ok: true, message: "✅ Approved: write notes" };
      },
      pending: () => [],
    });
    expect(poller.enabled()).toBe(true);
    const n = await poller.pollOnce();
    expect(n).toBe(1);
    expect(resolved).toEqual([["approval-1", "approved"]]);
    const methods = tg.calls.map((c) => c.method);
    expect(methods).toContain("answerCallbackQuery");
    expect(methods).toContain("editMessageReplyMarkup");
    expect(tg.calls.find((c) => c.method === "sendMessage")!.body.text).toContain("Approved");
    expect(poller.handled).toBe(1);
    // The offset advanced: a second poll sees nothing.
    expect(await poller.pollOnce()).toBe(0);
    expect(JSON.stringify(tg.calls)).not.toContain("t0k");
  });

  it("ignores messages from any other chat and answers /pending in ours", async () => {
    const resolved: string[] = [];
    const tg = fakeTelegram([
      { update_id: 1, message: { message_id: 1, chat: { id: 999 }, text: "/approve approval-1" } },
      { update_id: 2, message: { message_id: 2, chat: { id: 42 }, text: "/pending" } },
    ]);
    const poller = new TelegramPoller({
      getSettings: () => settingsWith("42"),
      env: { TG_TOKEN: "t0k" },
      fetchImpl: tg.fetchImpl,
      pollSeconds: 0,
      resolve: async (id) => {
        resolved.push(id);
        return { ok: true, message: "ok" };
      },
      pending: () => [{ id: "approval-1", kind: "tool_use", description: "Write: notes.md" }],
    });
    await poller.pollOnce();
    expect(resolved).toEqual([]);
    const sent = tg.calls.filter((c) => c.method === "sendMessage");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.chat_id).toBe(42);
    expect(String(sent[0]!.body.text)).toContain("/approve approval-1");
  });

  it("is disabled without inbound, a chat id or a token", () => {
    const s = settingsWith("42");
    s.channels.telegram.inbound = false;
    const mk = (settings: typeof s, env: NodeJS.ProcessEnv) =>
      new TelegramPoller({
        getSettings: () => settings,
        env,
        resolve: async () => ({ ok: true, message: "" }),
        pending: () => [],
      });
    expect(mk(s, { TG_TOKEN: "x" }).enabled()).toBe(false);
    const s2 = settingsWith("");
    expect(mk(s2, { TG_TOKEN: "x" }).enabled()).toBe(false);
    expect(mk(settingsWith("42"), {}).enabled()).toBe(false);
  });
});
