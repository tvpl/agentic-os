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
    const box = screen.getByRole("region", {
      name: new RegExp(`^Prompt \\(a1\\), ${LONG.length} characters`),
    });
    expect(box.textContent).toBe(LONG);
    expect(box.getAttribute("tabindex")).toBe("0");
    const text = screen.getByTestId("approval-request").textContent ?? "";
    // The record carries no name (an approval raised before the name was kept): the short id stands in.
    expect(text).toContain("a paired device (01234567)");
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
    // A skill that is held for approval is a skill that writes: the mode is said even though the input does not carry it.
    expect(t).toMatch(/Mode\s*write/);
    for (const [key, value] of Object.entries(inputs)) {
      const box = screen.getByRole("region", {
        name: new RegExp(`^${key} \\(a1\\), ${value.length} characters`),
      });
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
    expect(t).toContain("origem desconhecida");
    expect(t).toMatch(/Modo\s*write/);
    expect(t).toContain("Entradas");
    expect(t).toContain("nenhuma");
  });

  it("names the device by the name it was paired with", () => {
    show(
      approval({
        payload: {
          kind: "prompt",
          requestedByName: "Pixel do escritório",
          input: { prompt: "x", provider: "claude", mode: "write", cwd: "/w" },
        },
      }),
    );
    const text = screen.getByTestId("approval-request").textContent ?? "";
    expect(text).toContain("Pixel do escritório, a paired device");
    expect(text).not.toContain("01234567");
  });

  it("an approval from before who-asked was kept says its origin is unknown, and one from the owner says so", () => {
    show(
      approval({
        requestedBy: null,
        payload: { kind: "prompt", input: { prompt: "x", provider: "claude" } },
      }),
    );
    expect(screen.getByTestId("approval-request").textContent).toContain("unknown origin");
    expect(screen.getByTestId("approval-request").textContent).not.toContain("routine");
    expect(screen.getByTestId("approval-request").className).not.toContain("from-device");
  });

  it("two held writes on one screen have regions with names of their own", () => {
    const input = { prompt: "x".repeat(40), provider: "claude", mode: "write", cwd: "/w" };
    render(
      createElement(
        I18nContext.Provider,
        { value: { lang: "en", setLang: () => undefined } },
        createElement(
          "div",
          null,
          createElement(ApprovalRequest, {
            approval: approval({ id: "aaaaaaaa-1", payload: { kind: "prompt", input } }),
          }),
          createElement(ApprovalRequest, {
            approval: approval({ id: "bbbbbbbb-2", payload: { kind: "prompt", input } }),
          }),
        ),
      ),
    );
    const names = [
      ...screen.getAllByTestId("approval-request").map((e) => e.getAttribute("aria-label")),
      ...Array.from(document.querySelectorAll("pre[role=region]")).map((e) => e.getAttribute("aria-label")),
    ];
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(4);
  });

  it("renders nothing for an approval that is not a write run", () => {
    const { container } = show(approval({ kind: "tool_use", payload: { toolName: "Bash", input: {} } }));
    expect(container.innerHTML).toBe("");
  });

  it("comes before the actions in the inline approval card, so the request is read before Approve is reached", () => {
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
      ).toEqual(["approval-inline-main", "approval-inline-actions"]);
      // In the order of the page (and so of Tab): the request, then the buttons.
      const request = card.querySelector(".approval-request")!;
      const approve = Array.from(card.querySelectorAll("button")).find((b) => b.textContent === "Approve")!;
      expect(
        request.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING,
        String(compact),
      ).toBeTruthy();
      expect(card.querySelector(".approval-inline-main")!.contains(request)).toBe(true);
      expect(card.querySelector(".approval-request-text")!.textContent).toBe(LONG);
      cleanup();
    }
  });
});
