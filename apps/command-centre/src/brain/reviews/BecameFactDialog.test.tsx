// @vitest-environment jsdom
/**
 * "Virou realidade" (.specs/features/cerebro-natureza, C80; design.md "Diálogo - Virou realidade"; plan.md amendment
 * 8): one `Modal` of 480 px with "Desde", the closed section "Registrar como fato" and its three fields, the footer, what
 * "Confirmar" sends closed and open, and a failed save inside the dialog. Opened from the screen, over `./testkit`.
 */
// The dialog's day is local midnight (amendment 8): a zone away from UTC tells it from UTC midnight (round 3, D1).
process.env.TZ = "America/Sao_Paulo";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import postcss from "postcss";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { resetNet } from "../notes/testnet";
import { NetError, decided, item, list, mountReviews, net, resetReviews, reviews, sent } from "./testkit";

vi.mock("../../api", async (importOriginal) =>
  (await import("../notes/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 30_000 });

installPage();
beforeEach(() => {
  resetNet();
  resetReviews();
});

const pad = (n: number) => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function open() {
  const a = item("notes/plano.md", { natureza: "plano" });
  list({}, [a]);
  mountReviews();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Virou realidade" }));
  const dialog = await screen.findByRole("dialog", { name: "Virou realidade" });
  return { a, user, dialog, version: `sha256:${net.files.find((f) => f.rel === "notes/plano.md")!.id}` };
}

describe("C80 the dialog Virou realidade", () => {
  it("C80 one Modal 480 px wide titled Virou realidade: Desde (date, today), the closed Registrar como fato, then Cancelar and Confirmar (.btn.primary)", async () => {
    const { dialog, user } = await open();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(dialog.classList.contains("modal")).toBe(true);
    expect(dialog.classList.contains("rv-dialog")).toBe(true);
    let width = "";
    postcss
      .parse(readFileSync(join(__dirname, "reviews.css"), "utf8"))
      .walkRules(".modal.rv-dialog", (r) => r.walkDecls("width", (d) => void (width = d.value)));
    expect(width).toBe("min(480px, 100%)");
    const since = within(dialog).getByLabelText("Desde") as HTMLInputElement;
    expect(since.type).toBe("date");
    expect(since.value).toBe(today());
    const record = within(dialog).getByRole("button", { name: "Registrar como fato" });
    expect(record.getAttribute("aria-expanded")).toBe("false");
    expect(within(dialog).queryByLabelText("O quê")).toBeNull();
    const foot = [...dialog.querySelectorAll(".modal-actions button")];
    expect(foot.map((b) => `${b.textContent}|${b.className}`)).toEqual([
      "Cancelar|btn ghost",
      "Confirmar|btn primary",
    ]);
    const order = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(order(since, record)).toBe(true);
    await user.click(record);
    const fields = ["O quê", "Atributo", "Valor"].map(
      (l) => within(dialog).getByLabelText(l) as HTMLInputElement,
    );
    for (const f of fields) expect(f.maxLength).toBe(200);
    expect(order(record, fields[0]!)).toBe(true);
    expect(order(fields[0]!, fields[1]!) && order(fields[1]!, fields[2]!)).toBe(true);
    expect(order(fields[2]!, foot[0]!)).toBe(true);
  });

  it("C80 Confirmar with the section closed sends became_fact with the version and no fact", async () => {
    const { a, user, dialog, version } = await open();
    reviews.decide = (b) => Promise.resolve(decided((b as { path: string }).path, { version: "sha256:v2" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirmar" }));
    await waitFor(() =>
      expect(sent("POST", "/api/memory/reviews")).toEqual([
        { path: a.path, action: "became_fact", baseVersion: version },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("C80 with the section open and filled, fact carries the three fields and validFrom = the chosen day at local midnight", async () => {
    const { a, user, dialog, version } = await open();
    reviews.decide = (b) => Promise.resolve(decided((b as { path: string }).path, { version: "sha256:v2" }));
    const since = within(dialog).getByLabelText("Desde");
    await user.clear(since);
    await user.type(since, "2026-03-15");
    await user.click(within(dialog).getByRole("button", { name: "Registrar como fato" }));
    await user.type(within(dialog).getByLabelText("O quê"), "Curso");
    await user.type(within(dialog).getByLabelText("Atributo"), "lançamento");
    await user.type(within(dialog).getByLabelText("Valor"), "março");
    await user.click(within(dialog).getByRole("button", { name: "Confirmar" }));
    await waitFor(() =>
      expect(sent("POST", "/api/memory/reviews")).toEqual([
        {
          path: a.path,
          action: "became_fact",
          baseVersion: version,
          fact: {
            subject: "Curso",
            predicate: "lançamento",
            object: "março",
            validFrom: new Date(2026, 2, 15).getTime(),
          },
        },
      ]),
    );
    // The zone holds: local midnight of 2026-03-15 is 03:00 UTC there, three hours after UTC midnight.
    expect(new Date(2026, 2, 15).getTimezoneOffset()).toBe(180);
    expect(new Date(2026, 2, 15).getTime() - Date.UTC(2026, 2, 15)).toBe(3 * 3_600_000);
  });

  it("C80 a failed save shows the error inside the dialog, which stays open with what was typed", async () => {
    const { user, dialog } = await open();
    reviews.decide = () => Promise.reject(new NetError(500, "boom", "Não deu para salvar."));
    await user.click(within(dialog).getByRole("button", { name: "Registrar como fato" }));
    await user.type(within(dialog).getByLabelText("O quê"), "Curso");
    await user.type(within(dialog).getByLabelText("Atributo"), "preço");
    await user.type(within(dialog).getByLabelText("Valor"), "100");
    await user.click(within(dialog).getByRole("button", { name: "Confirmar" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toBe("Não deu para salvar.");
    expect(alert.querySelector("svg.lucide-triangle-alert")).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "Virou realidade" })).toBe(dialog);
    expect((within(dialog).getByLabelText("O quê") as HTMLInputElement).value).toBe("Curso");
    expect((within(dialog).getByLabelText("Valor") as HTMLInputElement).value).toBe("100");
  });
});
