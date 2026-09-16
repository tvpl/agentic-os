// @vitest-environment jsdom
/**
 * The deck's promise is that a skill is always one gesture away: the arc
 * carries the enabled skills, favourites first, picking one runs it and the
 * deck closes. Asserted on the rendered buttons rather than on the geometry,
 * because the geometry is decoration and the run is the contract.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { Skill } from "../api";
import { qk } from "../queries";
import { DesktopActionsProvider, type DesktopActions } from "./actions";
import SkillDeck from "./SkillDeck";

function skill(slug: string, over: Partial<Skill> = {}): Skill {
  return {
    slug,
    name: slug,
    description: "",
    triggers: [],
    inputs: [],
    providers: [],
    recommendedModel: null,
    recommendedEffort: "medium",
    mode: "read_only",
    enabled: true,
    version: "1",
    guardrails: [],
    successCriteria: [],
    resources: [],
    bodyLineCount: 0,
    thick: false,
    body: "",
    skillFile: `${slug}/SKILL.md`,
    ...over,
  };
}

function setup(skills: Skill[], over: Partial<DesktopActions> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(qk.skills, skills);
  const runSkill = vi.fn();
  const onClose = vi.fn();
  const actions: DesktopActions = {
    runSkill,
    configureSkill: () => undefined,
    focusDeck: () => undefined,
    runningSkills: new Set<string>(),
    openDocs: [],
    openDoc: () => undefined,
    referenceDoc: () => undefined,
    ...over,
  };
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <DesktopActionsProvider value={actions}>
          <SkillDeck open onClose={onClose} />
        </DesktopActionsProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { runSkill, onClose };
}

/** The skills on the arc, in arc order (the scrim is a button too). */
const slugs = () =>
  screen
    .getAllByRole("button")
    .filter((b) => b.classList.contains("deck-skill"))
    .map((b) => b.textContent);

afterEach(cleanup);

describe("the radial skill deck", () => {
  it("fans out the enabled skills, favourites first", () => {
    setup([
      skill("agent-usage"),
      skill("workspace-digest", { favorite: true }),
      skill("hidden", { enabled: false }),
    ]);
    expect(slugs()).toEqual(["workspace-digest", "agent-usage"]);
  });

  it("is a dialog, so the shell behind it cannot be reached", () => {
    setup([skill("smoke-test")]);
    const deck = screen.getByRole("dialog");
    expect(deck.getAttribute("aria-modal")).toBe("true");
  });

  it("runs the picked skill and closes, in that order", () => {
    const { runSkill, onClose } = setup([skill("smoke-test")]);
    fireEvent.click(screen.getByTitle("/smoke-test · smoke-test"));
    expect(runSkill).toHaveBeenCalledTimes(1);
    expect(runSkill.mock.calls[0]![0].slug).toBe("smoke-test");
    // Closing first keeps the exit animation off the run's critical path.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("marks a skill that already has a run in flight", () => {
    setup([skill("smoke-test"), skill("daily-news")], { runningSkills: new Set(["daily-news"]) });
    expect(screen.getByTitle("/daily-news · daily-news").className).toContain("live");
    expect(screen.getByTitle("/smoke-test · smoke-test").className).not.toContain("live");
  });

  it("owns up to the skills that did not fit instead of dropping them", () => {
    setup(Array.from({ length: 11 }, (_, i) => skill(`s${i}`)));
    const arc = slugs();
    // Eight skills and one seat that says where the other three went.
    expect(arc).toHaveLength(9);
    expect(arc[8]).toBe("+3 more");
    expect(arc.slice(0, 8)).toEqual(["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
  });

  it("keeps the whole arc when everything fits", () => {
    setup([skill("a"), skill("b")]);
    expect(slugs()).toEqual(["a", "b"]);
  });

  it("says so rather than showing an empty arc", () => {
    setup([skill("off", { enabled: false })]);
    expect(screen.getByText(/no skill is enabled/i)).toBeTruthy();
  });

  it("renders nothing at all while closed", () => {
    const qc = new QueryClient();
    qc.setQueryData(qk.skills, [skill("smoke-test")]);
    const { container } = render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <SkillDeck open={false} onClose={() => undefined} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
