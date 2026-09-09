// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { api } from "../api";
import { DEFAULT_LAYOUT } from "./defaultLayout";
import { useLayoutState } from "./useGridLayout";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("does not resend a confirmed layout when navigating away", async () => {
  vi.useFakeTimers();
  const put = vi.spyOn(api, "put").mockResolvedValue({});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(
    () =>
      useLayoutState({ serverLayout: DEFAULT_LAYOUT, rows: 20, editing: false, onError: () => undefined }),
    { wrapper },
  );
  act(() =>
    hook.result.current.commit({
      ...hook.result.current.layout,
      now: { ...hook.result.current.layout.now!, visible: false },
    }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  expect(put).toHaveBeenCalledTimes(1);
  hook.unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(put).toHaveBeenCalledTimes(1);
  client.clear();
});
