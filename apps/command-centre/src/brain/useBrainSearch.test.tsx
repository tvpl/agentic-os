// @vitest-environment jsdom
/**
 * The search-as-you-type of the two brain screens (.specs/features/cerebro-correcoes, C24): a failed request is its
 * own state, and "Try again" asks once more for the current text and brings the new hits.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const apiCall = vi.fn();
vi.mock("../apiCall", () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

const { useBrainSearch } = await import("./useBrainSearch");

beforeEach(() => apiCall.mockReset());

describe("C24 the brain search after a failure", () => {
  it("C24 a failed request is the failed state with no hits; retry asks again for the current text once, and its hits come back", async () => {
    apiCall.mockResolvedValueOnce([{ id: 1, name: "velha.md", rel: "velha.md" }]);
    const { result, rerender } = renderHook(({ q }) => useBrainSearch(q), { initialProps: { q: "velha" } });
    await waitFor(() => expect(result.current.hits.map((h) => h.name)).toEqual(["velha.md"]));
    expect(result.current.failed).toBe(false);

    apiCall.mockRejectedValueOnce(new Error("500"));
    rerender({ q: "nova" });
    await waitFor(() => expect(result.current.failed).toBe(true));
    // the hits of the earlier query are gone with the failure
    expect(result.current.hits).toEqual([]);
    expect(apiCall).toHaveBeenCalledTimes(2);

    apiCall.mockResolvedValueOnce([{ id: 2, name: "nova.md", rel: "nova.md" }]);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.hits.map((h) => h.name)).toEqual(["nova.md"]));
    expect(result.current.failed).toBe(false);
    expect(apiCall).toHaveBeenCalledTimes(3);
    expect(apiCall.mock.calls[2]).toEqual(["GET /api/memory/search", { query: { q: "nova", limit: 8 } }]);
  });
});
