// @vitest-environment jsdom
/** What both shells share (.specs/features/moldura-app, C54): launching a skill, in-flight runs, `@ref`, the panel events. */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type Skill } from "../api";
import type * as ApiModule from "../api";
import { I18nContext } from "../i18n";
import { ToastProvider } from "../components/ui";
import { OPEN_PANEL_EVENT } from "../components/CommandPalette";
import { CONSOLE_DRAFT_EVENT, readConsoleDraft, storeConsoleDraft } from "./consoleDraft";
import { PANEL_ACTION_EVENT, type OpenPanel } from "./panelKinds";
import {
  referencePanel,
  useActiveRunCount,
  usePanelEventBridge,
  useRunningSkills,
  useRunSkill,
  type RunOutcome,
} from "./shellActions";

vi.mock("../api", async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>();
  return { ...mod, api: { ...mod.api, post: vi.fn() } };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <I18nContext.Provider value={{ lang: "en", setLang: () => undefined }}>
        <ToastProvider>{children}</ToastProvider>
      </I18nContext.Provider>
    </QueryClientProvider>
  );
}

const skill = (slug: string, required = false) =>
  ({ slug, inputs: required ? [{ name: "x", required: true }] : [] }) as unknown as Skill;

describe("C54 useRunSkill", () => {
  it("a skill with required inputs is not run: its form is the outcome", async () => {
    const seen: RunOutcome[] = [];
    const { result } = renderHook(() => useRunSkill((o) => seen.push(o)), { wrapper });
    act(() => result.current(skill("a", true)));
    await waitFor(() => expect(seen).toEqual([{ form: "a" }]));
    expect(api.post).not.toHaveBeenCalled();
  });

  it("launches the others: the run, or the approvals when it has to wait", async () => {
    const seen: RunOutcome[] = [];
    const { result } = renderHook(() => useRunSkill((o) => seen.push(o)), { wrapper });
    vi.mocked(api.post).mockResolvedValueOnce({ runId: "r1", status: "queued" });
    act(() => result.current(skill("b")));
    await waitFor(() => expect(seen).toEqual([{ run: "r1" }]));
    expect(api.post).toHaveBeenCalledWith("/api/skills/b/run", { inputs: {} });

    vi.mocked(api.post).mockResolvedValueOnce({ status: "waiting_approval" });
    act(() => result.current(skill("c")));
    await waitFor(() => expect(seen).toEqual([{ run: "r1" }, { approvals: true }]));
  });

  it("is a stable function, and answers to the latest callback", async () => {
    const first: RunOutcome[] = [];
    const second: RunOutcome[] = [];
    const { result, rerender } = renderHook(({ sink }) => useRunSkill((o) => sink.push(o)), {
      wrapper,
      initialProps: { sink: first },
    });
    const fn = result.current;
    rerender({ sink: second });
    expect(result.current).toBe(fn);
    act(() => result.current(skill("d", true)));
    await waitFor(() => expect(second).toEqual([{ form: "d" }]));
    expect(first).toEqual([]);
  });
});

describe("C54 runs in flight", () => {
  const runs = [
    { status: "running", skillSlug: "a" },
    { status: "queued", skillSlug: null },
    { status: "completed", skillSlug: "b" },
    { status: "waiting_approval", skillSlug: "c" },
  ];
  it("counts the active ones and names their skills", () => {
    expect(renderHook(() => useActiveRunCount(runs)).result.current).toBe(3);
    expect([...renderHook(() => useRunningSkills(runs)).result.current].sort()).toEqual(["a", "c"]);
    expect(renderHook(() => useActiveRunCount(undefined)).result.current).toBe(0);
  });
});

describe("C54 referencePanel", () => {
  const panels = [{ id: "app:runs", ref: "runs" }] as unknown as OpenPanel[];
  it("puts @ref on the line and tells the console; an unknown panel does nothing", () => {
    const heard = vi.fn();
    window.addEventListener(CONSOLE_DRAFT_EVENT, heard);
    storeConsoleDraft({ text: "look at ", cwd: "/w", sessionId: null });
    referencePanel(panels, "nope");
    expect(heard).not.toHaveBeenCalled();
    referencePanel(panels, "app:runs");
    expect(readConsoleDraft().text).toBe("look at @runs ");
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(CONSOLE_DRAFT_EVENT, heard);
  });
});

describe("C54 usePanelEventBridge", () => {
  it("routes open, focus, close and minimize, subscribing once", () => {
    const open = vi.fn();
    const dismiss = vi.fn();
    const add = vi.spyOn(window, "addEventListener");
    const { rerender } = renderHook(({ n }) => usePanelEventBridge({ open: (id) => open(id, n), dismiss }), {
      initialProps: { n: 1 },
    });
    rerender({ n: 2 });
    expect(add.mock.calls.filter(([t]) => t === OPEN_PANEL_EVENT)).toHaveLength(1);
    const act = (id: string, action: string) =>
      window.dispatchEvent(new CustomEvent(PANEL_ACTION_EVENT, { detail: { id, action } }));
    window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: "now" }));
    act("a", "focus");
    act("b", "close");
    act("c", "minimize");
    expect(open.mock.calls).toEqual([
      ["now", 2],
      ["a", 2],
    ]);
    expect(dismiss.mock.calls).toEqual([["b"], ["c"]]);
    add.mockRestore();
  });
});
