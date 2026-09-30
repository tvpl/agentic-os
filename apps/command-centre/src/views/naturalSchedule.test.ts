import { describe, expect, it } from "vitest";
import { naturalToCron } from "./naturalSchedule";

describe("naturalToCron", () => {
  it("understands the phrases people actually type", () => {
    expect(naturalToCron("toda segunda às 8")).toBe("0 8 * * 1");
    expect(naturalToCron("todo dia às 9:30")).toBe("30 9 * * *");
    expect(naturalToCron("de segunda a sexta às 18h")).toBe("0 18 * * 1-5");
    expect(naturalToCron("every day at 9")).toBe("0 9 * * *");
    expect(naturalToCron("every monday at 8am")).toBe("0 8 * * 1");
    expect(naturalToCron("weekdays at 7pm")).toBe("0 19 * * 1-5");
    expect(naturalToCron("sábado e domingo às 10")).toBe("0 10 * * 0,6");
    expect(naturalToCron("a cada hora")).toBe("0 * * * *");
    expect(naturalToCron("every 15 minutes")).toBe("*/15 * * * *");
    expect(naturalToCron("todo mês às 8")).toBe("0 8 1 * *");
  });

  it("is null for what it does not know", () => {
    expect(naturalToCron("quando der")).toBeNull();
    expect(naturalToCron("às 25")).toBeNull();
    expect(naturalToCron("")).toBeNull();
  });
});
