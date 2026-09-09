// @vitest-environment jsdom
import { createElement, useEffect, useRef, useState } from "react";
import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useGridMetrics, type GridMetrics } from "./useGridLayout";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("reporting unchanged grid metrics settles instead of continuously updating the desktop", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  let reports = 0;
  function Grid({ report }: { report: (metrics: GridMetrics) => void }) {
    const ref = useRef<HTMLDivElement>(null);
    const metrics = useGridMetrics(ref);
    useEffect(() => {
      reports++;
      if (reports > 8) throw new Error("Grid metrics feedback loop");
      report(metrics);
    }, [metrics, report]);
    return createElement("div", { ref });
  }
  function Desktop() {
    const [metrics, setMetrics] = useState<GridMetrics | null>(null);
    return createElement(
      "section",
      { "data-width": metrics?.width },
      createElement(Grid, { report: setMetrics }),
    );
  }
  render(createElement(Desktop));
  expect(reports).toBeLessThanOrEqual(3);
});
