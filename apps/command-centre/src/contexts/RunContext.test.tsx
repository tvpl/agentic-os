// @vitest-environment jsdom
/**
 * The work context of a run in the run detail (.specs/features/cerebro-contextos, C24): a run keeps the id of a
 * context deleted after it was recorded, and the detail shows that id with "Deleted context" ("Contexto apagado").
 * The network is a stub that never answers: what the screen shows comes from the cache the test fills.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { I18nContext, dictionaries } from "../i18n";
import { qk } from "../queries";
import { installPage, mount } from "../ui/testkit";
import { RUN } from "../commands/testserver";
import RunDetail from "../runs/RunDetail";
import { RunContext, type ContextList } from "./RunContext";

installPage();

afterEach(() => {
  vi.unstubAllGlobals();
});

const CONTEXT = (id: string, name: string): ContextList[number] => ({
  id,
  name,
  paths: [{ path: `/projetos/${id}`, state: "ok" }],
  notesDir: `/home/memory/notes/${id}`,
  brief: null,
  map: `/home/memory/contexts/${id}.md`,
  files: 3,
});

function inLang(lang: "en" | "pt-BR", ui: ReactElement) {
  return mount(<I18nContext.Provider value={{ lang, setLang: () => undefined }}>{ui}</I18nContext.Provider>);
}

describe("C24 a run keeps the id of a deleted context", () => {
  it("C24 the run detail shows the id with Deleted context when GET /api/contexts no longer lists it", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnMount: false, staleTime: Infinity } },
    });
    const run = { ...RUN, status: "done", contextId: "cliente-x" };
    qc.setQueryData(qk.run(run.id), { run, events: [] });
    qc.setQueryData(qk.contexts, { contexts: [CONTEXT("outro", "Outro projeto")] });
    mount(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <RunDetail id={run.id} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const line = document.querySelector(".run-sheet-line")!;
    expect(line).toBeTruthy();
    expect(line.textContent).toContain("cliente-x");
    expect(line.textContent).toContain("Deleted context");
    expect(screen.getByText("Deleted context")).toBeTruthy();
  });

  it("C24 the text is Contexto apagado in pt-BR, next to the id", () => {
    inLang("pt-BR", <RunContext contextId="cliente-x" contexts={[]} />);
    expect(document.body.textContent).toContain("cliente-x");
    expect(document.body.textContent).toContain("Contexto apagado");
    expect(dictionaries["pt-BR"]["context.deleted"]).toBe("Contexto apagado");
    expect(dictionaries.en["context.deleted"]).toBe("Deleted context");
  });

  it("C24 a context that still exists shows its name and is not called deleted; while the list loads, the id alone", () => {
    const { unmount } = inLang(
      "en",
      <RunContext contextId="cliente-x" contexts={[CONTEXT("cliente-x", "App do cliente X")]} />,
    );
    expect(document.body.textContent).toContain("App do cliente X");
    expect(document.body.textContent).not.toContain("Deleted context");
    unmount();
    inLang("en", <RunContext contextId="cliente-x" contexts={undefined} />);
    expect(document.body.textContent).toContain("cliente-x");
    expect(document.body.textContent).not.toContain("Deleted context");
  });

  it("C24 a run without a context shows no context on the detail", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnMount: false, staleTime: Infinity } },
    });
    const run = { ...RUN, id: "r2", status: "done", contextId: null };
    qc.setQueryData(qk.run(run.id), { run, events: [] });
    mount(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <RunDetail id={run.id} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(document.querySelector(".run-sheet-line")).toBeTruthy();
    expect(document.querySelector(".run-work-context")).toBeNull();
  });
});
