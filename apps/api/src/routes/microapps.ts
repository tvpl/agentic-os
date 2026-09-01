import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

const PNG_PREFIX = "data:image/png;base64,";
const MAX_PNG_BYTES = 2 * 1024 * 1024;

/** Decode a PNG data URL, enforcing prefix + size; 400 on anything else. */
function decodePngDataUrl(dataUrl: string, field: string): Buffer {
  if (!dataUrl.startsWith(PNG_PREFIX)) {
    throw Object.assign(new Error(`${field} must be a base64 PNG data URL`), { statusCode: 400 });
  }
  const b64 = dataUrl.slice(PNG_PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    throw Object.assign(new Error(`${field} is not valid base64`), { statusCode: 400 });
  }
  const buf = Buffer.from(b64, "base64");
  if (buf.byteLength === 0) {
    throw Object.assign(new Error(`${field} decoded to an empty image`), { statusCode: 400 });
  }
  if (buf.byteLength > MAX_PNG_BYTES) {
    throw Object.assign(new Error(`${field} exceeds the 2MB limit`), { statusCode: 400 });
  }
  return buf;
}

export function registerMicroappRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * Save a Pixel Studio drawing into the artifacts directory.
   * The name regex is the only path input — no separators, no dots — so the
   * destination is contained in <artifacts>/pixel-studio by construction.
   */
  app.post("/api/microapps/pixel/save", async (req) => {
    const body = z
      .object({
        name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
        dataUrl: z.string(),
        spriteSheetDataUrl: z.string().optional(),
        frames: z.number().int().min(1).optional(),
      })
      .parse(req.body);

    const png = decodePngDataUrl(body.dataUrl, "dataUrl");
    const sheet =
      body.spriteSheetDataUrl !== undefined
        ? decodePngDataUrl(body.spriteSheetDataUrl, "spriteSheetDataUrl")
        : null;

    const dir = path.join(ctx.paths.artifacts, "pixel-studio");
    fs.mkdirSync(dir, { recursive: true });

    const saved: string[] = [];
    const framePath = path.join(dir, `${body.name}.png`);
    fs.writeFileSync(framePath, png);
    saved.push(framePath);

    if (sheet) {
      const sheetPath = path.join(dir, `${body.name}.sheet.png`);
      fs.writeFileSync(sheetPath, sheet);
      saved.push(sheetPath);
    }

    return { saved };
  });
}
