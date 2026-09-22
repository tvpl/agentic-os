import { describe, expect, it } from "vitest";
import { estimateRun } from "./estimate";

const run = (over: Partial<Parameters<typeof estimateRun>[0][number]>) => ({
  status: "done",
  skillSlug: "digest",
  promptSummary: "",
  durationMs: 40_000,
  usage: { costUsd: 0.1 },
  ...over,
});

describe("estimateRun", () => {
  it("needs three finished runs of the same skill and answers the median", () => {
    expect(estimateRun([run({}), run({})], { skillSlug: "digest" })).toBeNull();
    const est = estimateRun(
      [
        run({ usage: { costUsd: 0.1 } }),
        run({ usage: { costUsd: 0.3 } }),
        run({ usage: { costUsd: 9 }, durationMs: 900_000 }),
        run({ status: "failed", usage: { costUsd: 50 } }),
      ],
      { skillSlug: "digest" },
    );
    expect(est).toEqual({ usd: 0.3, ms: 40_000, samples: 3 });
  });

  it("matches prompt runs by their head", () => {
    const rows = [1, 2, 3].map(() =>
      run({ skillSlug: null, promptSummary: "resuma o dia de hoje em três linhas" }),
    );
    expect(estimateRun(rows, { prompt: "Resuma o dia de hoje em três linhas, por favor" })?.samples).toBe(3);
    expect(estimateRun(rows, { prompt: "outra coisa" })).toBeNull();
  });
});
