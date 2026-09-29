import { describe, expect, it } from "vitest";
import { tf, type TKey, type TVars } from "../i18n";
import { humanizeEvent, narrate, shortPath, toolInput } from "./humanize";

const pt = (k: TKey, v?: TVars) => tf("pt-BR", k, v);
const en = (k: TKey, v?: TVars) => tf("en", k, v);
const ev = (type: string, extra: Record<string, unknown> = {}) => ({ type, ts: 1, ...extra });

describe("humanizeEvent", () => {
  it("turns Claude Code tools into sentences with a subject", () => {
    const read = humanizeEvent(
      ev("tool_use", { tool: "Read", detail: '{"file_path":"/home/u/p/src/app.ts"}' }),
      pt,
      "/home/u/p",
    );
    expect(read).toEqual({ text: "li", subject: "src/app.ts", tone: "ok" });
    const bash = humanizeEvent(
      ev("tool_use", { tool: "Bash", detail: '{"command":"npm test","timeout":1}' }),
      en,
    );
    expect(bash).toEqual({ text: "ran", subject: "npm test", tone: "ok" });
    const edit = humanizeEvent(
      ev("tool_use", { tool: "Edit", detail: '{"file_path":"/a/b/c/d/e.ts","old_string":"x"}' }),
      pt,
    );
    expect(edit).toMatchObject({ text: "editei", subject: "…/c/d/e.ts" });
    const grep = humanizeEvent(
      ev("tool_use", { tool: "Grep", detail: '{"pattern":"TODO","path":"src"}' }),
      en,
    );
    expect(grep).toMatchObject({ text: "searched for", subject: "TODO" });
  });

  it("survives the adapter's truncated JSON", () => {
    const detail = '{"file_path":"/w/x.ts","content":"const a = 1;\\nconst b = 2;…';
    expect(toolInput(detail)).toMatchObject({ file_path: "/w/x.ts" });
    expect(humanizeEvent(ev("tool_use", { tool: "Write", detail }), en)).toMatchObject({
      text: "wrote",
      subject: "w/x.ts",
    });
  });

  it("falls back to 'used <tool>' for unknown tools and names the outcome", () => {
    expect(humanizeEvent(ev("tool_use", { tool: "mcp__foo__bar", detail: "{}" }), en)).toMatchObject({
      text: "used mcp__foo__bar",
    });
    expect(
      humanizeEvent(ev("tool_use", { tool: "tool_result", outcome: "error", detail: '"boom"' }), pt),
    ).toMatchObject({
      text: "a ferramenta falhou",
      subject: "boom",
      tone: "warn",
    });
    expect(humanizeEvent(ev("permission", { detail: "Bash(rm -rf)" }), pt)).toMatchObject({
      text: "pedi permissão",
      tone: "warn",
    });
    expect(humanizeEvent(ev("error", { message: "ENOENT" }), en)).toMatchObject({
      text: "hit an error",
      subject: "ENOENT",
      tone: "danger",
    });
    expect(humanizeEvent(ev("usage"), en)).toBeNull();
    expect(humanizeEvent(ev("result", { exitCode: 0 }), pt)).toMatchObject({ text: "concluí", tone: "ok" });
  });

  it("shortens paths to three segments relative to the working directory", () => {
    expect(shortPath("/Users/me/proj/src/a/b.ts", "/Users/me/proj")).toBe("src/a/b.ts");
    expect(shortPath("/Users/me/proj/src/a/b/c.ts", "/Users/me/proj")).toBe("…/a/b/c.ts");
    expect(shortPath("README.md")).toBe("README.md");
  });

  it("narrates the last few actions without repeating itself", () => {
    const events = [
      ev("started"),
      ev("tool_use", { tool: "Read", detail: '{"file_path":"/p/a.ts"}' }),
      ev("tool_use", { tool: "Read", detail: '{"file_path":"/p/a.ts"}' }),
      ev("tool_use", { tool: "Read", detail: '{"file_path":"/p/b.ts"}' }),
      ev("tool_use", { tool: "tool_result", outcome: "ok", detail: '"…"' }),
      ev("tool_use", { tool: "Bash", detail: '{"command":"npm test"}' }),
      ev("assistant", { text: "done" }),
    ];
    expect(narrate(events, en, "/p").map((h) => `${h.text} ${h.subject}`)).toEqual([
      "read a.ts",
      "read b.ts",
      "ran npm test",
    ]);
    expect(narrate(events, en, "/p", 1)).toHaveLength(1);
  });

  it("reads a question the agent asked as a question, without its JSON or the approval id", () => {
    const tr = (k: string) => k;
    const h = humanizeEvent(
      {
        type: "permission",
        ts: 1,
        detail:
          'AskUserQuestion: {"questions":[{"question":"Por onde começamos hoje?","header":"Foco"}]} (approval 5f0c2b1e-1111-2222-3333-444455556666)',
      },
      tr as never,
    );
    expect(h).toEqual({ text: "trace.asked", subject: "Por onde começamos hoje?", tone: "warn" });
    const p = humanizeEvent(
      {
        type: "permission",
        ts: 1,
        detail: "Bash: rm -rf dist (approval 5f0c2b1e-1111-2222-3333-444455556666)",
      },
      tr as never,
    );
    expect(p?.subject).toBe("Bash: rm -rf dist");
  });
});
