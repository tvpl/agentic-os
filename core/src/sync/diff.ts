/** Minimal dependency-free unified diff (LCS-based), capped for UI display. */
export function unifiedDiff(oldText: string, newText: string, maxLines = 400): string {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  if (a.length * b.length > 4_000_000) {
    return `(diff too large: ${a.length} → ${b.length} lines)`;
  }
  // LCS table
  const m = a.length;
  const n = b.length;
  const lcs: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n && out.length < maxLines) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push(`- ${a[i]}`);
      i++;
    } else {
      out.push(`+ ${b[j]}`);
      j++;
    }
  }
  while (i < m && out.length < maxLines) out.push(`- ${a[i++]}`);
  while (j < n && out.length < maxLines) out.push(`+ ${b[j++]}`);
  if (i < m || j < n) out.push(`… (${m - i + (n - j)} more lines)`);
  return out.join("\n");
}
