import { describe, expect, it } from "vitest";
import { activityKind, mergeActivity } from "./activity";

describe("activity satellites", () => {
  it("reads a kind from the sentence", () => {
    expect(activityKind("Li o arquivo")).toBe("read");
    expect(activityKind("Editei src/x.ts")).toBe("write");
    expect(activityKind("Executei npm test")).toBe("run");
    expect(activityKind("Busquei por TODO")).toBe("search");
    expect(activityKind("Abri https://example.com")).toBe("web");
    expect(activityKind("algo")).toBe("other");
  });

  it("keeps the birth time of what it already saw and labels by subject", () => {
    const first = mergeActivity([], [{ text: "Li", subject: "notes/plan.md", tone: "ok" }], 100);
    expect(first[0]).toMatchObject({ label: "plan.md", kind: "read", at: 100 });
    const next = mergeActivity(
      first,
      [
        { text: "Li", subject: "notes/plan.md", tone: "ok" },
        { text: "Executei", subject: "npm test", tone: "ok" },
      ],
      500,
    );
    expect(next.map((a) => a.at)).toEqual([100, 500]);
  });
});
