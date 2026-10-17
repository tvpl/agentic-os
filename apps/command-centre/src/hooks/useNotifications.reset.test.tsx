// @vitest-environment jsdom
/**
 * Segurança P1 (.specs/features/seguranca-p1, C29): when the event stream says its resume point is gone
 * (`stream.reset`, a restarted service) or that it dropped (`stream.reconnected`), the notification feed is
 * re-read from the server. The proof renders the real provider, fires the event through the stream's
 * fan-out and watches the inbox request and the list.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type * as ApiModule from "../api";
import type { OsEvent } from "../api";

const hoisted = vi.hoisted(() => ({
  listeners: new Set<(event: OsEvent) => void>(),
  inbox: [] as Array<Record<string, unknown>>,
  gets: [] as string[],
}));

vi.mock("../api", async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>();
  return {
    ...mod,
    api: {
      ...mod.api,
      get: vi.fn((url: string) => {
        hoisted.gets.push(url);
        return Promise.resolve({ items: hoisted.inbox });
      }),
      post: vi.fn(() => Promise.resolve({})),
    },
  };
});

vi.mock("./useEventStream", () => ({
  subscribeOsEvents: (fn: (event: OsEvent) => void) => {
    hoisted.listeners.add(fn);
    return () => hoisted.listeners.delete(fn);
  },
}));

import { NotificationsProvider, useNotifications } from "./useNotifications";

const row = (id: string, title: string) => ({
  id,
  kind: "system",
  title,
  ts: 1000,
  read: false,
});

function Feed() {
  const { items } = useNotifications();
  return (
    <ul>
      {items.map((i) => (
        <li key={i.id}>{i.title}</li>
      ))}
    </ul>
  );
}

const emit = (type: string, payload: unknown = {}) =>
  act(() => {
    for (const fn of hoisted.listeners) fn({ type, ts: Date.now(), payload } as unknown as OsEvent);
  });

afterEach(() => {
  cleanup();
  hoisted.listeners.clear();
  hoisted.gets.length = 0;
});

describe("C29 the notification feed is re-read when the event stream loses its place", () => {
  it.each(["stream.reset", "stream.reconnected"])("%s re-seeds the list from the server", async (type) => {
    hoisted.inbox = [row("n_1", "first")];
    render(
      <NotificationsProvider>
        <Feed />
      </NotificationsProvider>,
    );
    await screen.findByText("first");
    expect(hoisted.gets).toHaveLength(1);

    // The service restarted while the tab slept: the server's inbox is the truth now.
    hoisted.inbox = [row("n_2", "after the restart")];
    emit(type, type === "stream.reset" ? { lastId: 7 } : {});
    await screen.findByText("after the restart");
    expect(hoisted.gets).toHaveLength(2);
    expect(hoisted.gets[1]).toContain("/api/notifications");
  });

  it("an unrelated event does not re-read the inbox", async () => {
    hoisted.inbox = [row("n_1", "first")];
    render(
      <NotificationsProvider>
        <Feed />
      </NotificationsProvider>,
    );
    await screen.findByText("first");
    emit("settings.changed", {});
    await waitFor(() => expect(hoisted.gets).toHaveLength(1));
  });
});
