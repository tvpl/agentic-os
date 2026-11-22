import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * .specs/features/cerebro-perguntar, the contracts and the documents. Batch B: what docs/security.md says of
 * `mordomo mcp` (C49).
 */

const repo = path.resolve(import.meta.dirname, "..");
const security = fs.readFileSync(path.join(repo, "docs", "security.md"), "utf8");

/** The bullet of docs/security.md that holds `text` (from its `- ` to the next bullet or heading), on one line. */
function paragraphOf(page: string, text: string): string {
  const lines = page.split("\n");
  const at = lines.findIndex((l) => l.includes(text));
  if (at < 0) return "";
  let start = at;
  while (start > 0 && !lines[start]!.startsWith("- ")) start -= 1;
  let end = at + 1;
  while (end < lines.length && lines[end]!.startsWith("  ")) end += 1;
  return lines
    .slice(start, end)
    .map((l) => l.trim())
    .join(" ");
}

describe("C49 docs/security.md on the MCP", () => {
  it("C49 the MCP paragraph says the tools send x-mordomo-as: mcp, read with the agents' folder rules, only call MCP_ROUTES, and that it is not containment; the old sentence is gone", () => {
    const mcp = paragraphOf(security, "**`mordomo mcp` reads as agents read**");
    // the paragraph is the one of the folder levels' limits, where the old sentence was
    expect(mcp.startsWith("- **Limits.**")).toBe(true);
    expect(mcp).toContain("`x-mordomo-as: mcp`");
    expect(mcp).toContain("read with the agents' folder rules");
    expect(mcp).toContain("may only call `MCP_ROUTES`");
    expect(mcp).toContain("**This is not containment:**");
    expect(mcp).toContain("whoever holds it can call the API without the header and read as the owner");
    expect(security).not.toContain("`mordomo mcp` reads with the owner's token");
    expect(security).not.toContain("**`mordomo mcp` reads with the owner's token**");
  });
});
