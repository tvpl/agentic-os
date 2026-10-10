// @vitest-environment jsdom
/**
 * Settings › Security › Remote access (.specs/features/escopos-dispositivo, slice S6): the permissions of a paired
 * device are chosen when the code is shown and edited afterwards, and the card says that another machine needs TLS.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DeviceScope } from "@mordomo/contracts/policy";
import { api, type DeviceRecord } from "../../api";
import { ToastProvider } from "../../components/ui";
import { ConfirmProvider } from "../../hooks/useConfirm";
import { dictionaries, I18nContext, type Lang } from "../../i18n";
import { qk } from "../../queries";
import { SecurityTab } from "./security";
import type { SettingsShape } from "./shared";

const device = (id: string, name: string, scopes: DeviceScope[]): DeviceRecord => ({
  id,
  name,
  createdAt: 1,
  lastSeenAt: null,
  expiresAt: null,
  revokedAt: null,
  scopes,
});

function setup(
  options: { remote?: boolean; tls?: boolean; devices?: DeviceRecord[]; lang?: Lang; pairing?: boolean } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(qk.devices, { devices: options.devices ?? [], pairing: false });
  qc.setQueryData(qk.approvals, []);
  qc.setQueryData(qk.meta, { name: "x", tls: null });
  const s = {
    securityProfile: "review_before_write",
    port: 4777,
    limits: { dailyBudgetUsd: 0 },
    routines: { allowWebhooks: false },
    connectors: { allowedCommands: [] },
    remote: {
      enabled: options.remote ?? true,
      allowedHosts: [],
      deviceTtlDays: 90,
      tls: { enabled: options.tls ?? false, port: null },
    },
  } as unknown as SettingsShape;
  const view = render(
    <I18nContext.Provider value={{ lang: options.lang ?? "en", setLang: () => {} }}>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <ConfirmProvider>
            <SecurityTab s={s} put={() => Promise.resolve({ ok: true })} />
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>
    </I18nContext.Provider>,
  );
  return { qc, view };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const card = () => document.querySelector("#pair-scopes")!.closest(".card")!;
/** The checkboxes of a permission group by their label, in the order they are drawn. */
const boxes = (group: Element) =>
  Array.from(group.querySelectorAll("label.check")).map((label) => ({
    name: label.querySelector("strong")!.textContent,
    input: label.querySelector("input") as HTMLInputElement,
  }));
const state = (group: Element) =>
  boxes(group).map((b) => `${b.name}:${b.input.checked ? "on" : "off"}${b.input.disabled ? ":locked" : ""}`);
const box = (group: Element, name: string) => boxes(group).find((b) => b.name === name)!.input;

describe("S6 the permissions of a paired device", () => {
  it("C35 the pairing group sends the chosen scopes", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ code: "123456", expiresAt: Date.now() + 60_000 });
    setup();
    const group = document.querySelector("#pair-scopes")!;
    expect(group.tagName).toBe("FIELDSET");
    expect(group.querySelector("legend")!.textContent).toBe("Permissions for the new device");
    expect(state(group)).toEqual([
      "Monitor:on:locked",
      "Read content:on:locked",
      "Start runs:on",
      "Approve:off",
    ]);
    // Defaults first: the button sends the closure of what is ticked.
    fireEvent.click(screen.getByRole("button", { name: "Show a code" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenLastCalledWith("/api/pair/start", { scopes: ["monitor", "content", "run"] });

    // approve brings monitor; with run unticked, content is free again and monitor stays locked by approve
    fireEvent.click(box(group, "Approve"));
    expect(state(group)).toEqual([
      "Monitor:on:locked",
      "Read content:on:locked",
      "Start runs:on",
      "Approve:on",
    ]);
    fireEvent.click(box(group, "Start runs"));
    expect(state(group)).toEqual(["Monitor:on:locked", "Read content:on", "Start runs:off", "Approve:on"]);
    fireEvent.click(box(group, "Read content"));
    expect(state(group)).toEqual(["Monitor:on:locked", "Read content:off", "Start runs:off", "Approve:on"]);
    // run needs content and monitor: ticking it ticks and locks both
    fireEvent.click(box(group, "Start runs"));
    expect(state(group)).toEqual([
      "Monitor:on:locked",
      "Read content:on:locked",
      "Start runs:on",
      "Approve:on",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Show a code" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenLastCalledWith("/api/pair/start", {
      scopes: ["monitor", "content", "run", "approve"],
    });
    // Nothing ticked but monitor: the smallest device.
    fireEvent.click(box(group, "Approve"));
    fireEvent.click(box(group, "Start runs"));
    expect(state(group)).toEqual(["Monitor:on", "Read content:off", "Start runs:off", "Approve:off"]);
    fireEvent.click(box(group, "Monitor"));
    fireEvent.click(screen.getByRole("button", { name: "Show a code" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(post).toHaveBeenLastCalledWith("/api/pair/start", { scopes: [] });
  });

  it("C35 the button waits for remote access to be on", () => {
    setup({ remote: false });
    expect(screen.getByRole("button", { name: "Show a code" })).toHaveProperty("disabled", true);
  });

  it("C36 a device row shows and edits its permissions", async () => {
    const patch = vi.spyOn(api, "patch").mockResolvedValue(undefined);
    setup({
      devices: [
        device("d1", "Phone", ["monitor", "content", "run"]),
        device("d2", "Tablet", ["monitor", "approve"]),
      ],
    });
    const rows = Array.from(document.querySelectorAll(".device-list li"));
    expect(rows.map((r) => r.querySelector(".device-scopes")!.textContent)).toEqual([
      "Permissions: Monitor, Read content, Start runs",
      "Permissions: Monitor, Approve",
    ]);
    expect(document.querySelector(".device-editor")).toBeNull();

    const tablet = rows[1] as HTMLElement;
    fireEvent.click(within(tablet).getByRole("button", { name: "Permissions" }));
    const editor = tablet.querySelector(".device-editor")!;
    expect(state(editor.querySelector("fieldset")!)).toEqual([
      "Monitor:on:locked",
      "Read content:off",
      "Start runs:off",
      "Approve:on",
    ]);
    fireEvent.click(box(editor, "Start runs"));
    fireEvent.click(within(editor as HTMLElement).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenLastCalledWith("/api/devices/d2", {
      scopes: ["monitor", "content", "run", "approve"],
    });
    await waitFor(() => expect(document.querySelector(".device-editor")).toBeNull());

    // Cancel sends nothing and closes.
    fireEvent.click(within(rows[0] as HTMLElement).getByRole("button", { name: "Permissions" }));
    fireEvent.click(within(rows[0] as HTMLElement).getByRole("button", { name: "Cancel" }));
    expect(document.querySelector(".device-editor")).toBeNull();
    expect(patch).toHaveBeenCalledTimes(1);

    // A refusal keeps the editor and says what the server said.
    patch.mockRejectedValueOnce(new Error("Only the owner, with the local token, can call this route"));
    fireEvent.click(within(rows[0] as HTMLElement).getByRole("button", { name: "Permissions" }));
    fireEvent.click(within(rows[0] as HTMLElement).getByRole("button", { name: "Save" }));
    await screen.findByText("Only the owner, with the local token, can call this route");
    expect(rows[0]!.querySelector(".device-editor")).not.toBeNull();
  });

  it("C37 the TLS requirement is said on the card", () => {
    for (const lang of ["en", "pt-BR"] as const) {
      const text = dictionaries[lang]["apps.settings.remoteTlsRequired"];
      const on = setup({ remote: true, tls: false, lang });
      const notice = document.querySelector("#remote-tls-required");
      expect(notice?.textContent, lang).toBe(text);
      expect(notice?.tagName).toBe("P");
      expect(notice?.className).toBe("hint warn");
      // Between the TLS row and the pairing row.
      const rows = Array.from(card().children);
      const at = rows.indexOf(notice!);
      expect(rows[at - 1]?.textContent).toContain(dictionaries[lang]["apps.settings.remoteTls"]);
      expect(rows[at + 1]?.textContent).toContain(dictionaries[lang]["apps.settings.pairDevice"]);
      on.view.unmount();
      setup({ remote: true, tls: true, lang }).view.unmount();
      expect(document.querySelector("#remote-tls-required")).toBeNull();
      setup({ remote: false, tls: false, lang }).view.unmount();
      expect(document.querySelector("#remote-tls-required")).toBeNull();
    }
  });

  it("C38 the card keeps its arrangement", () => {
    const names = (el: Element) =>
      Array.from(el.children).map((c) => {
        if (c.id === "remote-tls-required") return "R5";
        if (c.id === "pair-scopes") return "R7";
        if (c.classList.contains("pairing-code-box")) return "R8";
        if (c.classList.contains("device-list")) return "R9";
        if (c.tagName === "H2") return "R1";
        return c.className === "apps-sound"
          ? `row:${c.querySelector("strong, h2")?.textContent ?? ""}`
          : c.tagName;
      });
    const header = dictionaries.en["apps.settings.remote"];
    const tlsRow = `row:${dictionaries.en["apps.settings.remoteTls"]}`;
    const pairRow = `row:${dictionaries.en["apps.settings.pairDevice"]}`;
    // Off, on without TLS, on with TLS: the cards of the states, in the order R1-R10 draw them.
    const states: Array<[string, Parameters<typeof setup>[0], string[]]> = [
      ["off", { remote: false }, [`row:${header}`, "DIV", "DIV", tlsRow, pairRow, "R7"]],
      ["on, no TLS", { remote: true }, [`row:${header}`, "DIV", "DIV", tlsRow, "R5", pairRow, "R7"]],
      ["on, TLS", { remote: true, tls: true }, [`row:${header}`, "DIV", "DIV", tlsRow, pairRow, "R7"]],
    ];
    for (const [name, options, expected] of states) {
      const { view } = setup(options);
      expect(names(card()), name).toEqual(expected.map((x) => x));
      view.unmount();
    }
    // Two devices, the editor open on the second: name, last seen, actions, permissions line, editor.
    const { view } = setup({
      devices: [device("d1", "Phone", ["monitor"]), device("d2", "Tablet", ["monitor", "content"])],
    });
    fireEvent.click(
      within(document.querySelectorAll(".device-list li")[1] as HTMLElement).getByRole("button", {
        name: "Permissions",
      }),
    );
    const items = Array.from(document.querySelectorAll(".device-list li"));
    const order = (li: Element) =>
      Array.from(li.children).map((c) =>
        c.classList.contains("row-actions")
          ? "actions"
          : c.className.split(" ")[0] || c.tagName.toLowerCase(),
      );
    expect(order(items[0]!)).toEqual(["strong", "meta", "actions", "meta"].map((x) => x));
    expect(order(items[1]!)).toEqual(["strong", "meta", "actions", "meta", "device-editor"].map((x) => x));
    view.unmount();
  });

  it("C38 every new key reads in both languages", () => {
    const keys = Object.keys(dictionaries.en).filter((k) =>
      /^apps\.settings\.(scope|deviceScopes|remoteTlsRequired)/.test(k),
    );
    expect(keys.sort()).toEqual(
      [
        "apps.settings.deviceScopes",
        "apps.settings.deviceScopesEdit",
        "apps.settings.remoteTlsRequired",
        "apps.settings.scope.approve",
        "apps.settings.scope.approve.hint",
        "apps.settings.scope.content",
        "apps.settings.scope.content.hint",
        "apps.settings.scope.monitor",
        "apps.settings.scope.monitor.hint",
        "apps.settings.scope.run",
        "apps.settings.scope.run.hint",
        "apps.settings.scopeGroup",
        "apps.settings.scopeNone",
      ].sort(),
    );
    for (const key of keys) {
      const en = dictionaries.en[key as keyof typeof dictionaries.en];
      const pt = dictionaries["pt-BR"][key as keyof (typeof dictionaries)["pt-BR"]];
      expect(en, key).not.toBe("");
      expect(pt, key).not.toBe("");
      expect(pt, key).not.toBe(en);
    }
  });
});
