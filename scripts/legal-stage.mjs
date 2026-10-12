/**
 * What the installer carries of the legal side (.specs/features/licenca-comercial, door 6): `LICENSE`, the whole
 * `legal/` folder and the SBOM as `legal/sbom.cdx.json`. Called by `scripts/package.mjs`; a function of its own
 * so tests/legal.docs.test.ts can run it without building the app.
 */
import fs from "node:fs";
import path from "node:path";
import { buildSbom } from "./sbom.mjs";
import { buildRustSbom } from "./sbom-rust.mjs";

export function stageLegal(root, payload) {
  fs.copyFileSync(path.join(root, "LICENSE"), path.join(payload, "LICENSE"));
  // The CycloneDX schemas (Apache-2.0) are test fixtures of the repository, not something the installer carries.
  const schemas = path.join(root, "legal", "vendor", "cyclonedx");
  fs.cpSync(path.join(root, "legal"), path.join(payload, "legal"), {
    recursive: true,
    filter: (src) => src !== schemas,
  });
  fs.writeFileSync(
    path.join(payload, "legal", "sbom.cdx.json"),
    JSON.stringify(buildSbom(root), null, 2) + "\n",
  );
}

/**
 * What the desktop app's payload carries besides `stageLegal`'s: the notice of its Rust crates (already inside `legal/`)
 * and the SBOM of those crates, `legal/sbom.desktop.cdx.json` (.specs/features/distribuicao).
 */
export function stageDesktopLegal(root, payload) {
  fs.writeFileSync(
    path.join(payload, "legal", "sbom.desktop.cdx.json"),
    JSON.stringify(buildRustSbom(root), null, 2) + "\n",
  );
}
