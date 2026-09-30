import { describe, expect, it } from "vitest";
import { MAX_MUTED, MUTE_STORAGE_KEY, mute, readMuted } from "./attentionMute";

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  };
}

describe("attention mute", () => {
  it("round-trips through storage and ignores garbage", () => {
    const s = memory();
    const next = mute(readMuted(s), "run-1", s);
    expect([...next]).toEqual(["run-1"]);
    expect([...readMuted(s)]).toEqual(["run-1"]);
    s.setItem(MUTE_STORAGE_KEY, "{not json");
    expect(readMuted(s).size).toBe(0);
    s.setItem(MUTE_STORAGE_KEY, JSON.stringify([1, "ok", null]));
    expect([...readMuted(s)]).toEqual(["ok"]);
  });

  it("is bounded, newest kept", () => {
    const s = memory();
    let muted = readMuted(s);
    for (let i = 0; i < MAX_MUTED + 5; i++) muted = mute(muted, `r${i}`, s);
    expect(muted.size).toBe(MAX_MUTED);
    expect(muted.has("r0")).toBe(false);
    expect(muted.has(`r${MAX_MUTED + 4}`)).toBe(true);
  });

  it("survives a storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readMuted(broken).size).toBe(0);
    expect(mute(new Set(), "x", broken).has("x")).toBe(true);
  });
});
