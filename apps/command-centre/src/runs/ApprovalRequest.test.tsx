// @vitest-environment jsdom
/**
 * escopos-dispositivo, round 1 (C47): the person who approves a held write run reads all of it. A prompt much longer
 * than the box that shows it is still in the page whole, in a region the keyboard reaches, and a skill's inputs are
 * listed one by one; who asked, the provider and the folder are there too.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApprovalRecord } from "../api";
import { ToastProvider } from "../components/ui";
import { I18nContext } from "../i18n";
import { ApprovalCard } from "./ApprovalCards";
import { ApprovalRequest } from "./ApprovalRequest";

afterEach(cleanup);

function approval(over: Partial<ApprovalRecord>): ApprovalRecord {
  return {
    id: "a1",
    createdAt: 1,
    kind: "write_run",
    description: 'Write-mode prompt run with claude: "start…"',
    payload: {},
    status: "pending",
    resolvedAt: null,
    resolvedBy: null,
    requestedBy: "device:0123456789abcdef",
    expiresAt: 2,
    ...over,
  };
}

const LONG = `${"Please tidy the notes. ".repeat(300)}THEN DELETE EVERYTHING IN THE HOME FOLDER`;

function show(a: ApprovalRecord, lang: "en" | "pt-BR" = "en") {
  return render(
    createElement(
      I18nContext.Provider,
      { value: { lang, setLang: () => undefined } },
      createElement(ApprovalRequest, { approval: a }),
    ),
  );
}

describe("ApprovalRequest", () => {
  it("holds the whole prompt, however long, in a focusable region that says its length", () => {
    expect(LONG.length).toBeGreaterThan(6000);
    show(
      approval({
        payload: {
          kind: "prompt",
          runId: "r1",
          input: {
            prompt: LONG,
            provider: "claude",
            model: "opus",
            effort: "high",
            mode: "write",
            cwd: "/home/me/notes",
            startedBy: "device:0123456789abcdef",
          },
        },
      }),
    );
    const box = screen.getByRole("region", { name: new RegExp(`Prompt, ${LONG.length} characters`) });
    expect(box.textContent).toBe(LONG);
    expect(box.getAttribute("tabindex")).toBe("0");
    const text = screen.getByTestId("approval-request").textContent ?? "";
    expect(text).toContain("paired device 01234567");
    expect(text).toContain("claude · opus · high");
    expect(text).toContain("write");
    expect(text).toContain("/home/me/notes");
  });

  it("lists a skill with every input, each whole", () => {
    const inputs = { topic: "short", body: `${"x".repeat(5000)}END`, ключ: "значение" };
    show(
      approval({
        requestedBy: "owner",
        payload: {
          kind: "skill",
          input: { slug: "digest", inputs, provider: "codex", model: null, effort: "low", cwd: "/w" },
        },
      }),
    );
    const t = screen.getByTestId("approval-request").textContent ?? "";
    expect(t).toContain("/digest");
    expect(t).toContain("you (the owner)");
    for (const [key, value] of Object.entries(inputs)) {
      const box = screen.getByRole("region", { name: new RegExp(`^${key}, ${value.length} characters`) });
      expect(box.textContent).toBe(value);
    }
  });

  it("speaks Portuguese and shows no inputs as none", () => {
    show(
      approval({
        requestedBy: null,
        payload: { kind: "skill", input: { slug: "digest", inputs: {}, provider: "codex", cwd: "/w" } },
      }),
      "pt-BR",
    );
    const t = screen.getByTestId("approval-request").textContent ?? "";
    expect(t).toContain("Pedido por");
    expect(t).toContain("uma rotina, um sentinela ou a linha de comando");
    expect(t).toContain("Entradas");
    expect(t).toContain("nenhuma");
  });

  it("renders nothing for an approval that is not a write run", () => {
    const { container } = show(approval({ kind: "tool_use", payload: { toolName: "Bash", input: {} } }));
    expect(container.innerHTML).toBe("");
  });

  it("sits after the actions inside the inline approval card, for the page, the widget and the run", () => {
    const a = approval({
      payload: { kind: "prompt", input: { prompt: LONG, provider: "claude", mode: "write", cwd: "/w" } },
    });
    for (const compact of [false, true]) {
      render(
        createElement(
          I18nContext.Provider,
          { value: { lang: "en", setLang: () => undefined } },
          createElement(
            QueryClientProvider,
            { client: new QueryClient() },
            createElement(ToastProvider, null, createElement(ApprovalCard, { approval: a, compact })),
          ),
        ),
      );
      const card = document.querySelector(".approval-inline")!;
      expect(
        Array.from(card.children).map((c) => c.className.split(" ")[0]),
        String(compact),
      ).toEqual(
        ["approval-inline-main", "approval-inline-actions", "approval-request from-device"].map(
          (x) => x.split(" ")[0],
        ),
      );
      expect(card.querySelector(".approval-request-text")!.textContent).toBe(LONG);
      cleanup();
    }
  });
});
