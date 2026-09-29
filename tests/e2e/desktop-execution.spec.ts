/**
 * Execution in the immersive shell (redesign G3, nucleo-imersivo rule 4): a
 * request said on the voice line is followed in the conversation, step by
 * step, and its trace is one click away ("Open run →"), projected as a lâmina
 * where you are; a skill's inputs are a lâmina, its result is a lâmina, and
 * every one of them is something the voice line can point at. In the Runs
 * scene the trace unfolds in place instead.
 */
import { test, expect } from "@playwright/test";
import {
  arrived,
  foldConversation,
  lamina,
  lastTurn,
  liveLaminas,
  openRunFromTurn,
  openShell,
  openVoiceControls,
  sendPrompt,
} from "./shell";

test("voice line → conversation → trace lâmina → result lâmina → reference in the next prompt", async ({
  page,
}) => {
  await openShell(page);
  const voice = page.locator("[data-console]");
  // The fake provider writes `report.md` into this run's own artifacts directory.
  const runId = await sendPrompt(page, "write me a report [[artifact:report.md]]");
  // Sending projects nothing: the turn in the conversation is where the run is followed.
  await expect(lastTurn(page).locator(".console-msg.you")).toContainText("write me a report");
  await expect(lamina(page, "run:", "^=")).toHaveCount(0);
  // Its result is offered in the turn once it is done…
  await expect(lastTurn(page).locator(".console-artifact-open")).toContainText("report.md", {
    timeout: 20_000,
  });
  await expect(lamina(page, "run:", "^=")).toHaveCount(0);
  // …and "Open run →" projects the trace beside the core, with the run's own
  // title, folding the conversation so it can be read.
  await openRunFromTurn(page);
  await expect(page.getByTestId("voice")).not.toHaveAttribute("data-open", /.*/);
  const trace = lamina(page, `run:${runId}`);
  await expect(trace).toHaveCount(1);
  await expect(trace.locator(".nu-lamina-title")).toHaveText(/^run-[0-9a-f]{8}/);
  await expect(trace.locator(".run-panel")).toHaveAttribute("data-run-status", "done", { timeout: 20_000 });
  // The result lands beside it — once, as one lâmina, readable.
  const result = lamina(page, "doc:", "^=");
  await expect(result).toHaveCount(1);
  await expect(result.locator(".nu-lamina-title")).toHaveText("report.md");
  await expect(result.locator(".nu-lamina-body")).toContainText("Written by the fake provider");
  await expect(liveLaminas(page)).toHaveCount(2);
  // The Núcleo is still the scene; the URL never left it.
  await expect(page).toHaveURL(/#\/$/);
  await arrived(page, "nucleo");
  // Both are the voice line's context, and both are referenceable from it.
  const side = await openVoiceControls(page);
  await expect(side.locator(".cons-tray .chp", { hasText: /@run-/ })).toHaveCount(1);
  await expect(side.locator(".cons-tray .chp", { hasText: "@report.md" })).toHaveCount(1);
  await foldConversation(page);
  await result.locator(".nu-lamina-ref").click();
  await expect(voice.locator("textarea")).toHaveValue(/^@report\.md /);
  await trace.locator(".nu-lamina-ref").click();
  await expect(voice.locator("textarea")).toHaveValue(/@report\.md @run-[0-9a-f]{8} $/);
});

test("a skill with required inputs asks in a lâmina, then runs; the form leaves when the run arrives", async ({
  page,
}) => {
  await openShell(page);
  await page.keyboard.press("ControlOrMeta+j");
  const deck = page.locator(".skill-deck");
  await expect(deck).toHaveClass(/open/);
  // The seat shows the skill's name; the title carries the slug.
  await deck.locator('.deck-skill[title^="/code-review"]').click();
  const form = lamina(page, "form:code-review");
  await expect(form).toBeVisible();
  await expect(form.locator(".nu-lamina-title")).toHaveText("/code-review · inputs");
  await expect(deck).toHaveCount(0);
  // An empty required field is refused in place, not by the server.
  await form.getByRole("button", { name: /^run|executar/i }).click();
  await expect(form.locator("[aria-invalid='true']")).toHaveCount(1);
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(lamina(page, "run:", "^=")).toHaveCount(0);
  await form.locator("input, textarea").first().fill("apps/command-centre");
  await form.getByRole("button", { name: /^run|executar/i }).click();
  const trace = lamina(page, "run:", "^=");
  await expect(trace).toHaveCount(1);
  await expect(trace.locator(".nu-lamina-title")).toHaveText(/^run-[0-9a-f]{8} · \/code-review$/);
  // The form's job is done: it is gone, and the voice line no longer offers it.
  await expect(lamina(page, "form:code-review")).toHaveCount(0);
  const side = await openVoiceControls(page);
  await expect(side.locator(".cons-tray .chp", { hasText: "@code-review" })).toHaveCount(0);
  await expect(trace.locator(".run-panel")).toHaveAttribute("data-run-status", "done", { timeout: 20_000 });
});

test("a write-mode skill waits in the approvals lâmina; approving projects its trace", async ({ page }) => {
  await openShell(page);
  await page.keyboard.press("ControlOrMeta+j");
  await page.locator('.skill-deck .deck-skill[title^="/consolidate-memory"]').click();
  const approvals = lamina(page, "approvals");
  await expect(approvals).toBeVisible();
  await expect(approvals.locator(".nu-lamina-body")).toContainText(/consolidate-memory/);
  // A pending decision is "waiting for you", not an alarm (refino item 21).
  await expect(page.locator(".nu-shell")).toHaveAttribute("data-core", "waiting");
  await approvals
    .getByRole("button", { name: /^approve|aprovar/i })
    .first()
    .click();
  const trace = lamina(page, "run:", "^=");
  await expect(trace).toHaveCount(1);
  await expect(trace.locator(".nu-lamina-title")).toHaveText(/\/consolidate-memory$/);
  await expect(trace.locator(".run-panel")).toHaveAttribute("data-run-status", "done", { timeout: 20_000 });
  await expect(approvals.locator(".nu-lamina-body")).not.toContainText(/consolidate-memory/);
});

test("a run's route is a deep link into its trace, unfolded in the Runs scene", async ({ page }) => {
  await openShell(page);
  const id = await sendPrompt(page, "hello from a deep link");
  await openRunFromTurn(page);
  const trace = lamina(page, `run:${id}`);
  await expect(trace).toHaveCount(1);
  await expect(trace.locator(".run-panel")).toHaveAttribute("data-run-status", "done", { timeout: 20_000 });
  await trace.getByRole("button", { name: /^(Dismiss|Dispensar): / }).click();
  await expect(liveLaminas(page)).toHaveCount(0);

  await page.goto(`/#/runs/${id}`);
  await arrived(page, "runs");
  await expect(page).toHaveURL(new RegExp(`#/runs/${id}$`));
  const unfolded = page.locator(".rs-trace.on");
  await expect(unfolded).toBeVisible();
  await expect(unfolded.locator(".rs-trace-top h3")).toContainText("hello from a deep link");
  await expect(unfolded.locator(".rs-pill")).toHaveText(/done|conclu/i);
  // "Full detail" is a query on the same place: a link, a reload and Back land there.
  await unfolded.getByRole("button", { name: /Full detail|Detalhe completo|detail/i }).click();
  await expect(page).toHaveURL(new RegExp(`#/runs/${id}\\?detail=1$`));
  const sheet = page.locator(".rs-sheet");
  await expect(sheet).toBeVisible();
  await page.reload();
  await expect(page.locator(".rs-sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".rs-sheet")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#/runs/${id}$`));

  // From a lâmina elsewhere, "open in its scene" goes to the same place.
  await page.goto("/#/");
  await arrived(page, "nucleo");
  await page.evaluate(
    (rid) => window.dispatchEvent(new CustomEvent("mordomo:open-panel", { detail: `run:${rid}` })),
    id,
  );
  await lamina(page, `run:${id}`)
    .getByRole("button", { name: /^(Open in its scene|Abrir na cena): / })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/runs/${id}$`));
  await arrived(page, "runs");
  await expect(page.locator(".rs-trace.on")).toBeVisible();
});

test("in the Runs scene a run from the voice line unfolds in place, not in a lâmina", async ({ page }) => {
  await openShell(page, "/runs");
  await arrived(page, "runs");
  const id = await sendPrompt(page, "hello from the river");
  // Saying it does not leave the conversation; its "Open run →" unfolds the trace in the river.
  await expect(page).toHaveURL(/#\/runs$/);
  await openRunFromTurn(page);
  await expect(page).toHaveURL(new RegExp(`#/runs/${id}$`));
  await expect(page.getByTestId("voice")).not.toHaveAttribute("data-open", /.*/);
  await expect(page.locator(".rs-trace.on .rs-trace-top h3")).toContainText("hello from the river");
  await expect(liveLaminas(page)).toHaveCount(0);
  await expect(page.locator(".rs-trace.on .rs-pill")).toHaveText(/done|conclu/i, { timeout: 20_000 });
});
