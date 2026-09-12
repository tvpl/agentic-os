import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("an objective drives the Now panel and preserves its causal chain in run detail", async ({
  page,
  request,
}) => {
  const headers = { "x-mordomo-token": process.env.MORDOMO_TOKEN! };
  const existing = (await (await request.get("/api/objectives", { headers })).json()) as Array<{
    id: string;
  }>;
  for (const objective of existing) {
    const deleted = await request.delete(`/api/objectives/${encodeURIComponent(objective.id)}`, { headers });
    expect(deleted.ok()).toBe(true);
  }
  const created = await request.post("/api/objectives", {
    headers,
    data: {
      project: "engine",
      title: "Validate durable objective",
      description: "A visible objective with evidence",
      context: { decisions: ["Use the fake provider"], retention: "Delete with the objective" },
      steps: [
        {
          title: "Produce evidence",
          request: {
            version: 1,
            kind: "prompt",
            prompt: "Return a concise verification result",
            mode: "read_only",
          },
          priority: 20,
        },
      ],
    },
  });
  expect(created.ok()).toBe(true);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  const panel = page.locator(".now-objective");
  await expect(panel).toContainText("Validate durable objective");
  const action = panel.getByRole("button", { name: "Run ready steps" });
  await expect(action).toBeInViewport();
  await action.click();
  const inspect = panel.getByRole("link", { name: "Inspect run" });
  await expect(inspect).toBeVisible();
  await inspect.click();
  await expect(page.getByText("Objective and causal chain")).toBeVisible();
  await expect(page.getByText(/Produce evidence · (dispatched|verified|verifying)/)).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? "")),
  ).toEqual([]);
});
