import { describe, expect, it } from "vitest";
import { answersFor, complete, isQuestion, questionsOf } from "./question";

const approval = (input: unknown, toolName = "AskUserQuestion") => ({
  kind: "tool_use" as const,
  payload: { toolName, input },
});

describe("agent questions", () => {
  it("reads the questions, their options and whether they take several answers", () => {
    const qs = questionsOf(
      approval({
        questions: [
          {
            question: "Por onde começamos?",
            header: "Foco",
            multiSelect: false,
            options: [{ label: "Testes", description: "rodar a suíte" }, "Docs", { nope: 1 }],
          },
          { question: "  " },
          { question: "Quais áreas?", multiSelect: true, options: [{ label: "UI" }, { label: "API" }] },
        ],
      }),
    );
    expect(qs).toEqual([
      {
        question: "Por onde começamos?",
        header: "Foco",
        multiSelect: false,
        options: [{ label: "Testes", description: "rodar a suíte" }, { label: "Docs" }],
      },
      {
        question: "Quais áreas?",
        header: undefined,
        multiSelect: true,
        options: [{ label: "UI" }, { label: "API" }],
      },
    ]);
  });

  it("is not a question when the tool is another one", () => {
    expect(isQuestion(approval({}, "Bash"))).toBe(false);
    expect(questionsOf(approval({}, "Bash"))).toBeNull();
    expect(questionsOf(approval({ questions: "x" }))).toEqual([]);
  });

  it("answers with the picks, joined, and a written answer wins", () => {
    const qs = questionsOf(
      approval({
        questions: [
          { question: "A?", options: ["x", "y"] },
          { question: "B?", multiSelect: true, options: ["1", "2"] },
          { question: "C?", options: ["k"] },
        ],
      }),
    )!;
    const answers = answersFor(qs, { "A?": ["x"], "B?": ["1", "2"], "C?": ["k"] }, { "C?": " outra coisa " });
    expect(answers).toEqual({ "A?": "x", "B?": "1, 2", "C?": "outra coisa" });
    expect(complete(qs, answers)).toBe(true);
    expect(complete(qs, { "A?": "x" })).toBe(false);
  });
});
