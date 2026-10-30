// @vitest-environment jsdom
/**
 * The guided cleanup's frame and flow (.specs/features/cerebro-faxina-guiada, C53, C54, C67, C70, C71, C73;
 * design.md "Tela - Assistente de faxina", "Etapa 1", "Estados de erro"; plan.md amendment 17): the Modal with its
 * fixed header and footer, the scope step, the scan with nothing to decide, the failures, resuming within a day and
 * "Cancelar". The network is `../notes/testnet` with the routes of `./testkit`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import postcss from "postcss";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { net, resetNet } from "../notes/testnet";
import { emit } from "../notes/testnet";
import { openCleanup } from "../cleanupEvents";
import {
  DAY,
  NetError,
  WORK,
  atStep,
  cleanup,
  context,
  finding,
  footer,
  mountHost,
  openWizard,
  resetCleanup,
  scan,
  sent,
  toFindings,
} from "./testkit";

vi.mock("../../api", async (importOriginal) =>
  (await import("../notes/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.mock("../../hooks/useEventStream", async () => ({
  useOsEvent: (await import("../notes/testnet")).useOsEventMock,
}));
vi.setConfig({ testTimeout: 30_000 });

installPage();
beforeEach(() => {
  resetNet();
  resetCleanup();
});

const follows = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const cards = () => [...document.querySelectorAll(".cln-cards > li")];
const unanswered = () => cards().filter((c) => !c.hasAttribute("data-answered"));

describe("C53 one Modal with a fixed header and footer", () => {
  it("C53 focus enters the dialog, the header holds the title, the scope and the five steps in order, the current one aria-current and the done one a Check, the step in text; the footer reads Fechar, Voltar, the action", async () => {
    context("alfa", "Alfa");
    const { dialog } = await openWizard({ context: "alfa", step: 2 });
    await atStep("Etapa 2 de 5 · O que tem aqui");
    expect(dialog.contains(document.activeElement)).toBe(true);
    const title = within(dialog).getByRole("heading", { name: "Faxina guiada" });
    const scope = dialog.querySelector(".cln-scope-line")!;
    const bar = dialog.querySelector("ol.cln-steps")!;
    expect(scope.textContent).toBe("Alfa");
    expect(follows(title, scope)).toBe(true);
    expect(follows(scope, bar)).toBe(true);
    const steps = [...bar.querySelectorAll("li")];
    expect(steps.map((s) => s.querySelector(".cln-step-name")!.textContent)).toEqual([
      "Escopo",
      "O que tem aqui",
      "Achados",
      "Conferir",
      "Pronto",
    ]);
    expect(steps.map((s) => s.querySelector(".cln-dot")!.textContent)).toEqual(["", "2", "3", "4", "5"]);
    expect(steps.map((s) => s.getAttribute("aria-current"))).toEqual([null, "step", null, null, null]);
    expect(steps[0]!.querySelector("svg.lucide-check")).not.toBeNull();
    expect(steps.slice(1).every((s) => s.querySelector("svg") === null)).toBe(true);
    // The header (scope, bar, step in text) sits above the scrolled body, and the footer below it.
    const head = dialog.querySelector(".cln-head")!;
    expect(head.contains(bar) && head.contains(dialog.querySelector(".cln-now"))).toBe(true);
    expect(follows(head, dialog.querySelector(".cln-body")!)).toBe(true);
    expect(follows(dialog.querySelector(".cln-body")!, dialog.querySelector(".cln-foot")!)).toBe(true);
    await waitFor(() => expect((footer().at(-1) as HTMLButtonElement).disabled).toBe(false));
    expect(footer().map((b) => [b.textContent, b.className])).toEqual([
      ["Fechar", "btn ghost"],
      ["Voltar", "btn"],
      ["Procurar o que decidir", "btn primary"],
    ]);
  });

  it("C53 a folder's scope is its path in the mono 12px class", async () => {
    cleanup.folders = [WORK];
    await openWizard({});
    fireEvent.change(screen.getByLabelText("Ou uma pasta…"), { target: { value: `${WORK}/docs` } });
    const scope = document.querySelector(".cln-scope-line")!;
    expect(scope.textContent).toBe(`${WORK}/docs`);
    expect(scope.classList.contains("cln-mono")).toBe(true);
    const css = postcss.parse(readFileSync(join(__dirname, "cleanup.css"), "utf8"));
    const decls: Record<string, string> = {};
    css.walkRules(".cln-mono", (r) => r.walkDecls((d) => void (decls[d.prop] = d.value)));
    expect(decls["font-size"]).toBe("var(--fs-2)");
    expect(decls["font-family"]).toBe("var(--font-mono)");
  });

  it("C53 Esc closes it and focus goes back to what opened it", async () => {
    context("alfa", "Alfa");
    mountHost(
      <button type="button" onClick={() => openCleanup({ context: "alfa", step: 2 })}>
        abrir
      </button>,
    );
    const opener = screen.getByRole("button", { name: "abrir" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", undefined, { timeout: 5000 });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe("C54 step 1, Escopo", () => {
  it("C54 the contexts (name, main path, count) above Ou uma pasta… with the indexed folders; a choice reads N arquivos, última mudança há D dias and enables Ver o que tem aqui", async () => {
    context("alfa", "Alfa", { files: 14 });
    context("beta", "Beta", { files: 3 });
    cleanup.folders = [WORK, "/work/outra"];
    const { dialog } = await openWizard({});
    await atStep("Etapa 1 de 5 · Escopo");
    await waitFor(() => expect(within(dialog).getAllByRole("radio")).toHaveLength(2));
    const rows = [...dialog.querySelectorAll(".cln-context")];
    expect(rows.map((r) => [...r.children].slice(1).map((c) => c.textContent))).toEqual([
      ["Alfa", `${WORK}/alfa`, "14 arquivos"],
      ["Beta", `${WORK}/beta`, "3 arquivos"],
    ]);
    const field = within(dialog).getByLabelText("Ou uma pasta…");
    expect(follows(rows[1]!, field)).toBe(true);
    const list = document.getElementById(field.getAttribute("list")!)!;
    expect([...list.querySelectorAll("option")].map((o) => o.getAttribute("value"))).toEqual([
      WORK,
      "/work/outra",
    ]);
    const see = within(dialog).getByRole("button", { name: "Ver o que tem aqui" });
    expect((see as HTMLButtonElement).disabled).toBe(true);
    expect(dialog.querySelector(".cln-chosen")).toBeNull();
    fireEvent.click(within(dialog).getAllByRole("radio")[0]!);
    await waitFor(() =>
      expect(dialog.querySelector(".cln-chosen")?.textContent).toBe("14 arquivos, última mudança há 3 dias"),
    );
    expect((see as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(see);
    await atStep("Etapa 2 de 5 · O que tem aqui");
  });

  it("C54 with no context and no indexed folder: Nada indexado ainda… and no action", async () => {
    const { dialog } = await openWizard({});
    await waitFor(() =>
      expect(
        within(dialog).getByText("Nada indexado ainda. Adicione uma pasta em Configurações › Pastas."),
      ).toBeTruthy(),
    );
    expect(dialog.querySelector(".cln-foot .btn.primary")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Ver o que tem aqui" })).toBeNull();
  });
});

describe("C67 a scan with no finding", () => {
  it("C67 Sparkles, Nada para decidir aqui…, the action Fechar, the inventory cards still there, and the bar never at Conferir", async () => {
    const { dialog } = await toFindings([]);
    await waitFor(() =>
      expect(within(dialog).getByText("Nada para decidir aqui. Este contexto está em ordem.")).toBeTruthy(),
    );
    const line = within(dialog).getByText("Nada para decidir aqui. Este contexto está em ordem.");
    expect(line.querySelector("svg.lucide-sparkles")).not.toBeNull();
    expect(dialog.querySelectorAll(".cln-grid .cln-card")).toHaveLength(5);
    expect(footer().at(-1)!.textContent).toBe("Fechar");
    expect(footer().at(-1)!.className).toBe("btn primary");
    expect(footer().filter((b) => b.textContent === "Fechar")).toHaveLength(1);
    expect(dialog.querySelector('[aria-current="step"] .cln-step-name')!.textContent).toBe("O que tem aqui");
    await atStep("Etapa 2 de 5 · O que tem aqui");
  });
});

describe("C70 a failure is a band with AlertTriangle, A faxina falhou. and Tentar de novo", () => {
  const band = async (dialog: HTMLElement) => {
    const alert = await within(dialog).findByRole("alert");
    expect(alert.querySelector("svg.lucide-triangle-alert")).not.toBeNull();
    expect(within(alert).getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    return alert;
  };

  it("C70 the inventory fails, and Tentar de novo asks again", async () => {
    context("alfa", "Alfa");
    cleanup.inventory = new NetError(500, "internal", "O índice não respondeu");
    const { dialog } = await openWizard({ context: "alfa", step: 2 });
    const alert = await band(dialog);
    expect(alert.textContent).toContain("A faxina falhou. O índice não respondeu");
    const before = sent("GET", "/api/memory/cleanup/inventory").length;
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(sent("GET", "/api/memory/cleanup/inventory").length).toBe(before + 1));
  });

  it("C70 the scan fails, and Tentar de novo starts it again", async () => {
    context("alfa", "Alfa");
    cleanup.starts.push("scan-x", "scan-y");
    scan("scan-x", [], { status: "failed", code: "scan_failed" });
    scan("scan-y", [finding("stale", [`${WORK}/a.md`])]);
    const { dialog } = await openWizard({ context: "alfa", step: 2 });
    await atStep("Etapa 2 de 5 · O que tem aqui");
    await waitFor(() =>
      expect(
        (within(dialog).getByRole("button", { name: "Procurar o que decidir" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    click("Procurar o que decidir");
    const alert = await band(dialog);
    expect(alert.textContent).toContain("A faxina falhou. scan_failed");
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await atStep("Etapa 3 de 5 · Achados");
    expect(sent("POST", "/api/memory/cleanup/scans")).toHaveLength(2);
  });

  it("C70 the apply fails, and Tentar de novo applies again", async () => {
    const f = finding("stale", [`${WORK}/velho.md`]);
    let calls = 0;
    cleanup.apply = () =>
      ++calls === 1
        ? Promise.reject(new NetError(409, "scan_stale", "Uma varredura mais nova substituiu esta"))
        : Promise.resolve({ manifest: null, moved: [], skipped: [], proposals: "/p.md" });
    const { dialog } = await toFindings([f]);
    fireEvent.click(within(cards()[0]! as HTMLElement).getByRole("button", { name: "Arquivar" }));
    await waitFor(() => expect(dialog.querySelector(".cln-finding[data-answered]")).not.toBeNull());
    click("Conferir mudanças");
    await atStep("Etapa 4 de 5 · Conferir");
    click("Aplicar");
    const alert = await band(dialog);
    expect(alert.textContent).toContain("A faxina falhou. Uma varredura mais nova substituiu esta");
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await atStep("Etapa 5 de 5 · Pronto");
    expect(sent("POST", "/api/memory/cleanup/apply")).toHaveLength(2);
  });

  it("C70 after a failed scan, the answers already stored are still answered when the next scan's cards come", async () => {
    const a = finding("stale", [`${WORK}/a.md`]);
    const b = finding("stale", [`${WORK}/b.md`]);
    const { dialog } = await toFindings([a, b]);
    cleanup.starts.push("scan-2", "scan-3");
    scan("scan-2", [], { status: "failed", code: "scan_failed" });
    scan("scan-3", [a, b]);
    fireEvent.click(within(cards()[0]! as HTMLElement).getByRole("button", { name: "Não sei" }));
    await waitFor(() => expect(unanswered()).toHaveLength(1));
    click("Voltar");
    await atStep("Etapa 2 de 5 · O que tem aqui");
    click("Procurar o que decidir");
    const alert = await band(dialog);
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await atStep("Etapa 3 de 5 · Achados");
    expect(cards()).toHaveLength(2);
    expect(unanswered().map((c) => c.querySelector(".cln-file-name")!.textContent)).toEqual(["b.md"]);
    expect(dialog.querySelector(".cln-finding[data-answered]")!.textContent).toContain("Respondido");
  });
});

describe("C71 reopening the same scope", () => {
  it("C71 one hour later it opens at Achados with the 3 unanswered cards; 25 hours later at O que tem aqui, and the new scan's cards leave the 2 decided out", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 9, 30, 9) });
    const five = [1, 2, 3, 4, 5].map((i) => finding("stale", [`${WORK}/n${i}.md`]));
    const first = await toFindings(five);
    for (const n of [0, 1]) {
      fireEvent.click(within(unanswered()[0]! as HTMLElement).getByRole("button", { name: "Manter" }));
      await waitFor(() => expect(unanswered()).toHaveLength(4 - n));
    }
    fireEvent.click(footer()[0]!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    first.unmount();

    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    const again = await openWizard({ context: "alfa", step: 2 });
    await atStep("Etapa 3 de 5 · Achados");
    expect(unanswered().map((c) => c.querySelector(".cln-file-name")!.textContent)).toEqual([
      "n3.md",
      "n4.md",
      "n5.md",
    ]);
    expect(sent("POST", "/api/memory/cleanup/scans")).toHaveLength(1);
    fireEvent.click(footer()[0]!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    again.unmount();

    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
    cleanup.starts.push("scan-2");
    scan("scan-2", five.slice(2));
    const later = await openWizard({ context: "alfa", step: 2 });
    await atStep("Etapa 2 de 5 · O que tem aqui");
    await waitFor(() =>
      expect(
        (within(later.dialog).getByRole("button", { name: "Procurar o que decidir" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    click("Procurar o que decidir");
    await atStep("Etapa 3 de 5 · Achados");
    expect(sent("POST", "/api/memory/cleanup/scans")).toHaveLength(2);
    expect(cards().map((c) => c.querySelector(".cln-file-name")!.textContent)).toEqual([
      "n3.md",
      "n4.md",
      "n5.md",
    ]);
    expect(unanswered()).toHaveLength(3);
    void DAY;
  });
});

describe("C73 Cancelar while a scan runs", () => {
  it("C73 closes the wizard, sends no apply and no decision, says Varredura cancelada. once in a status notice, and draws no Procurar de novo", async () => {
    context("alfa", "Alfa");
    cleanup.starts.push("scan-1");
    scan("scan-1", [], { status: "running", phase: "signatures", finishedAt: null });
    const { dialog } = await openWizard({ context: "alfa", step: 2 });
    await waitFor(() =>
      expect(
        (within(dialog).getByRole("button", { name: "Procurar o que decidir" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    click("Procurar o que decidir");
    act(() => emit("cleanup.progress", { scanId: "scan-1", phase: "signatures", done: 4, total: 9 }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sent("POST", "/api/memory/cleanup/apply")).toEqual([]);
    expect(sent("PUT", "/api/memory/cleanup/decisions")).toEqual([]);
    const notices = screen.getAllByText("Varredura cancelada.");
    expect(notices).toHaveLength(1);
    expect(notices[0]!.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByText("Procurar de novo")).toBeNull();
    // The scan ending later on the server opens nothing.
    scan("scan-1", [finding("stale", [`${WORK}/a.md`])]);
    act(() => emit("cleanup.finished", { scanId: "scan-1", findings: 1 }));
    expect(screen.queryByRole("dialog")).toBeNull();
    void net;
  });
});
