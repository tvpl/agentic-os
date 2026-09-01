import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../security/redact.js";

/**
 * Rotating JSONL logger. One logical stream per name (e.g. "runs").
 * Every line goes through secret redaction before touching disk.
 */
export class JsonlLogger {
  constructor(
    private readonly dir: string,
    private readonly name: string,
    private readonly maxFileBytes: number,
    private readonly retentionDays: number,
  ) {
    fs.mkdirSync(dir, { recursive: true });
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
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.renameSync(this.currentFile, path.join(this.dir, `${this.name}.jsonl.${stamp}`));
    this.prune();
  }

  prune(): void {
    const cutoff = Date.now() - this.retentionDays * 86_400_000;
    for (const file of fs.readdirSync(this.dir)) {
      if (!file.startsWith(`${this.name}.jsonl.`)) continue;
      const full = path.join(this.dir, file);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      } catch {
        /* best effort */
      }
    }
  }
}
