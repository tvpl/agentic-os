// @vitest-environment jsdom
/**
 * escopos-dispositivo, round 2 (C59): the tick on an inbox row approves what the person can judge from a line. A write
 * that a paired device asked for is longer than that line, so its tick becomes "review the whole request" and sends
 * the person to the approvals screen; a request of the owner's keeps its tick.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createElement } from "react";
import { api, type ApprovalRecord } from "../../api";
import { ToastProvider } from "../../components/ui";
import { I18nContext } from "../../i18n";
import { qk } from "../../queries";

const navigate = vi.hoisted(() => vi.fn());
const marked = vi.hoisted(() => vi.fn());
vi.mock("../../hooks/useViewTransition", () => ({ useOsNavigate: () => navigate }));
vi.mock("../../hooks/useNotifications", () => ({
  useNotifications: () => ({
    unread: 2,
    markRead: marked,
    markAllRead: vi.fn(),
    items: [
      {
        id: "n_dev",
        kind: "approval",
        title: "Approval requested",
        ts: 2,
        read: false,
        approvalId: "a-device",
        tone: "warn",
      },
      {
        id: "n_own",
        kind: "approval",
        title: "Approval requested",
        ts: 1,
        read: false,
        approvalId: "a-owner",
        tone: "warn",
      },
    ],
  }),
}));

import { InboxList } from "./InboxWidget";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate.mockClear();
  marked.mockClear();
});

const approval = (id: string, requestedBy: string | null): ApprovalRecord => ({
  id,
  createdAt: 1,
  kind: "write_run",
  description: "Write-mode prompt run",
  payload: { kind: "prompt", input: { prompt: "x" } },
  status: "pending",
  resolvedAt: null,
  resolvedBy: null,
  requestedBy,
  expiresAt: 2,
});

describe("the inbox's tick", () => {
  it("C59 reviews a device's write and approves the owner's", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({});
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(qk.approvals, [approval("a-device", "device:abc"), approval("a-owner", "owner")]);
    render(
      createElement(
        I18nContext.Provider,
        { value: { lang: "en", setLang: () => undefined } },
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(
            ToastProvider,
            null,
            createElement(MemoryRouter, null, createElement(InboxList, { limit: 10 })),
          ),
        ),
      ),
    );
    // One row of each: the device's has a review button and no approve button, the owner's the other way round.
    const rows = Array.from(document.querySelectorAll(".inbox-row"));
    expect(rows).toHaveLength(2);
    const names = rows.map((r) =>
      Array.from(r.querySelectorAll("button[aria-label]")).map((b) => b.getAttribute("aria-label")),
    );
    expect(names).toEqual([
      ["Review the whole request", "Deny"],
      ["Approve", "Deny"],
    ]);
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Review the whole request" }));
    expect(navigate).toHaveBeenCalledWith("/settings?tab=security");
    expect(post).not.toHaveBeenCalled();
    // Denying a device's write needs no review.
    fireEvent.click(within(rows[0] as HTMLElement).getByRole("button", { name: "Deny" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/approvals/a-device/resolve", { decision: "denied" }),
    );
  });
});
