// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IdentityFields, isValidTimeZone, type Put, type SaveResult } from "./SettingsFields";

const base = {
  systemName: "Mordomo",
  theme: "dark" as const,
  language: "en" as const,
  accentColor: "#7c5cff",
  port: 4123,
  timezone: "UTC",
};

const ok = (): Promise<SaveResult> => Promise.resolve({ ok: true });

function setup(put: Put = vi.fn(ok)) {
  const setLang = vi.fn();
  render(<IdentityFields s={base} put={put} setLang={setLang} />);
  return { put, setLang };
}

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Settings identity fields", () => {
  it("saves the trimmed value on blur and confirms inline", async () => {
    const { put } = setup();
    const name = input("System name");
    fireEvent.change(name, { target: { value: "  Jarvis  " } });
    fireEvent.blur(name);
    await waitFor(() => expect(put).toHaveBeenCalledWith({ systemName: "Jarvis" }));
    expect(put).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Saved ✓")).toBeTruthy();
    expect(name.value).toBe("Jarvis");
  });

  it("does not send a PUT when the value is unchanged or empty", () => {
    const { put } = setup();
    const name = input("System name");
    fireEvent.change(name, { target: { value: " Mordomo " } });
    fireEvent.blur(name);
    expect(put).not.toHaveBeenCalled();
    expect(name.value).toBe("Mordomo");

    fireEvent.change(name, { target: { value: "   " } });
    fireEvent.blur(name);
    expect(put).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("This field cannot be empty.");
  });

  it("rejects an out-of-range or cleared port without saving", () => {
    const { put } = setup();
    const port = input("Port");
    fireEvent.change(port, { target: { value: "80" } });
    fireEvent.blur(port);
    expect(put).not.toHaveBeenCalled();
    expect(port.getAttribute("aria-invalid")).toBe("true");
    expect(port.getAttribute("aria-describedby")).toBe("st-port-error");
    expect(screen.getByRole("alert").textContent).toBe("Enter a whole number between 1024 and 65535.");

    fireEvent.change(port, { target: { value: "" } });
    fireEvent.blur(port);
    expect(put).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();

    // Fixing the value clears the error live and saves on blur.
    fireEvent.change(port, { target: { value: "5000" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.blur(port);
    expect(put).toHaveBeenCalledWith({ port: 5000 });
  });

  it("saves on Enter and reverts on Escape", async () => {
    const { put } = setup();
    const tz = input("Timezone");
    fireEvent.change(tz, { target: { value: "America/Sao_Paulo" } });
    fireEvent.keyDown(tz, { key: "Enter" });
    await waitFor(() => expect(put).toHaveBeenCalledWith({ timezone: "America/Sao_Paulo" }));

    fireEvent.change(tz, { target: { value: "Mars/Olympus" } });
    fireEvent.keyDown(tz, { key: "Escape" });
    expect(tz.value).toBe("UTC");
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown timezone", () => {
    const { put } = setup();
    const tz = input("Timezone");
    fireEvent.change(tz, { target: { value: "Mars/Olympus" } });
    fireEvent.blur(tz);
    expect(put).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/Unknown timezone/);
    expect(isValidTimeZone("Europe/Lisbon")).toBe(true);
    expect(isValidTimeZone("Nowhere/Land")).toBe(false);
  });

  it("surfaces a server error inline and keeps the rejected draft", async () => {
    const put = vi.fn(async (): Promise<SaveResult> => ({ ok: false, error: "port already in use" }));
    setup(put);
    const port = input("Port");
    fireEvent.change(port, { target: { value: "5000" } });
    fireEvent.blur(port);
    await waitFor(() => expect(put).toHaveBeenCalledWith({ port: 5000 }));
    expect((await screen.findByRole("alert")).textContent).toBe("port already in use");
    expect(port.value).toBe("5000");
    expect(port.getAttribute("aria-invalid")).toBe("true");
  });

  it("validates the accent hex field and normalises it", async () => {
    const { put } = setup();
    const hex = screen.getByLabelText("Accent color", { selector: "input[type=text]" }) as HTMLInputElement;
    fireEvent.change(hex, { target: { value: "ZZZZZZ" } });
    fireEvent.blur(hex);
    expect(put).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Use a hex colour like #7c5cff.");
    fireEvent.change(hex, { target: { value: "FF8800" } });
    fireEvent.blur(hex);
    await waitFor(() => expect(put).toHaveBeenCalledWith({ accentColor: "#ff8800" }, true));
  });

  it("switches the UI language only after the server accepted it", async () => {
    const put = vi.fn(async (): Promise<SaveResult> => ({ ok: false, error: "nope" }));
    const { setLang } = setup(put);
    const lang = screen.getByLabelText("Language") as HTMLSelectElement;
    fireEvent.change(lang, { target: { value: "pt-BR" } });
    await waitFor(() => expect(put).toHaveBeenCalledWith({ language: "pt-BR" }, true));
    expect(setLang).not.toHaveBeenCalled();
    expect(lang.value).toBe("en");

    put.mockImplementation(ok);
    fireEvent.change(lang, { target: { value: "pt-BR" } });
    await waitFor(() => expect(setLang).toHaveBeenCalledWith("pt-BR"));
  });
});
