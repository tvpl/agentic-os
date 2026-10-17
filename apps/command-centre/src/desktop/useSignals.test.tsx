// @vitest-environment jsdom
/**
 * escopos-dispositivo, round 1 (C56): the device list is the owner's (`GET /api/devices` is an `owner` route), so the
 * HUD of a paired phone never asks for it, and the HUD at the desk still does and counts what comes back.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createElement } from "react";
import type * as ApiModule from "../api";
import { I18nContext } from "../i18n";

const paired = vi.hoisted(() => ({ value: false }));
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, isPairedDevice: () => paired.value };
});

import { api } from "../api";
import { useDesktopSignals, type DesktopSignals } from "./useSignals";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(isPaired: boolean) {
  paired.value = isPaired;
  const asked: string[] = [];
  vi.spyOn(api, "get").mockImplementation((path: string) => {
    asked.push(path);
    if (path.startsWith("/api/devices")) return Promise.resolve({ devices: [{}, {}] }) as never;
    if (path.startsWith("/api/settings")) return Promise.resolve({ limits: {}, channels: {} }) as never;
    if (path.startsWith("/api/metrics")) return Promise.resolve({ cost: { todayUsd: 0 } }) as never;
    if (path.startsWith("/api/doctor")) return Promise.resolve({ checks: [] }) as never;
    if (path.startsWith("/api/updates")) return Promise.resolve({}) as never;
    if (path.startsWith("/api/channels")) return Promise.resolve({ inbound: false, polling: false }) as never;
    return Promise.resolve([]) as never;
  });
  let signals: DesktopSignals | null = null;
  function Probe() {
    signals = useDesktopSignals(0);
    return null;
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    createElement(
      I18nContext.Provider,
      { value: { lang: "en", setLang: () => undefined } },
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(MemoryRouter, null, createElement(Probe)),
      ),
    ),
  );
  return { asked, signals: () => signals };
}

describe("the HUD and the device list", () => {
  it("C56 a paired phone's HUD never asks for /api/devices; the desk's does", async () => {
    const phone = mount(true);
    // Everything else the HUD needs is asked for, so the absence below is not an HUD that asked for nothing.
    await waitFor(() => expect(phone.asked.some((p) => p.startsWith("/api/doctor"))).toBe(true));
    await waitFor(() => expect(phone.asked.some((p) => p.startsWith("/api/approvals"))).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(phone.asked.filter((p) => p.startsWith("/api/devices"))).toEqual([]);
    expect(phone.signals()?.devices).toBe(0);
    cleanup();

    const desk = mount(false);
    await waitFor(() => expect(desk.asked.filter((p) => p.startsWith("/api/devices"))).toHaveLength(1));
    await waitFor(() => expect(desk.signals()?.devices).toBe(2));
  });
});
