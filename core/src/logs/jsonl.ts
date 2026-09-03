import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../security/redact.js";

function rotationStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Rotate `filePath` when it exceeds `maxBytes`: the file is renamed to
 * `<name>.<timestamp>` next to itself. Returns the rotated path, or null when
 * no rotation happened. Optional `retentionDays` prunes older rotations.
 * Used for JSONL streams and for the service stdout log (`service.out.log`).
 */
export function rotateFile(filePath: string, maxBytes: number, retentionDays?: number): string | null {
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return null;
  }
  if (size <= maxBytes) return null;
  const rotated = `${filePath}.${rotationStamp()}`;
  try {
    fs.renameSync(filePath, rotated);
  } catch {
    return null;
  }
  if (retentionDays !== undefined) pruneRotated(filePath, retentionDays);
  return rotated;
}

/** Delete rotations of `filePath` (`<file>.<stamp>`) older than `retentionDays`. */
export function pruneRotated(filePath: string, retentionDays: number): number {
  const dir = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.`;
  const cutoff = Date.now() - retentionDays * 86_400_000;
  let removed = 0;
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const file of entries) {
    if (!file.startsWith(prefix)) continue;
    const full = path.join(dir, file);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) {
        fs.unlinkSync(full);
        removed++;
      }
    } catch {
      /* best effort */
    }
  }
  return removed;
}

/**
 * Rotating JSONL logger. One logical stream per name (e.g. "runs").
 * Every line goes through secret redaction before touching disk.
 * Old rotations are pruned on construction (boot) and after every rotation.
 */
export class JsonlLogger {
  constructor(
    private readonly dir: string,
    private readonly name: string,
    private readonly maxFileBytes: number,
    private readonly retentionDays: number,
  ) {
    fs.mkdirSync(dir, { recursive: true });
    try {
      this.prune();
    } catch {
      /* best effort */
    }
  }

  private get currentFile(): string {
    return path.join(this.dir, `${this.name}.jsonl`);
  }

  append(record: Record<string, unknown>): void {
    const line = redactSecrets(JSON.stringify({ ts: Date.now(), ...record })) + "\n";
    this.rotateIfNeeded(Buffer.byteLength(line));
    fs.appendFileSync(this.currentFile, line, "utf8");
  }

  private rotateIfNeeded(incoming: number): void {
    let size = 0;
    try {
      size = fs.statSync(this.currentFile).size;
    } catch {
      return;
    }
    if (size + incoming <= this.maxFileBytes) return;
    fs.renameSync(this.currentFile, `${this.currentFile}.${rotationStamp()}`);
    this.prune();
  }

  prune(): number {
    return pruneRotated(this.currentFile, this.retentionDays);
  }
}
