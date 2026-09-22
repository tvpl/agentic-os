import { describe, expect, it } from "vitest";
import { tf, type TKey, type TVars } from "../i18n";
import { briefingDue, composeBriefing, localDay } from "./briefing";

const pt = (k: TKey, v?: TVars) => tf("pt-BR", k, v);
const NOW = Date.UTC(2026, 8, 21, 12);
const H = 3_600_000;

describe("briefing", () => {
  it("is due once per local day", () => {
    expect(briefingDue(null, NOW)).toBe(true);
    expect(briefingDue(localDay(NOW), NOW)).toBe(false);
    expect(briefingDue(localDay(NOW - 24 * H), NOW)).toBe(true);
  });

  it("opens with what ran, what failed and what waits", () => {
    const b = composeBriefing(
      {
        now: NOW,
        todayUsd: 0.08,
        pendingApprovals: 1,
        runs: [
          {
            status: "done",
            finishedAt: NOW - H,
            createdAt: NOW - 2 * H,
            skillSlug: "digest",
            promptSummary: "",
          },
          {
            status: "failed",
            finishedAt: NOW - 3 * H,
            createdAt: NOW - 4 * H,
            skillSlug: "consolidate-memory",
            promptSummary: "",
          },
          {
            status: "failed",
            finishedAt: NOW - 40 * H,
            createdAt: NOW - 41 * H,
            skillSlug: "old",
            promptSummary: "",
          },
        ],
        routines: [
          { name: "Nightly", enabled: true, healthy: false, nextRunAt: NOW + 5 * H },
          { name: "Digest", enabled: true, healthy: true, nextRunAt: NOW + 2 * H },
        ],
      },
      pt,
    );
    expect(b.quiet).toBe(false);
    expect(b.lines).toEqual([
      "Nas últimas 24 h: 1 execução concluída, 1 falhou.",
      "Falhou: /consolidate-memory.",
      "1 rotina parou de funcionar: Nightly.",
      "1 decisão espera por você.",
      "Próxima rotina: Digest em 2 h.",
      "Gasto hoje: US$ 0.08.",
    ]);
    expect(b.spoken.split(" ").length).toBeGreaterThan(3);
  });

  it("is one calm line when nothing happened", () => {
    const b = composeBriefing({ now: NOW, todayUsd: 0, pendingApprovals: 0, runs: [], routines: [] }, pt);
    expect(b.quiet).toBe(true);
    expect(b.lines).toEqual(["Noite tranquila: nada rodou, nada falhou, nada espera por você."]);
  });
});
